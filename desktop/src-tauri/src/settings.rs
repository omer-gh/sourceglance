//! Settings, in `settings.json` in the app's config folder (no secrets). The keys follow the
//! GSettings schema in `src/schemas`.
//!
//! `accounts` has the same format as the GNOME key. net.rs uses it to decide which instances
//! can be reached, so invalid entries are dropped when it's saved.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{Map, Value};

use crate::net::{Instance, GITHUB_COM, GITLAB_COM};

/// Keys JavaScript may set, and their JSON types.
const KEYS: &[(&str, &str)] = &[
    // The same names as the GSettings schema in src/schemas.
    ("accounts", "array"),
    ("repositories", "array"),
    ("refresh-interval", "number"),
    ("layout", "string"),
    ("toolbar-buttons", "array"),
    ("collapsed-sections", "array"),
    ("collapsed-groups", "array"),
    ("widgets", "array"),
    ("widget-positions", "object"),
    ("widget-opacity", "number"),
    ("start-automatically", "bool"),
    ("check-updates", "bool"),
    ("token-changed", "number"),
    // macOS only.
    ("show-dock-icon", "bool"),
];

pub struct Settings {
    path: Option<PathBuf>,
    values: Mutex<Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub platform: String,
    pub base: String,
}

fn type_matches(value: &Value, kind: &str) -> bool {
    match kind {
        "array" => value.is_array(),
        "number" => value.is_number(),
        "string" => value.is_string(),
        "bool" => value.is_boolean(),
        "object" => value.is_object(),
        _ => false,
    }
}

/// The instance in an account id (`platform:host[/path]:login`, see `accountId()` in
/// accounts.js), or for the old "github.com" and "gitlab.com" ids. Sign-ins are only sent
/// to this instance, whatever the account list says.
pub fn base_from_id(id: &str) -> Option<String> {
    match id {
        "github.com" => return Some(GITHUB_COM.into()),
        "gitlab.com" => return Some(GITLAB_COM.into()),
        _ => {}
    }
    let (_, rest) = id.split_once(':')?;
    let (host, _) = rest.rsplit_once(':')?;
    let base = if host.starts_with("http://") {
        host.to_string()
    } else {
        format!("https://{host}")
    };
    Instance::parse(&base).map(|i| i.base)
}

/// Parses one account entry, like `parseAccount()` in accounts.js. The entry's instance
/// must be the one in its id.
pub fn parse_account(text: &str) -> Option<Account> {
    let value: Value = serde_json::from_str(text).ok()?;
    let id = value.get("id")?.as_str()?.to_string();
    let platform = value.get("platform")?.as_str()?.to_string();
    let base = value.get("base")?.as_str()?.to_string();
    if id.is_empty() || id.len() > 300 || (platform != "github" && platform != "gitlab") {
        return None;
    }
    let base = Instance::parse(&base)?.base;
    if base_from_id(&id).as_deref() != Some(base.as_str()) {
        return None;
    }
    Some(Account { id, platform, base })
}

impl Settings {
    pub fn load(path: Option<PathBuf>) -> Settings {
        let values = path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        Settings {
            path,
            values: Mutex::new(values),
        }
    }

    pub fn all(&self) -> Value {
        Value::Object(self.values.lock().unwrap().clone())
    }

    /// Saves a setting and returns the value as saved (invalid accounts dropped).
    pub fn set(&self, key: &str, value: Value) -> Result<Value, String> {
        let kind = KEYS
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, t)| *t)
            .ok_or("unknown setting")?;
        if !type_matches(&value, kind) {
            return Err("wrong type".into());
        }
        let value = if key == "accounts" {
            Self::checked_accounts(&value)
        } else {
            value
        };
        let mut values = self.values.lock().unwrap();
        values.insert(key.to_string(), value.clone());
        self.save(&values)?;
        Ok(value)
    }

    fn checked_accounts(value: &Value) -> Value {
        let kept = value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter(|item| item.as_str().and_then(parse_account).is_some())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        Value::Array(kept)
    }

    fn save(&self, values: &Map<String, Value>) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Write to a temporary file and rename it, so a crash can't leave half a file.
        let temporary = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&Value::Object(values.clone()))
            .map_err(|e| e.to_string())?;
        fs::write(&temporary, text).map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    }

    pub fn accounts(&self) -> Vec<Account> {
        let values = self.values.lock().unwrap();
        values
            .get("accounts")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|i| i.as_str().and_then(parse_account))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// github.com, gitlab.com or an account's instance.
    pub fn knows_instance(&self, base: &str) -> bool {
        base == GITHUB_COM || base == GITLAB_COM || self.accounts().iter().any(|a| a.base == base)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(id: &str, base: &str) -> Value {
        Value::String(serde_json::json!({"id": id, "platform": "gitlab", "base": base}).to_string())
    }

    #[test]
    fn only_known_keys_of_the_right_type_are_written() {
        let settings = Settings::load(None);
        assert!(settings.set("widget-opacity", Value::from(92)).is_ok());
        assert!(settings.set("widget-opacity", Value::from("x")).is_err());
        assert!(settings.set("anything", Value::from(1)).is_err());
    }

    #[test]
    fn bad_accounts_are_dropped_and_instances_come_from_the_list() {
        let settings = Settings::load(None);
        let list = Value::Array(vec![
            account("gitlab:git.example.com:bob", "https://git.example.com"),
            account("bad", "https://git.example.com/"),
            // An entry can't point an account's sign-in at another host.
            account("gitlab:git.example.com:carol", "https://evil.example.com"),
            account("gitlab.com", "https://evil.example.com"),
            Value::String("not json".into()),
        ]);
        settings.set("accounts", list).unwrap();
        assert_eq!(settings.accounts().len(), 1);
        assert!(settings.knows_instance("https://git.example.com"));
        assert!(!settings.knows_instance("https://evil.example.com"));
    }

    #[test]
    fn account_ids_name_their_instance() {
        assert_eq!(
            base_from_id("github:github.com:alice").as_deref(),
            Some("https://github.com")
        );
        assert_eq!(
            base_from_id("gitlab:git.example.com/gitlab:bob").as_deref(),
            Some("https://git.example.com/gitlab")
        );
        assert_eq!(
            base_from_id("gitlab:http://192.168.1.5:8080:bob").as_deref(),
            Some("http://192.168.1.5:8080")
        );
        assert_eq!(
            base_from_id("gitlab:http://[fd00::1]:8080:bob").as_deref(),
            Some("http://[fd00::1]:8080")
        );
        assert_eq!(base_from_id("github.com").as_deref(), Some(GITHUB_COM));
        assert_eq!(base_from_id("nonsense"), None);
    }
}
