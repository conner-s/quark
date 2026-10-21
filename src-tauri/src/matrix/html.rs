//! Sanitization of incoming Matrix HTML (`org.matrix.custom.html`).
//!
//! `formatted_body` on `m.room.message` is attacker-controlled — any sender in
//! any joined room can put arbitrary markup there — and the frontend renders it
//! into the WebView via `innerHTML`. Without sanitization that's a stored-XSS
//! sink (`<script>`, `<img onerror=…>`, `javascript:` URLs, …) made fully
//! exploitable by the (formerly) `null` CSP.
//!
//! Matrix specifies a strict allowlist of tags and attributes for this field
//! (client-server spec, *m.room.message msgtypes*). We enforce that allowlist on
//! the **read path**: every place the backend lifts a remote `formatted_body`
//! out of an event funnels through [`sanitize`], so all frontend render sinks are
//! covered at the source rather than one `innerHTML` at a time.

use ammonia::Builder;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// Tags permitted in `org.matrix.custom.html` (Matrix CS spec), plus `mx-reply`
/// — the reply-fallback wrapper the frontend strips in `stripReplyFallback`,
/// which only works if the `<mx-reply>` element survives intact.
const ALLOWED_TAGS: &[&str] = &[
    "font", "del", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a",
    "ul", "ol", "sup", "sub", "li", "b", "i", "u", "strong", "em", "strike",
    "code", "hr", "br", "div", "table", "thead", "tbody", "tr", "th", "td",
    "caption", "pre", "span", "img", "details", "summary", "mx-reply",
];

/// URL schemes permitted in `href` / `src`. `mxc` is required for inline custom
/// emoji and images (MSC2545); `matrix` for `matrix:` permalinks. Notably
/// absent: `javascript`, `data`, `vbscript`, `file`.
const ALLOWED_SCHEMES: &[&str] =
    &["http", "https", "ftp", "mailto", "magnet", "matrix", "mxc"];

/// Whether `token` is a `language-*` class whose language name stays within the
/// charset the composer accepts for a fence info word (`[A-Za-z0-9_+#.-]+`,
/// covering `c++`, `c#`, `objective-c`, `vue.js`).
fn is_language_class(token: &str) -> bool {
    token.strip_prefix("language-").is_some_and(|lang| {
        !lang.is_empty()
            && lang
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_+#.-".contains(&b))
    })
}

/// Narrow `class` on `<code>` to its `language-*` tokens, dropping the
/// attribute when none are left; every other attribute passes through as is.
///
/// The spec allows `class` on `<code>` only for `language-*`, the hint a sender
/// attaches to a fenced code block, and that hint is all the frontend reads (to
/// pick a highlight.js grammar). Anything else in the attribute is a remote
/// sender reaching for the app's own classes: `hljs-*` to fake highlighting,
/// or a UI class the stylesheet already styles. The charset keeps the language
/// name to what a fence can express, so nothing odd reaches the grammar lookup.
fn filter_attribute<'u>(element: &str, attribute: &str, value: &'u str) -> Option<Cow<'u, str>> {
    if element != "code" || attribute != "class" {
        return Some(Cow::Borrowed(value));
    }
    // ASCII whitespace is what HTML itself splits a class list on.
    let kept: Vec<&str> = value
        .split_ascii_whitespace()
        .filter(|token| is_language_class(token))
        .collect();
    if kept.is_empty() {
        None
    } else {
        Some(Cow::Owned(kept.join(" ")))
    }
}

/// The configured sanitizer, built once and shared. `ammonia::Builder` is
/// `Send + Sync`: its allowlists are `'static`, and ammonia requires the
/// attribute filter to be `Send + Sync` as well (here a plain fn), so a single
/// instance can clean from any thread.
fn cleaner() -> &'static Builder<'static> {
    static CLEANER: OnceLock<Builder<'static>> = OnceLock::new();
    CLEANER.get_or_init(|| {
        let mut tag_attributes: HashMap<&str, HashSet<&str>> = HashMap::new();
        // `rel` is deliberately omitted: ammonia's `link_rel` default injects
        // `rel="noopener noreferrer"` on every link, and allowing an incoming
        // `rel` alongside that is rejected.
        tag_attributes.insert("a", ["name", "target", "href"].into_iter().collect());
        tag_attributes.insert(
            "img",
            ["width", "height", "alt", "title", "src", "data-mx-emoticon"]
                .into_iter()
                .collect(),
        );
        tag_attributes.insert("ol", ["start"].into_iter().collect());
        tag_attributes.insert("code", ["class"].into_iter().collect());
        tag_attributes.insert(
            "span",
            ["data-mx-bg-color", "data-mx-color", "data-mx-spoiler", "data-mx-maths"]
                .into_iter()
                .collect(),
        );
        tag_attributes.insert("div", ["data-mx-maths"].into_iter().collect());
        tag_attributes.insert(
            "font",
            ["data-mx-bg-color", "data-mx-color", "color"].into_iter().collect(),
        );

        let mut b = Builder::default();
        // `allowed_classes` can't narrow `<code class>`: ammonia refuses it while
        // `class` is also in `tag_attributes`, and it matches whole class names
        // rather than a `language-*` pattern. The filter runs after the
        // allowlists, so it only ever sees attributes they kept.
        b.tags(ALLOWED_TAGS.iter().copied().collect())
            .url_schemes(ALLOWED_SCHEMES.iter().copied().collect())
            .tag_attributes(tag_attributes)
            .attribute_filter(filter_attribute);
        b
    })
}

/// Sanitize a remote `formatted_body` down to the Matrix-permitted HTML subset.
/// Disallowed tags are unwrapped (their text content kept); disallowed
/// attributes, event handlers, and unsafe URL schemes are dropped; `<script>` /
/// `<style>` contents are removed entirely.
pub fn sanitize(html: &str) -> String {
    cleaner().clean(html).to_string()
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn strips_script_tags() {
        let out = sanitize("hi<script>alert(1)</script> there");
        assert!(!out.contains("<script"), "script tag survived: {out}");
        assert!(!out.contains("alert(1)"), "script body survived: {out}");
        assert!(out.contains("hi"));
    }

    #[test]
    fn strips_event_handler_attributes() {
        let out = sanitize(r#"<img src="mxc://x/y" onerror="alert(1)">"#);
        assert!(!out.contains("onerror"), "onerror survived: {out}");
        assert!(out.contains("mxc://x/y"), "legit mxc src dropped: {out}");
    }

    #[test]
    fn drops_javascript_url_scheme() {
        let out = sanitize(r#"<a href="javascript:alert(1)">click</a>"#);
        assert!(!out.contains("javascript:"), "javascript: URL survived: {out}");
        assert!(out.contains("click"));
    }

    #[test]
    fn keeps_basic_formatting() {
        let out = sanitize("<strong>bold</strong> and <em>italic</em>");
        assert!(out.contains("<strong>bold</strong>"));
        assert!(out.contains("<em>italic</em>"));
    }

    #[test]
    fn preserves_custom_emoji_image() {
        let out = sanitize(
            r#"<img data-mx-emoticon src="mxc://e/party" alt=":party:" title=":party:">"#,
        );
        assert!(out.contains("data-mx-emoticon"), "emoji marker dropped: {out}");
        assert!(out.contains("mxc://e/party"), "emoji mxc src dropped: {out}");
    }

    #[test]
    fn preserves_spoiler_span() {
        let out = sanitize(r#"<span data-mx-spoiler>secret</span>"#);
        assert!(out.contains("data-mx-spoiler"), "spoiler attr dropped: {out}");
        assert!(out.contains("secret"));
    }

    #[test]
    fn preserves_reply_fallback_wrapper() {
        // stripReplyFallback() on the frontend depends on the <mx-reply> element
        // surviving so it can be removed; otherwise the quote renders inline.
        let html = "<mx-reply><blockquote>quoted</blockquote></mx-reply>actual reply";
        let out = sanitize(html);
        assert!(out.starts_with("<mx-reply>"), "mx-reply wrapper dropped: {out}");
        assert!(out.contains("actual reply"));
    }

    // --- <code class>: only `language-*` survives ---

    #[test]
    fn keeps_code_language_class() {
        let out = sanitize(r#"<pre><code class="language-nix">inputs = { };</code></pre>"#);
        assert_eq!(out, r#"<pre><code class="language-nix">inputs = { };</code></pre>"#);
    }

    #[test]
    fn keeps_language_names_using_the_whole_fence_charset() {
        for lang in ["c++", "C#", "objective-c", "vue.js", "x86_64"] {
            let out = sanitize(&format!(r#"<code class="language-{lang}">x</code>"#));
            assert!(
                out.contains(&format!(r#"class="language-{lang}""#)),
                "language-{lang} dropped: {out}"
            );
        }
    }

    #[test]
    fn strips_non_language_tokens_from_code_class() {
        let out = sanitize(r#"<code class="language-nix hljs foo">x</code>"#);
        assert_eq!(out, r#"<code class="language-nix">x</code>"#);
    }

    #[test]
    fn drops_code_class_with_no_language_token() {
        let out = sanitize(r#"<code class="hljs-keyword">let</code>"#);
        assert_eq!(out, "<code>let</code>");
    }

    #[test]
    fn drops_language_class_outside_the_charset() {
        for class in ["language-<bad>", "language-", "language-a/b", "language-ñ"] {
            let out = sanitize(&format!(r#"<code class="{class}">x</code>"#));
            assert_eq!(out, "<code>x</code>", "class=\"{class}\" survived");
        }
        // A quote can't end the attribute early, but its fragments must not
        // survive as tokens either.
        let out = sanitize(r#"<code class='language-x" onclick="y'>x</code>"#);
        assert_eq!(out, "<code>x</code>");
    }

    #[test]
    fn filter_leaves_other_attributes_alone() {
        let out = sanitize(r#"<span data-mx-spoiler="reason">secret</span>"#);
        assert!(out.contains(r#"data-mx-spoiler="reason""#), "spoiler reason dropped: {out}");

        let out = sanitize(r#"<a href="https://example.org/a?b=c">link</a>"#);
        assert!(out.contains(r#"href="https://example.org/a?b=c""#), "href changed: {out}");
        assert!(out.contains(r#"rel="noopener noreferrer""#), "injected rel dropped: {out}");
    }

    // The filter only narrows; `class` stays disallowed everywhere but <code>.
    #[test]
    fn language_class_is_not_allowed_off_code() {
        let out = sanitize(r#"<span class="language-nix">x</span>"#);
        assert_eq!(out, "<span>x</span>");
    }
}
