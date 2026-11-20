//! Source Glance for macOS (ADR 0006). The commands JavaScript can call. Requests are in
//! net.rs, sign-ins in secrets.rs, settings in settings.rs and the menu bar in tray.rs.

#[cfg(target_os = "macos")]
mod macos;
mod net;
mod secrets;
mod settings;
mod tray;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use net::{ApiRequest, ApiResponse, Instance, NetError};
use secrets::{Secrets, ACCOUNT_PREFIX};
use settings::{base_from_id, Settings};
use tray::{Anchor, Tray, TrayState};

/// How long an instance typed into the sign-in form stays reachable before an account is
/// added there, and how many can be at once.
const PROBE_TIME: Duration = Duration::from_secs(10 * 60);
const MAX_PROBING: usize = 4;

/// OAuth endpoints a sign-in on a new instance may post to.
const SIGN_IN_PATHS: &[&str] = &[
    "/login/device/code",
    "/login/oauth/access_token",
    "/oauth/authorize_device",
    "/oauth/token",
];

struct AppState {
    settings: Settings,
    secrets: Secrets,
    /// Instances being checked while adding a self-hosted account, and when they were added.
    probing: Mutex<Vec<(String, Instant)>>,
    user_agent: String,
}

/// Whether a request may go to an instance: an account's (anything), or one being checked
/// in the sign-in form (reading only).
#[derive(Debug, PartialEq, Eq)]
enum Access {
    Account,
    Probing,
}

impl AppState {
    fn instance(&self, base: &str) -> Result<(Instance, Access), NetError> {
        let instance = Instance::parse(base).ok_or(NetError::Invalid)?;
        if self.settings.knows_instance(&instance.base) {
            return Ok((instance, Access::Account));
        }
        let mut probing = self.probing.lock().unwrap();
        probing.retain(|(_, added)| added.elapsed() < PROBE_TIME);
        if probing.iter().any(|(b, _)| *b == instance.base) {
            Ok((instance, Access::Probing))
        } else {
            Err(NetError::NotAllowed)
        }
    }

    fn allow_probe(&self, base: String) {
        let mut probing = self.probing.lock().unwrap();
        probing.retain(|(b, added)| *b != base && added.elapsed() < PROBE_TIME);
        probing.push((base, Instant::now()));
        while probing.len() > MAX_PROBING {
            probing.remove(0);
        }
    }

    /// The Authorization header for a sign-in reference, if it belongs to `base`.
    fn authorization(&self, reference: &str, base: &str) -> Result<Option<String>, String> {
        // The account id names its instance; the editable account list doesn't decide.
        let account_base = reference
            .strip_prefix(ACCOUNT_PREFIX)
            .and_then(base_from_id);
        let secret = self
            .secrets
            .resolve(reference, base, account_base.as_deref())?;
        Ok(secret.map(|s| format!("Bearer {}", secrets::access_token(&s))))
    }
}

#[tauri::command]
async fn api_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: ApiRequest,
) -> Result<ApiResponse, NetError> {
    let (instance, access) = state.instance(&request.base)?;
    if access == Access::Probing && request.method != "GET" {
        return Err(NetError::NotAllowed);
    }
    let authorization = match request.auth.clone() {
        Some(reference) => {
            let base = instance.base.clone();
            keychain(app, move |state| state.authorization(&reference, &base))
                .await
                .map_err(|_| NetError::NotAllowed)?
        }
        None => None,
    };
    net::send(&instance, &request, authorization, &state.user_agent).await
}

/// Posts an OAuth form and keeps any token in the response. `json` is null when the body
/// isn't JSON.
#[tauri::command]
async fn oauth_request(
    state: State<'_, AppState>,
    base: String,
    platform: String,
    url: String,
    form: HashMap<String, String>,
) -> Result<Value, NetError> {
    let (instance, access) = state.instance(&base)?;
    if form.keys().any(|k| k == "refresh_token") {
        // Renewing is done by gitlab_access.
        return Err(NetError::Invalid);
    }
    if access == Access::Probing {
        let target = url::Url::parse(&url).map_err(|_| NetError::Invalid)?;
        if !SIGN_IN_PATHS.iter().any(|p| target.path().ends_with(p)) {
            return Err(NetError::NotAllowed);
        }
    }
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter())
        .finish();
    let request = ApiRequest {
        base: base.clone(),
        method: "POST".into(),
        url,
        headers: HashMap::from([
            ("Accept".into(), "application/json".into()),
            (
                "Content-Type".into(),
                "application/x-www-form-urlencoded".into(),
            ),
        ]),
        body: Some(body),
        auth: None,
    };
    let response = net::send(&instance, &request, None, &state.user_agent).await?;
    let json: Value = serde_json::from_str(&response.body).unwrap_or(Value::Null);
    let json =
        secrets::hold_token_response(&state.secrets, &instance.base, platform == "gitlab", json);
    Ok(serde_json::json!({
        "status": response.status,
        "headers": response.headers,
        "json": json,
    }))
}

/// A reference to the account's sign-in, if it has one.
#[tauri::command]
async fn secret_lookup(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let found = keychain(app, {
        let id = id.clone();
        move |state| state.secrets.lookup(&id)
    })
    .await?;
    Ok(found.map(|_| format!("{ACCOUNT_PREFIX}{id}")))
}

/// Keeps a personal access token the user typed and returns a reference.
#[tauri::command]
fn secret_hold(
    state: State<'_, AppState>,
    base: String,
    platform: String,
    token: String,
) -> Result<String, String> {
    let instance = Instance::parse(&base).ok_or("not an instance")?;
    let token = token.trim();
    if token.is_empty() || token.len() > 1024 || token.chars().any(char::is_whitespace) {
        return Err("not a token".into());
    }
    Ok(state.secrets.hold(
        &instance.base,
        secrets::token_secret(platform == "gitlab", token),
    ))
}

/// Saves a pending sign-in under an account id from the same instance.
#[tauri::command]
async fn secret_store(app: tauri::AppHandle, id: String, reference: String) -> Result<(), String> {
    let base = base_from_id(&id).ok_or("not an account id")?;
    if let Some(existing) = reference.strip_prefix(ACCOUNT_PREFIX) {
        // Signing in again as the same account keeps the saved sign-in.
        return if existing == id {
            Ok(())
        } else {
            Err("not this account's sign-in".into())
        };
    }
    keychain(app, move |state| {
        state.secrets.adopt(&reference, &id, &base)
    })
    .await
}

#[tauri::command]
async fn secret_clear(app: tauri::AppHandle, id: String) -> Result<(), String> {
    keychain(app, move |state| state.secrets.clear(&id)).await
}

/// Runs a Keychain call on a background thread. It can wait on a macOS permission prompt,
/// which must not hold up the app's main thread.
async fn keychain<T: Send + 'static>(
    app: tauri::AppHandle,
    call: impl FnOnce(&AppState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || call(&app.state::<AppState>()))
        .await
        .map_err(|e| e.to_string())?
}

/// A GitLab account's sign-in reference, renewing the token first if it's about to expire
/// (like `accessToken()` in gitlab.js).
#[tauri::command]
async fn gitlab_access(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    client_id: String,
) -> Result<Option<String>, NetError> {
    let base = base_from_id(&id).ok_or(NetError::NotAllowed)?;
    let found = keychain(app.clone(), {
        let id = id.clone();
        move |state| state.secrets.lookup(&id)
    })
    .await
    .map_err(|_| NetError::Network)?;
    let Some(secret) = found else {
        return Ok(None);
    };
    if let Some(refresh) = secrets::refresh_due(&secret) {
        let (instance, access) = state.instance(&base)?;
        if access != Access::Account {
            return Err(NetError::NotAllowed);
        }
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &client_id)
            .append_pair("refresh_token", &refresh)
            .append_pair("grant_type", "refresh_token")
            .finish();
        let request = ApiRequest {
            base: base.clone(),
            method: "POST".into(),
            url: format!("{base}/oauth/token"),
            headers: HashMap::from([
                ("Accept".into(), "application/json".into()),
                (
                    "Content-Type".into(),
                    "application/x-www-form-urlencoded".into(),
                ),
            ]),
            body: Some(body),
            auth: None,
        };
        // If renewing fails, keep using the stored token, as on GNOME.
        if let Ok(response) = net::send(&instance, &request, None, &state.user_agent).await {
            let json: Value = serde_json::from_str(&response.body).unwrap_or(Value::Null);
            if let Some(access) = json.get("access_token").and_then(Value::as_str) {
                let expires_in = json
                    .get("expires_in")
                    .and_then(Value::as_i64)
                    .filter(|n| *n > 0)
                    .unwrap_or(7200);
                let fresh = serde_json::json!({
                    "access": access,
                    "refresh": json.get("refresh_token").and_then(Value::as_str),
                    "expiresAt": secrets::now_ms() + expires_in * 1000,
                });
                let id = id.clone();
                let _ = keychain(app, move |state| {
                    state.secrets.store(&id, &fresh.to_string())
                })
                .await;
            }
        }
    }
    Ok(Some(format!("{ACCOUNT_PREFIX}{id}")))
}

/// Allows reading from an instance the user typed in, before an account exists there. It
/// lasts ten minutes, for a few instances at most.
#[tauri::command]
fn instance_allow(state: State<'_, AppState>, base: String) -> Result<(), NetError> {
    let instance = Instance::parse(&base).ok_or(NetError::Invalid)?;
    state.allow_probe(instance.base);
    Ok(())
}

#[tauri::command]
fn settings_get(state: State<'_, AppState>) -> Value {
    state.settings.all()
}

/// Saves a setting and tells every window, so the popover and the main window stay in step.
/// `origin` names the window that made the change.
#[tauri::command]
fn settings_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: Value,
    origin: Option<String>,
) -> Result<(), String> {
    let value = state.settings.set(&key, value)?;
    let _ = app.emit(
        "settings-changed",
        serde_json::json!({"key": key, "value": value, "origin": origin}),
    );
    Ok(())
}

/// Opens a link in the browser, only on github.com, gitlab.com or an account's instance
/// (threat model T7).
#[tauri::command]
fn open_link(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), NetError> {
    let target = url::Url::parse(&url).map_err(|_| NetError::Invalid)?;
    let allowed = [net::GITHUB_COM.to_string(), net::GITLAB_COM.to_string()]
        .into_iter()
        .chain(state.settings.accounts().into_iter().map(|a| a.base))
        .filter_map(|base| Instance::parse(&base))
        .any(|instance| instance.contains(&target));
    if !allowed {
        return Err(NetError::NotAllowed);
    }
    app.opener()
        .open_url(target.as_str(), None::<&str>)
        .map_err(|_| NetError::Invalid)
}

/// Copies a device sign-in code to the clipboard. Only text shaped like a code is accepted.
#[tauri::command]
fn copy_device_code(app: tauri::AppHandle, code: String) -> Result<(), String> {
    if !is_device_code(&code) {
        return Err("not a sign-in code".into());
    }
    app.clipboard().write_text(code).map_err(|e| e.to_string())
}

/// Same shape the JavaScript checks: 4 to 16 letters, digits or dashes.
fn is_device_code(code: &str) -> bool {
    (4..=16).contains(&code.len()) && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Shows the main window, optionally on a page ("tasks", "accounts", "settings").
pub fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>, page: Option<&str>) {
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        if let Some(page) = page {
            let _ = main.emit("open-page", page);
        }
    }
}

/// The menu-bar items and their counts, after each refresh.
#[tauri::command]
fn tray_update(
    app: tauri::AppHandle,
    tray: State<'_, Tray>,
    state: TrayState,
) -> Result<(), String> {
    tray.update(&app, state).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_main(app: tauri::AppHandle, page: Option<String>) {
    show_main(&app, page.as_deref());
}

#[tauri::command]
fn hide_popover(app: tauri::AppHandle) {
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.hide();
    }
}

/// Resizes the popover to fit its content, within the width the menus use on Ubuntu.
#[tauri::command]
fn size_popover(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.set_size(tauri::LogicalSize::new(
            width.clamp(240.0, 800.0),
            height.clamp(80.0, 2000.0),
        ));
    }
}

/// Quits everything: menu-bar items, popover and window.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_dock_icon(app: tauri::AppHandle, show: bool) {
    #[cfg(target_os = "macos")]
    macos::set_dock_icon(&app, show);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, show);
}

#[tauri::command]
fn start_at_login() -> bool {
    #[cfg(target_os = "macos")]
    return macos::start_at_login();
    #[cfg(not(target_os = "macos"))]
    false
}

#[tauri::command]
fn set_start_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::set_start_at_login(enabled);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("not supported".into())
    }
}

/// Whether an app bundle sits in an Applications folder (/Applications or ~/Applications),
/// where the installer puts it. A copy anywhere else, such as a build folder, isn't removed.
fn installed_bundle(bundle: &std::path::Path) -> bool {
    bundle.extension().is_some_and(|e| e == "app")
        && bundle
            .parent()
            .and_then(|dir| dir.file_name())
            .is_some_and(|name| name == "Applications")
}

/// The app's own folders: settings, caches and the web page's storage. Only folders named
/// after the app's identifier, so nothing else can be deleted by mistake.
fn data_dirs(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let identifier = app.config().identifier.clone();
    let path = app.path();
    let mut dirs: Vec<std::path::PathBuf> = [
        path.app_config_dir(),
        path.app_data_dir(),
        path.app_local_data_dir(),
        path.app_cache_dir(),
    ]
    .into_iter()
    .filter_map(Result::ok)
    .collect();
    if let Ok(home) = path.home_dir() {
        dirs.push(home.join("Library/WebKit").join(&identifier));
        dirs.push(home.join("Library/HTTPStorages").join(&identifier));
    }
    dirs.sort();
    dirs.dedup();
    dirs.retain(|dir| {
        dir.file_name()
            .is_some_and(|name| name == identifier.as_str())
    });
    dirs
}

/// Uninstalls Source Glance: turns off the login item, optionally removes the sign-ins from
/// the Keychain and the app's settings and caches, moves the app to the Trash, and quits.
#[tauri::command]
async fn uninstall(app: tauri::AppHandle, remove_data: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let bundle = macos::app_bundle().ok_or("Source Glance isn't running from an app")?;
    #[cfg(not(target_os = "macos"))]
    let bundle = std::path::PathBuf::new();
    if !installed_bundle(&bundle) {
        return Err(format!(
            "Source Glance isn't in an Applications folder ({}). Quit it and delete it yourself.",
            bundle.display()
        ));
    }
    if remove_data {
        let ids: Vec<String> = app
            .state::<AppState>()
            .settings
            .accounts()
            .into_iter()
            .map(|a| a.id)
            .chain(["github.com".to_string(), "gitlab.com".to_string()])
            .collect();
        keychain(app.clone(), move |state| {
            ids.iter().try_for_each(|id| state.secrets.clear(id))
        })
        .await?;
    }
    #[cfg(target_os = "macos")]
    {
        if macos::start_at_login() {
            let _ = macos::set_start_at_login(false);
        }
        macos::move_to_trash(&bundle)?;
        if let Ok(home) = app.path().home_dir() {
            macos::forget_receipt(&home);
        }
    }
    if remove_data {
        for dir in data_dirs(&app) {
            if dir.exists() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
    }
    // Answer JavaScript first, then quit.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.exit(0);
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join("settings.json"));
            let version = app.package_info().version.to_string();
            app.manage(AppState {
                settings: Settings::load(path),
                secrets: Secrets::default(),
                probing: Mutex::new(Vec::new()),
                user_agent: format!("sourceglance/{version}"),
            });
            app.manage(Tray::default());
            app.manage(Anchor::default());
            #[cfg(target_os = "macos")]
            {
                let show = app
                    .state::<AppState>()
                    .settings
                    .all()
                    .get("show-dock-icon")
                    .and_then(Value::as_bool);
                macos::set_dock_icon(app.handle(), show.unwrap_or(false));
            }
            // macOS doesn't load a window's page until it has been on screen once. Show the
            // popover off-screen for a moment, so its first refresh fills in the counts now.
            if let Some(popover) = app.get_webview_window("popover") {
                let _ = popover.set_position(tauri::PhysicalPosition::new(-30000, -30000));
                let _ = popover.show();
                let handle = popover.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let _ = handle.hide();
                });
            }
            // The menu bar shows up right away, before the first refresh fills in the counts.
            app.state::<Tray>().update(
                app.handle(),
                TrayState {
                    layout: "tabs".into(),
                    buttons: tray::LISTS.map(String::from).to_vec(),
                    ..Default::default()
                },
            )?;
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the window keeps Source Glance running in the menu bar, as on Ubuntu.
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The popover closes when you click elsewhere.
            ("popover", WindowEvent::Focused(false)) => {
                if window.is_visible().unwrap_or(false) {
                    window.app_handle().state::<Anchor>().hidden_now();
                }
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            api_request,
            oauth_request,
            secret_lookup,
            secret_hold,
            secret_store,
            secret_clear,
            gitlab_access,
            instance_allow,
            settings_get,
            settings_set,
            open_link,
            copy_device_code,
            tray_update,
            open_main,
            hide_popover,
            size_popover,
            quit_app,
            set_dock_icon,
            start_at_login,
            set_start_at_login,
            uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Source Glance");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AppState {
        AppState {
            settings: Settings::load(None),
            secrets: Secrets::default(),
            probing: Mutex::new(Vec::new()),
            user_agent: "test".into(),
        }
    }

    #[test]
    fn a_forged_account_entry_cannot_send_a_sign_in_elsewhere() {
        let state = state();
        let forged = serde_json::json!({
            "id": "github:github.com:alice",
            "platform": "github",
            "base": "https://evil.example.com",
        })
        .to_string();
        state
            .settings
            .set("accounts", serde_json::json!([forged]))
            .unwrap();
        assert!(state.settings.accounts().is_empty());
        assert_eq!(
            state.instance("https://evil.example.com").unwrap_err(),
            NetError::NotAllowed
        );
        // Checked before the Keychain is read.
        assert!(state
            .authorization(
                "account:github:github.com:alice",
                "https://evil.example.com"
            )
            .is_err());
    }

    #[test]
    fn instances_being_checked_are_read_only_and_limited() {
        let state = state();
        for n in 0..=MAX_PROBING {
            state.allow_probe(format!("https://git{n}.example.com"));
        }
        assert_eq!(
            state.instance("https://git0.example.com").unwrap_err(),
            NetError::NotAllowed
        );
        let (_, access) = state.instance("https://git1.example.com").unwrap();
        assert_eq!(access, Access::Probing);
        let (_, access) = state.instance(net::GITHUB_COM).unwrap();
        assert_eq!(access, Access::Account);
    }

    #[test]
    fn only_an_installed_app_is_removed() {
        use std::path::Path;
        assert!(installed_bundle(Path::new(
            "/Users/me/Applications/Source Glance.app"
        )));
        assert!(installed_bundle(Path::new(
            "/Applications/Source Glance.app"
        )));
        assert!(!installed_bundle(Path::new(
            "/Users/me/src/desktop/src-tauri/target/debug/bundle/macos/Source Glance.app"
        )));
        assert!(!installed_bundle(Path::new("/Applications")));
    }

    #[test]
    fn only_device_codes_are_copied() {
        assert!(is_device_code("ABCD-1234"));
        assert!(!is_device_code("abc"));
        assert!(!is_device_code("ghp_secret token"));
        assert!(!is_device_code("ABCD-1234-ABCD-1234"));
    }
}
