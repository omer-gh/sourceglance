//! All of the app's HTTP requests, with the ADR 0007 rules (same as `src/lib/transport.js`):
//!
//! - Only github.com, gitlab.com and the user's instances are reached, and a request stays
//!   on its own instance.
//! - No redirects on self-hosted instances.
//! - Plain `http://` only to the local network. The name is resolved before every request,
//!   every address must be a LAN address, and the connection is pinned to it (no DNS
//!   rebinding).

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use url::Url;

pub const GITHUB_COM: &str = "https://github.com";
pub const GITLAB_COM: &str = "https://gitlab.com";
const GITHUB_API: &str = "https://api.github.com";
const TIMEOUT: Duration = Duration::from_secs(30);
/// Larger responses are refused.
const MAX_BODY: usize = 8 * 1024 * 1024;

/// Headers JavaScript may not set.
const FORBIDDEN_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "host",
    "proxy-authorization",
    "connection",
    "content-length",
    "transfer-encoding",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NetError {
    /// Not an instance the user added, or a URL outside its instance.
    NotAllowed,
    /// Plain http:// to an address that isn't on the local network.
    Insecure,
    /// A local-network instance couldn't be reached: usually macOS's Local Network
    /// permission is off for Source Glance.
    LocalNetwork,
    /// No connection, DNS failure, TLS failure or timeout.
    Network,
    /// The response was too large.
    TooLarge,
    /// Bad method, header or URL.
    Invalid,
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            NetError::NotAllowed => "not-allowed",
            NetError::Insecure => "insecure",
            NetError::LocalNetwork => "local-network",
            NetError::Network => "network",
            NetError::TooLarge => "too-large",
            NetError::Invalid => "invalid",
        };
        f.write_str(text)
    }
}

/// An instance address in the form `parseInstanceUrl()` in accounts.js produces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instance {
    /// As JavaScript has it, which is how settings and account ids name the instance.
    pub base: String,
    pub url: Url,
    /// The same address as URLs are written once parsed (an IPv6 address in its short
    /// form), to match request URLs against.
    prefix: String,
}

impl Instance {
    pub fn parse(base: &str) -> Option<Instance> {
        let url = Url::parse(base).ok()?;
        if url.scheme() != "https" && url.scheme() != "http" {
            return None;
        }
        if !url.username().is_empty() || url.password().is_some() {
            return None;
        }
        if url.query().is_some() || url.fragment().is_some() {
            return None;
        }
        let host = url.host_str()?;
        // Only accept the normalized form, so JavaScript and Rust agree on the instance.
        let mut normalized = url.as_str().to_string();
        if url.path() == "/" {
            normalized.pop();
        }
        if base.ends_with('/') {
            return None;
        }
        // JavaScript keeps an IPv6 address as typed; the URL parser shortens it.
        let typed = match (url.host(), base.find('['), base.find(']')) {
            (Some(url::Host::Ipv6(_)), Some(open), Some(close)) if open < close => {
                format!("{}{host}{}", &base[..open], &base[close + 1..])
            }
            _ => base.to_string(),
        };
        if normalized != typed {
            return None;
        }
        Some(Instance {
            base: base.to_string(),
            url,
            prefix: normalized,
        })
    }

    pub fn is_default(&self) -> bool {
        self.base == GITHUB_COM || self.base == GITLAB_COM
    }

    fn is_plain_http(&self) -> bool {
        self.url.scheme() == "http"
    }

    /// Whether `target` is under this instance (or api.github.com for github.com).
    pub fn contains(&self, target: &Url) -> bool {
        if !target.username().is_empty() || target.password().is_some() {
            return false;
        }
        let text = target.as_str();
        if self.base == GITHUB_COM && starts_under(text, GITHUB_API) {
            return true;
        }
        starts_under(text, &self.prefix)
    }
}

fn starts_under(text: &str, base: &str) -> bool {
    text == base || text.starts_with(&format!("{base}/")) || text.starts_with(&format!("{base}?"))
}

/// Loopback, private IPv4, link-local, or IPv6 unique local. Same rule as `isLanAddress()`
/// in accounts.js.
pub fn is_lan_address(address: &IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            a == 10
                || a == 127
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 169 && b == 254)
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_lan_address(&IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

/// A request from JavaScript. `auth` is a sign-in reference (see secrets.rs).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub base: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub auth: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Checks a request against its instance and returns the parsed URL.
pub fn check_request(instance: &Instance, request: &ApiRequest) -> Result<Url, NetError> {
    let target = Url::parse(&request.url).map_err(|_| NetError::Invalid)?;
    if !instance.contains(&target) {
        return Err(NetError::NotAllowed);
    }
    match request.method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" => {}
        _ => return Err(NetError::Invalid),
    }
    for (name, value) in &request.headers {
        let lower = name.to_ascii_lowercase();
        if FORBIDDEN_HEADERS.contains(&lower.as_str())
            || lower.starts_with("sec-")
            || lower.starts_with("proxy-")
        {
            return Err(NetError::Invalid);
        }
        if value.contains(['\r', '\n']) {
            return Err(NetError::Invalid);
        }
    }
    Ok(target)
}

/// Resolves a plain-http host, checks every address is on the LAN, and returns the one to
/// connect to (IPv4 first).
async fn checked_lan_address(target: &Url) -> Result<SocketAddr, NetError> {
    let host = target.host_str().ok_or(NetError::Invalid)?;
    let port = target.port_or_known_default().ok_or(NetError::Invalid)?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let addresses: Vec<SocketAddr> = match host.parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| NetError::Network)?
            .collect(),
    };
    if addresses.is_empty() || !addresses.iter().all(|a| is_lan_address(&a.ip())) {
        return Err(NetError::Insecure);
    }
    Ok(*addresses
        .iter()
        .find(|a| a.is_ipv4())
        .unwrap_or(&addresses[0]))
}

/// A client for one request, with the redirect and LAN rules applied.
async fn client_for(
    instance: &Instance,
    target: &Url,
    user_agent: &str,
) -> Result<reqwest::Client, NetError> {
    let policy = if instance.is_default() {
        // github.com and gitlab.com: up to 5 redirects, https on the same host only.
        Policy::custom(|attempt| {
            let same_host = attempt
                .previous()
                .last()
                .and_then(|u| u.host_str().map(str::to_owned));
            if attempt.previous().len() >= 5 {
                attempt.stop()
            } else if attempt.url().scheme() == "https"
                && attempt.url().host_str().map(str::to_owned) == same_host
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        })
    } else {
        Policy::none()
    };
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(TIMEOUT)
        .redirect(policy)
        // A proxy from the environment would skip the LAN check and the pinned address.
        .no_proxy();
    if instance.is_plain_http() {
        let pinned = checked_lan_address(target).await?;
        let host = target.host_str().ok_or(NetError::Invalid)?;
        builder = builder.resolve(host, pinned);
    } else {
        builder = builder.https_only(true);
    }
    builder.build().map_err(|_| NetError::Network)
}

/// "No route to host" or "Operation not permitted" while connecting: what macOS answers
/// when the Local Network permission is off (or the server is down).
fn is_unreachable(error: &reqwest::Error) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(e) = source {
        if let Some(io) = e.downcast_ref::<std::io::Error>() {
            // EPERM and EHOSTUNREACH on macOS.
            return matches!(io.raw_os_error(), Some(1) | Some(65));
        }
        source = e.source();
    }
    false
}

/// Checks and sends a request. `authorization` is the header value, if any.
pub async fn send(
    instance: &Instance,
    request: &ApiRequest,
    authorization: Option<String>,
    user_agent: &str,
) -> Result<ApiResponse, NetError> {
    let target = check_request(instance, request)?;
    let client = client_for(instance, &target, user_agent).await?;
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| NetError::Invalid)?;
    let mut builder = client.request(method, target);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if let Some(value) = authorization {
        builder = builder.header(reqwest::header::AUTHORIZATION, value);
    }
    if let Some(body) = &request.body {
        builder = builder.body(body.clone());
    }
    let response = builder.send().await.map_err(|e| {
        if instance.is_plain_http() && is_unreachable(&e) {
            NetError::LocalNetwork
        } else {
            NetError::Network
        }
    })?;
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(text) = value.to_str() {
            headers.insert(name.as_str().to_ascii_lowercase(), text.to_string());
        }
    }
    if response
        .content_length()
        .is_some_and(|n| n as usize > MAX_BODY)
    {
        return Err(NetError::TooLarge);
    }
    // Read in pieces, so a response without a length can't fill the memory.
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| NetError::Network)? {
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err(NetError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(ApiResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn lan_addresses_match_the_javascript_rule() {
        for lan in [
            "10.0.0.1",
            "127.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.1.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:192.168.0.1",
        ] {
            assert!(is_lan_address(&ip(lan)), "{lan} should be LAN");
        }
        for public in [
            "8.8.8.8",
            "172.32.0.1",
            "192.169.0.1",
            "2001:db8::1",
            "::ffff:8.8.8.8",
            "100.64.0.1",
        ] {
            assert!(!is_lan_address(&ip(public)), "{public} should not be LAN");
        }
    }

    #[test]
    fn instances_must_be_normalized() {
        assert!(Instance::parse("https://github.com").is_some());
        assert!(Instance::parse("https://git.example.com/gitlab").is_some());
        assert!(Instance::parse("http://192.168.1.5:8080").is_some());
        assert!(Instance::parse("https://github.com/").is_none());
        assert!(Instance::parse("https://user:pw@git.example.com").is_none());
        assert!(Instance::parse("https://git.example.com?x=1").is_none());
        assert!(Instance::parse("ftp://git.example.com").is_none());
        assert!(Instance::parse("https://GIT.example.com").is_none());
        // IPv6 as typed in the form; requests use the short form.
        let v6 = Instance::parse("http://[fd00:0:0::1]:8080").unwrap();
        assert_eq!(v6.base, "http://[fd00:0:0::1]:8080");
        assert!(v6.contains(&Url::parse("http://[fd00::1]:8080/api/v4/user").unwrap()));
        assert!(Instance::parse("http://[fd00::1]:8080").is_some());
    }

    fn request(url: &str) -> ApiRequest {
        ApiRequest {
            base: String::new(),
            method: "GET".into(),
            url: url.into(),
            headers: HashMap::new(),
            body: None,
            auth: None,
        }
    }

    #[test]
    fn requests_stay_on_their_instance() {
        let github = Instance::parse(GITHUB_COM).unwrap();
        assert!(check_request(&github, &request("https://api.github.com/user")).is_ok());
        assert!(check_request(&github, &request("https://github.com/login/device/code")).is_ok());
        assert_eq!(
            check_request(&github, &request("https://github.com.evil.example/x")),
            Err(NetError::NotAllowed)
        );
        assert_eq!(
            check_request(&github, &request("https://gitlab.com/api/v4/user")),
            Err(NetError::NotAllowed)
        );

        let gitlab = Instance::parse("https://git.example.com/gitlab").unwrap();
        assert!(check_request(
            &gitlab,
            &request("https://git.example.com/gitlab/api/v4/user")
        )
        .is_ok());
        assert_eq!(
            check_request(&gitlab, &request("https://git.example.com/other")),
            Err(NetError::NotAllowed)
        );
        assert_eq!(
            check_request(&gitlab, &request("https://git.example.com/gitlabx/api")),
            Err(NetError::NotAllowed)
        );
        assert_eq!(
            check_request(&gitlab, &request("https://u:p@git.example.com/gitlab/api")),
            Err(NetError::NotAllowed)
        );
    }

    #[test]
    fn the_webview_cannot_set_the_sign_in_or_smuggle_headers() {
        let github = Instance::parse(GITHUB_COM).unwrap();
        let mut req = request("https://api.github.com/user");
        req.headers
            .insert("Authorization".into(), "Bearer stolen".into());
        assert_eq!(check_request(&github, &req), Err(NetError::Invalid));

        let mut req = request("https://api.github.com/user");
        req.headers
            .insert("X-Test".into(), "a\r\nHost: evil".into());
        assert_eq!(check_request(&github, &req), Err(NetError::Invalid));

        let mut req = request("https://api.github.com/user");
        req.method = "TRACE".into();
        assert_eq!(check_request(&github, &req), Err(NetError::Invalid));
    }

    #[tokio::test]
    async fn plain_http_is_only_for_lan_addresses() {
        let lan = Url::parse("http://192.168.1.5:8080/api").unwrap();
        assert!(checked_lan_address(&lan).await.is_ok());
        let public = Url::parse("http://8.8.8.8/api").unwrap();
        assert_eq!(checked_lan_address(&public).await, Err(NetError::Insecure));
    }

    /// Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore = "needs the network"]
    async fn live_github_request_and_refused_hosts() {
        let github = Instance::parse(GITHUB_COM).unwrap();
        let response = send(
            &github,
            &request("https://api.github.com/meta"),
            None,
            "sourceglance/test",
        )
        .await
        .unwrap();
        assert_eq!(response.status, 200);
        assert!(response.body.contains("verifiable_password_authentication"));
        assert_eq!(
            send(
                &github,
                &request("https://example.com/"),
                None,
                "sourceglance/test"
            )
            .await
            .unwrap_err(),
            NetError::NotAllowed
        );
        let public_http = Instance::parse("http://example.com").unwrap();
        assert_eq!(
            send(
                &public_http,
                &request("http://example.com/api"),
                None,
                "sourceglance/test"
            )
            .await
            .unwrap_err(),
            NetError::Insecure
        );
    }
}
