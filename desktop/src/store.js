// The lists, loaded for every account, shared by the window and the popover. The popover,
// which is always loaded, is the one that fetches them; the main window follows its results,
// so the API isn't used twice. A change in either window (signing in, an action) makes the
// popover reload.
import {AccountClients, loadAccount, loadAccounts} from '@core/accountRegistry.js';
import {aggregateStatus, fetchProblem, latestUpdate, sourceFrom} from '@core/accounts.js';
import {allowLinkBases} from '@core/requests.js';
import {emit, listen} from '@tauri-apps/api/event';

import {GitHubClient} from './platform/github.js';
import {GitLabClient} from './platform/gitlab.js';
import {accountList, secrets} from './platform/tauri.js';

const factory = {
    github: (version, base) => new GitHubClient(version, base),
    gitlab: (version, options) => new GitLabClient(version, options),
};

// Settings that change what's loaded.
const RELOAD_KEYS = ['accounts', 'token-changed', 'repositories'];

export class Store {
    /**
     * `follow`: don't fetch, show what the popover's Store loads (the main window). The
     * popover's Store fetches on the interval and when asked.
     */
    constructor(settings, {follow = false} = {}) {
        this._follow = follow;
        this.settings = settings;
        this.list = accountList(settings);
        this.clients = new AccountClients(factory, secrets, __APP_VERSION__);
        this.accounts = [];
        this.results = new Map();
        this.busy = [];
        this._busy = new Map();
        this.state = this._state(false);
        this._controller = null;
        this._timer = null;
        this._listeners = new Set();
        this._id = Math.random().toString(36).slice(2);
    }

    /** Runs `listener(state)` after every change. */
    connect(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    async start() {
        this.settings.connect(key => {
            // The popover reloads on its own for these; the main window only rereads the accounts.
            if (RELOAD_KEYS.includes(key))
                this._follow ? this._loadAccounts() : this.refresh();
            else if (key === 'refresh-interval' && !this._follow)
                this._schedule();
            else
                this._changed();
        });
        if (this._follow) {
            await listen('lists-state', ({payload}) => this._received(payload));
            await this._loadAccounts();
            await emit('lists-wanted');
            return;
        }
        await listen('refresh', () => this.refresh());
        await listen('lists-changed', ({payload}) => {
            if (payload !== this._id)
                this.refresh();
        });
        await listen('lists-wanted', () => this._publish());
        await this.refresh();
    }

    /** Tells the popover to reload, after a change made here. */
    announce() {
        return emit('lists-changed', this._id);
    }

    _schedule() {
        clearTimeout(this._timer);
        const minutes = Math.max(1, this.settings.get('refresh-interval', 10));
        this._timer = setTimeout(() => this.refresh(), minutes * 60 * 1000);
    }

    async refresh() {
        if (this._follow) {
            await this._loadAccounts();
            await emit('refresh');
            return;
        }
        this._controller?.abort();
        const controller = new AbortController();
        this._controller = controller;
        this.state = {...this.state, refreshing: true};
        this._changed();
        this._publish();
        try {
            this.accounts = await loadAccounts(this.list, secrets, controller.signal);
            this.clients.prune(this.accounts);
            allowLinkBases(this.accounts.map(account => account.base));
            await Promise.all(this.accounts.map(account => this._load(account, controller.signal)));
        } catch (e) {
            if (e?.name === 'AbortError')
                return;
            console.error('sourceglance: refresh failed', e);
        }
        if (this._controller !== controller)
            return;
        this._controller = null;
        for (const id of this.results.keys()) {
            if (!this.accounts.some(account => account.id === id))
                this.results.delete(id);
        }
        this.state = this._state(false);
        this._schedule();
        this._changed();
        this._publish();
    }

    /** The account list only, for the main window. */
    async _loadAccounts() {
        try {
            this.accounts = await loadAccounts(this.list, secrets);
            allowLinkBases(this.accounts.map(account => account.base));
        } catch (e) {
            console.error('sourceglance: reading the accounts failed', e);
        }
        this.state = this._state(this.state.refreshing);
        this._changed();
    }

    /** Sends the popover's results to the main window. */
    _publish() {
        if (this._follow)
            return;
        emit('lists-state', {
            refreshing: this.state.refreshing,
            results: [...this.results],
        }).catch(e => console.error('sourceglance: sharing the lists failed', e));
    }

    /** Results from the popover. Dates arrive as text. */
    _received({refreshing, results}) {
        this.results = new Map(results.map(([id, result]) => [id, {
            ...result,
            updatedAt: result.updatedAt ? new Date(result.updatedAt) : null,
        }]));
        this.state = this._state(refreshing);
        this._changed();
    }

    async _load(account, signal) {
        try {
            const result = await loadAccount(this.clients, account, {
                repos: this.settings.get('repositories', []),
                projects: true,
            }, signal);
            this.results.set(account.id, result.status === 'ready' ? {...result, updatedAt: new Date(), error: null} : result);
        } catch (e) {
            if (e?.name === 'AbortError')
                throw e;
            const previous = this.results.get(account.id) ?? {};
            this.results.set(account.id, {
                ...previous,
                status: 'error',
                error: {kind: e.kind ?? 'unknown', retryAt: e.retryAt ?? null},
            });
        }
    }

    _state(refreshing) {
        const sources = this.accounts.map(account => sourceFrom(account, this.results.get(account.id) ?? {}));
        return {
            status: this.accounts.length === 0 ? 'signed-out' : aggregateStatus(sources),
            sources,
            updatedAt: latestUpdate(sources),
            problem: fetchProblem(sources),
            busy: this.busy,
            refreshing,
            intervalMinutes: this.settings.get('refresh-interval', 10),
        };
    }

    /** Marks an item busy while an action runs on it. Actions on one item can overlap. */
    setBusy(key, busy) {
        const count = (this._busy.get(key) ?? 0) + (busy ? 1 : -1);
        if (count > 0)
            this._busy.set(key, count);
        else
            this._busy.delete(key);
        this.busy = [...this._busy.keys()];
        this.state = {...this.state, busy: this.busy};
        this._changed();
    }

    _changed() {
        for (const listener of this._listeners)
            listener(this.state);
    }
}
