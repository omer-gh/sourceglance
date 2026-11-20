import test from 'node:test';
import assert from 'node:assert/strict';

import {discoveryRequests, friendlyName, nameRequests, parseDisplayName, parseOrganizations} from '../src/lib/names.js';

test('nameRequests: users and orgs on GitHub, groups then users on GitLab, nothing for odd input', () => {
    assert.deepEqual(nameRequests('github', 'octo-org'), [{method: 'GET', path: '/users/octo-org'}]);
    assert.deepEqual(nameRequests('gitlab', 'g/sub'), [{method: 'GET', path: '/groups/g%2Fsub'}]);
    assert.deepEqual(nameRequests('gitlab', 'me').map(r => r.path), ['/groups/me', '/users?username=me']);
    assert.deepEqual(nameRequests('github', '../admin'), []);
    assert.deepEqual(nameRequests('gitlab', 'a/../b?x=1'), []);
    assert.deepEqual(nameRequests('github', null), []);
});

test('parseDisplayName reads objects and lists, as plain capped text', () => {
    assert.equal(parseDisplayName({name: 'Acme Inc'}), 'Acme Inc');
    assert.equal(parseDisplayName([{name: 'Mo Omer'}]), 'Mo Omer');
    assert.equal(parseDisplayName({name: ' A\n\tB '}), 'A B');
    assert.equal(parseDisplayName({name: 'x'.repeat(200)}).length <= 60, true);
    assert.equal(parseDisplayName({name: 7}), '');
    assert.equal(parseDisplayName(null), '');
});

test('friendlyName shows the name with the login in parentheses', () => {
    assert.equal(friendlyName('Acme Inc', 'acme'), 'Acme Inc (@acme)');
    assert.equal(friendlyName('', 'acme'), '@acme');
    assert.equal(friendlyName('Acme', 'acme'), '@acme');
});

test('organizations are discovered with read-only requests and parsed safely', () => {
    assert.deepEqual(discoveryRequests('github').map(r => r.path), ['/graphql', '/user/orgs?per_page=100']);
    assert.deepEqual(parseOrganizations('github', {data: {viewer: {organizations: {nodes: [{login: 'acme', name: 'Acme Inc'}, null]}}}}),
        [{login: 'acme', name: 'Acme Inc'}]);
    assert.ok(discoveryRequests('gitlab')[0].path.startsWith('/groups?min_access_level=10'));
    assert.ok(discoveryRequests('github').filter(r => !r.graphql).every(r => r.method === 'GET'));
    assert.ok(discoveryRequests('github').filter(r => r.graphql).every(r => r.body.query.startsWith('query')));
    assert.deepEqual(parseOrganizations('github', [{login: 'acme'}, {login: '../x'}, null]), [{login: 'acme', name: ''}]);
    assert.deepEqual(parseOrganizations('gitlab', [{full_path: 'g/sub', name: 'Group Sub'}, {full_path: 'a b'}]),
        [{login: 'g/sub', name: 'Group Sub'}]);
    assert.deepEqual(parseOrganizations('github', {message: 'nope'}), []);
});
