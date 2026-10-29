//! Shared application state threaded through every request handler.

use crate::analyzer::FileCategory;
use crate::models::{FileEntry, ScanProgress};
use crate::web::settings::Settings;
use crate::web::sysmon::SysMonitor;
use crate::web::tree::TreeIndex;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Categorized scan output kept in memory after a scan completes.
pub(super) struct ResultsState {
    pub(super) scan_path: PathBuf,
    pub(super) entries: Vec<(FileEntry, FileCategory)>,
    pub(super) dir_bytes: Vec<(PathBuf, u64)>,
    pub(super) tree: TreeIndex,
}

impl ResultsState {
    pub(super) fn new(scan_path: PathBuf, entries: Vec<(FileEntry, FileCategory)>, dir_bytes: Vec<(PathBuf, u64)>) -> Self {
        let tree = TreeIndex::build(&scan_path, &entries, &dir_bytes);
        Self { scan_path, entries, dir_bytes, tree }
    }

    /// Forget deleted paths and recompute folder totals.
    pub(super) fn remove(&mut self, removed: &[PathBuf]) {
        let gone = |p: &PathBuf| removed.iter().any(|r| p.starts_with(r));
        self.entries.retain(|(e, _)| !gone(&e.path));
        self.dir_bytes.retain(|(p, _)| !gone(p));
        self.tree = TreeIndex::build(&self.scan_path, &self.entries, &self.dir_bytes);
    }
}

pub(super) struct Inner {
    pub(super) settings: Settings,
    pub(super) monitor: Mutex<SysMonitor>,
    pub(super) progress: Arc<Mutex<ScanProgress>>,
    pub(super) results: Mutex<Option<ResultsState>>,
    pub(super) scan_running: AtomicBool,
    pub(super) scan_cancel: Arc<AtomicBool>,
    /// Set once the user has confirmed deleting; lasts until the app quits.
    pub(super) delete_authorized: AtomicBool,
}

#[derive(Clone)]
pub struct AppState {
    pub(super) inner: Arc<Inner>,
}

impl AppState {
    pub fn new(settings: Settings) -> Self {
        Self {
            inner: Arc::new(Inner {
                settings,
                monitor: Mutex::new(SysMonitor::new()),
                progress: Arc::new(Mutex::new(ScanProgress::default())),
                results: Mutex::new(None),
                scan_running: AtomicBool::new(false),
                scan_cancel: Arc::new(AtomicBool::new(false)),
                delete_authorized: AtomicBool::new(false),
            }),
        }
    }

    /// Claim the single scan slot. `None` if a scan is already running.
    pub(super) fn begin_scan(&self) -> Option<ScanGuard> {
        if self.inner.scan_running.swap(true, Ordering::SeqCst) {
            return None;
        }
        self.inner.scan_cancel.store(false, Ordering::SeqCst);
        Some(ScanGuard(self.inner.clone()))
    }
}

/// Releases the scan slot when dropped, so a panicking scan task can never
/// leave the app stuck in "a scan is already running".
pub(super) struct ScanGuard(Arc<Inner>);

impl Drop for ScanGuard {
    fn drop(&mut self) {
        self.0.scan_running.store(false, Ordering::SeqCst);
    }
}
