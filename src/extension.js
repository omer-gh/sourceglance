import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AccountClients, loadAccount, loadAccounts, rememberLogin} from './lib/accountStore.js';
import {aggregateStatus, firstError, latestUpdate, sourceFrom} from './lib/accounts.js';
import {ActionController} from './lib/actions.js';
import {installLauncher, removeLauncher} from './lib/appLauncher.js';
import {GitHubClient, GitHubError, isCancelled} from './lib/github.js';
import {ToolbarButton} from './lib/indicator.js';
import {migrateBoardsRename} from './lib/migrations.js';
import {boardKey, normalizeRepoMap} from './lib/projects.js';
import {allowLinkBases} from './lib/requests.js';
import {UpdateNotice} from './lib/updateNotice.js';
import {backgroundSettings, forgetStaleSavedWallpaper} from './lib/wallpaper.js';
import {DesktopWidgets} from './lib/widgets.js';
import {WIDGET_ICONS, itemKey, nextRefreshDelaySeconds, normalizeButtons, normalizeGroupBy, normalizeWidgets, parseCustomWidgets} from './lib/model.js';

// Settings that change which top-bar buttons exist.
const TOOLBAR_KEYS = ['layout', 'toolbar-buttons'];
// Settings that don't need a refresh when they change.
const UI_ONLY_KEYS = ['start-automatically', 'start-request', 'bar-enabled', 'group-by', 'project-repos', 'organization-names', 'quit-request', 'app-launcher', 'widget-positions', 'widget-opacity',
    'widget-opacities', 'widget-size', 'widget-sizes', 'widgets-off-desktop', 'widget-layout', 'widget-backdrop', 'widget-arrangement',
    'collapsed-sections', 'collapsed-groups', 'open-page', 'install-update', 'saved-wallpaper', 'tasks-expanded'];

// Whether sourceglance runs in this session: null until the first enable() after login.
// Kept at module level because GNOME disables and re-enables extensions around the lock
// screen, and Quit should survive that.
let sessionRunning = null;

// How many items closed from the menu stay under "Recently closed" for a quick reopen.
const MAX_RECENTLY_CLOSED = 5;
// Search can list a just-closed item as open for a while; after this, believe the search.
const REOPENED_ELSEWHERE_MS = 2 * 60 * 1000;

// `sources` has one entry per account, in the order of Settings → Accounts (see sourceFrom()
// in lib/accounts.js): its lists grouped by repository, counts, closed counts and, for GitHub,
// project boards. `status`, `updatedAt` and `error` sum them up.
const INITIAL_STATE = {
    status: 'loading',
    sources: [],
    recentlyClosed: [],
    busy: [],
    updatedAt: null,
    error: null,
    refreshing: false,
    intervalMinutes: 10,
};

export default class SourceglanceExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        migrateBoardsRename(this._settings);
        // For the update notice: sourceglance's releases are on github.com, signed in or not.
        this._client = new GitHubClient(this.metadata['version-name'] ?? 'dev');
        this._clients = new AccountClients(this.metadata['version-name'] ?? 'dev');
        this._state = {...INITIAL_STATE};
        this._accounts = [];
        this._cancellable = null;
        this._timeoutId = 0;
        // Each account's last load, by account id: {account, status, updatedAt, error, issues, …}.
        this._results = new Map();
        this._closed = new Map();
        this._busy = new Set();

        this._actions = new ActionController({
            clients: this._clients,
            getAccount: id => this._accounts.find(account => account.id === id) ?? null,
            getLogin: id => this._state?.sources.find(source => source.account.id === id)?.login ?? null,
            setBusy: (item, busy) => this._setBusy(item, busy),
            onChanged: (item, change) => this._onItemChanged(item, change),
        });

        const icon = name => Gio.FileIcon.new(this.dir.get_child('icons').get_child(`${name}-symbolic.svg`));
        this._icons = {
            issues: Gio.ThemedIcon.new('checkbox-checked-symbolic'),
            boards: icon('checklist'),
            prs: icon('git-pull-request'),
            app: icon('sourceglance'),
            // Used inside the menus.
            issue: icon('issue'),
            issueClosed: icon('issue-closed'),
            prMerged: icon('git-merge'),
            prClosed: icon('pr-closed'),
            label: icon('label'),
            // Custom widgets' icons (WIDGET_ICONS in model.js).
            ...Object.fromEntries(Object.entries(WIDGET_ICONS).map(([key, name]) => [`widget-${key}`, icon(name)])),
        };
        this._buttons = [];
        this._running = false;

        // Debounced, so typing in the repositories field doesn't fire a request per keystroke.
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'start-request')
                this._start();
            // The Top bar switch (Glance → System Tray): on shows the top bar and starts refreshing, off stops
            // them, without closing the window.
            if (key === 'bar-enabled') {
                const on = this._settings.get_boolean('bar-enabled');
                if (on && !this._running)
                    this._start();
                else if (!on && this._running)
                    this._stop();
            }
            // Quit in the window.
            if (key === 'quit-request' && this._running)
                this._quit();
            if (key === 'app-launcher')
                this._syncLauncher();
            // Changing how the lists are built redraws them; nothing needs to be loaded again.
            if (['group-by', 'project-repos', 'organization-names'].includes(key) && this._running)
                this._setState({});
            if (!this._running || UI_ONLY_KEYS.includes(key))
                return;
            if (TOOLBAR_KEYS.includes(key)) {
                this._buildButtons();
                this._setState({});
            }
            this._schedule(1);
        });

        this._syncLauncher();
        // Reset (Glance → Widgets) is only offered until the wallpaper changes some
        // other way, even while the window is closed.
        this._background = backgroundSettings();
        this._backgroundChangedId = this._background.connect('changed',
            () => forgetStaleSavedWallpaper(this._background, this._settings));
        forgetStaleSavedWallpaper(this._background, this._settings);
        const atLogin = sessionRunning === null;
        sessionRunning ??= this._settings.get_boolean('start-automatically');
        if (sessionRunning)
            this._start();
        else
            this._settings.set_boolean('bar-enabled', false);
        // Once per login (not after the lock screen), say if a newer version is out.
        if (atLogin && sessionRunning) {
            this._updateNotice = new UpdateNotice({
                client: this._client,
                settings: this._settings,
                version: this.metadata['version-name'] ?? 'dev',
                gicon: Gio.FileIcon.new(this.dir.get_child('icons').get_child('sourceglance-app.svg')),
                onInstall: () => this._installUpdate(),
            });
        }
    }

    /** Opens the window and starts its update, as if you'd clicked "Update available" there. */
    _installUpdate() {
        this._settings?.set_boolean('install-update', true);
        this._openWindow();
    }

    /** Adds or removes the app grid icon, following the "Show in app grid" setting. */
    _syncLauncher() {
        if (this._settings.get_boolean('app-launcher'))
            installLauncher(this.dir);
        else
            removeLauncher();
    }

    /** Shows the top-bar buttons and starts refreshing. */
    _start() {
        if (this._running)
            return;
        this._running = true;
        sessionRunning = true;
        this._settings.set_boolean('bar-enabled', true);
        this._buildButtons();
        this._widgets = new DesktopWidgets({
            settings: this._settings,
            icons: this._icons,
            getRepos: () => this._settings?.get_strv('repositories') ?? [],
        });
        this._widgets.update(this._state);
        this._refresh();
    }

    /**
     * Quit: hides the buttons and widgets and stops all network activity until started again.
     * Closes the window too (it follows quit-request).
     */
    _quit() {
        this._running = false;
        sessionRunning = false;
        this._settings.set_boolean('bar-enabled', false);
        this._settings.set_int('quit-request', this._settings.get_int('quit-request') + 1);
        this._shutDown();
        Main.notify('Source Glance', _('Source Glance has quit. To show the top bar again, open Source Glance ' +
            'and switch Top bar on under Glance → System Tray.'));
    }

    /** The Top bar switch, off: the same as Quit, but the window stays open. */
    _stop() {
        this._running = false;
        sessionRunning = false;
        this._shutDown();
    }

    /** Stops refreshing and takes down the buttons and desktop widgets. */
    _shutDown() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._actions.closeDialog();
        for (const button of this._buttons)
            button.destroy();
        this._buttons = [];
        this._widgets?.destroy();
        this._widgets = null;
    }

    disable() {
        // sessionRunning is left as is, so the lock screen doesn't undo Quit.
        this._running = false;
        this._updateNotice?.destroy();
        this._updateNotice = null;
        if (this._backgroundChangedId) {
            this._background.disconnect(this._backgroundChangedId);
            this._backgroundChangedId = 0;
        }
        this._background = null;
        this._cancellable?.cancel();
        this._cancellable = null;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        this._settings = null;

        this._actions?.destroy();
        this._actions = null;

        this._client?.destroy();
        this._client = null;
        this._clients?.destroy();
        this._clients = null;
        this._accounts = null;
        this._results = null;
        this._closed = null;
        this._busy = null;

        for (const button of this._buttons ?? [])
            button.destroy();
        this._buttons = null;
        this._widgets?.destroy();
        this._widgets = null;
        this._icons = null;

        this._state = null;
    }

    /** The lists shown in the top bar, from Settings. */
    _lists() {
        return normalizeButtons(this._settings.get_strv('toolbar-buttons'));
    }

    /** Opens the sourceglance window, on `page` if given (the window reads `open-page`). */
    _openWindow(page = '') {
        this._settings.set_string('open-page', page);
        // In Source Glance's own app (launcher.js), so the dock shows it as Source Glance.
        try {
            Gio.Subprocess.new(['gjs', '-m', this.dir.get_child('launcher.js').get_path(), '--open'],
                Gio.SubprocessFlags.NONE);
            return;
        } catch (e) {
            console.warn(`sourceglance: could not open the window: ${e.message}`);
        }
        // openPreferences() returns a promise on newer Shells; it rejects if prefs fail to open.
        Promise.resolve(this.openPreferences()).catch(e =>
            console.warn(`sourceglance: could not open Settings: ${e.message}`));
    }

    /**
     * (Re)creates the top-bar buttons: one per list plus the sourceglance button ("separate"),
     * or only the sourceglance button with a tab per list ("tabs").
     */
    _buildButtons() {
        for (const button of this._buttons)
            button.destroy();
        const lists = this._lists();
        const tabs = this._settings.get_string('layout') === 'tabs';
        const callbacks = {
            onRefresh: () => this._refresh(),
            onOpenTasks: () => this._openWindow('tasks'),
            onOpenPage: page => this._openWindow(page),
            // Settings opens on the first settings page; signing in is there too.
            onSettings: () => this._openWindow('accounts'),
            onAbout: () => this._openWindow('about'),
            onAction: (item, action, arg) => this._actions.run(item, action, arg),
            getRepos: () => this._settings?.get_strv('repositories') ?? [],
            // The top bar lists are built from Glance → System Tray's Group by, and your projects and organization names.
            getListSettings: () => ({
                groupBy: normalizeGroupBy(this._settings?.get_string('group-by')),
                projectRepos: normalizeRepoMap(this._settings?.get_value('project-repos').recursiveUnpack() ?? {}),
                organizationNames: this._settings?.get_value('organization-names').recursiveUnpack() ?? {},
            }),
            getAutostart: () => this._settings?.get_boolean('start-automatically') ?? true,
            // `key` is collapsed-sections (GitHub/GitLab) or collapsed-groups (repositories).
            getCollapsed: key => this._settings?.get_strv(key) ?? [],
            setCollapsed: (key, ids) => this._settings?.set_strv(key, ids),
            setAutostart: active => this._settings?.set_boolean('start-automatically', active),
            onQuit: () => this._quit(),
        };
        // The sourceglance button leads the group, followed by the lists.
        const ids = tabs ? ['app'] : ['app', ...lists];
        this._buttons = ids.map(id => new ToolbarButton({
            id, icons: this._icons, tabs: id === 'app' && tabs ? lists : null, ...callbacks,
        }));
        this._buttons[0].add_style_class_name('sourceglance-group-first');
        this._buttons.at(-1).add_style_class_name('sourceglance-group-last');
        // Each button is inserted at the same position, so add them right to left.
        for (let i = ids.length - 1; i >= 0; i--)
            Main.panel.addToStatusArea(`${this.uuid}-${ids[i]}`, this._buttons[i]);
        if (this._state)
            this._buttons.forEach(button => button.render(this._state));
    }

    _setState(patch) {
        if (!this._buttons)
            return;
        this._state = {...this._state, ...patch};
        for (const button of this._buttons)
            button.render(this._state);
        this._widgets?.update(this._state);
    }

    _setBusy(item, busy) {
        if (!this._busy)
            return;
        if (busy)
            this._busy.add(itemKey(item));
        else
            this._busy.delete(itemKey(item));
        this._setState({busy: [...this._busy]});
    }

    _onItemChanged(item, change) {
        if (!this._closed)
            return;
        if (change === 'closed') {
            this._closed.delete(itemKey(item));
            this._closed.set(itemKey(item), {...item, state: 'closed', closedAt: Date.now()});
            while (this._closed.size > MAX_RECENTLY_CLOSED)
                this._closed.delete(this._closed.keys().next().value);
        } else if (change === 'reopened') {
            this._closed.delete(itemKey(item));
        }
        this._publish();
        // GitHub's search index lags a few seconds behind writes.
        this._schedule(3);
    }

    /** Pushes every account's latest lists to the menus, hiding items closed from the menu. */
    _publish() {
        if (!this._results || !this._accounts)
            return;
        // Still open in search long after we closed it: it was reopened elsewhere.
        for (const result of this._results.values()) {
            for (const item of [...result.issues ?? [], ...result.prs ?? []]) {
                const closed = this._closed.get(itemKey(item));
                if (closed && Date.now() - closed.closedAt > REOPENED_ELSEWHERE_MS)
                    this._closed.delete(itemKey(item));
            }
        }
        const hidden = item => this._closed.has(itemKey(item));
        const hiddenKeys = new Set(this._settings.get_strv('hidden-boards'));
        const sources = this._accounts.map(account => sourceFrom(account, this._results.get(account.id), hidden,
            board => hiddenKeys.has(boardKey(board))));
        this._setState({
            sources,
            status: aggregateStatus(sources),
            updatedAt: latestUpdate(sources),
            error: firstError(sources),
            recentlyClosed: [...this._closed.values()].reverse(),
        });
    }

    /** Loads one account; its errors only mark its own section. Resolves to the error, if any. */
    async _loadAccount(account, options, cancellable) {
        try {
            const result = await loadAccount(this._clients, account, options, cancellable);
            if (cancellable.is_cancelled())
                return null;
            this._results.set(account.id, result.status === 'signed-out'
                ? {status: 'signed-out'}
                : {...result, updatedAt: new Date(), error: null});
            if (result.login && result.login !== account.login)
                rememberLogin(this._settings, account.id, result.login);
            this._publish();
            return null;
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return null;
            const error = e instanceof GitHubError
                ? {kind: e.kind, retryAt: e.retryAt ?? null}
                : {kind: 'unknown', retryAt: null};
            if (!(e instanceof GitHubError))
                console.error(`sourceglance: refresh of ${account.platform} account failed`, e);
            // Keep the last lists, marked with the error.
            this._results.set(account.id, {...this._results.get(account.id), status: 'error', error});
            this._publish();
            return error;
        }
    }

    _schedule(seconds) {
        if (!this._running)
            return;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeoutId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        if (!this._running)
            return;
        // A new refresh replaces any running one.
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const intervalMinutes = this._settings.get_int('refresh-interval');
        this._setState({refreshing: true, intervalMinutes});
        let errors = [];
        try {
            this._accounts = await loadAccounts(this._settings, cancellable);
            allowLinkBases(this._accounts.map(account => account.base));
            this._clients.prune(this._accounts);
            for (const id of [...this._results.keys()]) {
                if (!this._accounts.some(account => account.id === id))
                    this._results.delete(id);
            }
            if (this._accounts.length === 0) {
                this._closed.clear();
                this._setState({...INITIAL_STATE, status: 'signed-out', intervalMinutes, busy: this._state.busy});
                return;
            }
            this._publish();
            // Boards feed the Project Boards list and the boards and summary widgets.
            const custom = parseCustomWidgets(this._settings.get_strv('custom-widgets'));
            const widgets = normalizeWidgets(this._settings.get_strv('widgets'), custom);
            const options = {
                repos: this._settings.get_strv('repositories'),
                boards: this._lists().includes('boards') || widgets.includes('boards') || widgets.includes('summary') ||
                    custom.some(def => def.kind === 'boards' && widgets.includes(def.id)),
            };
            errors = (await Promise.all(this._accounts.map(account =>
                this._loadAccount(account, options, cancellable)))).filter(Boolean);
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            console.error('sourceglance: refresh failed', e);
            errors = [{kind: 'unknown', retryAt: null}];
        } finally {
            if (this._cancellable === cancellable) {
                this._cancellable = null;
                this._setState({refreshing: false});
                // A rate limit on any account waits for its reset; other errors retry sooner.
                const error = errors.find(e => e.kind === 'rate-limit') ?? errors[0] ?? null;
                this._schedule(nextRefreshDelaySeconds(intervalMinutes, error));
            }
        }
    }
}
