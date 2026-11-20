import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    GITLAB_DEVICE_URL,
    closedCountPaths,
    gitlabAssigneesRequest,
    gitlabClosedPageUrl,
    gitlabCloseRequest,
    gitlabCommentRequest,
    gitlabLabelsRequest,
    gitlabReopenRequest,
    isSafeGitLabUrl,
    isValidGitLabUsername,
    listPath,
    parseGitLabDeviceCode,
    parseGitLabItems,
    parseGitLabLabels,
    parseGitLabMembers,
    parseGitLabToken,
    parseProjectIds,
    parseStoredAuth,
    teamListPath,
    teamProjectsPath,
    tokenNeedsRefresh,
} from '../src/lib/gitlabModel.js';

test('isSafeGitLabUrl only allows https://gitlab.com links', () => {
    assert.ok(isSafeGitLabUrl('https://gitlab.com/group/project/-/issues/12'));
    assert.ok(isSafeGitLabUrl('https://gitlab.com/group/project/-/merge_requests/3'));
    assert.ok(!isSafeGitLabUrl('http://gitlab.com/a'));
    assert.ok(!isSafeGitLabUrl('https://gitlab.com.evil.example/a'));
    assert.ok(!isSafeGitLabUrl('javascript:alert(1)'));
    assert.ok(!isSafeGitLabUrl(null));
});

test('parseGitLabDeviceCode prefers the pre-filled gitlab.com link', () => {
    const ok = {device_code: 'dc', user_code: 'COA8FLF8', verification_uri: 'https://gitlab.com/oauth/device',
        verification_uri_complete: 'https://gitlab.com/oauth/device?user_code=COA8FLF8', expires_in: 300, interval: 5};
    assert.equal(parseGitLabDeviceCode(ok).verificationUri, 'https://gitlab.com/oauth/device?user_code=COA8FLF8');
    const evil = parseGitLabDeviceCode({...ok, verification_uri_complete: 'https://evil.example/', verification_uri: 'https://evil.example/'});
    assert.equal(evil.verificationUri, GITLAB_DEVICE_URL);
    assert.equal(parseGitLabDeviceCode({error: 'access_denied'}), null);
});

test('tokens: parse, store form, refresh timing', () => {
    const now = 1_000_000;
    const auth = parseGitLabToken({access_token: 'a', refresh_token: 'r', expires_in: 7200}, now);
    assert.deepEqual(auth, {access: 'a', refresh: 'r', expiresAt: now + 7200 * 1000});
    assert.equal(parseGitLabToken({error: 'x'}), null);
    assert.ok(!tokenNeedsRefresh(auth, now + 60 * 1000));
    assert.ok(tokenNeedsRefresh(auth, now + 7200 * 1000 - 60 * 1000));
    assert.ok(!tokenNeedsRefresh({...auth, refresh: null}, now + 9e9));
    assert.deepEqual(parseStoredAuth(JSON.stringify(auth)), auth);
    assert.equal(parseStoredAuth('not json'), null);
    assert.equal(parseStoredAuth('{}'), null);
});

test('list paths and closed counts', () => {
    assert.ok(listPath('issue').startsWith('/issues?scope=assigned_to_me&state=opened'));
    assert.ok(listPath('mr-review', 'omer.gh').includes('reviewer_username=omer.gh'));
    assert.throws(() => listPath('mr-review', 'bad name&x=1'), TypeError);
    assert.throws(() => listPath('nope'), TypeError);
    assert.equal(closedCountPaths().prs.length, 2);
});

test('parseGitLabItems maps issues and merge requests to the shared item shape', () => {
    const json = [
        {iid: 7, project_id: 42, title: 'Fix CI', web_url: 'https://gitlab.com/g/p/-/issues/7', state: 'opened',
            references: {full: 'g/p#7'}, labels: ['ci', ''], assignees: [{id: 5, username: 'omer'}, {id: 'x', username: 'bad name'}],
            updated_at: '2026-11-16T00:00:00Z'},
        {iid: 8, project_id: 42, title: 'no ref', references: {}},
        {iid: 0, project_id: 42, references: {full: 'g/p#0'}},
    ];
    const [item, ...rest] = parseGitLabItems(json, 'issue');
    assert.equal(rest.length, 0);
    assert.deepEqual(item, {
        platform: 'gitlab', kind: 'issue', reason: 'assigned', number: 7, title: 'Fix CI',
        url: 'https://gitlab.com/g/p/-/issues/7', repo: 'g/p', projectId: 42, nodeId: null, state: 'open',
        labels: [{name: 'ci', color: null}], assignees: ['omer'], assigneeIds: [5], comments: 0,
        updatedAt: '2026-11-16T00:00:00Z', boards: [],
    });
    const [mr] = parseGitLabItems([{...json[0], references: {full: 'g/sub/p!3'}, iid: 3}], 'mr-review');
    assert.deepEqual([mr.kind, mr.reason, mr.repo, mr.number], ['pr', 'review', 'g/sub/p', 3]);
});

test('members and labels drop malformed entries', () => {
    assert.deepEqual(parseGitLabMembers([{id: 1, username: 'a'}, {id: 0, username: 'b'}, {id: 2, username: 'x y'}]),
        [{id: 1, username: 'a'}]);
    assert.deepEqual(parseGitLabLabels([{name: 'bug', color: '#D73A4A'}, {name: ''}, {name: 'ui', color: 'red'}]),
        [{name: 'bug', color: 'd73a4a'}, {name: 'ui', color: null}]);
    assert.ok(isValidGitLabUsername('omer.gh-1'));
    assert.ok(!isValidGitLabUsername('a/b'));
});

test('GitLab write requests', () => {
    const issue = {platform: 'gitlab', kind: 'issue', projectId: 42, number: 7,
        labels: [{name: 'ci'}], assigneeIds: [5]};
    const mr = {...issue, kind: 'pr', number: 3};
    assert.deepEqual(gitlabCloseRequest(issue), {method: 'PUT', path: '/projects/42/issues/7', body: {state_event: 'close'}});
    assert.equal(gitlabReopenRequest(mr).path, '/projects/42/merge_requests/3');
    assert.deepEqual(gitlabCommentRequest(issue, ' hi '), {method: 'POST', path: '/projects/42/issues/7/notes', body: {body: 'hi'}});
    assert.equal(gitlabCommentRequest(issue, '  '), null);
    assert.deepEqual(gitlabLabelsRequest(issue, ['bug']).body, {add_labels: 'bug', remove_labels: 'ci'});
    assert.equal(gitlabLabelsRequest(issue, ['ci']), null);
    const members = [{id: 5, username: 'omer'}, {id: 6, username: 'ann'}];
    assert.deepEqual(gitlabAssigneesRequest(issue, ['ann'], members).body, {assignee_ids: [6]});
    assert.deepEqual(gitlabAssigneesRequest(issue, [], members).body, {assignee_ids: [0]});
    assert.equal(gitlabAssigneesRequest(issue, ['omer'], members), null);
    assert.throws(() => gitlabCloseRequest({...issue, platform: 'github'}), TypeError);
    assert.throws(() => gitlabCloseRequest({...issue, projectId: '42/../1'}), TypeError);
    assert.ok(isSafeGitLabUrl(gitlabClosedPageUrl('pr', 'omer')));
});

test('requests.js picks the right platform', async () => {
    const r = await import('../src/lib/requests.js');
    const m = await import('../src/lib/model.js');
    const gl = {platform: 'gitlab', kind: 'issue', projectId: 42, number: 7, repo: 'g/p', labels: [], assigneeIds: []};
    const gh = {kind: 'issue', repo: 'a/b', number: 7, labels: [], assignees: []};
    assert.deepEqual(r.closeReasons(gl), ['close']);
    assert.deepEqual(r.closeReasons(gh), ['not_planned', 'completed']);
    assert.equal(r.closeRequests(gl, 'close')[0].path, '/projects/42/issues/7');
    assert.equal(r.closeRequests(gh, 'not_planned')[0].body.state_reason, 'not_planned');
    assert.equal(r.commentRequests(gl, '  ').length, 0);
    assert.ok(r.isSafeLink('https://gitlab.com/g/p/-/issues/7') && r.isSafeLink('https://github.com/a/b'));
    assert.ok(!r.isSafeLink('https://evil.example/'));
    assert.equal(m.itemKey(gl), 'gitlab:g/p#7');
    assert.equal(m.itemKey({...gl, kind: 'pr'}), 'gitlab:g/p!7');
    assert.equal(m.itemRef({...gl, kind: 'pr'}), '!7');
    assert.equal(m.itemRef(gh), '#7');
});

test('listBadge adds up every account', async () => {
    const {listBadge} = await import('../src/lib/model.js');
    const github = {platform: 'github', status: 'ready', updatedAt: new Date(), issueTotal: 2, issueShown: 2, prTotal: 0,
        prShown: 0, boards: [], boardsError: null};
    const gitlab = {platform: 'gitlab', status: 'ready', updatedAt: new Date(), issueTotal: 3, issueShown: 3, prTotal: 1,
        prShown: 1, boards: null, boardsError: null};
    assert.equal(listBadge('issues', {sources: [github, gitlab]}), '5');
    assert.equal(listBadge('prs', {sources: [github, {platform: 'gitlab', status: 'signed-out'}]}), '0');
    assert.equal(listBadge('issues', {sources: [{...github, status: 'signed-out'}, gitlab]}), '3');
    assert.equal(listBadge('boards', {sources: [{...github, status: 'signed-out'}, gitlab]}), '');
    // A second GitHub account still loading its boards.
    assert.equal(listBadge('boards', {sources: [github, {...github, boards: null}]}), '…');
});

test('team lists: your most active projects, then each one\'s open issues and merge requests', () => {
    assert.ok(teamProjectsPath().startsWith('/projects?membership=true&archived=false'));
    assert.deepEqual(parseProjectIds([{id: 4}, {id: 'x'}, null, {id: 9}]), [4, 9]);
    assert.ok(teamListPath(4, 'team-issue').startsWith('/projects/4/issues?state=opened'));
    assert.ok(teamListPath(4, 'team-mr').startsWith('/projects/4/merge_requests?state=opened'));
    assert.throws(() => teamListPath('4/../x', 'team-issue'), TypeError);
    assert.throws(() => teamListPath(4, 'issue'), TypeError);
    const json = [{iid: 2, project_id: 4, title: 'T', references: {full: 'g/p!2'}, state: 'opened'}];
    const [mr] = parseGitLabItems(json, 'team-mr');
    assert.deepEqual([mr.kind, mr.reason], ['pr', 'team']);
    assert.deepEqual(parseGitLabItems(json, 'team-issue').map(item => [item.kind, item.reason]), [['issue', 'team']]);
});
