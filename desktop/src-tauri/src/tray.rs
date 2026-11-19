//! Menu-bar items, like the Ubuntu top bar. `layout` is the GNOME setting's: "separate" (one
//! item per list, plus the Source Glance item) or "tabs" (one item whose popover has a tab
//! per list). Clicking an item opens the popover window under it; right-clicking shows a
//! small menu with Open, Refresh and Quit.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Rect, Runtime};

pub const LISTS: [&str; 3] = ["issues", "prs", "projects"];
const APP: &str = "app";

fn icon(id: &str) -> Image<'static> {
    let bytes: &'static [u8] = match id {
        "issues" => include_bytes!("../icons/tray/issues.png"),
        "prs" => include_bytes!("../icons/tray/prs.png"),
        "projects" => include_bytes!("../icons/tray/projects.png"),
        _ => include_bytes!("../icons/tray/app.png"),
    };
    Image::from_bytes(bytes).expect("bundled tray icon")
}

fn tooltip(id: &str) -> &'static str {
    match id {
        "issues" => "Issues",
        "prs" => "Pull requests",
        "projects" => "Projects",
        _ => "Source Glance",
    }
}

/// What JavaScript sends after each refresh.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct TrayState {
    pub layout: String,
    pub buttons: Vec<String>,
    /// Badge text per list, from `listBadge()`: "", "7" or "25+".
    pub issues: String,
    pub prs: String,
    pub projects: String,
    /// Shown on the Source Glance item when a list didn't load (the red "!" on Ubuntu).
    pub problem: bool,
}

impl TrayState {
    fn count(&self, id: &str) -> &str {
        match id {
            "issues" => &self.issues,
            "prs" => &self.prs,
            "projects" => &self.projects,
            _ => "",
        }
    }

    /// The items to show, in order.
    fn items(&self) -> Vec<String> {
        let mut items = vec![APP.to_string()];
        if self.layout != "tabs" {
            items.extend(
                LISTS
                    .iter()
                    .filter(|id| self.buttons.iter().any(|b| b == *id))
                    .map(|id| id.to_string()),
            );
        }
        items
    }

    /// The title next to an item's icon. In "tabs" layout the one item shows every count.
    fn title(&self, id: &str) -> String {
        if id == APP {
            let alert = if self.problem { "!" } else { "" };
            if self.layout == "tabs" {
                let counts: Vec<&str> = LISTS
                    .iter()
                    .filter(|l| self.buttons.iter().any(|b| b == *l))
                    .map(|l| {
                        if self.count(l).is_empty() {
                            "0"
                        } else {
                            self.count(l)
                        }
                    })
                    .collect();
                return format!("{alert}{}", counts.join(" · "));
            }
            return alert.to_string();
        }
        let count = self.count(id);
        if count.is_empty() {
            "0".into()
        } else {
            count.into()
        }
    }
}

#[derive(Default)]
pub struct Tray {
    state: Mutex<TrayState>,
    shown: Mutex<Vec<String>>,
}

impl Tray {
    /// Brings the menu bar in line with `next`: adds and removes items, and sets titles.
    pub fn update<R: Runtime>(&self, app: &AppHandle<R>, next: TrayState) -> tauri::Result<()> {
        let wanted = next.items();
        let mut shown = self.shown.lock().unwrap();
        if *shown != wanted {
            for id in shown.iter() {
                app.remove_tray_by_id(id.as_str());
            }
            // macOS puts the newest item on the left, so add them right to left.
            for id in wanted.iter().rev() {
                build(app, id)?;
            }
            *shown = wanted.clone();
        }
        for id in &wanted {
            if let Some(tray) = app.tray_by_id(id.as_str()) {
                tray.set_title(Some(next.title(id)))?;
            }
        }
        *self.state.lock().unwrap() = next;
        Ok(())
    }

    pub fn layout(&self) -> String {
        self.state.lock().unwrap().layout.clone()
    }
}

fn build<R: Runtime>(app: &AppHandle<R>, id: &str) -> tauri::Result<TrayIcon<R>> {
    let open = MenuItem::with_id(app, "open", "Open Source Glance", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Source Glance", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &refresh, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    TrayIconBuilder::with_id(id)
        .icon(icon(id))
        .icon_as_template(true)
        .tooltip(tooltip(id))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::show_main(app, None),
            "refresh" => {
                let _ = app.emit("refresh", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                id,
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), id.as_ref(), rect);
            }
        })
        .build(app)
}

/// Which page the popover shows for an item: a list, or for the Source Glance item either the
/// app menu ("separate") or the tabs ("tabs").
fn page_for<R: Runtime>(app: &AppHandle<R>, id: &str) -> String {
    if id != APP {
        return id.to_string();
    }
    let layout = app.state::<Tray>().layout();
    if layout == "tabs" {
        "tabs".into()
    } else {
        APP.into()
    }
}

/// Opens the popover under the clicked item, or closes it if it's already open there.
fn toggle_popover<R: Runtime>(app: &AppHandle<R>, id: &str, rect: Rect) {
    let Some(popover) = app.get_webview_window("popover") else {
        return;
    };
    let page = page_for(app, id);
    let anchor = app.state::<Anchor>();
    if anchor.get() == page {
        if popover.is_visible().unwrap_or(false) {
            let _ = popover.hide();
            return;
        }
        // Clicking the item takes the focus first, which already hid the popover: this
        // click was meant to close it.
        if anchor.just_hidden() {
            return;
        }
    }
    anchor.set(&page);
    let scale = popover.scale_factor().unwrap_or(1.0);
    let position = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let width = popover
        .outer_size()
        .map(|s| s.width as f64)
        .unwrap_or(420.0);
    // Centered under the item, kept on its display.
    let mut x = position.x + size.width / 2.0 - width / 2.0;
    if let Ok(Some(monitor)) = popover.monitor_from_point(position.x, position.y) {
        let left = monitor.position().x as f64;
        let right = left + monitor.size().width as f64;
        x = x.clamp(left + 8.0, (right - width - 8.0).max(left + 8.0));
    }
    let _ = popover.set_position(PhysicalPosition::new(x, position.y + size.height + 4.0));
    let _ = popover.emit("popover:show", &page);
    let _ = popover.show();
    let _ = popover.set_focus();
}

/// The page the popover was last opened for, and when it last closed because the focus
/// moved, to toggle it closed on a second click.
#[derive(Default)]
pub struct Anchor {
    page: Mutex<String>,
    hidden: Mutex<Option<Instant>>,
}

/// A click this soon after the popover lost the focus is the click that took it.
const CLICK_AFTER_HIDE: Duration = Duration::from_millis(300);

impl Anchor {
    fn get(&self) -> String {
        self.page.lock().unwrap().clone()
    }

    fn set(&self, page: &str) {
        *self.page.lock().unwrap() = page.to_string();
    }

    /// The popover closed because something else took the focus.
    pub fn hidden_now(&self) {
        *self.hidden.lock().unwrap() = Some(Instant::now());
    }

    fn just_hidden(&self) -> bool {
        self.hidden
            .lock()
            .unwrap()
            .take()
            .is_some_and(|at| at.elapsed() < CLICK_AFTER_HIDE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(layout: &str) -> TrayState {
        TrayState {
            layout: layout.into(),
            buttons: vec!["issues".into(), "prs".into(), "projects".into()],
            issues: "12".into(),
            prs: "".into(),
            projects: "25+".into(),
            problem: false,
        }
    }

    #[test]
    fn separate_layout_has_one_item_per_list() {
        let s = state("separate");
        assert_eq!(s.items(), vec!["app", "issues", "prs", "projects"]);
        assert_eq!(s.title("issues"), "12");
        assert_eq!(s.title("prs"), "0");
        assert_eq!(s.title("app"), "");
    }

    #[test]
    fn tabs_layout_has_one_item_with_every_count() {
        let mut s = state("tabs");
        assert_eq!(s.items(), vec!["app"]);
        assert_eq!(s.title("app"), "12 · 0 · 25+");
        s.problem = true;
        s.buttons = vec!["issues".into()];
        assert_eq!(s.title("app"), "!12");
    }
}
