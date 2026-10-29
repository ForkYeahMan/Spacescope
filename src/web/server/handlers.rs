//! The JSON + SSE request handlers backing the web API.

use super::error::{ApiError, ApiResult};
use super::state::{AppState, Inner, ResultsState, ScanGuard};
use crate::analyzer::Analyzer;
use crate::cleaner::Cleaner;
use crate::models::{ScanProgress, StorageInfo};
use crate::scanner::Scanner;
use crate::web::dto::*;
use crate::web::settings::{filesystem_root, home_dir};
use crate::web::sysmon::{MetricsDto, SystemInfoDto};
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::Stream;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

// ---- live metrics ----

pub(super) async fn get_metrics(State(state): State<AppState>) -> Json<MetricsDto> {
    Json(state.inner.monitor.lock().await.sample())
}

pub(super) async fn get_system(State(state): State<AppState>) -> Json<SystemInfoDto> {
    Json(state.inner.monitor.lock().await.system_info())
}

// ---- config ----

pub(super) async fn get_config(State(state): State<AppState>) -> Json<ConfigDto> {
    let settings = &state.inner.settings;
    Json(ConfigDto {
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        default_path: settings.default_path.to_string_lossy().into_owned(),
        home_path: home_dir().to_string_lossy().into_owned(),
        root_path: filesystem_root().to_string_lossy().into_owned(),
        min_size_mb: settings.min_size_mb,
        max_depth: settings.max_depth,
        storage: StorageDto::from(&StorageInfo::from_path(&settings.default_path)),
    })
}

// ---- scan ----

pub(super) async fn post_scan(
    State(state): State<AppState>,
    Json(req): Json<ScanRequest>,
) -> ApiResult<Json<Value>> {
    let path = PathBuf::from(&req.path);
    if !path.is_dir() {
        return Err(ApiError::BadRequest(format!("Not a directory: {}", req.path)));
    }
    let guard = state
        .begin_scan()
        .ok_or_else(|| ApiError::Conflict("A scan is already running".into()))?;

    *state.inner.progress.lock().await = ScanProgress {
        scan_path: req.path.clone(),
        started_at: Some(std::time::Instant::now()),
        expected_bytes: (path == filesystem_root()).then(|| StorageInfo::from_path(&path).used_space),
        ..ScanProgress::default()
    };
    *state.inner.results.lock().await = None;

    tokio::spawn(run_scan(state.inner.clone(), guard, path, req));
    Ok(Json(json!({ "ok": true })))
}

/// Run one scan to completion, then store its (categorized) results.
async fn run_scan(inner: Arc<Inner>, _guard: ScanGuard, path: PathBuf, req: ScanRequest) {
    let scanner = Scanner::new(req.min_size_mb, req.max_depth);
    let outcome = scanner
        .scan_with_progress(&path, inner.progress.clone(), inner.scan_cancel.clone())
        .await;

    let cancelled = inner.scan_cancel.load(Ordering::SeqCst);
    let mut progress = inner.progress.lock().await;
    progress.cancelled = cancelled;

    match outcome {
        Ok(_) if cancelled => {}
        Ok(result) => {
            // Categorize the whole batch in O(n). System entries stay in the
            // tree (they take up space) but can never be deleted.
            let entries = Analyzer::categorize_all(result.entries);
            *inner.results.lock().await = Some(ResultsState::new(path, entries, result.dir_bytes));
        }
        Err(e) => progress.error = Some(format!("{e:#}")),
    }
    // `_guard` drops last: `scan_running` only flips once results are stored,
    // so a client that fetches /api/results on `complete` never races.
}

pub(super) async fn post_scan_cancel(State(state): State<AppState>) -> Json<Value> {
    state.inner.scan_cancel.store(true, Ordering::SeqCst);
    Json(json!({ "ok": true }))
}

/// Where the scan flow stands, so the UI can resume after a reload or a
/// direct visit to a scan URL.
pub(super) async fn get_scan_status(State(state): State<AppState>) -> Json<Value> {
    // Lock order everywhere: progress, then results.
    let running = state.inner.scan_running.load(Ordering::SeqCst);
    let progress = state.inner.progress.lock().await;
    let results = state.inner.results.lock().await;
    let path = results
        .as_ref()
        .map(|r| r.scan_path.to_string_lossy().into_owned())
        .unwrap_or_else(|| progress.scan_path.clone());
    Json(json!({
        "running": running,
        "has_results": results.is_some(),
        "path": path,
        "elapsed_secs": progress.started_at.map(|t| t.elapsed().as_secs()).unwrap_or(0),
        "delete_authorized": state.inner.delete_authorized.load(Ordering::SeqCst),
    }))
}

pub(super) async fn scan_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let inner = state.inner.clone();
    let stream = async_stream::stream! {
        loop {
            let done = !inner.scan_running.load(Ordering::SeqCst);
            let dto = {
                let mut prog = inner.progress.lock().await;
                update_percent(&mut prog, done);
                progress_dto(&prog, done)
            };
            let data = serde_json::to_string(&dto).unwrap_or_else(|_| "{}".into());
            yield Ok(Event::default().data(data));
            if done {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Whole-disk scans compare bytes found with the volume's used space; other
/// scans compare folders read with folders discovered. Never moves backwards,
/// and only reaches 100 once the scan has actually finished.
fn update_percent(prog: &mut ScanProgress, done: bool) {
    if done {
        if !prog.cancelled && prog.error.is_none() {
            prog.percent = 100.0;
        }
        return;
    }
    let estimate = match prog.expected_bytes {
        Some(expected) if expected > 0 => prog.total_size_scanned as f64 / expected as f64,
        _ => {
            let seen = (prog.dirs_done + prog.dirs_pending) as f64;
            // Squared: the folder queue is shallow early on, which flatters the ratio.
            if seen > 0.0 { (prog.dirs_done as f64 / seen).powi(2) } else { 0.0 }
        }
    };
    prog.percent = prog.percent.max((estimate * 100.0).min(99.0));
}

fn progress_dto(prog: &ScanProgress, complete: bool) -> ProgressDto {
    let mut categories: Vec<ProgressCategoryDto> = prog
        .category_sizes
        .iter()
        .map(|(name, &size)| ProgressCategoryDto { name: name.clone(), size })
        .collect();
    categories.sort_by(|a, b| b.size.cmp(&a.size));
    ProgressDto {
        files: prog.files_scanned,
        dirs: prog.dirs_scanned,
        size: prog.total_size_scanned,
        current_path: prog.current_path.clone(),
        complete,
        cancelled: prog.cancelled,
        error: prog.error.clone(),
        percent: prog.percent,
        categories,
    }
}

// ---- results ----

pub(super) async fn get_results(State(state): State<AppState>) -> ApiResult<Json<ResultsDto>> {
    let progress = state.inner.progress.lock().await;
    let results = state.inner.results.lock().await;
    let rs = results
        .as_ref()
        .ok_or_else(|| ApiError::NotFound("No scan results available".into()))?;
    let mut dto = build_results(&rs.scan_path, &rs.entries);
    // The listed entries only cover files above the size threshold; the tree
    // and the walk's counters know the true totals.
    dto.total_size = rs.tree.total(rs.tree.root());
    dto.total_files = progress.files_scanned;
    dto.total_dirs = progress.dirs_scanned;
    Ok(Json(dto))
}

// ---- folder browser ----

#[derive(serde::Deserialize)]
pub(super) struct TreeQuery {
    path: Option<String>,
    #[serde(default = "default_rings")]
    rings: usize,
}

fn default_rings() -> usize {
    4
}

pub(super) async fn get_tree(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<TreeQuery>,
) -> ApiResult<Json<Value>> {
    let results = state.inner.results.lock().await;
    let rs = results
        .as_ref()
        .ok_or_else(|| ApiError::NotFound("No scan results available".into()))?;
    let dir = q.path.map(PathBuf::from).unwrap_or_else(|| rs.scan_path.clone());
    if !rs.tree.contains(&dir) {
        return Err(ApiError::NotFound(format!("Not in the scan: {}", dir.display())));
    }
    let total = rs.tree.total(&dir);
    // Anything under half a percent of the folder is too thin to draw.
    let node = rs
        .tree
        .subtree(&dir, q.rings.clamp(1, 6), total / 200, &rs.entries)
        .ok_or_else(|| ApiError::NotFound("Folder not found".into()))?;

    let storage = StorageInfo::from_path(&rs.scan_path);
    let is_disk_root = rs.scan_path == filesystem_root();
    let at_root = dir == rs.scan_path;
    Ok(Json(json!({
        "node": node,
        "scan_root": rs.scan_path.to_string_lossy(),
        // Only a whole-disk scan can say how much space it couldn't see.
        "hidden": if is_disk_root && at_root { storage.used_space.saturating_sub(total) } else { 0 },
        "free": if at_root { storage.available_space } else { 0 },
        "storage": StorageDto::from(&storage),
    })))
}

// ---- delete ----

/// Move the requested files to the Trash.
///
/// Only paths that appeared in the current scan results are accepted, and each
/// must still resolve inside the scanned root. The Trash keeps every delete
/// recoverable.
pub(super) async fn post_delete(
    State(state): State<AppState>,
    Json(req): Json<DeleteRequest>,
) -> ApiResult<Json<DeleteResponse>> {
    // The first delete of a session has to be confirmed in the UI; after that
    // the user has already said yes until the app is restarted.
    if req.authorize {
        state.inner.delete_authorized.store(true, Ordering::SeqCst);
    } else if !state.inner.delete_authorized.load(Ordering::SeqCst) {
        return Err(ApiError::Forbidden("Deleting needs confirmation first".into()));
    }

    let mut results = state.inner.results.lock().await;
    let rs = results
        .as_mut()
        .ok_or_else(|| ApiError::Conflict("No scan results to delete from".into()))?;

    let root = rs.scan_path.canonicalize().unwrap_or_else(|_| rs.scan_path.clone());
    // Deletable: listed by the scan, not a system path.
    let scanned: HashSet<&Path> = rs
        .entries
        .iter()
        .filter(|(e, _)| !e.is_system)
        .map(|(e, _)| e.path.as_path())
        .collect();
    let tree = &rs.tree;
    let sizes: std::collections::HashMap<&Path, u64> = rs
        .entries
        .iter()
        .map(|(e, _)| (e.path.as_path(), if e.is_dir { tree.total(&e.path) } else { e.size }))
        .collect();

    let mut plan: Vec<(String, PathBuf, u64)> = Vec::new();
    let mut outcomes = Vec::with_capacity(req.paths.len());
    for raw in req.paths {
        let path = PathBuf::from(&raw);
        if scanned.contains(path.as_path()) && path_within_root(&path, &root) {
            let size = sizes.get(path.as_path()).copied().unwrap_or(0);
            plan.push((raw, path, size));
        } else {
            outcomes.push(DeleteResult { path: raw, success: false });
        }
    }

    // Trashing touches the disk (and may prompt the OS), so keep it off the async threads.
    let trashed = tokio::task::spawn_blocking(move || {
        plan.into_iter()
            .map(|(raw, path, size)| {
                let ok = Cleaner::delete_file(&path).is_ok();
                (raw, path, size, ok)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| ApiError::Internal(format!("delete task failed: {e}")))?;

    let mut freed = 0u64;
    let mut removed: Vec<PathBuf> = Vec::new();
    for (raw, path, size, ok) in trashed {
        if ok {
            freed += size;
            removed.push(path);
        }
        outcomes.push(DeleteResult { path: raw, success: ok });
    }

    // Drop deleted entries so subsequent /api/results reflect the deletion.
    if !removed.is_empty() {
        rs.remove(&removed);
    }

    let deleted = outcomes.iter().filter(|r| r.success).count();
    Ok(Json(DeleteResponse { results: outcomes, freed, deleted }))
}

/// True only if `path` resolves strictly inside `canonical_root`.
///
/// The parent directory is canonicalized (resolving `..` and symlinked
/// directories) and the final component re-attached, so a symlink *inside* the
/// root can be removed (only the link, never its target) while paths that
/// escape the root are rejected. Fails closed if the parent cannot be resolved.
fn path_within_root(path: &Path, canonical_root: &Path) -> bool {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return false;
    };
    parent
        .canonicalize()
        .map(|p| p.join(name))
        .is_ok_and(|resolved| resolved != canonical_root && resolved.starts_with(canonical_root))
}

#[cfg(test)]
mod tests {
    use super::path_within_root;
    use std::fs;

    #[test]
    fn delete_guard_stays_inside_root() {
        let root = std::env::temp_dir().join(format!("dc-guard-{}", std::process::id()));
        fs::create_dir_all(root.join("a")).unwrap();
        fs::write(root.join("a/f.txt"), "x").unwrap();
        let root = root.canonicalize().unwrap();

        assert!(path_within_root(&root.join("a/f.txt"), &root));
        assert!(!path_within_root(&root, &root), "root itself");
        assert!(!path_within_root(&root.join("a/../../etc/hosts"), &root), "traversal");
        assert!(!path_within_root(std::path::Path::new("/etc/hosts"), &root), "outside");
        fs::remove_dir_all(&root).unwrap();
    }
}
