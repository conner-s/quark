//! A tiny localhost HTTP server that serves decrypted media files with HTTP
//! Range support, used as the transport for inline `<video>` playback.
//!
//! Why not the asset protocol or a `blob:` URL? WebKitGTK's GStreamer media
//! pipeline can't read Tauri's asset/custom-scheme URLs for `<video>` at all,
//! and an in-webview `blob:` URL plays but isn't reliably *seekable* there
//! (seeking/replay throws "Failed to send data for decoding"). A real
//! `souphttpsrc` talking to `127.0.0.1` with `Accept-Ranges`/`Content-Range`
//! *is* fully seekable — GStreamer satisfies seeks with HTTP range requests —
//! and it streams from disk instead of holding the whole file in memory.
//!
//! The server binds to loopback only and gates every request behind an
//! unguessable path token; it only serves the `quark-media-<hash>.<ext>` temp
//! files this app writes.

use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Arc;

/// Worker threads serving requests. A small pool keeps one long in-flight
/// response (a large file, or one the user is about to seek/abort) from
/// blocking a concurrent range request on another connection.
const WORKERS: usize = 4;

pub struct MediaServer {
    pub port: u16,
    pub token: String,
    base_dir: PathBuf,
}

/// How to answer a request given its (optional) `Range` header.
enum RangeReq {
    /// Serve these inclusive byte offsets → 206 Partial Content.
    Bytes(u64, u64),
    /// Syntactically valid but out of bounds → 416 Range Not Satisfiable.
    Unsatisfiable,
    /// No usable range (absent/invalid/unsupported) → 200 with the whole file.
    Whole,
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Only serve the stable temp-file names this app generates
/// (`quark-media-<hex>.<ext>`) — guards against path traversal and arbitrary
/// file disclosure.
fn is_safe_media_name(name: &str) -> bool {
    name.starts_with("quark-media-")
        && !name.contains('/')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
}

fn mime_for_name(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

impl MediaServer {
    /// Bind to `127.0.0.1:0` (random port) and spawn the serving thread pool.
    pub fn start(base_dir: PathBuf) -> Result<Arc<MediaServer>, String> {
        let server = Arc::new(
            tiny_http::Server::http("127.0.0.1:0")
                .map_err(|e| format!("media server bind failed: {e}"))?,
        );
        let port = server
            .server_addr()
            .to_ip()
            .map(|a| a.port())
            .ok_or_else(|| "media server: could not resolve port".to_string())?;
        let inst = Arc::new(MediaServer {
            port,
            token: random_token(),
            base_dir,
        });
        for i in 0..WORKERS {
            let server = server.clone();
            let worker = inst.clone();
            std::thread::Builder::new()
                .name(format!("quark-media-server-{i}"))
                .spawn(move || loop {
                    match server.recv() {
                        Ok(request) => {
                            // A panic serving one request must not take down the
                            // worker (which would stop it serving for the session).
                            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                                || worker.handle(request),
                            ));
                            match result {
                                Ok(Ok(())) => {}
                                Ok(Err(e)) => tracing::debug!("media server request error: {e}"),
                                Err(_) => tracing::warn!("media server request handler panicked"),
                            }
                        }
                        // recv only errors when the server is shutting down.
                        Err(_) => break,
                    }
                })
                .map_err(|e| format!("media server thread spawn failed: {e}"))?;
        }
        tracing::info!(port, workers = WORKERS, "media server started");
        Ok(inst)
    }

    /// The loopback URL the webview should load for `basename`.
    pub fn url_for(&self, basename: &str) -> String {
        format!("http://127.0.0.1:{}/{}/{}", self.port, self.token, basename)
    }

    fn handle(&self, request: tiny_http::Request) -> std::io::Result<()> {
        // Path must be /<token>/<filename>.
        let url = request.url().to_string();
        let (tok, filename) = match url.trim_start_matches('/').split_once('/') {
            Some(parts) => parts,
            None => return request.respond(tiny_http::Response::empty(404)),
        };
        if tok != self.token || !is_safe_media_name(filename) {
            return request.respond(tiny_http::Response::empty(403));
        }
        let path = self.base_dir.join(filename);
        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => return request.respond(tiny_http::Response::empty(404)),
        };
        let total = file.metadata().map(|m| m.len()).unwrap_or(0);
        let ctype = mime_for_name(filename);

        // Build headers without panicking: a header that somehow fails to
        // construct is omitted rather than unwinding the worker.
        let mk = |k: &str, v: &str| tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).ok();

        let range = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Range"))
            .map(|h| h.value.as_str().to_string());

        match range.as_deref().map(|r| parse_range(r, total)) {
            Some(RangeReq::Bytes(start, end)) => {
                let len = end - start + 1;
                file.seek(SeekFrom::Start(start))?;
                let headers: Vec<tiny_http::Header> = [
                    mk("Content-Type", ctype),
                    mk("Accept-Ranges", "bytes"),
                    mk("Content-Range", &format!("bytes {start}-{end}/{total}")),
                ]
                .into_iter()
                .flatten()
                .collect();
                request.respond(tiny_http::Response::new(
                    tiny_http::StatusCode(206),
                    headers,
                    file.take(len),
                    Some(len as usize),
                    None,
                ))
            }
            Some(RangeReq::Unsatisfiable) => {
                let mut resp = tiny_http::Response::empty(416);
                if let Some(h) = mk("Content-Range", &format!("bytes */{total}")) {
                    resp.add_header(h);
                }
                request.respond(resp)
            }
            // No Range header, or one we ignore → whole file.
            _ => {
                let headers: Vec<tiny_http::Header> =
                    [mk("Content-Type", ctype), mk("Accept-Ranges", "bytes")]
                        .into_iter()
                        .flatten()
                        .collect();
                request.respond(tiny_http::Response::new(
                    tiny_http::StatusCode(200),
                    headers,
                    file,
                    Some(total as usize),
                    None,
                ))
            }
        }
    }
}

/// Classify a single `Range` header against the file size. Multi-range,
/// malformed, and absent ranges are treated as "serve the whole file"; a
/// syntactically valid range that starts past EOF is `Unsatisfiable` (→ 416).
fn parse_range(header: &str, total: u64) -> RangeReq {
    let spec = match header.trim().strip_prefix("bytes=") {
        Some(s) => s,
        None => return RangeReq::Whole,
    };
    if spec.contains(',') || total == 0 {
        return RangeReq::Whole; // multi-range unsupported / empty file
    }
    let (s, e) = match spec.split_once('-') {
        Some(parts) => parts,
        None => return RangeReq::Whole,
    };
    match (s.trim(), e.trim()) {
        ("", "") => RangeReq::Whole,
        // bytes=-N → final N bytes
        ("", suffix) => match suffix.parse::<u64>() {
            Ok(0) => RangeReq::Unsatisfiable,
            Ok(n) => RangeReq::Bytes(total.saturating_sub(n), total - 1),
            Err(_) => RangeReq::Whole,
        },
        // bytes=S- → S to end
        (start, "") => match start.parse::<u64>() {
            Ok(s) if s < total => RangeReq::Bytes(s, total - 1),
            Ok(_) => RangeReq::Unsatisfiable,
            Err(_) => RangeReq::Whole,
        },
        // bytes=S-E
        (start, end) => match (start.parse::<u64>(), end.parse::<u64>()) {
            (Ok(s), Ok(_)) if s >= total => RangeReq::Unsatisfiable,
            (Ok(s), Ok(e)) if s > e => RangeReq::Whole, // invalid order → ignore
            (Ok(s), Ok(e)) => RangeReq::Bytes(s, e.min(total - 1)),
            _ => RangeReq::Whole,
        },
    }
}
