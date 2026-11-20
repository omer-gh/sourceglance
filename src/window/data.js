// The window's copy of the lists: loads every account's lists on open, on the refresh interval
// and after a change, and tells the pages. Signed out or failing loads show as a status. The
// state has the extension's shape: one source per account (sourceFrom() in lib/accounts.js).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {loadAccount, loadAccounts, rememberLogin} from '../lib/accountStore.js';
import {aggregateStatus, firstError, latestUpdate, sourceFrom} from '../lib/accounts.js';
import {GitHubError, isCancelled} from '../lib/github.js';
import {boardKey} from '../lib/projects.js';
import {allowLinkBases} from '../lib/requests.js';

export class WindowData {
    /** onChange(state) runs after every change. `clients` is an AccountClients. */
    constructor({clients, settings, onChange}) {
        this._clients = clients;
        this._settings = settings;
        this._onChange = onChange;
        this._cancellable = null;
        this._timeoutId = 0;
        this._afterChangeId = 0;
        this.accounts = [];
        // Each account's last load, by account id.
        this._results = new Map();
        // Hiding or showing a board in Settings changes the lists right away.
        settings.connect('changed::hidden-boards', () => this._publish());
        this.state = {status: 'loading', sources: [], updatedAt: null, error: null, busy: [], refreshing: false};
    }

    start() {
        this.refresh();
    }

    stop() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        if (this._afterChangeId)
            GLib.source_remove(this._afterChangeId);
        this._afterChangeId = 0;
    }

    /** The account with this id, or null. */
    account(id) {
        return this.accounts.find(account => account.id === id) ?? null;
    }

    setBusy(key, busy) {
        const set = new Set(this.state.busy);
        if (busy)
            set.add(key);
        else
            set.delete(key);
        this._set({busy: [...set]});
    }

    _set(patch) {
        this.state = {...this.state, ...patch};
        this._onChange(this.state);
    }

    _publish() {
        const hiddenKeys = new Set(this._settings.get_strv('hidden-boards'));
        const sources = this.accounts.map(account => sourceFrom(account, this._results.get(account.id), undefined,
            board => hiddenKeys.has(boardKey(board))));
        this._set({sources, status: aggregateStatus(sources), updatedAt: latestUpdate(sources), error: firstError(sources)});
    }

    _schedule() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            Math.max(1, this._settings.get_int('refresh-interval')) * 60, () => {
                this._timeoutId = 0;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
    }

    /** Reloads now and once more shortly after: GitHub's search index lags behind writes. */
    refreshAfterChange() {
        this.refresh({nudge: true});
        if (this._afterChangeId)
            GLib.source_remove(this._afterChangeId);
        this._afterChangeId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            this._afterChangeId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Loads one account; its errors only mark its own section. */
    async _loadAccount(account, options, cancellable) {
        try {
            const result = await loadAccount(this._clients, account, options, cancellable);
            if (cancellable.is_cancelled())
                return;
            this._results.set(account.id, result.status === 'signed-out'
                ? {status: 'signed-out'}
                : {...result, updatedAt: new Date(), error: null});
            if (result.login && result.login !== account.login)
                rememberLogin(this._settings, account.id, result.login);
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            if (!(e instanceof GitHubError))
                console.error('sourceglance window: load failed', e);
            this._results.set(account.id, {...this._results.get(account.id), status: 'error',
                error: {kind: e instanceof GitHubError ? e.kind : 'unknown', retryAt: e.retryAt ?? null}});
        }
        this._publish();
    }

    /** Reloads everything. `nudge` also asks the top bar to refresh (after a change). */
    async refresh({nudge = false} = {}) {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        if (nudge)
            this._settings.set_int('refresh-request', this._settings.get_int('refresh-request') + 1);
        this._set({refreshing: true});
        // Development only: show fixed data from a JSON file (screenshots, UI tests).
        const fake = GLib.getenv('SOURCEGLANCE_FAKE_LISTS');
        if (fake) {
            const [, bytes] = GLib.file_get_contents(fake);
            this._set({...JSON.parse(new TextDecoder().decode(bytes)), updatedAt: new Date(), refreshing: false});
            this._cancellable = null;
            return;
        }
        try {
            this.accounts = await loadAccounts(this._settings, cancellable);
            allowLinkBases(this.accounts.map(account => account.base));
            this._clients.prune(this.accounts);
            for (const id of [...this._results.keys()]) {
                if (!this.account(id))
                    this._results.delete(id);
            }
            this._publish();
            const options = {
                repos: this._settings.get_strv('repositories'),
                // The window always has a Project Boards page, whatever the top bar shows.
                boards: true,
                // Everyone's open items in your repositories, for the Assignee filter.
                team: true,
            };
            await Promise.all(this.accounts.map(account => this._loadAccount(account, options, cancellable)));
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            console.error('sourceglance window: load failed', e);
            this._set({status: 'error', error: {kind: 'unknown', retryAt: null}});
        } finally {
            if (this._cancellable === cancellable) {
                this._cancellable = null;
                this._set({refreshing: false});
                this._schedule();
            }
        }
    }
}
