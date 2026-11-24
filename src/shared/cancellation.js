// Whether an error means the request was cancelled. That's a Gio CANCELLED error on GNOME
// (github.js sets the check) and an AbortError in the desktop app. Kept out of github.js so
// the loaders don't import GLib.

let check = error => error?.name === 'AbortError';

/** Sets the check; github.js calls this on GNOME. */
export function setCancelledCheck(fn) {
    check = fn;
}

export function isCancelled(error) {
    return Boolean(error) && check(error);
}
