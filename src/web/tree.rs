//! The scanned file tree, indexed for browsing.
//!
//! The scanner reports, for every directory it read, the bytes of the files
//! directly inside it, plus a list of entries (every directory and every file
//! above the size threshold). This module rolls those up into per-directory
//! totals so the UI can show how big any folder is, and walk down from it.

use crate::analyzer::FileCategory;
use crate::models::FileEntry;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Most children listed for the folder being viewed; the rest are folded together.
const MAX_LISTED: usize = 300;

#[derive(Default)]
struct DirNode {
    /// Bytes of files directly inside, small ones included.
    own_bytes: u64,
    /// Bytes of those files that are listed individually.
    listed_bytes: u64,
    /// Own bytes plus every descendant's.
    total: u64,
    subdirs: Vec<PathBuf>,
    files: Vec<usize>,
    /// This directory's own entry (the root has none).
    entry: Option<usize>,
}

pub struct TreeIndex {
    root: PathBuf,
    dirs: HashMap<PathBuf, DirNode>,
}

#[derive(Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// `dir`, `file`, or `rest` (small files / items folded together).
    pub kind: &'static str,
    pub category: Option<String>,
    pub safe: bool,
    pub protected: bool,
    pub modified: Option<String>,
    /// Present for directories; empty when not expanded at this depth.
    pub children: Vec<TreeNode>,
    pub expandable: bool,
}

impl TreeIndex {
    pub fn build(root: &Path, entries: &[(FileEntry, FileCategory)], dir_bytes: &[(PathBuf, u64)]) -> Self {
        let mut dirs: HashMap<PathBuf, DirNode> = HashMap::with_capacity(dir_bytes.len() + 1);
        for (path, own) in dir_bytes {
            dirs.insert(path.clone(), DirNode { own_bytes: *own, total: *own, ..DirNode::default() });
        }
        dirs.entry(root.to_path_buf()).or_default();

        for (i, (entry, _)) in entries.iter().enumerate() {
            if entry.is_dir {
                // Directories the walk didn't read (skipped or past the depth limit) still get a node.
                dirs.entry(entry.path.clone()).or_default().entry = Some(i);
            }
        }
        for (i, (entry, _)) in entries.iter().enumerate() {
            let Some(parent) = entry.path.parent().and_then(|p| dirs.get_mut(p)) else { continue };
            if entry.is_dir {
                parent.subdirs.push(entry.path.clone());
            } else {
                parent.files.push(i);
                parent.listed_bytes += entry.size;
            }
        }

        // Roll totals up, deepest directories first.
        let mut order: Vec<PathBuf> = dirs.keys().cloned().collect();
        order.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
        for path in order {
            let total = dirs[&path].total;
            if let Some(parent) = path.parent().and_then(|p| dirs.get_mut(p)) {
                parent.total += total;
            }
        }
        Self { root: root.to_path_buf(), dirs }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn contains(&self, dir: &Path) -> bool {
        self.dirs.contains_key(dir)
    }

    pub fn total(&self, dir: &Path) -> u64 {
        self.dirs.get(dir).map_or(0, |d| d.total)
    }

    /// `dir` and its descendants down `rings` levels. Items smaller than
    /// `min_size` below the first level are folded into one "rest" node.
    pub fn subtree(&self, dir: &Path, rings: usize, min_size: u64, entries: &[(FileEntry, FileCategory)]) -> Option<TreeNode> {
        self.node(dir, rings, min_size, entries, true)
    }

    fn node(&self, dir: &Path, rings: usize, min_size: u64, entries: &[(FileEntry, FileCategory)], top: bool) -> Option<TreeNode> {
        let d = self.dirs.get(dir)?;
        let entry = d.entry.map(|i| &entries[i]);
        let mut node = TreeNode {
            name: dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| dir.to_string_lossy().into_owned()),
            path: dir.to_string_lossy().into_owned(),
            size: d.total,
            kind: "dir",
            category: entry.map(|(_, c)| c.as_str().to_string()),
            safe: entry.is_some_and(|(e, c)| !e.is_system && c.is_safe_to_delete()),
            protected: entry.is_some_and(|(e, _)| e.is_system) || dir == self.root,
            modified: entry.map(|(e, _)| e.modified.format("%Y-%m-%d %H:%M").to_string()),
            children: Vec::new(),
            expandable: d.total > 0 && (!d.subdirs.is_empty() || !d.files.is_empty()),
        };
        if rings == 0 {
            return Some(node);
        }

        let mut kids: Vec<TreeNode> = d
            .subdirs
            .iter()
            .filter(|p| self.total(p) > 0)
            .filter_map(|p| self.node(p, rings - 1, min_size, entries, false))
            .collect();
        for &i in &d.files {
            let (e, c) = &entries[i];
            kids.push(TreeNode {
                name: e.name.clone(),
                path: e.path.to_string_lossy().into_owned(),
                size: e.size,
                kind: "file",
                category: Some(c.as_str().to_string()),
                safe: !e.is_system && c.is_safe_to_delete(),
                protected: e.is_system,
                modified: Some(e.modified.format("%Y-%m-%d %H:%M").to_string()),
                children: Vec::new(),
                expandable: false,
            });
        }
        kids.sort_by(|a, b| b.size.cmp(&a.size));

        // Fold what's too small to draw (or past the listing cap) into one node.
        let mut rest = d.own_bytes.saturating_sub(d.listed_bytes);
        let keep = if top {
            kids.len().min(MAX_LISTED)
        } else {
            kids.iter().take_while(|k| k.size >= min_size).count()
        };
        rest += kids.drain(keep..).map(|k| k.size).sum::<u64>();
        if rest > 0 {
            kids.push(TreeNode {
                name: "Smaller items".into(),
                path: String::new(),
                size: rest,
                kind: "rest",
                category: None,
                safe: false,
                protected: true,
                modified: None,
                children: Vec::new(),
                expandable: false,
            });
        }
        node.children = kids;
        Some(node)
    }
}
