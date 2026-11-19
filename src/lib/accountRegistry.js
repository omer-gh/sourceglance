// The account list and sign-ins (ADR 0007), shared by GNOME and the desktop app. Callers
// pass where the list and the secrets are kept:
//
//   list    = {read(), write(strv), notify()}
//   secrets = {lookup(id, cancellable), store(id, secret, cancellable, label), clear(id, cancellable)}
//
// GNOME uses GSettings and the keyring (accountStore.js); the desktop app uses its settings
// file and the Keychain. No platform imports, so Node can test it (ADR 0004).
import {isCancelled} from './cancellation.js';
import {loadGitLab} from './gitlabLoader.js';
import {loadLists} from './loader.js';
import {
    GITHUB_COM,
    LEGACY_IDS,
    PLATFORMS,
    accountTitle,
    migrateAccounts,
    parseAccounts,
    sameAccount,
    serializeAccounts,
    withAccount,
    withLogin,
    withoutAccount,
} from './accounts.js';

export function readAccounts(list) {
    return parseAccounts(list.read());
}

function writeAccounts(list, accounts) {
    list.write(serializeAccounts(accounts));
}

/** Whether the store has an entry; a locked or missing store counts as none (ADR 0002). */
async function hasSecret(secrets, id, cancellable) {
    try {
        return Boolean(await secrets.lookup(id, cancellable));
    } catch (e) {
        if (isCancelled(e))
            throw e;
        return false;
    }
}

/**
 * The accounts, after adding the github.com and gitlab.com sign-ins from before multiple
 * accounts: they keep their stored entries and are listed once found there.
 */
export async function loadAccounts(list, secrets, cancellable = null) {
    const accounts = readAccounts(list);
    const missing = PLATFORMS.filter(platform => !accounts.some(account => account.id === LEGACY_IDS[platform]));
    if (missing.length === 0)
        return accounts;
    const stored = {};
    for (const platform of missing)
        stored[platform] = await hasSecret(secrets, LEGACY_IDS[platform], cancellable);
    const migrated = migrateAccounts(accounts, stored);
    if (migrated !== accounts)
        writeAccounts(list, migrated);
    return migrated;
}

/**
 * Stores a new sign-in and lists the account. Signing in again as someone already listed
 * replaces their sign-in. Resolves to the saved account.
 */
export async function saveAccount(list, secrets, account, secret) {
    const accounts = withAccount(readAccounts(list), account);
    const saved = accounts.find(other => sameAccount(other, account));
    await secrets.store(saved.id, secret, null, `Source Glance: ${accountTitle(saved)}`);
    writeAccounts(list, accounts);
    list.notify();
    return saved;
}

/** Signs out: forgets the stored sign-in and takes the account off the list. */
export async function removeAccount(list, secrets, account) {
    await secrets.clear(account.id, null);
    writeAccounts(list, withoutAccount(readAccounts(list), account.id));
    list.notify();
}

/** Remembers an account's login once known (the first sign-ins were stored without one). */
export function rememberLogin(list, id, login) {
    const accounts = readAccounts(list);
    const next = withLogin(accounts, id, login);
    if (next !== accounts)
        writeAccounts(list, next);
}

/**
 * One client per account, each talking only to its own instance. `factory` builds the
 * platform's clients: {github(version, base), gitlab(version, {base, accountId, clientId})}.
 */
export class AccountClients {
    constructor(factory, secrets, version = 'dev') {
        this._factory = factory;
        this._secrets = secrets;
        this._version = version;
        this._clients = new Map();
    }

    _key(account) {
        return `${account.id}\n${account.base}\n${account.clientId ?? ''}`;
    }

    clientFor(account) {
        const key = this._key(account);
        let client = this._clients.get(key);
        if (!client) {
            client = account.platform === 'gitlab'
                ? this._factory.gitlab(this._version, {base: account.base, accountId: account.id, clientId: account.clientId})
                : this._factory.github(this._version, account.base);
            this._clients.set(key, client);
        }
        return client;
    }

    /** The account's token (GitLab's renewed when due), or null when signed out or the store is locked. */
    async tokenFor(account, cancellable = null) {
        try {
            return account.platform === 'gitlab'
                ? await this.clientFor(account).accessToken(cancellable)
                : await this._secrets.lookup(account.id, cancellable);
        } catch (e) {
            if (isCancelled(e) || e.kind)
                throw e;
            console.warn(`sourceglance: secret store unavailable: ${e.message}`);
            return null;
        }
    }

    /** Drops the clients of accounts no longer listed. */
    prune(accounts) {
        const keep = new Set(accounts.map(account => this._key(account)));
        for (const [key, client] of this._clients) {
            if (!keep.has(key)) {
                client.destroy();
                this._clients.delete(key);
            }
        }
    }

    destroy() {
        for (const client of this._clients.values())
            client.destroy();
        this._clients.clear();
    }
}

/**
 * Loads one account's lists. Resolves to {status: 'signed-out'} or {status: 'ready', login,
 * issues, prs, issueTotal, prTotal, closedCounts, boards, boardsError}, with every item and
 * board tagged with the account id, so actions run as that account. Throws on API errors.
 * `repos` (the repository filter) applies to github.com accounts only. `team` adds the team's
 * open items (the window's Assignee filter; see loadLists()).
 */
export async function loadAccount(clients, account, {repos = [], projects = true, team = false} = {}, cancellable = null) {
    let result;
    if (account.platform === 'gitlab') {
        result = await loadGitLab(clients.clientFor(account), {team}, cancellable);
        if (result.status === 'signed-out')
            return result;
        result = {...result, boards: null, boardsError: null};
    } else {
        const token = await clients.tokenFor(account, cancellable);
        if (!token)
            return {status: 'signed-out'};
        const lists = await loadLists(clients.clientFor(account), token, {
            repos: account.base === GITHUB_COM ? repos : [],
            projects,
            team,
        }, cancellable);
        result = {...lists, status: 'ready'};
    }
    for (const item of [...result.issues, ...result.prs])
        item.accountId = account.id;
    for (const board of result.boards ?? [])
        board.accountId = account.id;
    return result;
}
