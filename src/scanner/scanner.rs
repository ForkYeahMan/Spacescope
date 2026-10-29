//! Public scanner API and scan orchestration.
//!
//! [`Scanner`] owns the scan settings and coordinates the two halves of a scan:
//! a background task that publishes progress and the blocking parallel walk in
//! [`super::walk`]. Path-skipping and classification live in sibling modules to
//! keep this file focused on wiring.

use super::walk::{self, Counters, WalkOptions};
use crate::models::{ScanProgress, ScanResult};
use anyhow::{Context, Result};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

pub struct Scanner {
    min_size_bytes: u64,
    max_depth: usize,
}

impl Scanner {
    pub fn new(min_size_mb: u64, max_depth: usize) -> Self {
        Self {
            min_size_bytes: min_size_mb.saturating_mul(1_000_000),
            max_depth,
        }
    }

    /// Scan `path`, publishing live progress into `progress`.
    ///
    /// Setting `cancel` stops the walk early; the entries found so far are
    /// still returned so the caller decides whether to keep them.
    pub async fn scan_with_progress(
        &self,
        path: &Path,
        progress: Arc<Mutex<ScanProgress>>,
        cancel: Arc<AtomicBool>,
    ) -> Result<ScanResult> {
        let opts = WalkOptions {
            min_size: self.min_size_bytes,
            max_depth: self.max_depth,
            is_full_disk: is_full_disk_scan(path),
            root_device: root_device(path),
        };
        let counters = Arc::new(Counters::default());
        let done = Arc::new(AtomicBool::new(false));

        let publisher = tokio::spawn(publish_progress(
            counters.clone(),
            progress.clone(),
            done.clone(),
        ));

        let root = path.to_path_buf();
        let walk_counters = counters.clone();
        let walked = tokio::task::spawn_blocking(move || {
            walk::scan_all(&root, &opts, &walk_counters, &cancel)
        })
        .await;

        done.store(true, Ordering::Release);
        let _ = publisher.await;

        let walk::WalkOutput { mut entries, dir_bytes } = walked.context("scan task failed")?;
        entries.sort_unstable_by(|a, b| b.size.cmp(&a.size));

        let mut prog = progress.lock().await;
        copy_counters(&counters, &mut prog);
        prog.is_complete = true;

        Ok(ScanResult { entries, dir_bytes })
    }
}

/// Periodically copy the walk's atomic counters into the shared progress.
async fn publish_progress(
    counters: Arc<Counters>,
    progress: Arc<Mutex<ScanProgress>>,
    done: Arc<AtomicBool>,
) {
    while !done.load(Ordering::Acquire) {
        tokio::time::sleep(PROGRESS_INTERVAL).await;
        copy_counters(&counters, &mut *progress.lock().await);
    }
}

fn copy_counters(counters: &Counters, prog: &mut ScanProgress) {
    prog.files_scanned = counters.files.load(Ordering::Relaxed);
    prog.dirs_scanned = counters.dirs.load(Ordering::Relaxed);
    prog.total_size_scanned = counters.bytes.load(Ordering::Relaxed);
    prog.dirs_done = counters.dirs_done.load(Ordering::Relaxed);
    prog.dirs_pending = counters.dirs_pending.load(Ordering::Relaxed);
    if let Ok(cp) = counters.current_path.try_lock() {
        prog.current_path.clone_from(&cp);
    }
    if let Ok(cats) = counters.categories.try_lock() {
        prog.category_sizes.clone_from(&cats);
    }
}

/// Whole-disk and user-home scans skip mount points that would double count.
fn is_full_disk_scan(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s == "/" || s == "/Users" || s.starts_with("/Users/")
}

#[cfg(unix)]
fn root_device(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.dev())
}

#[cfg(not(unix))]
fn root_device(_path: &Path) -> Option<u64> {
    None
}
