// What the window's right-hand panels (the task detail and About) share: how wide they open
// and how long they take to slide in and out. The task detail panel is docked beside the list;
// About covers the settings page.
export const PANEL_MIN_WIDTH = 380;
export const PANEL_SLIDE_MS = 250;

/** The width a panel opens at: half the window, never under the minimum. */
export function defaultPanelWidth(windowWidth) {
    return Math.max(PANEL_MIN_WIDTH, Math.round(windowWidth * 0.5));
}
