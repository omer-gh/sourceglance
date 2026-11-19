//! Sign-ins, kept in the login Keychain (Credential Manager on Windows), one item per
//! account id. Tokens never go to JavaScript; it gets a reference instead:
//!
//! - `account:<id>` for a saved sign-in;
//! - `pending:<n>` for a new one that isn't saved under an account yet.
//!
//! A pending sign-in can only be used with the instance it came from. GitLab sign-ins are
//! stored as JSON `{access, refresh, expiresAt}`, as on GNOME.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Same name as the GNOME keyring schema.
const SERVICE: &str = "io.github.omer-gh.sourceglance";
/// How many unsaved sign-ins to keep; the oldest go first.
const MAX_PENDING: usize = 8;
/// Renew GitLab tokens this long before they expire, as in gitlabModel.js.
const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

pub const ACCOUNT_PREFIX: &str = "account:";
pub const PENDING_PREFIX: &str = "pending:";

#[derive(Clone)]
struct Pending {
    base: String,
    secret: String,
}

#[derive(Default)]
pub struct Secrets {
    pending: Mutex<Vec<(String, Pending)>>,
    counter: AtomicU64,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, id).map_err(|e| e.to_string())
}

/// The token to send: `access` from a GitLab sign-in, otherwise the stored text.
pub fn access_token(secret: &str) -> String {
    match serde_json::from_str::<Value>(secret) {
        Ok(Value::Object(map)) => map
            .get("access")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        _ => secret.to_string(),
    }
}

impl Secrets {
    /// The saved sign-in for an account id, if any.
    pub fn lookup(&self, id: &str) -> Result<Option<String>, String> {
        match entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn store(&self, id: &str, secret: &str) -> Result<(), String> {
        entry(id)?.set_password(secret).map_err(|e| e.to_string())
    }

    pub fn clear(&self, id: &str) -> Result<(), String> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Keeps a new sign-in for `base` until it's saved, and returns its reference.
    pub fn hold(&self, base: &str, secret: String) -> String {
        let reference = format!(
            "{PENDING_PREFIX}{}",
            self.counter.fetch_add(1, Ordering::Relaxed) + 1
        );
        let mut pending = self.pending.lock().unwrap();
        pending.push((
            reference.clone(),
            Pending {
                base: base.to_string(),
                secret,
            },
        ));
        while pending.len() > MAX_PENDING {
            pending.remove(0);
        }
        reference
    }

    /// Saves a pending sign-in under an account id, if it came from `base`.
    pub fn adopt(&self, reference: &str, id: &str, base: &str) -> Result<(), String> {
        let held = {
            let mut pending = self.pending.lock().unwrap();
            let index = pending
                .iter()
                .position(|(r, p)| r == reference && p.base == base)
                .ok_or("unknown sign-in")?;
            pending.remove(index).1
        };
        self.store(id, &held.secret)
    }

    /// The secret behind a reference, if it may be sent to `base`. `account_base` is the
    /// instance of the account, from the account list.
    pub fn resolve(
        &self,
        reference: &str,
        base: &str,
        account_base: Option<&str>,
    ) -> Result<Option<String>, String> {
        if let Some(id) = reference.strip_prefix(ACCOUNT_PREFIX) {
            if account_base != Some(base) {
                return Err("sign-in belongs to another instance".into());
            }
            return self.lookup(id);
        }
        if reference.starts_with(PENDING_PREFIX) {
            let pending = self.pending.lock().unwrap();
            return match pending.iter().find(|(r, _)| r == reference) {
                Some((_, held)) if held.base == base => Ok(Some(held.secret.clone())),
                Some(_) => Err("sign-in belongs to another instance".into()),
                None => Ok(None),
            };
        }
        Err("not a sign-in reference".into())
    }
}

/// Replaces the token in an OAuth response with a reference and drops the refresh token.
pub fn hold_token_response(secrets: &Secrets, base: &str, gitlab: bool, mut json: Value) -> Value {
    let Some(access) = json
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return json;
    };
    let secret = if gitlab {
        let expires_in = json
            .get("expires_in")
            .and_then(Value::as_i64)
            .filter(|n| *n > 0)
            .unwrap_or(7200);
        json!({
            "access": access,
            "refresh": json.get("refresh_token").and_then(Value::as_str),
            "expiresAt": now_ms() + expires_in * 1000,
        })
        .to_string()
    } else {
        access
    };
    let reference = secrets.hold(base, secret);
    if let Value::Object(map) = &mut json {
        map.insert("access_token".into(), Value::String(reference));
        map.remove("refresh_token");
    }
    json
}

/// A personal access token in the form stored for its platform.
pub fn token_secret(gitlab: bool, token: &str) -> String {
    if gitlab {
        json!({"access": token, "refresh": null, "expiresAt": i64::MAX / 2}).to_string()
    } else {
        token.to_string()
    }
}

/// The refresh token, if a GitLab sign-in is due for renewal.
pub fn refresh_due(secret: &str) -> Option<String> {
    let value: Value = serde_json::from_str(secret).ok()?;
    let refresh = value.get("refresh")?.as_str()?.to_string();
    let expires_at = value.get("expiresAt")?.as_i64()?;
    (now_ms() > expires_at - REFRESH_MARGIN_MS).then_some(refresh)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_sign_ins_only_go_to_their_instance() {
        let secrets = Secrets::default();
        let r = secrets.hold("https://github.com", "tok".into());
        assert_eq!(
            secrets.resolve(&r, "https://github.com", None).unwrap(),
            Some("tok".into())
        );
        assert!(secrets.resolve(&r, "https://gitlab.com", None).is_err());
        assert!(secrets.resolve("tok", "https://github.com", None).is_err());
    }

    #[test]
    fn account_sign_ins_need_a_matching_account() {
        let secrets = Secrets::default();
        assert!(secrets
            .resolve(
                "account:x",
                "https://github.com",
                Some("https://gitlab.com")
            )
            .is_err());
        assert!(secrets
            .resolve("account:x", "https://github.com", None)
            .is_err());
    }

    #[test]
    fn token_responses_never_carry_the_token_out() {
        let secrets = Secrets::default();
        let out = hold_token_response(
            &secrets,
            "https://gitlab.com",
            true,
            json!({"access_token": "a", "refresh_token": "r", "expires_in": 60}),
        );
        let reference = out["access_token"].as_str().unwrap();
        assert!(reference.starts_with(PENDING_PREFIX));
        assert!(out.get("refresh_token").is_none());
        let held = secrets
            .resolve(reference, "https://gitlab.com", None)
            .unwrap()
            .unwrap();
        assert_eq!(access_token(&held), "a");
        assert_eq!(refresh_due(&held), Some("r".into()));

        let waiting = hold_token_response(
            &secrets,
            "https://github.com",
            false,
            json!({"error": "authorization_pending"}),
        );
        assert_eq!(waiting, json!({"error": "authorization_pending"}));
    }

    #[test]
    fn old_pending_sign_ins_are_dropped() {
        let secrets = Secrets::default();
        let first = secrets.hold("https://github.com", "0".into());
        for n in 0..MAX_PENDING {
            secrets.hold("https://github.com", n.to_string());
        }
        assert_eq!(
            secrets.resolve(&first, "https://github.com", None).unwrap(),
            None
        );
    }
}
