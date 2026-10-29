use super::FileEntry;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ScanResult {
    pub entries: Vec<FileEntry>,
    /// Bytes of the files directly inside each directory that was read.
    pub dir_bytes: Vec<(PathBuf, u64)>,
}
