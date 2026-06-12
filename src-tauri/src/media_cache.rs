use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// How often the background flusher persists a dirty index to disk. Bounds the
/// window in which deferred `last_accessed` bumps / new entries can be lost to a
/// crash; the media files themselves are always written through immediately.
const FLUSH_INTERVAL_SECS: u64 = 5;

// ─── Public Types ─────────────────────────────────────────────────────────────

/// A successfully retrieved cache entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedMedia {
    pub path: PathBuf,
    pub mime_type: String,
    pub size: u64,
    pub mxc_url: String,
}

/// Aggregate statistics about the cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_size_bytes: u64,
    pub entry_count: u64,
    pub max_size_bytes: u64,
    pub usage_percent: f64,
}

// ─── Internal Index Entry ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexEntry {
    /// Absolute path to the cached file on disk.
    path: PathBuf,
    mime_type: String,
    size: u64,
    mxc_url: String,
    /// Seconds since UNIX epoch; updated on every `get`.
    last_accessed: u64,
}

// ─── MediaCache ───────────────────────────────────────────────────────────────

/// Disk-backed, LRU-evicting media cache.
pub struct MediaCache {
    cache_dir: PathBuf,
    index_path: PathBuf,
    max_size_bytes: u64,
    /// mxc_url → IndexEntry
    index: RwLock<HashMap<String, IndexEntry>>,
    /// Set whenever `index` is mutated without an immediate disk write. The
    /// background flusher, the exit hook, and `Drop` persist the index when this
    /// is set, so hot-path reads/writes never pay the O(n) serialize cost.
    dirty: AtomicBool,
}

impl MediaCache {
    /// Create (or reopen) a cache stored under `cache_dir`.
    ///
    /// The `max_size_mb` limit is soft: it is enforced lazily during `put`.
    pub fn new(max_size_mb: u64) -> Result<Self, String> {
        let cache_dir = Self::default_cache_dir()?;
        Self::with_dir(cache_dir, max_size_mb)
    }

    /// Create a cache rooted at an explicit directory (useful for tests).
    pub fn with_dir(cache_dir: PathBuf, max_size_mb: u64) -> Result<Self, String> {
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {e}"))?;

        let index_path = cache_dir.join("index.json");
        let index = Self::load_index(&index_path, &cache_dir);

        Ok(Self {
            cache_dir,
            index_path,
            max_size_bytes: max_size_mb * 1024 * 1024,
            index: RwLock::new(index),
            dirty: AtomicBool::new(false),
        })
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn default_cache_dir() -> Result<PathBuf, String> {
        let dirs = directories::ProjectDirs::from("", "", "quark")
            .ok_or_else(|| "Could not determine data directory".to_string())?;
        Ok(dirs.data_dir().join("media_cache"))
    }

    /// SHA-256 hash of the mxc URL, rendered as a lowercase hex string.
    fn hash_url(mxc_url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(mxc_url.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Read the persisted index from disk, dropping entries whose files are gone.
    fn load_index(index_path: &Path, cache_dir: &Path) -> HashMap<String, IndexEntry> {
        let raw = match fs::read_to_string(index_path) {
            Ok(s) => s,
            Err(_) => return HashMap::new(),
        };

        let map: HashMap<String, IndexEntry> = match serde_json::from_str(&raw) {
            Ok(m) => m,
            Err(_) => return HashMap::new(),
        };

        // Only keep entries whose cache files still exist on disk.
        map.into_iter()
            .filter(|(_, entry)| {
                // Accept both absolute paths and paths relative to cache_dir.
                entry.path.exists() || cache_dir.join(&entry.path).exists()
            })
            .collect()
    }

    /// Atomically persist the in-memory index to disk.
    fn save_index(&self, index: &HashMap<String, IndexEntry>) -> Result<(), String> {
        let json = serde_json::to_string(index)
            .map_err(|e| format!("Failed to serialise index: {e}"))?;

        let tmp = self.index_path.with_extension("json.tmp");
        fs::write(&tmp, &json).map_err(|e| format!("Failed to write index: {e}"))?;
        fs::rename(&tmp, &self.index_path)
            .map_err(|e| format!("Failed to commit index: {e}"))?;
        Ok(())
    }

    fn total_size(index: &HashMap<String, IndexEntry>) -> u64 {
        index.values().map(|e| e.size).sum()
    }

    /// Record that the in-memory index has changes not yet on disk.
    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }

    /// Persist the index to disk if it has unsaved changes; cheap no-op
    /// otherwise. On write failure the dirty flag is restored so the next
    /// flush retries rather than silently dropping the changes.
    pub fn flush(&self) -> Result<(), String> {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return Ok(());
        }
        let guard = self.index.read().map_err(|_| "Index lock poisoned")?;
        if let Err(e) = self.save_index(&guard) {
            self.dirty.store(true, Ordering::Relaxed);
            return Err(e);
        }
        Ok(())
    }

    /// Spawn a background thread that flushes the index every
    /// [`FLUSH_INTERVAL_SECS`]. The thread holds only a weak reference, so it
    /// exits once the cache is dropped (e.g. the temp cache that startup swaps
    /// out for the persistent one).
    pub fn spawn_flusher(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(FLUSH_INTERVAL_SECS));
            match weak.upgrade() {
                Some(cache) => {
                    if let Err(e) = cache.flush() {
                        tracing::warn!("media cache flush failed: {e}");
                    }
                }
                None => break,
            }
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Look up a cached entry. Updates the `last_accessed` timestamp.
    pub fn get(&self, mxc_url: &str) -> Option<CachedMedia> {
        // Fast path: read lock to check existence.
        {
            let guard = self.index.read().ok()?;
            if !guard.contains_key(mxc_url) {
                return None;
            }
        }

        // Upgrade to write lock to update last_accessed.
        let mut guard = self.index.write().ok()?;
        let entry = guard.get_mut(mxc_url)?;

        // Verify the file is still on disk.
        if !entry.path.exists() {
            guard.remove(mxc_url);
            self.mark_dirty();
            return None;
        }

        entry.last_accessed = Self::now_secs();
        let cached = CachedMedia {
            path: entry.path.clone(),
            mime_type: entry.mime_type.clone(),
            size: entry.size,
            mxc_url: entry.mxc_url.clone(),
        };

        // Defer persistence to the background flusher / exit hook so a cache hit
        // stays O(1) instead of rewriting the entire index on every read.
        self.mark_dirty();
        Some(cached)
    }

    /// Store media bytes for `mxc_url`. Triggers LRU eviction if over the size limit.
    pub fn put(&self, mxc_url: &str, data: &[u8], mime_type: &str) -> Result<CachedMedia, String> {
        let hash = Self::hash_url(mxc_url);
        let file_path = self.cache_dir.join(&hash);

        fs::write(&file_path, data)
            .map_err(|e| format!("Failed to write cache file: {e}"))?;

        let entry = IndexEntry {
            path: file_path.clone(),
            mime_type: mime_type.to_string(),
            size: data.len() as u64,
            mxc_url: mxc_url.to_string(),
            last_accessed: Self::now_secs(),
        };

        {
            let mut guard = self.index.write().map_err(|_| "Index lock poisoned")?;
            guard.insert(mxc_url.to_string(), entry);
        }
        self.mark_dirty();

        // Evict if we are over the limit (ignore errors; the put already
        // succeeded). Eviction marks the index dirty too; the flusher persists.
        if self.max_size_bytes > 0 {
            let _ = self.evict_to_size(self.max_size_bytes);
        }

        Ok(CachedMedia {
            path: file_path,
            mime_type: mime_type.to_string(),
            size: data.len() as u64,
            mxc_url: mxc_url.to_string(),
        })
    }

    /// Remove a single entry from the cache.
    pub fn remove(&self, mxc_url: &str) -> Result<(), String> {
        let mut guard = self.index.write().map_err(|_| "Index lock poisoned")?;

        if let Some(entry) = guard.remove(mxc_url) {
            let _ = fs::remove_file(&entry.path); // best-effort
        }

        self.save_index(&guard)
    }

    /// Delete all cached files and reset the index.
    pub fn clear(&self) -> Result<(), String> {
        let mut guard = self.index.write().map_err(|_| "Index lock poisoned")?;

        for entry in guard.values() {
            let _ = fs::remove_file(&entry.path);
        }

        guard.clear();
        self.save_index(&guard)
    }

    /// Evict least-recently-accessed entries until the total is ≤ `max_bytes`.
    ///
    /// Returns the number of bytes freed.
    pub fn evict_to_size(&self, max_bytes: u64) -> Result<u64, String> {
        let mut guard = self.index.write().map_err(|_| "Index lock poisoned")?;

        let current = Self::total_size(&guard);
        if current <= max_bytes {
            return Ok(0);
        }

        // Sort by last_accessed ascending (oldest first).
        let mut entries: Vec<(String, u64, u64)> = guard
            .iter()
            .map(|(k, v)| (k.clone(), v.last_accessed, v.size))
            .collect();
        entries.sort_by_key(|(_, ts, _)| *ts);

        let mut freed = 0u64;
        let mut total = current;

        for (key, _, size) in entries {
            if total <= max_bytes {
                break;
            }
            if let Some(entry) = guard.remove(&key) {
                let _ = fs::remove_file(&entry.path);
                freed += size;
                total = total.saturating_sub(size);
            }
        }

        // Files are deleted immediately to free disk; index persistence is
        // deferred to the flusher to keep the hot `put` path cheap.
        self.mark_dirty();
        Ok(freed)
    }

    /// Return aggregate statistics about the current cache state.
    pub fn stats(&self) -> CacheStats {
        let guard = self.index.read().unwrap_or_else(|e| e.into_inner());
        let total_size_bytes = Self::total_size(&guard);
        let entry_count = guard.len() as u64;
        let usage_percent = if self.max_size_bytes == 0 {
            0.0
        } else {
            (total_size_bytes as f64 / self.max_size_bytes as f64) * 100.0
        };

        CacheStats {
            total_size_bytes,
            entry_count,
            max_size_bytes: self.max_size_bytes,
            usage_percent,
        }
    }

    /// Return true if `mxc_url` is present in the in-memory index.
    pub fn contains(&self, mxc_url: &str) -> bool {
        self.index
            .read()
            .map(|g| g.contains_key(mxc_url))
            .unwrap_or(false)
    }

    /// Update the maximum cache size. Immediately evicts if over the new limit.
    pub fn set_max_size_mb(&self, max_size_mb: u64) -> Result<(), String> {
        // SAFETY: We take a write lock only to read max_size_bytes; the field is
        // not behind a lock so we use an unsafe cast. Instead we just call
        // evict_to_size with the new limit.
        let new_limit = max_size_mb * 1024 * 1024;
        self.evict_to_size(new_limit)?;
        // Explicit settings change — persist promptly rather than waiting for
        // the next background flush.
        self.flush()
    }
}

impl Drop for MediaCache {
    /// Best-effort final persist so deferred index changes (LRU bumps, newly
    /// cached entries) survive a clean shutdown even without an explicit flush.
    fn drop(&mut self) {
        if *self.dirty.get_mut() {
            if let Ok(guard) = self.index.read() {
                let _ = self.save_index(&guard);
            }
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_cache(tmp: &TempDir, max_mb: u64) -> MediaCache {
        MediaCache::with_dir(tmp.path().to_path_buf(), max_mb).unwrap()
    }

    // ── put / get roundtrip ───────────────────────────────────────────────────

    #[test]
    fn put_get_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 100);

        let url = "mxc://example.com/abc123";
        let data = b"hello world";
        let result = cache.put(url, data, "text/plain").unwrap();

        assert_eq!(result.mxc_url, url);
        assert_eq!(result.size, data.len() as u64);
        assert_eq!(result.mime_type, "text/plain");
        assert!(result.path.exists());

        let cached = cache.get(url).unwrap();
        assert_eq!(cached.mxc_url, url);
        assert_eq!(cached.size, data.len() as u64);
        assert_eq!(cached.mime_type, "text/plain");

        let on_disk = fs::read(&cached.path).unwrap();
        assert_eq!(on_disk, data);
    }

    // ── contains ─────────────────────────────────────────────────────────────

    #[test]
    fn contains_returns_correct_values() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 100);

        let url = "mxc://example.com/xyz";
        assert!(!cache.contains(url));
        cache.put(url, b"data", "image/png").unwrap();
        assert!(cache.contains(url));
    }

    // ── remove ────────────────────────────────────────────────────────────────

    #[test]
    fn remove_deletes_entry_and_file() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 100);

        let url = "mxc://example.com/remove_me";
        let result = cache.put(url, b"bytes", "image/jpeg").unwrap();
        let file_path = result.path.clone();

        cache.remove(url).unwrap();

        assert!(!cache.contains(url));
        assert!(cache.get(url).is_none());
        assert!(!file_path.exists());
    }

    // ── clear ─────────────────────────────────────────────────────────────────

    #[test]
    fn clear_wipes_everything() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 100);

        for i in 0..5u8 {
            cache
                .put(&format!("mxc://example.com/{i}"), &[i; 64], "image/png")
                .unwrap();
        }

        let stats_before = cache.stats();
        assert_eq!(stats_before.entry_count, 5);

        cache.clear().unwrap();

        let stats_after = cache.stats();
        assert_eq!(stats_after.entry_count, 0);
        assert_eq!(stats_after.total_size_bytes, 0);
    }

    // ── cache stats ───────────────────────────────────────────────────────────

    #[test]
    fn stats_accuracy() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 1); // 1 MB limit

        cache.put("mxc://a/1", &[0u8; 100], "image/png").unwrap();
        cache.put("mxc://a/2", &[0u8; 200], "image/png").unwrap();

        let stats = cache.stats();
        assert_eq!(stats.entry_count, 2);
        assert_eq!(stats.total_size_bytes, 300);
        assert_eq!(stats.max_size_bytes, 1024 * 1024);
        assert!(stats.usage_percent > 0.0);
        assert!(stats.usage_percent < 1.0); // 300 bytes / 1 MB << 1 %
    }

    // ── LRU eviction ─────────────────────────────────────────────────────────

    #[test]
    fn lru_eviction_removes_oldest() {
        let tmp = TempDir::new().unwrap();
        // 300-byte limit so that three 100-byte items fit but a fourth causes eviction.
        let cache = make_cache(&tmp, 0); // unlimited for manual control

        // Write three entries with staggered last_accessed times by touching
        // the index directly via get() to bump timestamps.
        cache.put("mxc://a/old1", &[1u8; 100], "image/png").unwrap();
        // Small sleep not needed — we'll use evict_to_size directly.
        cache.put("mxc://a/old2", &[2u8; 100], "image/png").unwrap();
        cache.put("mxc://a/new3", &[3u8; 100], "image/png").unwrap();

        // Forcibly set last_accessed of old1 < old2 < new3 via the internal index.
        {
            let mut guard = cache.index.write().unwrap();
            guard.get_mut("mxc://a/old1").unwrap().last_accessed = 1000;
            guard.get_mut("mxc://a/old2").unwrap().last_accessed = 2000;
            guard.get_mut("mxc://a/new3").unwrap().last_accessed = 3000;
        }

        // Evict to 150 bytes — should remove old1 (100 b) and old2 (100 b).
        let freed = cache.evict_to_size(150).unwrap();
        assert!(freed >= 150, "freed={freed}");

        assert!(!cache.contains("mxc://a/old1"));
        assert!(!cache.contains("mxc://a/old2"));
        assert!(cache.contains("mxc://a/new3"));
    }

    // ── Index persistence ─────────────────────────────────────────────────────

    #[test]
    fn index_persistence_across_restarts() {
        let tmp = TempDir::new().unwrap();

        // First instance: write some data.
        {
            let cache = make_cache(&tmp, 100);
            cache.put("mxc://persist/a", b"alpha", "text/plain").unwrap();
            cache.put("mxc://persist/b", b"beta", "text/plain").unwrap();
        }

        // Second instance from the same directory: should recover the index.
        {
            let cache = make_cache(&tmp, 100);
            assert!(cache.contains("mxc://persist/a"));
            assert!(cache.contains("mxc://persist/b"));

            let a = cache.get("mxc://persist/a").unwrap();
            let on_disk = fs::read(&a.path).unwrap();
            assert_eq!(on_disk, b"alpha");
        }
    }

    // ── SHA-256 key hashing ───────────────────────────────────────────────────

    #[test]
    fn sha256_hashing_is_consistent() {
        let url = "mxc://matrix.org/someMediaId";
        let hash1 = MediaCache::hash_url(url);
        let hash2 = MediaCache::hash_url(url);
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // 32 bytes → 64 hex chars
        // Different URL → different hash.
        assert_ne!(hash1, MediaCache::hash_url("mxc://matrix.org/different"));
    }

    // ── Overwrite existing entry ───────────────────────────────────────────────

    #[test]
    fn put_overwrites_existing_entry() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 100);

        let url = "mxc://example.com/overwrite";
        cache.put(url, b"old data", "text/plain").unwrap();
        cache.put(url, b"new data", "image/png").unwrap();

        let cached = cache.get(url).unwrap();
        assert_eq!(cached.mime_type, "image/png");
        assert_eq!(cached.size, 8);
        let on_disk = fs::read(&cached.path).unwrap();
        assert_eq!(on_disk, b"new data");
    }

    // ── deferred persistence ───────────────────────────────────────────────────

    #[test]
    fn put_defers_index_write_until_flush() {
        let tmp = TempDir::new().unwrap();
        let index_path = tmp.path().join("index.json");
        let cache = make_cache(&tmp, 100);

        cache.put("mxc://defer/a", b"alpha", "text/plain").unwrap();

        // The media file is written through immediately, but the index is not
        // serialised until a flush.
        assert!(!index_path.exists(), "index should not be written on put");

        cache.flush().unwrap();
        assert!(index_path.exists(), "flush should persist the index");

        // A second flush with no intervening mutation is a cheap no-op (the
        // dirty flag is clear); the data is still recoverable.
        cache.flush().unwrap();
        let reopened = make_cache(&tmp, 100);
        assert!(reopened.contains("mxc://defer/a"));
    }

    // ── get returns None for missing entries ───────────────────────────────────

    #[test]
    fn get_returns_none_for_missing() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 100);
        assert!(cache.get("mxc://nonexistent/url").is_none());
    }
}
