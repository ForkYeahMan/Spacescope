//! Axum server setup: binds a port, builds the shared state and the routing table.
//!
//! Request handling is split by concern — [`state`] holds the shared app state,
//! [`assets`] serves the embedded frontend, [`handlers`] implements the JSON +
//! SSE API and [`error`] renders failures.

mod assets;
mod error;
mod guard;
mod handlers;
mod state;

use crate::web::settings::Settings;
use anyhow::{Context, Result};
use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use state::AppState;
use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::net::TcpListener;

/// How many consecutive ports to try when the requested one is busy.
const PORT_ATTEMPTS: u16 = 20;

/// Bind `host:port`, moving up to the next free port if it is already taken.
pub async fn bind(host: IpAddr, port: u16) -> Result<TcpListener> {
    for candidate in port..=port.saturating_add(PORT_ATTEMPTS) {
        match TcpListener::bind(SocketAddr::new(host, candidate)).await {
            Ok(listener) => return Ok(listener),
            Err(e) if e.kind() == ErrorKind::AddrInUse => continue,
            Err(e) => return Err(e).with_context(|| format!("cannot bind {host}:{candidate}")),
        }
    }
    anyhow::bail!("ports {port}–{} are all in use; pass --port to pick another", port + PORT_ATTEMPTS)
}

pub async fn serve(listener: TcpListener, settings: Settings) -> Result<()> {
    let local_only = listener.local_addr()?.ip().is_loopback();
    let state = AppState::new(settings);

    let mut app = Router::new()
        .route("/", get(assets::index))
        .route("/assets/*path", get(assets::asset))
        .route("/api/config", get(handlers::get_config))
        .route("/api/metrics", get(handlers::get_metrics))
        .route("/api/system", get(handlers::get_system))
        .route("/api/scan", post(handlers::post_scan))
        .route("/api/scan/status", get(handlers::get_scan_status))
        .route("/api/scan/cancel", post(handlers::post_scan_cancel))
        .route("/api/scan/stream", get(handlers::scan_stream))
        .route("/api/results", get(handlers::get_results))
        .route("/api/tree", get(handlers::get_tree))
        .route("/api/delete", post(handlers::post_delete))
        .with_state(state.clone());

    if local_only {
        // Defends against DNS-rebinding: only answer requests addressed to localhost.
        app = app.layer(middleware::from_fn(guard::require_local_host));
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown(state))
        .await
        .context("server error")
}

/// Resolves on Ctrl-C / SIGTERM, cancelling any running scan so exit is prompt.
async fn shutdown(state: AppState) {
    wait_for_signal().await;
    println!("\n  Shutting down…");
    state.inner.scan_cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    // Open SSE streams would otherwise hold the graceful shutdown open.
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_secs(2)).await;
        std::process::exit(0);
    });
}

async fn wait_for_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    ctrl_c.await;
}
