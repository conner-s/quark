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

/// The configured sanitizer, built once and shared. `ammonia::Builder` is
/// `Send + Sync` (it holds only `'static` allowlists and no filter closures), so
/// a single instance can clean from any thread.
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
        b.tags(ALLOWED_TAGS.iter().copied().collect())
            .url_schemes(ALLOWED_SCHEMES.iter().copied().collect())
            .tag_attributes(tag_attributes);
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
}
