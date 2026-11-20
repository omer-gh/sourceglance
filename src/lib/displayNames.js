// Keeps the names of organizations per account: the ones the platform gives (fetched once per
// account and kept for the session) and the ones you set. Not pure (GLib), so the request and
// parsing code lives in names.js, tested with Node.
import GLib from 'gi://GLib';

import {organizationOf} from './model.js';
import {discoveryRequests, friendlyName, nameRequests, parseDisplayName, parseOrganizations} from './names.js';

const OVERRIDES_KEY = 'organization-names';

/**
 * Loads and keeps the names of organizations per account, with the ones you set (the
 * `organization-names` setting) taking priority. `clients` is an AccountClients.
 */
export class DisplayNames {
    constructor(clients, settings) {
        this._clients = clients;
        this._settings = settings;
        this._names = new Map();
        this._tried = new Set();
        this._found = new Map();
        // Organizations seen on loaded items, by account id: they're listed even if the platform doesn't say.
        this._seen = new Map();
        this._listeners = [];
        // The watch list changing (a public repository added) can add an organization.
        settings.connect('changed::repositories', () => this._notify());
    }

    /** Runs `callback` when a name was loaded or you changed one. */
    connectChanged(callback) {
        this._listeners.push(callback);
        this._settings.connect(`changed::${OVERRIDES_KEY}`, callback);
    }

    _notify() {
        for (const callback of this._listeners)
            callback();
    }

    // One name per organization on an instance, whichever account sees it (logins ignore case).
    _key(account, login) {
        return `${account.platform}:${account.base}|${String(login).toLowerCase()}`;
    }

    // The names you set are kept as plain text: the organization's login (lower case), then its name.
    _textKey(login) {
        return String(login).toLowerCase();
    }

    _overrides() {
        return this._settings.get_value(OVERRIDES_KEY).recursiveUnpack();
    }

    /** The name you set for the organization, or '' if none. */
    override(account, login) {
        return this._overrides()[this._textKey(login)] ?? '';
    }

    /** The name to show: yours, else the platform's, else ''. */
    nameOf(account, login) {
        return this.override(account, login) || this._names.get(this._key(account, login)) || '';
    }

    /** What to show: "Name (@login)", or "@login" with no name. */
    label(account, login) {
        return friendlyName(this.nameOf(account, login), login);
    }

    /** What groups organizations together: the name (or the login with none), case folded. */
    keyOf(account, login) {
        return (this.nameOf(account, login) || login).toLowerCase();
    }

    /** Saves the name you chose for an organization; '' goes back to the platform's. */
    setOverride(account, login, name) {
        const next = {...this._overrides()};
        const clean = parseDisplayName({name});
        if (clean)
            next[this._textKey(login)] = clean;
        else
            delete next[this._textKey(login)];
        this._settings.set_value(OVERRIDES_KEY, new GLib.Variant('a{ss}', next));
    }

    /** Remembers organizations seen on loaded items; tells listeners if any is new. */
    noteSeen(account, logins) {
        const seen = this._seen.get(account.id) ?? new Set();
        const before = seen.size;
        for (const login of logins)
            seen.add(login);
        this._seen.set(account.id, seen);
        if (seen.size > before)
            this._notify();
    }

    /**
     * The organizations `account` belongs to, its own login first: [{login, name}]. Asks the
     * platform once per account (each request on its own, since a token may read one kind and not
     * another), then adds the organizations seen on its items. With no answer, those are all.
     */
    async discover(account) {
        if (!this._found.has(account.id))
            this._found.set(account.id, this._askPlatform(account));
        const asked = await this._found.get(account.id);
        const all = [...asked];
        // Organizations of the repositories you watch on github.com (a public one is no membership of yours).
        const watched = account.platform === 'github' && account.base === 'https://github.com'
            ? this._settings.get_strv('repositories').map(organizationOf) : [];
        for (const login of watched) {
            if (!all.some(known => known.login.toLowerCase() === login.toLowerCase()))
                all.push({login, name: ''});
        }
        for (const login of this._seen.get(account.id) ?? []) {
            if (!all.some(known => known.login.toLowerCase() === login.toLowerCase()))
                all.push({login, name: ''});
        }
        return all;
    }

    async _askPlatform(account) {
        const found = account.login ? [{login: account.login, name: ''}] : [];
        try {
            const token = await this._clients.tokenFor(account);
            const client = token ? this._clients.clientFor(account) : null;
            for (const request of client ? discoveryRequests(account.platform) : []) {
                let entries = [];
                try {
                    entries = parseOrganizations(account.platform, await client.send(token, request));
                } catch {
                    continue;
                }
                for (const entry of entries) {
                    if (found.some(known => known.login.toLowerCase() === entry.login.toLowerCase()))
                        continue;
                    found.push(entry);
                    if (entry.name)
                        this._names.set(this._key(account, entry.login), entry.name);
                }
            }
        } catch {
            // Only the account's own login.
        }
        return found;
    }

    /**
     * Loads the names of `wanted` ([{account, login}]) not tried yet, then tells listeners if
     * any name turned up. A failed load isn't retried until the window restarts.
     */
    async load(wanted) {
        const todo = wanted.filter(({account, login}) => !this._tried.has(this._key(account, login)));
        for (const {account, login} of todo)
            this._tried.add(this._key(account, login));
        let found = false;
        await Promise.all(todo.map(async ({account, login}) => {
            try {
                const token = await this._clients.tokenFor(account);
                if (!token)
                    return;
                const client = this._clients.clientFor(account);
                for (const request of nameRequests(account.platform, login)) {
                    let name = '';
                    try {
                        name = parseDisplayName(await client.send(token, request));
                    } catch {
                        continue;
                    }
                    if (name) {
                        this._names.set(this._key(account, login), name);
                        found = true;
                        return;
                    }
                }
            } catch {
                // No name: the login shows instead.
            }
        }));
        if (found)
            this._notify();
    }
}
