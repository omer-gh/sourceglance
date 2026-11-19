//! macOS-only code: the Dock icon and the login item.

use objc2_service_management::{SMAppService, SMAppServiceStatus};
use tauri::{ActivationPolicy, AppHandle};

/// No Dock icon unless the user asks for one (Source Glance lives in the menu bar).
pub fn set_dock_icon(app: &AppHandle, show: bool) {
    let policy = if show {
        ActivationPolicy::Regular
    } else {
        ActivationPolicy::Accessory
    };
    let _ = app.set_activation_policy(policy);
}

/// Whether Source Glance opens at login. Uses SMAppService, so it shows up in System Settings →
/// General → Login Items (macOS 13 and later).
pub fn start_at_login() -> bool {
    let service = unsafe { SMAppService::mainAppService() };
    let status = unsafe { service.status() };
    status == SMAppServiceStatus::Enabled
}

pub fn set_start_at_login(enabled: bool) -> Result<(), String> {
    let service = unsafe { SMAppService::mainAppService() };
    let result = if enabled {
        unsafe { service.registerAndReturnError() }
    } else {
        unsafe { service.unregisterAndReturnError() }
    };
    result.map_err(|e| e.localizedDescription().to_string())
}
