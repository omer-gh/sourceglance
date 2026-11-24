//! macOS-only code: the Dock icon, the login item, and moving the app to the Trash when it's
//! uninstalled.

use std::path::{Path, PathBuf};

use objc2_foundation::{NSFileManager, NSString, NSURL};
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

/// The running app bundle, if Source Glance runs from one.
pub fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // .../Source Glance.app/Contents/MacOS/sourceglance
    let bundle = exe.parent()?.parent()?.parent()?.to_path_buf();
    (bundle.extension()? == "app").then_some(bundle)
}

/// Moves a file or folder to the user's Trash, where it can still be put back.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    let text = path.to_str().ok_or("not a valid path")?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(text));
    let manager = NSFileManager::defaultManager();
    manager
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

/// Forgets the installer's receipt for the app (a per-user install keeps it in
/// ~/Library/Receipts), so macOS doesn't think it's still installed.
pub fn forget_receipt(home: &Path) {
    let _ = std::process::Command::new("/usr/sbin/pkgutil")
        .arg("--volume")
        .arg(home)
        .args(["--forget", "io.github.omer-gh.sourceglance.app"])
        .output();
}
