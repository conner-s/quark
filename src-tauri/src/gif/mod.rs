pub mod giphy;
pub mod klipy;
pub mod tenor;

use serde::{Deserialize, Serialize};

/// A GIF result from any provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GifResult {
    pub id: String,
    pub title: String,
    /// Direct URL to the full GIF.
    pub url: String,
    /// URL to a smaller preview/thumbnail.
    pub preview_url: String,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

/// Unified GIF search provider trait.
pub trait GifProvider {
    fn search(
        &self,
        query: &str,
        limit: u32,
        rating: &str,
    ) -> impl std::future::Future<Output = Result<Vec<GifResult>, String>> + Send;
}
