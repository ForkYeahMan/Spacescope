//! The parallel directory walk that powers a scan.
//!
//! A pool of worker threads pull directories off a shared work queue, read each
//! one, collect matching entries and push newly discovered subdirectories back
//! onto the queue. Hard links are de-duplicated by inode so their bytes are only
//! counted once, and the walk can be cancelled at any point.

use super::{classify, skip};
use crate::models::FileEntry;
use chrono::{DateTime, Local};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// Settings that stay fixed for the lifetime of one walk.
pub(super) struct WalkOptions {
    pub min_size: u64,
    /// Directory levels to descend below the root (`0` = unlimited).
    pub max_depth: usize,
    pub is_full_disk: bool,
    pub root_device: Option<u64>,
}

/// Live counters the progress publisher reads while the walk is running.
#[derive(Default)]
pub(super) struct Counters {
    pub files: AtomicUsize,
    pub dirs: AtomicUsize,
    pub bytes: AtomicU64,
    /// Directories read so far, and discovered but not yet read.
    pub dirs_done: AtomicUsize,
    pub dirs_pending: AtomicUsize,
    pub current_path: Mutex<String>,
    pub categories: Mutex<HashMap<String, u64>>,
}

/// Work queue plus the number of directories currently being processed, kept
/// under one lock so "queue empty and nobody active" is a race-free exit test.
#[derive(Default)]
struct Queue {
    state: Mutex<QueueState>,
    wake: Condvar,
}

#[derive(Default)]
struct QueueState {
    items: VecDeque<(PathBuf, usize)>,
    active: usize,
}

impl Queue {
    /// Next directory to process, blocking while other workers may still add
    /// more. `None` means the walk is finished (or cancelled).
    fn next(&self, cancel: &AtomicBool) -> Option<(PathBuf, usize)> {
        let mut state = self.state.lock().unwrap();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            if let Some(item) = state.items.pop_front() {
                state.active += 1;
                return Some(item);
            }
            if state.active == 0 {
                return None;
            }
            state = self.wake.wait(state).unwrap();
        }
    }

    fn finish(&self, discovered: Vec<(PathBuf, usize)>) {
        let mut state = self.state.lock().unwrap();
        state.items.extend(discovered);
        state.active -= 1;
        self.wake.notify_all();
    }
}

struct Walk<'a> {
    opts: &'a WalkOptions,
    counters: &'a Counters,
    queue: Queue,
    seen_inodes: Mutex<HashSet<(u64, u64)>>,
    cancel: &'a AtomicBool,
}

/// What a walk produces: the listed entries, plus the byte total of the files
/// sitting directly inside each directory that was read (small files included).
pub(super) struct WalkOutput {
    pub entries: Vec<FileEntry>,
    pub dir_bytes: Vec<(PathBuf, u64)>,
}

/// Walk `root` and return every directory plus every file at least `min_size`.
pub(super) fn scan_all(
    root: &Path,
    opts: &WalkOptions,
    counters: &Counters,
    cancel: &AtomicBool,
) -> WalkOutput {
    let walk = Walk {
        opts,
        counters,
        queue: Queue::default(),
        seen_inodes: Mutex::new(HashSet::new()),
        cancel,
    };
    walk.queue.state.lock().unwrap().items.push_back((root.to_path_buf(), 0));
    counters.dirs_pending.store(1, Ordering::Relaxed);

    let workers = thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);

    thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| scope.spawn(|| walk.worker()))
            .collect();
        let mut out = WalkOutput { entries: Vec::new(), dir_bytes: Vec::new() };
        for handle in handles {
            if let Ok(part) = handle.join() {
                out.entries.extend(part.entries);
                out.dir_bytes.extend(part.dir_bytes);
            }
        }
        out
    })
}

impl Walk<'_> {
    fn worker(&self) -> WalkOutput {
        let mut entries = Vec::new();
        let mut dir_bytes = Vec::new();
        let mut local_categories: HashMap<String, u64> = HashMap::new();
        let mut visited = 0u32;

        while let Some((dir, depth)) = self.queue.next(self.cancel) {
            visited += 1;
            if visited % 50 == 0 {
                if let Ok(mut cp) = self.counters.current_path.try_lock() {
                    *cp = dir.to_string_lossy().into_owned();
                }
            }
            let (subdirs, own_bytes) = self.process_directory(&dir, depth, &mut entries, &mut local_categories);
            if let Some(own) = own_bytes {
                dir_bytes.push((dir, own));
            }
            self.counters.dirs_done.fetch_add(1, Ordering::Relaxed);
            self.counters.dirs_pending.fetch_add(subdirs.len(), Ordering::Relaxed);
            self.counters.dirs_pending.fetch_sub(1, Ordering::Relaxed);
            self.queue.finish(subdirs);
            self.flush_categories(&mut local_categories, false);
        }
        self.flush_categories(&mut local_categories, true);
        WalkOutput { entries, dir_bytes }
    }

    /// Merge a worker's category tallies into the shared map. Non-blocking
    /// unless `force`, so a busy progress publisher never stalls the walk.
    fn flush_categories(&self, local: &mut HashMap<String, u64>, force: bool) {
        if local.is_empty() {
            return;
        }
        let guard = if force {
            self.counters.categories.lock().ok()
        } else {
            self.counters.categories.try_lock().ok()
        };
        if let Some(mut shared) = guard {
            for (name, size) in local.drain() {
                *shared.entry(name).or_insert(0) += size;
            }
        }
    }

    /// Read one directory and record its entries. Returns the subdirectories to
    /// visit and the bytes of files directly inside (`None` if it wasn't read).
    fn process_directory(
        &self,
        dir: &Path,
        depth: usize,
        entries: &mut Vec<FileEntry>,
        categories: &mut HashMap<String, u64>,
    ) -> (Vec<(PathBuf, usize)>, Option<u64>) {
        let opts = self.opts;
        if self.should_skip(dir) {
            return (Vec::new(), None);
        }
        let Ok(read_dir) = std::fs::read_dir(dir) else {
            return (Vec::new(), None);
        };
        let mut own_bytes = 0u64;

        let descend = opts.max_depth == 0 || depth + 1 < opts.max_depth;
        let mut subdirs = Vec::new();

        for entry in read_dir.flatten() {
            // `DirEntry::metadata` does not follow symlinks; skipping them
            // avoids loops and double counting.
            let Ok(metadata) = entry.metadata() else { continue };
            if metadata.file_type().is_symlink() {
                continue;
            }

            let path = entry.path();
            let is_dir = metadata.is_dir();

            if is_dir {
                self.counters.dirs.fetch_add(1, Ordering::Relaxed);
                if !self.should_skip(&path) && descend {
                    subdirs.push((path.clone(), depth + 1));
                }
                entries.push(self.entry(&path, &entry, 0, true, &metadata));
                continue;
            }

            if self.is_duplicate_hardlink(&metadata) {
                continue;
            }
            let size = metadata.len();
            own_bytes += size;
            self.counters.files.fetch_add(1, Ordering::Relaxed);
            self.counters.bytes.fetch_add(size, Ordering::Relaxed);

            let hidden = classify::is_hidden_path(&path);
            let system = classify::is_system_path(&path);
            let category = classify::categorize_path(&path, hidden, system);
            *categories.entry(category.to_string()).or_insert(0) += size;

            if size >= opts.min_size {
                entries.push(self.entry(&path, &entry, size, false, &metadata));
            }
        }
        (subdirs, Some(own_bytes))
    }

    fn entry(
        &self,
        path: &Path,
        dir_entry: &std::fs::DirEntry,
        size: u64,
        is_dir: bool,
        metadata: &std::fs::Metadata,
    ) -> FileEntry {
        FileEntry {
            path: path.to_path_buf(),
            size,
            is_dir,
            is_hidden: classify::is_hidden_path(path),
            is_system: classify::is_system_path(path),
            modified: modified_time(metadata),
            name: dir_entry.file_name().to_string_lossy().into_owned(),
        }
    }

    fn should_skip(&self, path: &Path) -> bool {
        skip::should_skip_path(path, self.opts.is_full_disk)
            || skip::is_different_filesystem(path, self.opts.root_device)
    }

    /// True when this file is a hard link whose bytes were already counted.
    #[cfg(unix)]
    fn is_duplicate_hardlink(&self, metadata: &std::fs::Metadata) -> bool {
        if metadata.nlink() <= 1 {
            return false;
        }
        !self
            .seen_inodes
            .lock()
            .unwrap()
            .insert((metadata.dev(), metadata.ino()))
    }

    #[cfg(not(unix))]
    fn is_duplicate_hardlink(&self, _metadata: &std::fs::Metadata) -> bool {
        false
    }
}

fn modified_time(metadata: &std::fs::Metadata) -> DateTime<Local> {
    metadata
        .modified()
        .map(DateTime::<Local>::from)
        .unwrap_or_else(|_| Local::now())
}
