// The account list and each account's sign-in (ADR 0007): the list (non-secret) lives in the
// `accounts` GSettings key, each sign-in in the keyring under the account's id. Also a client
// per account and the loader for one account's lists. Used by the top bar (extension.js) and
// the window, so no GNOME Shell imports.
import {GitHubClient, isCancelled} from './github.js';
import {GitLabClient} from './gitlab.js';
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
import {clearSecret, lookupSecret, storeSecret} from './tokenStore.js';

export function readAccounts(settings) {
    return parseAccounts(settings.get_strv('accounts'));
}

function writeAccounts(settings, accounts) {
    settings.set_strv('accounts', serializeAccounts(accounts));
}

/** Tells the running extension (and the window's lists) to reload right away. */
export function notifyAccountsChanged(settings) {
    settings.set_int('token-changed', settings.get_int('token-changed') + 1);
}

/** Whether the keyring has an entry; a locked or missing keyring counts as none (ADR 0002). */
async function hasSecret(id, cancellable) {
    try {
        return Boolean(await lookupSecret(id, cancellable));
    } catch (e) {
        if (isCancelled(e))
            throw e;
        return false;
    }
}

/**
 * The accounts, after adding the github.com and gitlab.com sign-ins from before multiple
 * accounts: they keep their keyring entries and are listed once found there.
 */
export async function loadAccounts(settings, cancellable = null) {
    const accounts = readAccounts(settings);
    const missing = PLATFORMS.filter(platform => !accounts.some(account => account.id === LEGACY_IDS[platform]));
    if (missing.length === 0)
        return accounts;
    const stored = {};
    for (const platform of missing)
        stored[platform] = await hasSecret(LEGACY_IDS[platform], cancellable);
    const migrated = migrateAccounts(accounts, stored);
    if (migrated !== accounts)
        writeAccounts(settings, migrated);
    return migrated;
}

/**
 * Stores a new sign-in and lists the account. Signing in again as someone already listed
 * replaces their sign-in. Resolves to the saved account.
 */
export async function saveAccount(settings, account, secret) {
    const accounts = withAccount(readAccounts(settings), account);
    const saved = accounts.find(other => sameAccount(other, account));
    await storeSecret(saved.id, secret, null, `Source Glance: ${accountTitle(saved)}`);
    writeAccounts(settings, accounts);
    notifyAccountsChanged(settings);
    return saved;
}

/** Signs out: forgets the keyring entry and takes the account off the list. */
export async function removeAccount(settings, account) {
    await clearSecret(account.id);
    writeAccounts(settings, withoutAccount(readAccounts(settings), account.id));
    notifyAccountsChanged(settings);
}

/** Remembers an account's login once known (the first sign-ins were stored without one). */
export function rememberLogin(settings, id, login) {
    const accounts = readAccounts(settings);
    const next = withLogin(accounts, id, login);
    if (next !== accounts)
        writeAccounts(settings, next);
}

/** One client per account, each talking only to its own instance. */
export class AccountClients {
    constructor(version = 'dev') {
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
                ? new GitLabClient(this._version, {base: account.base, accountId: account.id, clientId: account.clientId})
                : new GitHubClient(this._version, account.base);
            this._clients.set(key, client);
        }
        return client;
    }

    /** The account's token (GitLab's renewed when due), or null when signed out or the keyring is locked. */
    async tokenFor(account, cancellable = null) {
        try {
            return account.platform === 'gitlab'
                ? await this.clientFor(account).accessToken(cancellable)
                : await lookupSecret(account.id, cancellable);
        } catch (e) {
            if (isCancelled(e) || e.kind)
                throw e;
            console.warn(`sourceglance: keyring unavailable: ${e.message}`);
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
export async function loadAccount(clients, account, {repos = [], boards: withBoards = true, team = false} = {}, cancellable = null) {
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
            boards: withBoards,
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
