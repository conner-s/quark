//! SSRF guard for backend HTTP fetches of frontend-/message-supplied URLs.
//!
//! `get_url_preview` fetches arbitrary URLs that arrive in message content (it
//! even auto-fires on the first link in a message). Without validation that's a
//! server-side request forgery primitive: a link to `http://127.0.0.1:…`,
//! `http://169.254.169.254/…` (cloud metadata), or any RFC1918 LAN host makes
//! Quark fetch it from the user's machine/network.
//!
//! [`guarded_get`] closes that off:
//!  - only `http`/`https` schemes are allowed;
//!  - the host is resolved and **every** resulting IP must be publicly routable
//!    (loopback / private / link-local / ULA / etc. are refused);
//!  - the connection is pinned to the validated IP via reqwest `.resolve(...)`,
//!    so a DNS rebind between our check and the connect can't swap in an
//!    internal address;
//!  - redirects are followed manually (capped), re-validating every hop, so a
//!    public URL can't 30x its way to an internal one;
//!  - the response body is read with a hard byte cap to bound memory use.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

/// Max redirect hops to follow before giving up.
const MAX_REDIRECTS: usize = 5;

/// True if `ip` must never be the target of a backend fetch. Covers loopback,
/// private (RFC1918), link-local, unspecified, multicast/broadcast,
/// documentation, CGNAT, IPv6 ULA/link-local, and the IPv4-mapped forms of all
/// of the above.
pub fn ip_is_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_documentation()
                || o[0] == 0 // 0.0.0.0/8 "this host"
                || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 CGNAT
                || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 IETF
                || o[0] >= 240 // 240.0.0.0/4 reserved (excl. broadcast, handled above)
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
                return true;
            }
            // Re-check IPv4-mapped (::ffff:a.b.c.d) against the v4 rules.
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return ip_is_blocked(IpAddr::V4(mapped));
            }
            let seg = v6.segments();
            (seg[0] & 0xfe00) == 0xfc00      // fc00::/7  unique-local
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

/// Validate a URL's scheme, then resolve its host and ensure **every** resolved
/// address is publicly routable. Returns the host and a validated socket address
/// to pin the connection to.
async fn resolve_checked(url: &url::Url) -> Result<(String, SocketAddr), String> {
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("refusing to fetch non-http(s) scheme: {other}")),
    }
    let host = url.host_str().ok_or_else(|| "URL has no host".to_string())?.to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL has no port".to_string())?;

    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| format!("DNS resolution failed: {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err("host did not resolve to any address".to_string());
    }
    if let Some(bad) = addrs.iter().find(|a| ip_is_blocked(a.ip())) {
        return Err(format!(
            "refusing to fetch non-public address {} for host {host}",
            bad.ip()
        ));
    }
    Ok((host, addrs[0]))
}

/// Fetch `url_str` with full SSRF protection, following up to [`MAX_REDIRECTS`]
/// validated redirects. Headers from `extra_headers` are sent on every hop.
/// Returns the final non-redirect response.
pub async fn guarded_get(
    url_str: &str,
    user_agent: &str,
    timeout: Duration,
    extra_headers: &[(&str, &str)],
) -> Result<reqwest::Response, String> {
    let mut current = url::Url::parse(url_str).map_err(|e| format!("invalid URL: {e}"))?;

    for _ in 0..=MAX_REDIRECTS {
        let (host, pinned) = resolve_checked(&current).await?;

        // Pin the connection to the address we just validated so a rebind can't
        // redirect us to an internal host between check and connect. Auto
        // redirects are disabled — we follow them ourselves, re-validating each.
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .resolve(&host, pinned)
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;

        let mut req = client.get(current.clone());
        for (k, v) in extra_headers {
            req = req.header(*k, *v);
        }
        let resp = req.send().await.map_err(|e| format!("URL fetch failed: {e}"))?;

        if resp.status().is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "redirect response without a usable Location".to_string())?;
            // Resolve relative redirects against the current URL.
            current = current
                .join(location)
                .map_err(|e| format!("invalid redirect target: {e}"))?;
            continue;
        }

        return Ok(resp);
    }

    Err("too many redirects".to_string())
}

/// Read a response body into memory, but never more than `max_bytes` (extra data
/// is discarded). Guards against a hostile target streaming a huge body.
pub async fn read_body_capped(mut resp: reqwest::Response, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("URL read failed: {e}"))? {
        let remaining = max_bytes.saturating_sub(buf.len());
        if remaining == 0 {
            break;
        }
        let take = remaining.min(chunk.len());
        buf.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            break;
        }
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::ip_is_blocked;
    use std::net::IpAddr;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn blocks_private_and_local_v4() {
        for s in [
            "127.0.0.1",      // loopback
            "10.0.0.1",       // RFC1918
            "172.16.0.1",     // RFC1918
            "172.31.255.254", // RFC1918 upper
            "192.168.1.1",    // RFC1918
            "169.254.1.1",    // link-local (incl. cloud metadata range)
            "169.254.169.254",// cloud metadata specifically
            "0.0.0.0",        // unspecified / this-host
            "100.64.0.1",     // CGNAT
            "255.255.255.255",// broadcast
            "240.0.0.1",      // reserved
        ] {
            assert!(ip_is_blocked(ip(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn allows_public_v4() {
        for s in ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1"] {
            assert!(!ip_is_blocked(ip(s)), "{s} should be allowed");
        }
    }

    #[test]
    fn blocks_private_and_local_v6() {
        for s in [
            "::1",                // loopback
            "::",                 // unspecified
            "fe80::1",            // link-local
            "fc00::1",            // ULA
            "fd12:3456::1",       // ULA
            "::ffff:127.0.0.1",   // v4-mapped loopback
            "::ffff:10.0.0.1",    // v4-mapped private
            "ff02::1",            // multicast
        ] {
            assert!(ip_is_blocked(ip(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn allows_public_v6() {
        for s in ["2606:4700:4700::1111", "2001:4860:4860::8888"] {
            assert!(!ip_is_blocked(ip(s)), "{s} should be allowed");
        }
    }
}
