// Legacy session cleanup.
//
// Sessions used to be persisted here as plaintext JSON in localStorage (the
// `quark_session` key), which put the Matrix access token on disk and made it
// readable by any JS in the WebView. Sessions are now owned entirely by the Rust
// backend and stored in the OS keyring (see `secrets.rs`); the token never
// reaches the frontend. The only thing left to do here is scrub the old
// plaintext key off disk for users upgrading from a pre-keyring build.

const LEGACY_SESSION_KEY = "quark_session";

/** Remove any plaintext session left in localStorage by a pre-keyring build. */
export function clearLegacySession(): void {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* localStorage unavailable — nothing to clean up */
  }
}
