//! Request guards.

use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Reject requests whose `Host` is not a loopback name.
///
/// The server only listens on localhost, but a hostile web page can still
/// reach it through DNS rebinding; those requests carry a foreign `Host`.
pub(super) async fn require_local_host(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    if is_loopback_host(host) {
        next.run(request).await
    } else {
        (StatusCode::FORBIDDEN, "Forbidden host").into_response()
    }
}

fn is_loopback_host(host: &str) -> bool {
    let name = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or_default(),
        None => host.rsplit_once(':').map_or(host, |(name, _)| name),
    };
    matches!(name, "localhost" | "127.0.0.1" | "::1")
}

#[cfg(test)]
mod tests {
    use super::is_loopback_host;

    #[test]
    fn accepts_loopback_hosts() {
        for h in ["localhost:8080", "127.0.0.1:9000", "[::1]:8080", "localhost"] {
            assert!(is_loopback_host(h), "{h}");
        }
    }

    #[test]
    fn rejects_foreign_hosts() {
        for h in ["evil.com", "evil.com:8080", "192.168.1.5:8080", "", "localhost.evil.com"] {
            assert!(!is_loopback_host(h), "{h}");
        }
    }
}
