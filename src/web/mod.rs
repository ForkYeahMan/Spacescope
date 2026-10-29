// Web UI module — an axum server that serves an embedded single-page app
// and exposes the scanner/analyzer/cleaner over a small JSON + SSE API.
mod dto;
mod server;
mod settings;
mod sysmon;
mod tree;

pub use server::{bind, serve};
pub use settings::{Settings, filesystem_root, home_dir};
