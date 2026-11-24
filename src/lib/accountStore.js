// The account list and each account's sign-in (ADR 0007): the list (non-secret) lives in the
// `accounts` GSettings key, each sign-in in the keyring under the account's id. Also a client
// per account and the loader for one account's lists. Used by the top bar (extension.js) and
// the window, so no GNOME Shell imports.
import {GitHubClient} from './github.js';
import {GitLabClient} from './gitlab.js';
import * as registry from './accountRegistry.js';
import {accountKey} from './sync.js';
import {clearSecret, lookupSecret, storeSecret} from './tokenStore.js';

export {loadAccount} from './accountRegistry.js';

const keyring = {
    lookup: lookupSecret,
    store: storeSecret,
    clear: clearSecret,
};

const soupClients = {
    github: (version, base) => new GitHubClient(version, base),
    gitlab: (version, options) => new GitLabClient(version, options),
};

/** The `accounts` key, for accountRegistry.js. */
function settingsList(settings) {
    return {
        read: () => settings.get_strv('accounts'),
        write: strv => settings.set_strv('accounts', strv),
        notify: () => notifyAccountsChanged(settings),
    };
}

/**
 * The name of the computer that provides this account, or null when this computer does (or there is no sync server). An account
 * another computer provides comes down from the sync server and is that computer's to sign out: not here.
 */
export function providerOf(settings, account) {
    if (!settings.settings_schema.has_key('sync-managed'))
        return null;
    return settings.get_value('sync-managed').deepUnpack()[accountKey(account)] ?? null;
}

export function readAccounts(settings) {
    return registry.readAccounts(settingsList(settings));
}

/** Tells the running extension (and the window's lists) to reload right away. */
export function notifyAccountsChanged(settings) {
    settings.set_int('token-changed', settings.get_int('token-changed') + 1);
}

/**
 * The accounts, after adding the github.com and gitlab.com sign-ins from before multiple
 * accounts: they keep their keyring entries and are listed once found there.
 */
export function loadAccounts(settings, cancellable = null) {
    return registry.loadAccounts(settingsList(settings), keyring, cancellable);
}

/**
 * Stores a new sign-in and lists the account. Signing in again as someone already listed
 * replaces their sign-in. Resolves to the saved account.
 */
export function saveAccount(settings, account, secret) {
    return registry.saveAccount(settingsList(settings), keyring, account, secret);
}

/** Signs out: forgets the keyring entry and takes the account off the list. */
export function removeAccount(settings, account) {
    return registry.removeAccount(settingsList(settings), keyring, account);
}

/** Remembers an account's login once known (the first sign-ins were stored without one). */
export function rememberLogin(settings, id, login) {
    registry.rememberLogin(settingsList(settings), id, login);
}

/** One client per account, each talking only to its own instance. */
export class AccountClients extends registry.AccountClients {
    constructor(version = 'dev') {
        super(soupClients, keyring, version);
    }
}
