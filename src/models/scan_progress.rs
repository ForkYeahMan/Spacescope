use std::collections::HashMap;
use std::time::Instant;

/// Live progress of a running scan, published by the scanner and streamed to the UI.
#[derive(Debug, Clone, Default)]
pub struct ScanProgress {
    /// Root of the scan in progress (or last run).
    pub scan_path: String,
    pub started_at: Option<Instant>,
    /// Bytes a whole-disk scan is expected to find (the volume's used space).
    pub expected_bytes: Option<u64>,
    pub dirs_done: usize,
    pub dirs_pending: usize,
    /// Best estimate of completion, 0–100, never moves backwards.
    pub percent: f64,
    pub current_path: String,
    pub files_scanned: usize,
    pub dirs_scanned: usize,
    pub total_size_scanned: u64,
    pub is_complete: bool,
    pub cancelled: bool,
    /// Set when the scan could not run to completion.
    pub error: Option<String>,
    pub category_sizes: HashMap<String, u64>,
}
