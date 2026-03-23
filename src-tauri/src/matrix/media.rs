use matrix_sdk::{
    media::{MediaFormat, MediaRequestParameters, MediaThumbnailSettings},
    ruma::{
        api::client::media::get_content_thumbnail::v3::Method,
        events::room::MediaSource,
        MxcUri, UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

/// Result of a media download — base64-encoded bytes + mime type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDownload {
    /// Base64-encoded file content.
    pub data_base64: String,
    pub mime_type: String,
    pub filename: Option<String>,
}

/// Encode bytes to base64 without an external crate.
fn to_base64(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };

        result.push(CHARS[(b0 >> 2)] as char);
        result.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Upload a file to the homeserver and return its mxc:// URL.
pub async fn upload_media(
    client: &Client,
    data: Vec<u8>,
    mime_type: &str,
    _filename: Option<&str>,
) -> Result<String, String> {
    let mime: mime::Mime = mime_type
        .parse()
        .map_err(|e| format!("Invalid MIME type: {e}"))?;

    let response = client
        .media()
        .upload(&mime, data, None)
        .await
        .map_err(|e| format!("Failed to upload media: {e}"))?;

    let mxc_url = response.content_uri.to_string();
    info!(url = %mxc_url, "Media uploaded");
    Ok(mxc_url)
}

/// Download media from an mxc:// URL.
pub async fn download_media(
    client: &Client,
    mxc_url: &str,
    allow_thumbnail: bool,
    thumbnail_width: Option<u32>,
    thumbnail_height: Option<u32>,
) -> Result<MediaDownload, String> {
    let mxc_uri = <&MxcUri>::try_from(mxc_url).map_err(|e| format!("Invalid mxc URI: {e}"))?;

    let source = MediaSource::Plain(mxc_uri.to_owned());

    let format = if allow_thumbnail {
        let width = thumbnail_width.unwrap_or(320);
        let height = thumbnail_height.unwrap_or(240);
        MediaFormat::Thumbnail(MediaThumbnailSettings::new(
            UInt::try_from(width as u64).unwrap_or(UInt::from(320u32)),
            UInt::try_from(height as u64).unwrap_or(UInt::from(240u32)),
        ))
    } else {
        MediaFormat::File
    };

    let request = MediaRequestParameters { source, format };

    let bytes = client
        .media()
        .get_media_content(&request, true)
        .await
        .map_err(|e| format!("Failed to download media: {e}"))?;

    let data_base64 = to_base64(&bytes);

    Ok(MediaDownload {
        data_base64,
        mime_type: "application/octet-stream".to_string(),
        filename: None,
    })
}

/// Upload a file from disk to the homeserver.
pub async fn upload_file(
    client: &Client,
    file_path: &str,
) -> Result<String, String> {
    let path = Path::new(file_path);

    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let data = std::fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;

    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    };

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(String::from);

    upload_media(client, data, mime_type, filename.as_deref()).await
}
