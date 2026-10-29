//! Static asset serving.
//!
//! Everything under `src/web/assets` is embedded into the binary at compile
//! time (and read straight from disk in debug builds, so frontend edits show up
//! on refresh). Adding a page, stylesheet or font needs no Rust changes.

use axum::{
    extract::Path as AxumPath,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "src/web/assets"]
struct Assets;

pub(super) async fn index(headers: HeaderMap) -> Response {
    serve("index.html", &headers)
}

pub(super) async fn asset(AxumPath(path): AxumPath<String>, headers: HeaderMap) -> Response {
    serve(&path, &headers)
}

/// Serve one embedded file with an ETag so browsers revalidate cheaply.
fn serve(path: &str, request: &HeaderMap) -> Response {
    let Some(file) = Assets::get(path) else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };

    let etag = format!("\"{}\"", hex(&file.metadata.sha256_hash()));
    if request
        .get(header::IF_NONE_MATCH)
        .is_some_and(|v| v.as_bytes() == etag.as_bytes())
    {
        return StatusCode::NOT_MODIFIED.into_response();
    }

    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = file.data.into_owned().into_response();
    let headers = response.headers_mut();
    if let Ok(v) = HeaderValue::from_str(mime.essence_str()) {
        headers.insert(header::CONTENT_TYPE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, v);
    }
    // Fonts never change under the same name; everything else revalidates.
    let cache = if path.starts_with("fonts/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    response
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
