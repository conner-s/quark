use crate::gif::{self, GifProvider, GifResult};
use reqwest::Client;
use serde::Deserialize;

/// Tenor API v2 GIF search client.
pub struct TenorClient {
    api_key: String,
    http: Client,
}

impl TenorClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            http: Client::new(),
        }
    }
}

// Tenor API response types
#[derive(Debug, Deserialize)]
struct TenorResponse {
    results: Vec<TenorGif>,
    #[serde(default)]
    next: String,
}

#[derive(Debug, Deserialize)]
struct TenorGif {
    id: String,
    title: String,
    media_formats: std::collections::HashMap<String, TenorMediaFormat>,
}

#[derive(Debug, Deserialize)]
struct TenorMediaFormat {
    url: String,
    dims: Vec<u32>,
    #[serde(default)]
    size: u64,
}

impl GifProvider for TenorClient {
    async fn search(
        &self,
        query: &str,
        limit: u32,
        rating: &str,
    ) -> Result<Vec<GifResult>, String> {
        let content_filter = match rating {
            "g" => "high",
            "pg" => "medium",
            "pg-13" => "low",
            "r" => "off",
            _ => "medium",
        };

        let url = format!(
            "https://tenor.googleapis.com/v2/search?q={}&key={}&limit={}&contentfilter={}&media_filter=gif,tinygif",
            gif::encode_query(query),
            self.api_key,
            limit,
            content_filter,
        );

        let response = gif::fetch_response(&self.http, "Tenor", &url).await?;

        let tenor_resp: TenorResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Tenor response: {e}"))?;

        let results: Vec<GifResult> = tenor_resp
            .results
            .into_iter()
            .filter_map(|gif| {
                let full = gif.media_formats.get("gif")?;
                let preview = gif
                    .media_formats
                    .get("tinygif")
                    .or_else(|| gif.media_formats.get("gif"))?;

                let (width, height) = full
                    .dims
                    .first()
                    .zip(full.dims.get(1))
                    .map(|(&w, &h)| (w, h))
                    .unwrap_or((0, 0));

                Some(GifResult {
                    id: gif.id,
                    title: gif.title,
                    url: full.url.clone(),
                    preview_url: preview.url.clone(),
                    width,
                    height,
                })
            })
            .collect();

        Ok(results)
    }
}

/// Map a rating string to the Tenor contentfilter parameter value.
pub(crate) fn rating_to_content_filter(rating: &str) -> &'static str {
    match rating {
        "g" => "high",
        "pg" => "medium",
        "pg-13" => "low",
        "r" => "off",
        _ => "medium",
    }
}

/// Build a Tenor search URL from parts (without making an HTTP request).
pub(crate) fn build_search_url(query: &str, api_key: &str, limit: u32, rating: &str) -> String {
    let content_filter = rating_to_content_filter(rating);
    format!(
        "https://tenor.googleapis.com/v2/search?q={}&key={}&limit={}&contentfilter={}&media_filter=gif,tinygif",
        gif::encode_query(query),
        api_key,
        limit,
        content_filter,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Content filter mapping ---

    #[test]
    fn test_rating_g_maps_to_high() {
        assert_eq!(rating_to_content_filter("g"), "high");
    }

    #[test]
    fn test_rating_pg_maps_to_medium() {
        assert_eq!(rating_to_content_filter("pg"), "medium");
    }

    #[test]
    fn test_rating_pg13_maps_to_low() {
        assert_eq!(rating_to_content_filter("pg-13"), "low");
    }

    #[test]
    fn test_rating_r_maps_to_off() {
        assert_eq!(rating_to_content_filter("r"), "off");
    }

    #[test]
    fn test_unknown_rating_defaults_to_medium() {
        assert_eq!(rating_to_content_filter("x"), "medium");
        assert_eq!(rating_to_content_filter(""), "medium");
        assert_eq!(rating_to_content_filter("adult"), "medium");
    }

    // --- URL construction ---

    #[test]
    fn test_build_search_url_simple_query() {
        let url = build_search_url("cats", "MY_KEY", 20, "pg");
        assert!(url.starts_with("https://tenor.googleapis.com/v2/search?"));
        assert!(url.contains("q=cats"));
        assert!(url.contains("key=MY_KEY"));
        assert!(url.contains("limit=20"));
        assert!(url.contains("contentfilter=medium"));
        assert!(url.contains("media_filter=gif,tinygif"));
    }

    #[test]
    fn test_build_search_url_spaces_encoded() {
        let url = build_search_url("funny cats", "KEY", 10, "g");
        // Spaces become '+'
        assert!(url.contains("q=funny+cats"));
        assert!(url.contains("contentfilter=high"));
    }

    #[test]
    fn test_build_search_url_special_chars_encoded() {
        let url = build_search_url("hello & world", "KEY", 5, "pg-13");
        // '&' is not in the safe set — it should be percent-encoded
        assert!(url.contains("%26"));
        assert!(url.contains("contentfilter=low"));
    }

    #[test]
    fn test_build_search_url_r_rating() {
        let url = build_search_url("test", "KEY", 50, "r");
        assert!(url.contains("contentfilter=off"));
    }

    #[test]
    fn test_build_search_url_limit_embedded() {
        let url = build_search_url("dogs", "APIKEY123", 42, "pg");
        assert!(url.contains("limit=42"));
        assert!(url.contains("key=APIKEY123"));
    }

    // --- encode_query helper (shared in gif::mod) ---

    #[test]
    fn test_urlencoding_safe_chars_unchanged() {
        let result = crate::gif::encode_query("hello-world_test.~");
        assert_eq!(result, "hello-world_test.~");
    }

    #[test]
    fn test_urlencoding_space_becomes_plus() {
        assert_eq!(crate::gif::encode_query("hello world"), "hello+world");
    }

    #[test]
    fn test_urlencoding_special_chars_percent_encoded() {
        let result = crate::gif::encode_query("a=b&c=d");
        assert!(result.contains("%3D") || result.contains("%3d")); // '='
        assert!(result.contains("%26")); // '&'
    }

    #[test]
    fn test_urlencoding_empty_string() {
        assert_eq!(crate::gif::encode_query(""), "");
    }

    #[test]
    fn test_urlencoding_alphanumeric_unchanged() {
        assert_eq!(crate::gif::encode_query("abc123XYZ"), "abc123XYZ");
    }
}
