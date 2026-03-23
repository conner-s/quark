use crate::gif::{GifProvider, GifResult};
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
            urlencoding::encode(query),
            self.api_key,
            limit,
            content_filter,
        );

        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Tenor API request failed: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Tenor API error: HTTP {}", response.status()));
        }

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

// Helper module for URL encoding (we use reqwest's built-in)
mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut encoded = String::new();
        for c in s.chars() {
            match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                    encoded.push(c);
                }
                ' ' => encoded.push('+'),
                c => {
                    for byte in c.to_string().as_bytes() {
                        encoded.push('%');
                        encoded.push_str(&format!("{:02X}", byte));
                    }
                }
            }
        }
        encoded
    }
}
