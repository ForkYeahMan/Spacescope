//! Run-time settings shared between the CLI and the web server.

use std::path::{Path, PathBuf};

/// Defaults the UI pre-fills for a new scan.
#[derive(Debug, Clone)]
pub struct Settings {
    pub default_path: PathBuf,
    pub min_size_mb: u64,
    pub max_depth: usize,
}

/// The top of the filesystem: `/` on Unix, the home drive (e.g. `C:\`) on Windows.
pub fn filesystem_root() -> PathBuf {
    dirs::home_dir()
        .and_then(|home| home.ancestors().last().map(Path::to_path_buf))
        .filter(|root| !root.as_os_str().is_empty())
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(filesystem_root)
}
