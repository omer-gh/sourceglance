import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    GITHUB_COM,
    GITLAB_COM,
    accountForItem,
    accountId,
    accountTitle,
    assigneeTitle,
    aggregateStatus,
    allLanAddresses,
    githubUrls,
    gitlabUrls,
    httpAllowed,
    isLanAddress,
    isSafeAccountUrl,
    latestUpdate,
    migrateAccounts,
    parseAccounts,
    parseGhesMeta,
    parseGitLabDiscovery,
    parseInstanceUrl,
    sectionKey,
    serializeAccounts,
    sourceFrom,
    withAccount,
    withLogin,
    withoutAccount,
} from '../src/lib/accounts.js';
import {gitlabClosedPageUrl, isSafeGitLabUrl, parseGitLabDeviceCode, parseGitLabItems} from '../src/lib/gitlabModel.js';
import {itemKey, parseDeviceCodeResponse, parseSearchResponse, parseViewerBoards, searchPageUrl} from '../src/lib/model.js';
import {allowLinkBases, closedPageUrl, isSafeLink, profileUrl} from '../src/lib/requests.js';

const GHES = 'https://github.example.com';
const SELF = 'https://git.example.com/gitlab';

test('parseInstanceUrl normalizes addresses and refuses the rest', () => {
    assert.deepEqual(parseInstanceUrl(' git.example.com/gitlab/ '),
        {base: SELF, scheme: 'https', hostname: 'git.example.com', port: 443, path: '/gitlab'});
    assert.equal(parseInstanceUrl('HTTPS://GitHub.Example.com:443').base, GHES);
    assert.equal(parseInstanceUrl('https://example.com:8443').base, 'https://example.com:8443');
    assert.equal(parseInstanceUrl('http://192.168.1.5:3000/').base, 'http://192.168.1.5:3000');
    assert.deepEqual(parseInstanceUrl('https://[fd00::5]:8443').hostname, 'fd00::5');
    assert.equal(parseInstanceUrl('').error, 'empty');
    assert.equal(parseInstanceUrl('ftp://example.com').error, 'scheme');
    assert.equal(parseInstanceUrl('javascript://alert(1)').error, 'scheme');
    assert.equal(parseInstanceUrl('https://user:pass@example.com').error, 'credentials');
    assert.equal(parseInstanceUrl('https://example.com/?x=1').error, 'query');
    assert.equal(parseInstanceUrl('https://exa mple.com').error, 'invalid');
    assert.equal(parseInstanceUrl('https://example.com/../x').error, 'invalid');
    assert.equal(parseInstanceUrl('https://999.0.0.1').error, 'invalid');
    assert.equal(parseInstanceUrl('https://example.com:70000').error, 'invalid');
});

test('isLanAddress accepts only loopback, private and link-local addresses', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '127.0.0.1', '169.254.3.4',
        '::1', 'fd12:3456::1', 'fc00::1', 'fe80::1', 'fe80::1%eth0', '::ffff:192.168.1.1'])
        assert.ok(isLanAddress(ip), ip);
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '192.169.0.1', '2001:db8::1', '::ffff:8.8.8.8',
        '::', 'example.com', '', null, '1.2.3'])
        assert.ok(!isLanAddress(ip), String(ip));
    assert.ok(allLanAddresses(['192.168.1.5', 'fd00::5']));
    // One public address among the answers (DNS rebinding) is enough to refuse.
    assert.ok(!allLanAddresses(['192.168.1.5', '93.184.216.34']));
    assert.ok(!allLanAddresses([]));
});

test('httpAllowed: https always; http only to a LAN address, or a name checked when connecting', () => {
    assert.ok(httpAllowed(parseInstanceUrl('https://example.com')));
    assert.ok(httpAllowed(parseInstanceUrl('http://192.168.1.5')));
    assert.ok(httpAllowed(parseInstanceUrl('http://[fd00::5]')));
    assert.ok(!httpAllowed(parseInstanceUrl('http://8.8.8.8')));
    assert.ok(httpAllowed(parseInstanceUrl('http://gitea.lan')));
});

test('accounts are parsed, migrated and updated without losing the first sign-ins', () => {
    const work = {id: accountId('github', GITHUB_COM, 'Alice'), platform: 'github', base: GITHUB_COM, login: 'Alice',
        method: 'pat', clientId: null};
    assert.equal(work.id, 'github:github.com:alice');
    const stored = serializeAccounts([work]);
    const bad = [
        'not json',
        JSON.stringify({...work, id: 'x', platform: 'gitea'}),
        JSON.stringify({...work, id: 'y', base: 'http://8.8.8.8'}),
        JSON.stringify({...work, id: 'z', base: 'https://example.com/'}),
        JSON.stringify({...work, id: 'w', clientId: 'a b'}),
        stored[0],
    ];
    assert.deepEqual(parseAccounts([...stored, ...bad]), [work]);

    const migrated = migrateAccounts([work], {github: true, gitlab: false});
    assert.deepEqual(migrated.map(account => account.id), ['github.com', work.id]);
    assert.equal(migrateAccounts(migrated, {github: true, gitlab: false}), migrated);
    assert.deepEqual(migrateAccounts([], {gitlab: true})[0],
        {id: 'gitlab.com', platform: 'gitlab', base: GITLAB_COM, login: null, method: 'device', clientId: null});

    // Signing in again as someone listed keeps their id (and keyring entry).
    const legacy = withLogin(migrated, 'github.com', 'omer');
    assert.equal(legacy[0].login, 'omer');
    assert.equal(withLogin(legacy, 'github.com', 'omer'), legacy);
    const again = withAccount(legacy, {...work, id: accountId('github', GITHUB_COM, 'omer'), login: 'OMER', method: 'device'});
    assert.equal(again.length, 2);
    assert.equal(again[0].id, 'github.com');
    assert.equal(again[0].method, 'device');
    assert.equal(withAccount(legacy, {...work, id: 'github:github.com:bob', login: 'bob'}).length, 3);
    assert.deepEqual(withoutAccount(again, 'github.com').map(account => account.id), [work.id]);
});

test('section keys keep the old collapse ids; titles name the instance and login', () => {
    assert.equal(sectionKey({id: 'github.com'}), 'github');
    assert.equal(sectionKey({id: 'gitlab.com'}), 'gitlab');
    assert.equal(sectionKey({id: 'github:github.com:alice'}), 'github:github.com:alice');
    assert.equal(accountTitle({platform: 'github', base: GITHUB_COM, login: 'alice'}), 'GitHub · @alice');
    assert.equal(accountTitle({platform: 'gitlab', base: GITLAB_COM, login: null}), 'GitLab');
    assert.equal(assigneeTitle({platform: 'github', base: GITHUB_COM, login: 'alice'}), '@alice · GitHub');
    assert.equal(assigneeTitle({platform: 'gitlab', base: 'https://git.example.com', login: 'bob'}), '@bob · git.example.com');
    assert.equal(assigneeTitle({platform: 'gitlab', base: GITLAB_COM, login: null}), 'GitLab');
    assert.equal(accountTitle({platform: 'gitlab', base: SELF, login: 'bob'}), 'GitLab · git.example.com/gitlab · @bob');
    assert.equal(accountTitle({platform: 'gitlab', base: 'http://192.168.1.5', login: 'bob'}), 'GitLab · http://192.168.1.5 · @bob');
});

test('instance URLs and links stay on the account’s instance', () => {
    assert.equal(githubUrls().api, 'https://api.github.com');
    assert.equal(githubUrls().graphql, 'https://api.github.com/graphql');
    assert.equal(githubUrls(GHES).api, `${GHES}/api/v3`);
    assert.equal(githubUrls(GHES).graphql, `${GHES}/api/graphql`);
    assert.equal(githubUrls(GHES).deviceCode, `${GHES}/login/device/code`);
    assert.equal(gitlabUrls(SELF).api, `${SELF}/api/v4`);
    assert.ok(isSafeAccountUrl(`${GHES}/a/b/issues/1`, GHES));
    assert.ok(!isSafeAccountUrl(`${GHES}.evil.example/a`, GHES));
    assert.ok(!isSafeAccountUrl('https://evil.example/', GHES));
    assert.ok(!isSafeAccountUrl(`${GHES}/a b`, GHES));
    assert.ok(!isSafeAccountUrl(`${GHES}/a`, ''));
    assert.ok(isSafeGitLabUrl(`${SELF}/g/p/-/issues/1`, SELF));
    assert.ok(!isSafeGitLabUrl('https://gitlab.com/g/p', SELF));

    assert.ok(!isSafeLink(`${GHES}/a/b`));
    allowLinkBases([GHES, GITHUB_COM]);
    assert.ok(isSafeLink(`${GHES}/a/b`));
    assert.ok(isSafeLink('https://github.com/a/b'));
    allowLinkBases([]);
    assert.ok(!isSafeLink(`${GHES}/a/b`));
});

test('parsers take the instance for GitHub Enterprise Server and self-managed GitLab', () => {
    const json = {items: [{number: 1, title: 'T', html_url: `${GHES}/a/b/issues/1`, repository_url: `${GHES}/api/v3/repos/a/b`,
        state: 'open', labels: [], assignees: []}]};
    assert.equal(parseSearchResponse(json, 'issue').items[0].url, null);
    const ghes = parseSearchResponse(json, 'issue', url => isSafeAccountUrl(url, GHES)).items[0];
    assert.equal(ghes.url, `${GHES}/a/b/issues/1`);
    assert.equal(ghes.repo, 'a/b');
    const boards = parseViewerBoards({data: {viewer: {projectsV2: {nodes: [{id: 'PVT_1', title: 'B', url: `${GHES}/users/a/projects/1`, items: {nodes: []}}]}}}},
        url => isSafeAccountUrl(url, GHES));
    assert.equal(boards[0].url, `${GHES}/users/a/projects/1`);
    const code = parseDeviceCodeResponse({device_code: 'd', user_code: 'ABCD-1234', verification_uri: 'https://evil.example/'},
        {isSafe: url => isSafeAccountUrl(url, GHES), fallback: `${GHES}/login/device`});
    assert.equal(code.verificationUri, `${GHES}/login/device`);
    assert.equal(searchPageUrl('issue-closed', [], GHES).startsWith(`${GHES}/issues?q=`), true);

    const items = parseGitLabItems([{iid: 3, project_id: 9, title: 'X', web_url: `${SELF}/g/p/-/issues/3`, state: 'opened',
        references: {full: 'g/p#3'}}], 'issue', SELF);
    assert.equal(items[0].url, `${SELF}/g/p/-/issues/3`);
    assert.equal(parseGitLabDeviceCode({device_code: 'd', user_code: 'ABCD1234', verification_uri: 'https://gitlab.com/oauth/device'}, SELF)
        .verificationUri, `${SELF}/oauth/device`);
    assert.equal(gitlabClosedPageUrl('issue', 'bob', SELF), `${SELF}/dashboard/issues?assignee_username=bob&state=closed`);
});

test('the wizard recognises GitHub Enterprise Server and GitLab', () => {
    assert.deepEqual(parseGhesMeta({installed_version: '3.14.2'}), {version: '3.14.2'});
    assert.equal(parseGhesMeta({verifiable_password_authentication: true}), null);
    assert.equal(parseGhesMeta({installed_version: '<b>'}), null);
    assert.equal(parseGhesMeta(null), null);
    const discovery = {issuer: SELF, scopes_supported: ['api', 'read_api', 'openid'], grant_types_supported: ['authorization_code', 'device_code']};
    assert.deepEqual(parseGitLabDiscovery(discovery, SELF), {device: true});
    assert.deepEqual(parseGitLabDiscovery({...discovery, grant_types_supported: ['authorization_code']}, SELF), {device: false});
    assert.equal(parseGitLabDiscovery({...discovery, issuer: 'https://evil.example'}, SELF), null);
    assert.equal(parseGitLabDiscovery({...discovery, scopes_supported: ['openid']}, SELF), null);
});

test('sourceFrom builds one account’s section; items carry their account', () => {
    const account = {id: 'github:github.com:alice', platform: 'github', base: GITHUB_COM, login: null, method: 'pat', clientId: null};
    const issue = n => ({kind: 'issue', repo: 'a/b', number: n, accountId: account.id, labels: [], assignees: []});
    const result = {status: 'ready', login: 'alice', updatedAt: new Date(1000), error: null, issues: [issue(1), issue(2)], prs: [],
        issueTotal: 30, prTotal: 0, closedCounts: {issues: 4, prs: 1}, boards: [], boardsError: null};
    const source = sourceFrom(account, result, item => item.number === 2);
    assert.equal(source.key, account.id);
    assert.equal(source.title, 'GitHub · @alice');
    assert.equal(source.login, 'alice');
    assert.equal(source.issueShown, 1);
    assert.equal(source.issueTotal, 29);
    assert.deepEqual(source.groups.map(group => group.repo), ['a/b']);
    assert.equal(sourceFrom({...account, platform: 'gitlab'}, result).boards, null);
    assert.equal(sourceFrom(account).status, 'loading');
    // The team's items (window only) are listed but don't change your counts.
    const team = sourceFrom(account, {...result, issues: [issue(1), {...issue(3), reason: 'team'}]});
    assert.equal(team.issueShown, 1);
    assert.equal(team.issueTotal, 30);
    assert.equal(team.groups[0].issues.length, 2);

    assert.equal(aggregateStatus([]), 'signed-out');
    assert.equal(aggregateStatus([{status: 'signed-out'}]), 'signed-out');
    assert.equal(aggregateStatus([{status: 'loading'}, {status: 'error', updatedAt: null}]), 'error');
    assert.equal(aggregateStatus([source, {status: 'error', updatedAt: null}]), 'ready');
    assert.equal(latestUpdate([source, {updatedAt: new Date(5000)}]).getTime(), 5000);

    // The same issue from two accounts is two items; the first sign-ins keep their old keys.
    assert.equal(itemKey(issue(1)), 'github:github.com:alice|a/b#1');
    assert.equal(itemKey({...issue(1), accountId: 'github.com'}), 'a/b#1');
    assert.equal(accountForItem({platform: 'gitlab'}), 'gitlab.com');
    assert.equal(accountForItem(issue(1)), account.id);
});

test('closed-page and profile links follow the account', () => {
    const gh = {platform: 'github', base: GITHUB_COM, login: 'alice'};
    assert.ok(closedPageUrl(gh, 'issue', ['a/b']).includes(encodeURIComponent('repo:a/b')));
    assert.ok(!closedPageUrl({...gh, base: GHES}, 'issue', ['a/b']).includes('repo'));
    assert.ok(closedPageUrl({...gh, base: GHES}, 'pr').startsWith(`${GHES}/pulls?q=`));
    assert.equal(closedPageUrl({platform: 'gitlab', base: SELF, login: 'bob'}, 'pr'),
        `${SELF}/dashboard/merge_requests?assignee_username=bob&state=merged`);
    assert.equal(profileUrl(gh), 'https://github.com/alice');
    assert.equal(profileUrl({...gh, login: null}), null);
});

test('sourceFrom leaves out hidden boards but keeps them for the picker', () => {
    const account = {id: 'github:github.com:a', platform: 'github', base: 'https://github.com', login: 'a'};
    const boards = [{title: 'Keep', url: 'https://github.com/users/a/projects/1', drafts: []},
        {title: 'Hide', url: 'https://github.com/users/a/projects/2', drafts: []}];
    const source = sourceFrom(account, {status: 'ready', boards}, undefined, board => board.title === 'Hide');
    assert.deepEqual(source.boards.map(board => board.title), ['Keep']);
    assert.deepEqual(source.allBoards.map(board => board.title), ['Keep', 'Hide']);
});
