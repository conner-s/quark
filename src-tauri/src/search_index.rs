//! Persistent, encrypted message-search index.
//!
//! The matrix-sdk event cache only surfaces the events it currently holds *in
//! memory* (a window), so searching deep history means re-paginating — slow,
//! and after a restart it even re-downloads. This index keeps its own copy of
//! the searchable message text on disk, so a fully-indexed room can be searched
//! instantly with no pagination and no network.
//!
//! **Encryption.** Message bodies are sensitive, so the index is an SQLCipher
//! database — page-encrypted at rest under the *same* 256-bit key matrix-sdk
//! uses for its stores (held in the OS keyring; see [`crate::secrets`]). It
//! lives in the app data dir as `search_index.sqlite3`, separate from the
//! event-cache DB (so "clear event cache" doesn't wipe it, and vice versa).
//!
//! **Platforms.** Desktop/iOS only. Android excludes the SQLCipher dependency
//! (its OpenSSL crypto doesn't cross-compile cleanly — the same reason
//! matrix-sdk uses rustls there), so the Android `imp` is a no-op stub and
//! search transparently falls back to the event-cache scan.

use std::sync::{Arc, Mutex};

pub use imp::SearchIndex;

/// One message row stored in (and returned from) the index. Carries just enough
/// to rebuild a search-result `TimelineEvent` and to match a substring query.
#[derive(Debug, Clone)]
pub struct IndexedMessage {
    pub event_id: String,
    pub sender: String,
    pub timestamp: u64,
    pub body: String,
    pub formatted_body: Option<String>,
    pub msg_type: String,
}

impl IndexedMessage {
    /// Lowercased text used for substring matching: the plain body plus the
    /// formatted (HTML) body when present — mirrors `event_matches` so the index
    /// returns exactly what an inline scan would.
    fn search_text(&self) -> String {
        let mut s = self.body.to_lowercase();
        if let Some(fb) = &self.formatted_body {
            s.push('\n');
            s.push_str(&fb.to_lowercase());
        }
        s
    }
}

/// Tauri-managed handle to the (lazily opened) index. `None` until a session is
/// established and the keyed DB is opened, or always `None` on Android / if the
/// keyring is unreachable — callers treat `None` as "no index, scan instead".
pub struct SearchIndexState(pub Mutex<Option<Arc<SearchIndex>>>);

impl Default for SearchIndexState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl SearchIndexState {
    /// Clone out the current index handle, if one is open.
    pub fn get(&self) -> Option<Arc<SearchIndex>> {
        self.0.lock().ok().and_then(|g| g.clone())
    }

    /// Install an opened index (replacing any prior one — e.g. on re-login).
    pub fn set(&self, idx: Arc<SearchIndex>) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(idx);
        }
    }
}

/// Cap on rows emitted as hits for a single index-served search. Match *counts*
/// are exact (a separate `COUNT`); this only bounds how many events we stream,
/// well above the frontend's 200-row render cap.
pub const EMIT_CAP: usize = 1_000;

// ─── Desktop / iOS: real SQLCipher-backed index ─────────────────────────────

#[cfg(not(target_os = "android"))]
mod imp {
    use super::IndexedMessage;
    use rusqlite::Connection;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    /// Bump when the schema changes; on mismatch the index (a derived cache) is
    /// dropped and rebuilt rather than migrated.
    const SCHEMA_VERSION: i64 = 1;

    pub struct SearchIndex {
        conn: Mutex<Connection>,
        path: PathBuf,
    }

    impl SearchIndex {
        /// Open (or create) the encrypted index at `db_path`, unlocked with the
        /// raw 256-bit `key_hex` (64 hex chars). A wrong key fails on first read.
        pub fn open(db_path: &Path, key_hex: &str) -> Result<Self, String> {
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create index dir: {e}"))?;
            }
            let conn = Connection::open(db_path).map_err(|e| format!("open index: {e}"))?;

            // SQLCipher: supply the key as a raw blob (`x'…'`) so it's used
            // directly with no PBKDF2 over a passphrase. key_hex comes from our
            // own keyring (controlled, hex-only), so the inline format is safe.
            conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))
                .map_err(|e| format!("key index: {e}"))?;
            // Touching the schema forces SQLCipher to actually decrypt page 1 —
            // a wrong/rotated key surfaces here instead of on a later query.
            if conn.execute_batch("SELECT count(*) FROM sqlite_master;").is_err() {
                return Err("search index key mismatch".to_string());
            }

            let idx = Self { conn: Mutex::new(conn), path: db_path.to_path_buf() };
            idx.init_schema()?;
            Ok(idx)
        }

        fn init_schema(&self) -> Result<(), String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            let version: i64 = conn
                .query_row("PRAGMA user_version;", [], |r| r.get(0))
                .map_err(|e| format!("read schema version: {e}"))?;
            // Existing DB on an older schema → drop and rebuild (derived data).
            if version != 0 && version != SCHEMA_VERSION {
                conn.execute_batch("DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS rooms;")
                    .map_err(|e| format!("reset index: {e}"))?;
            }
            conn.execute_batch(&format!(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS messages (
                     room_id        TEXT NOT NULL,
                     event_id       TEXT NOT NULL,
                     sender         TEXT NOT NULL,
                     ts             INTEGER NOT NULL,
                     msg_type       TEXT NOT NULL,
                     body           TEXT NOT NULL,
                     formatted_body TEXT,
                     search_text    TEXT NOT NULL,
                     PRIMARY KEY (room_id, event_id)
                 );
                 CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, ts);
                 CREATE TABLE IF NOT EXISTS rooms (
                     room_id          TEXT PRIMARY KEY,
                     indexed_to_start INTEGER NOT NULL DEFAULT 0,
                     total_events     INTEGER
                 );
                 PRAGMA user_version = {SCHEMA_VERSION};"
            ))
            .map_err(|e| format!("init index schema: {e}"))
        }

        /// Insert/replace a batch of messages for a room in one transaction.
        pub fn upsert(&self, room_id: &str, msgs: &[IndexedMessage]) -> Result<(), String> {
            if msgs.is_empty() {
                return Ok(());
            }
            let mut conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            let tx = conn.transaction().map_err(|e| format!("index tx: {e}"))?;
            {
                let mut stmt = tx
                    .prepare_cached(
                        "INSERT OR REPLACE INTO messages
                         (room_id, event_id, sender, ts, msg_type, body, formatted_body, search_text)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    )
                    .map_err(|e| format!("prepare upsert: {e}"))?;
                for m in msgs {
                    stmt.execute(rusqlite::params![
                        room_id,
                        m.event_id,
                        m.sender,
                        m.timestamp as i64,
                        m.msg_type,
                        m.body,
                        m.formatted_body,
                        m.search_text(),
                    ])
                    .map_err(|e| format!("upsert row: {e}"))?;
                }
            }
            tx.commit().map_err(|e| format!("commit upsert: {e}"))
        }

        /// Substring search within a room, newest first. `needle` must be
        /// lowercased by the caller; `until_ts` (epoch ms) bounds results to that
        /// date or newer (for the "back to date" tier).
        pub fn search(
            &self,
            room_id: &str,
            needle: &str,
            until_ts: Option<u64>,
            limit: usize,
        ) -> Result<Vec<IndexedMessage>, String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            // instr() is a literal substring test (no LIKE wildcard semantics).
            let sql = format!(
                "SELECT event_id, sender, ts, msg_type, body, formatted_body
                 FROM messages
                 WHERE room_id = ?1 AND instr(search_text, ?2) > 0{}
                 ORDER BY ts DESC LIMIT ?3",
                if until_ts.is_some() { " AND ts >= ?4" } else { "" }
            );
            let mut stmt = conn.prepare_cached(&sql).map_err(|e| format!("prepare search: {e}"))?;
            let map_row = |r: &rusqlite::Row| {
                Ok(IndexedMessage {
                    event_id: r.get(0)?,
                    sender: r.get(1)?,
                    timestamp: r.get::<_, i64>(2)? as u64,
                    msg_type: r.get(3)?,
                    body: r.get(4)?,
                    formatted_body: r.get(5)?,
                })
            };
            let rows = if let Some(until) = until_ts {
                stmt.query_map(
                    rusqlite::params![room_id, needle, limit as i64, until as i64],
                    map_row,
                )
            } else {
                stmt.query_map(rusqlite::params![room_id, needle, limit as i64], map_row)
            }
            .map_err(|e| format!("query search: {e}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("read search rows: {e}"))
        }

        /// Exact count of matches (independent of the emission cap).
        pub fn count(
            &self,
            room_id: &str,
            needle: &str,
            until_ts: Option<u64>,
        ) -> Result<u64, String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            let sql = format!(
                "SELECT count(*) FROM messages
                 WHERE room_id = ?1 AND instr(search_text, ?2) > 0{}",
                if until_ts.is_some() { " AND ts >= ?3" } else { "" }
            );
            let mut stmt = conn.prepare_cached(&sql).map_err(|e| format!("prepare count: {e}"))?;
            let n: i64 = if let Some(until) = until_ts {
                stmt.query_row(rusqlite::params![room_id, needle, until as i64], |r| r.get(0))
            } else {
                stmt.query_row(rusqlite::params![room_id, needle], |r| r.get(0))
            }
            .map_err(|e| format!("query count: {e}"))?;
            Ok(n.max(0) as u64)
        }

        /// Record that a room has been indexed back to the start of its history,
        /// with `total` events — the authoritative source for the search-total
        /// (supersedes the old matrix-sdk custom-value).
        pub fn set_indexed_to_start(&self, room_id: &str, total: u64) -> Result<(), String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            conn.execute(
                "INSERT INTO rooms (room_id, indexed_to_start, total_events)
                 VALUES (?1, 1, ?2)
                 ON CONFLICT(room_id) DO UPDATE SET indexed_to_start = 1, total_events = ?2",
                rusqlite::params![room_id, total as i64],
            )
            .map_err(|e| format!("set indexed_to_start: {e}"))?;
            Ok(())
        }

        /// Whether a room has been fully indexed (back to its start).
        pub fn is_indexed_to_start(&self, room_id: &str) -> Result<bool, String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            let v: Option<i64> = conn
                .query_row(
                    "SELECT indexed_to_start FROM rooms WHERE room_id = ?1",
                    [room_id],
                    |r| r.get(0),
                )
                .ok();
            Ok(v.unwrap_or(0) != 0)
        }

        /// Last-known total event count for a room from a completed full index.
        pub fn room_total(&self, room_id: &str) -> Result<Option<u64>, String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            let v: Option<i64> = conn
                .query_row(
                    "SELECT total_events FROM rooms WHERE room_id = ?1",
                    [room_id],
                    |r| r.get(0),
                )
                .ok()
                .flatten();
            Ok(v.map(|n| n.max(0) as u64))
        }

        /// Wipe the entire index (all rooms). Used by "clear search cache".
        pub fn clear(&self) -> Result<(), String> {
            let conn = self.conn.lock().map_err(|_| "index lock poisoned")?;
            conn.execute_batch("DELETE FROM messages; DELETE FROM rooms;")
                .map_err(|e| format!("clear index: {e}"))
        }

        /// On-disk size of the index (main DB + WAL/SHM sidecars), for the
        /// Settings cache readout.
        pub fn size_bytes(&self) -> u64 {
            let len = |p: PathBuf| std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            let main = len(self.path.clone());
            let wal = len(self.path.with_extension("sqlite3-wal"));
            let shm = len(self.path.with_extension("sqlite3-shm"));
            main + wal + shm
        }
    }
}

// ─── Android: no-op stub (no SQLCipher dependency there) ─────────────────────

#[cfg(target_os = "android")]
mod imp {
    use super::IndexedMessage;
    use std::path::Path;

    /// Stub: never constructed on Android (the index is never opened there), but
    /// the type must exist so the shared state/command code compiles.
    pub struct SearchIndex;

    #[allow(unused_variables)]
    impl SearchIndex {
        pub fn open(db_path: &Path, key_hex: &str) -> Result<Self, String> {
            Err("search index unavailable on this platform".to_string())
        }
        pub fn upsert(&self, room_id: &str, msgs: &[IndexedMessage]) -> Result<(), String> {
            Ok(())
        }
        pub fn search(
            &self,
            room_id: &str,
            needle: &str,
            until_ts: Option<u64>,
            limit: usize,
        ) -> Result<Vec<IndexedMessage>, String> {
            Ok(Vec::new())
        }
        pub fn count(&self, room_id: &str, needle: &str, until_ts: Option<u64>) -> Result<u64, String> {
            Ok(0)
        }
        pub fn set_indexed_to_start(&self, room_id: &str, total: u64) -> Result<(), String> {
            Ok(())
        }
        pub fn is_indexed_to_start(&self, room_id: &str) -> Result<bool, String> {
            Ok(false)
        }
        pub fn room_total(&self, room_id: &str) -> Result<Option<u64>, String> {
            Ok(None)
        }
        pub fn clear(&self) -> Result<(), String> {
            Ok(())
        }
        pub fn size_bytes(&self) -> u64 {
            0
        }
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    fn msg(id: &str, ts: u64, body: &str) -> IndexedMessage {
        IndexedMessage {
            event_id: id.into(),
            sender: "@a:x".into(),
            timestamp: ts,
            body: body.into(),
            formatted_body: None,
            msg_type: "m.room.message".into(),
        }
    }

    fn open_tmp() -> (tempfile::TempDir, SearchIndex) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search_index.sqlite3");
        // 64 hex chars = 32-byte raw key.
        let key = "a".repeat(64);
        let idx = SearchIndex::open(&path, &key).unwrap();
        (dir, idx)
    }

    #[test]
    fn upsert_and_substring_search() {
        let (_d, idx) = open_tmp();
        let room = "!r:x";
        idx.upsert(
            room,
            &[msg("$1", 100, "hello world"), msg("$2", 200, "the latest TEST"), msg("$3", 300, "nope")],
        )
        .unwrap();

        // Case-insensitive, mid-word substring (matches "TEST" inside "latest").
        let hits = idx.search(room, "test", None, 50).unwrap();
        let ids: Vec<_> = hits.iter().map(|m| m.event_id.as_str()).collect();
        assert_eq!(ids, vec!["$2"], "only the message containing 'test' matches");
        assert_eq!(idx.count(room, "test", None).unwrap(), 1);

        // Newest-first ordering.
        let all = idx.search(room, "e", None, 50).unwrap();
        assert_eq!(all.first().unwrap().event_id, "$3");
        assert_eq!(all.last().unwrap().event_id, "$1");
    }

    #[test]
    fn until_ts_bounds_results() {
        let (_d, idx) = open_tmp();
        let room = "!r:x";
        idx.upsert(room, &[msg("$old", 100, "match"), msg("$new", 300, "match")]).unwrap();
        let hits = idx.search(room, "match", Some(200), 50).unwrap();
        assert_eq!(hits.len(), 1, "only events at/after the cutoff");
        assert_eq!(hits[0].event_id, "$new");
        assert_eq!(idx.count(room, "match", Some(200)).unwrap(), 1);
    }

    #[test]
    fn indexed_to_start_and_total_roundtrip() {
        let (_d, idx) = open_tmp();
        let room = "!r:x";
        assert!(!idx.is_indexed_to_start(room).unwrap());
        assert_eq!(idx.room_total(room).unwrap(), None);
        idx.set_indexed_to_start(room, 4_242).unwrap();
        assert!(idx.is_indexed_to_start(room).unwrap());
        assert_eq!(idx.room_total(room).unwrap(), Some(4_242));
    }

    #[test]
    fn upsert_replaces_existing_event() {
        let (_d, idx) = open_tmp();
        let room = "!r:x";
        idx.upsert(room, &[msg("$1", 100, "original")]).unwrap();
        idx.upsert(room, &[msg("$1", 100, "edited body")]).unwrap();
        assert_eq!(idx.count(room, "original", None).unwrap(), 0);
        assert_eq!(idx.count(room, "edited", None).unwrap(), 1);
    }

    #[test]
    fn wrong_key_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search_index.sqlite3");
        {
            let idx = SearchIndex::open(&path, &"a".repeat(64)).unwrap();
            idx.upsert("!r:x", &[msg("$1", 1, "secret")]).unwrap();
        }
        // Reopening with a different key must fail (data is encrypted at rest).
        assert!(SearchIndex::open(&path, &"b".repeat(64)).is_err());
        // Right key still works.
        assert!(SearchIndex::open(&path, &"a".repeat(64)).is_ok());
    }

    #[test]
    fn clear_wipes_all_rooms() {
        let (_d, idx) = open_tmp();
        idx.upsert("!r:x", &[msg("$1", 1, "hi")]).unwrap();
        idx.set_indexed_to_start("!r:x", 1).unwrap();
        idx.clear().unwrap();
        assert_eq!(idx.count("!r:x", "hi", None).unwrap(), 0);
        assert!(!idx.is_indexed_to_start("!r:x").unwrap());
    }
}
