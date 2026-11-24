import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    AccountClients,
    loadAccount,
    loadAccounts,
    readAccounts,
    rememberLogin,
    removeAccount,
    saveAccount,
} from '../src/lib/accountRegistry.js';
import {isCancelled, setCancelledCheck} from '../src/lib/cancellation.js';
import {serializeAccounts} from '../src/lib/accounts.js';

const ALICE = {id: 'github:github.com:alice', platform: 'github', base: 'https://github.com', login: 'alice'};

function memoryList(strv = []) {
    const list = {
        strv,
        notified: 0,
        writes: 0,
        read: () => list.strv,
        write: next => {
            list.strv = next;
            list.writes++;
        },
        notify: () => list.notified++,
    };
    return list;
}

function memorySecrets(entries = {}) {
    const secrets = {
        entries: {...entries},
        labels: {},
        lookup: async id => secrets.entries[id] ?? null,
        store: async (id, secret, _c, label) => {
            secrets.entries[id] = secret;
            secrets.labels[id] = label;
        },
        clear: async id => {
            delete secrets.entries[id];
        },
    };
    return secrets;
}

test('saveAccount stores the secret under the account id and lists it once', async () => {
    const list = memoryList();
    const secrets = memorySecrets();
    const saved = await saveAccount(list, secrets, ALICE, 'tok-1');
    assert.equal(saved.id, ALICE.id);
    assert.equal(secrets.entries[ALICE.id], 'tok-1');
    assert.match(secrets.labels[ALICE.id], /^Source Glance: /);
    assert.equal(readAccounts(list).length, 1);
    assert.equal(list.notified, 1);

    await saveAccount(list, secrets, ALICE, 'tok-2');
    assert.equal(readAccounts(list).length, 1);
    assert.equal(secrets.entries[ALICE.id], 'tok-2');
});

test('removeAccount clears the secret and the list entry', async () => {
    const list = memoryList();
    const secrets = memorySecrets();
    await saveAccount(list, secrets, ALICE, 'tok');
    await removeAccount(list, secrets, readAccounts(list)[0]);
    assert.deepEqual(readAccounts(list), []);
    assert.equal(secrets.entries[ALICE.id], undefined);
    assert.equal(list.notified, 2);
});

test('loadAccounts lists legacy sign-ins found in the store, and only those', async () => {
    const list = memoryList();
    const accounts = await loadAccounts(list, memorySecrets({'github.com': 'old-token'}));
    assert.deepEqual(accounts.map(account => account.id), ['github.com']);
    assert.equal(readAccounts(list).length, 1);

    const empty = memoryList();
    assert.deepEqual(await loadAccounts(empty, memorySecrets()), []);
    assert.equal(empty.writes, 0);
});

test('loadAccounts treats a store that fails as empty, but passes cancellation on', async () => {
    const failing = {lookup: async () => {
        throw new Error('locked');
    }};
    assert.deepEqual(await loadAccounts(memoryList(), failing), []);

    const abort = Object.assign(new Error('stop'), {name: 'AbortError'});
    const cancelled = {lookup: async () => {
        throw abort;
    }};
    await assert.rejects(loadAccounts(memoryList(), cancelled), abort);
});

test('rememberLogin writes only when the login changes', () => {
    const legacy = {id: 'github.com', platform: 'github', base: 'https://github.com', login: null};
    const list = memoryList(serializeAccounts([legacy]));
    rememberLogin(list, 'github.com', 'alice');
    assert.equal(readAccounts(list)[0].login, 'alice');
    const writes = list.writes;
    rememberLogin(list, 'github.com', 'alice');
    assert.equal(list.writes, writes);
});

function fakeFactory() {
    const made = [];
    const client = kind => ({
        kind,
        destroyed: false,
        destroy() {
            this.destroyed = true;
        },
    });
    return {
        made,
        github: (version, base) => {
            const c = {...client('github'), version, base};
            made.push(c);
            return c;
        },
        gitlab: (version, options) => {
            const c = {...client('gitlab'), version, ...options, accessToken: async () => 'gl-token'};
            made.push(c);
            return c;
        },
    };
}

test('AccountClients builds one client per account through the platform factory', async () => {
    const factory = fakeFactory();
    const clients = new AccountClients(factory, memorySecrets({[ALICE.id]: 'gh-token'}), '1.2.3');
    const first = clients.clientFor(ALICE);
    assert.equal(clients.clientFor(ALICE), first);
    assert.equal(first.version, '1.2.3');
    assert.equal(await clients.tokenFor(ALICE), 'gh-token');

    const bob = {id: 'gitlab:gitlab.com:bob', platform: 'gitlab', base: 'https://gitlab.com', login: 'bob'};
    assert.equal(clients.clientFor(bob).accountId, bob.id);
    assert.equal(await clients.tokenFor(bob), 'gl-token');

    clients.prune([bob]);
    assert.equal(first.destroyed, true);
    clients.destroy();
    assert.ok(factory.made.every(c => c.destroyed));
});

test('AccountClients.tokenFor returns null when the store is unavailable', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
        const clients = new AccountClients(fakeFactory(), {lookup: async () => {
            throw new Error('locked');
        }});
        assert.equal(await clients.tokenFor(ALICE), null);
    } finally {
        console.warn = warn;
    }
});

test('loadAccount reports signed-out without a token', async () => {
    const clients = new AccountClients(fakeFactory(), memorySecrets());
    assert.deepEqual(await loadAccount(clients, ALICE), {status: 'signed-out'});
});

test('the cancellation check can be replaced per platform', () => {
    assert.equal(isCancelled(Object.assign(new Error(), {name: 'AbortError'})), true);
    assert.equal(isCancelled(null), false);
    setCancelledCheck(error => error.code === 19);
    try {
        assert.equal(isCancelled({code: 19}), true);
        assert.equal(isCancelled(Object.assign(new Error(), {name: 'AbortError'})), false);
    } finally {
        setCancelledCheck(error => error?.name === 'AbortError');
    }
});
