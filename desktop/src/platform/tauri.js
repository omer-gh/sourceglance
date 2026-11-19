// Adapters between the shared code in src/lib and the Rust commands (ADR 0006).
//
// Settings live in a JSON file instead of GSettings. Sign-ins live in the Keychain, and
// JavaScript only gets a reference like `account:<id>`, which it passes around where GNOME
// passes the token. Rust adds the real Authorization header. An AbortSignal is used where
// GNOME uses a Gio.Cancellable.
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

/** The settings file, cached so reads are synchronous like GSettings. */
export class Settings {
    constructor() {
        this._values = {};
        this._listeners = new Set();
        this._id = Math.random().toString(36).slice(2);
    }

    /** Reads the file, then follows changes made in any window. */
    async load() {
        this._values = await invoke('settings_get');
        await listen('settings-changed', ({payload: {key, value, origin}}) => {
            const same = JSON.stringify(this._values[key]) === JSON.stringify(value);
            this._values[key] = value;
            // A change from another window is always passed on, even when it matches what
            // this window last set: both may have set the same value for different reasons.
            if (origin !== this._id || !same)
                this._notify(key, value);
        });
        return this;
    }

    get(key, fallback = null) {
        return key in this._values ? this._values[key] : fallback;
    }

    async set(key, value) {
        this._values[key] = value;
        this._notify(key, value);
        try {
            await invoke('settings_set', {key, value, origin: this._id});
        } catch (e) {
            // Not saved: go back to what the file has.
            const saved = await invoke('settings_get');
            for (const changed of new Set([...Object.keys(saved), ...Object.keys(this._values)])) {
                if (JSON.stringify(saved[changed]) !== JSON.stringify(this._values[changed])) {
                    if (changed in saved)
                        this._values[changed] = saved[changed];
                    else
                        delete this._values[changed];
                    this._notify(changed, saved[changed]);
                }
            }
            throw e;
        }
    }

    _notify(key, value) {
        for (const listener of this._listeners)
            listener(key, value);
    }

    /** Runs `listener(key, value)` after every change; returns a function that stops it. */
    connect(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
}

/** Account list for accountRegistry.js. */
export function accountList(settings) {
    return {
        read: () => settings.get('accounts', []),
        write: strv => {
            settings.set('accounts', strv).catch(e => console.error('sourceglance: saving accounts failed', e));
        },
        notify: () => {
            settings.set('token-changed', settings.get('token-changed', 0) + 1)
                .catch(e => console.error('sourceglance: saving settings failed', e));
        },
    };
}

/** Secret store for accountRegistry.js. */
export const secrets = {
    lookup: id => invoke('secret_lookup', {id}),
    store: (id, reference) => invoke('secret_store', {id, reference}),
    clear: id => invoke('secret_clear', {id}),
};

/** Hands a typed token to Rust; resolves to its reference. */
export function holdToken(base, platform, token) {
    return invoke('secret_hold', {base, platform, token});
}

/** Lets the self-hosted wizard reach the instance being checked. */
export function allowInstance(base) {
    return invoke('instance_allow', {base});
}

/** Opens a link in the browser (Rust checks the host). */
export function openLink(url) {
    return invoke('open_link', {url});
}

/** Copies a device sign-in code to the clipboard (from Rust, which works after a network wait). */
export function copyDeviceCode(code) {
    return invoke('copy_device_code', {code});
}

/** The menu-bar items and their counts. */
export function updateTray(state) {
    return invoke('tray_update', {state});
}

/** Shows the main window, optionally on a page. */
export function openMain(page = null) {
    return invoke('open_main', {page});
}

export function hidePopover() {
    return invoke('hide_popover');
}

export function sizePopover(width, height) {
    return invoke('size_popover', {width, height});
}

export function quitApp() {
    return invoke('quit_app');
}

export function setDockIcon(show) {
    return invoke('set_dock_icon', {show});
}

export function startAtLogin() {
    return invoke('start_at_login');
}

export function setStartAtLogin(enabled) {
    return invoke('set_start_at_login', {enabled});
}

export function abortError() {
    return Object.assign(new Error('Operation was cancelled'), {name: 'AbortError'});
}

export function throwIfAborted(signal) {
    if (signal?.aborted)
        throw abortError();
}

/** Resolves after `seconds`, or rejects as cancelled when `signal` aborts. */
export function sleep(seconds, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        const id = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, seconds * 1000);
        const onAbort = () => {
            clearTimeout(id);
            reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, {once: true});
    });
}
