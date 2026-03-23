use crate::gif::{GifProvider, GifResult};
use reqwest::Client;
use serde::Deserialize;

/// Giphy API GIF search client.
pub struct GiphyClient {
    api_key: String,
    http: Client,
}

impl GiphyClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            http: Client::new(),
        }
    }
}

// Giphy API response types
#[derive(Debug, Deserialize)]
struct GiphyResponse {
    data: Vec<GiphyGif>,
}

#[derive(Debug, Deserialize)]
struct GiphyGif {
    id: String,
    title: String,
    images: GiphyImages,
}

#[derive(Debug, Deserialize)]
struct GiphyImages {
    original: GiphyImage,
    fixed_width_small: GiphyImage,
}

#[derive(Debug, Deserialize)]
struct GiphyImage {
    url: String,
    #[serde(default)]
    width: String,
    #[serde(default)]
    height: String,
}

impl GifProvider for GiphyClient {
    async fn search(
        &self,
        query: &str,
        limit: u32,
        rating: &str,
    ) -> Result<Vec<GifResult>, String> {
        // Giphy uses g, pg, pg-13, r ratings directly
        let giphy_rating = match rating {
            "pg-13" => "pg-13",
            r @ ("g" | "pg" | "r") => r,
            _ => "pg",
        };

        let url = format!(
            "https://api.giphy.com/v1/gifs/search?q={}&api_key={}&limit={}&rating={}",
            encode_query(query),
            self.api_key,
            limit,
            giphy_rating,
        );

        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Giphy API request failed: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Giphy API error: HTTP {}", response.status()));
        }

        let giphy_resp: GiphyResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Giphy response: {e}"))?;

        let results: Vec<GifResult> = giphy_resp
            .data
            .into_iter()
            .map(|gif| {
                let width: u32 = gif.images.original.width.parse().unwrap_or(0);
                let height: u32 = gif.images.original.height.parse().unwrap_or(0);

                GifResult {
                    id: gif.id,
                    title: gif.title,
                    url: gif.images.original.url,
                    preview_url: gif.images.fixed_width_small.url,
                    width,
                    height,
                }
            })
            .collect();

        Ok(results)
    }
}

fn encode_query(s: &str) -> String {
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
