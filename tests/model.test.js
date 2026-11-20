import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    DEVICE_VERIFICATION_URL,
    LAUNCHER_ID,
    MAX_COMMENT_LENGTH,
    TOOLBAR_LISTS,
    clampWidgetPosition,
    defaultWidgetPositions,
    cleanCustomWidget,
    largestCardSize,
    scaledCardSize,
    customWidgetItems,
    moveWidget,
    newCustomWidgetId,
    parseCustomWidgets,
    splitFilterList,
    widgetCardRows,
    widgetCardSize,
    widgetGridRows,
    normalizeWidgetLayout,
    widgetOrder,
    normalizeWidgets,
    draftAssigneesRequest,
    draftTarget,
    groupDraftsByStatus,
    gtypeName,
    itemKey,
    normalizeButtons,
    groupByOrganization,
    groupByPlatform,
    normalizeGroupBy,
    organizationOf,
    renameLegacyBoards,
    labelTextColor,
    parseViewerBoards,
    searchPageUrl,
    PROJECT_ITEMS_QUERY,
    classifyGraphqlErrors,
    moveStatusRequest,
    parseProjectItems,
    projectItemsRequest,
    addLabelsRequest,
    appInstallUrl,
    assigneeChangeRequests,
    assigneeChoices,
    assigneesRequest,
    buildSearchPath,
    buildSearchQuery,
    classifyDeviceTokenResponse,
    classifyHttpError,
    closeRequest,
    commentRequest,
    countLabel,
    diffSelection,
    filterByLabel,
    formEncode,
    groupIssues,
    isDoneStatus,
    isSafeGitHubUrl,
    isValidLogin,
    isValidRepo,
    labelChangeRequests,
    labelChoices,
    labelOptions,
    launcherDesktopEntry,
    listBadge,
    mergeItems,
    nextRefreshDelaySeconds,
    parseDeviceCodeResponse,
    parseLabels,
    parseLogins,
    parseRepoList,
    parseSearchResponse,
    parseTeamItems,
    teamItemsPath,
    removeLabelRequest,
    reopenRequest,
    relativeTime,
    repoFromApiUrl,
    truncate,
} from '../src/lib/model.js';

test('isValidRepo accepts owner/name and rejects junk', () => {
    assert.ok(isValidRepo('omer-gh/sourceglance'));
    assert.ok(isValidRepo('GNOME/gnome-shell.git-mirror_1'));
    assert.ok(!isValidRepo('sourceglance'));
    assert.ok(!isValidRepo('a/b/c'));
    assert.ok(!isValidRepo('-bad/name'));
    assert.ok(!isValidRepo('owner/na me'));
    assert.ok(!isValidRepo('owner/name repo:evil/x'));
});

test('parseRepoList splits, dedupes and reports invalid entries', () => {
    assert.deepEqual(parseRepoList(' a/b, c/d  a/b ,bad,, '), {repos: ['a/b', 'c/d'], invalid: ['bad']});
    assert.deepEqual(parseRepoList(''), {repos: [], invalid: []});
});

test('buildSearchQuery adds repo qualifiers and drops invalid repos', () => {
    assert.equal(buildSearchQuery(), 'is:open is:issue assignee:@me archived:false');
    assert.equal(
        buildSearchQuery(['a/b', 'not valid', 'c/d']),
        'is:open is:issue assignee:@me archived:false repo:a/b repo:c/d');
});

test('buildSearchPath encodes the query and sorts by update', () => {
    const path = buildSearchPath(['a/b']);
    assert.ok(path.startsWith('/search/issues?q=is%3Aopen%20is%3Aissue%20assignee%3A%40me'));
    assert.ok(path.includes('repo%3Aa%2Fb'));
    assert.ok(path.endsWith('&sort=updated&order=desc&per_page=25'));
});

test('isSafeGitHubUrl only allows https://github.com links', () => {
    assert.ok(isSafeGitHubUrl('https://github.com/omer-gh/sourceglance/issues/12'));
    assert.ok(isSafeGitHubUrl('https://github.com/issues/assigned'));
    assert.ok(!isSafeGitHubUrl('http://github.com/a/b/issues/1'));
    assert.ok(!isSafeGitHubUrl('https://github.com.evil.example/a'));
    assert.ok(!isSafeGitHubUrl('https://evil.example/https://github.com/'));
    assert.ok(!isSafeGitHubUrl('https://user@github.com/a'));
    assert.ok(!isSafeGitHubUrl('javascript:alert(1)'));
    assert.ok(!isSafeGitHubUrl('file:///etc/passwd'));
    assert.ok(!isSafeGitHubUrl('https://github.com/a b'));
    assert.ok(!isSafeGitHubUrl(null));
});

test('parseSearchResponse drops unsafe issue links', () => {
    const {items} = parseSearchResponse({items: [{number: 1, title: 'x', html_url: 'file:///etc/passwd',
        repository_url: 'https://api.github.com/repos/a/b', updated_at: '2026-11-01T00:00:00Z'}]});
    assert.equal(items[0].url, null);
});

test('buildSearchQuery lists PRs assigned to you or awaiting your review', () => {
    assert.equal(buildSearchQuery([], 'pr-assigned'), 'is:open is:pr assignee:@me archived:false');
    assert.equal(buildSearchQuery(['a/b'], 'pr-review'),
        'is:open is:pr review-requested:@me archived:false repo:a/b');
    assert.ok(buildSearchPath([], 'pr-review').includes('review-requested%3A%40me'));
});

test('repoFromApiUrl extracts owner/name', () => {
    assert.equal(repoFromApiUrl('https://api.github.com/repos/omer-gh/sourceglance'), 'omer-gh/sourceglance');
    assert.equal(repoFromApiUrl(undefined), 'unknown');
});

test('parseSearchResponse maps items and skips pull requests', () => {
    const result = parseSearchResponse({
        total_count: 3,
        items: [
            {number: 1, title: 'One', html_url: 'https://github.com/a/b/issues/1', node_id: 'I_1',
                state: 'open', repository_url: 'https://api.github.com/repos/a/b',
                updated_at: '2026-11-01T00:00:00Z',
                labels: [{name: 'bug', color: 'D73A4A'}, {name: ''}, {color: 'fff'}],
                assignees: [{login: 'omer-gh'}, {login: 'bad login'}, null]},
            {number: 2, title: 'PR', html_url: 'u', repository_url: 'x', updated_at: 'y', pull_request: {}},
        ],
    });
    assert.equal(result.total, 3);
    assert.deepEqual(result.items, [{
        kind: 'issue', reason: 'assigned', number: 1, title: 'One',
        url: 'https://github.com/a/b/issues/1', repo: 'a/b', nodeId: 'I_1', state: 'open',
        labels: [{name: 'bug', color: 'd73a4a'}], assignees: ['omer-gh'], comments: 0,
        updatedAt: '2026-11-01T00:00:00Z',
    }]);
    assert.deepEqual(parseSearchResponse(null), {total: 0, items: []});
});

test('parseSearchResponse keeps only PRs for PR searches, with the reason', () => {
    const json = {items: [
        {number: 1, title: 'Issue', repository_url: 'https://api.github.com/repos/a/b'},
        {number: 7, title: 'PR', repository_url: 'https://api.github.com/repos/a/b', pull_request: {}},
    ]};
    const review = parseSearchResponse(json, 'pr-review').items;
    assert.deepEqual(review.map(i => [i.kind, i.number, i.reason]), [['pr', 7, 'review']]);
    assert.equal(parseSearchResponse(json, 'pr-assigned').items[0].reason, 'assigned');
    assert.equal([...parseSearchResponse({items: [{number: 3, title: 'x'.repeat(500)}]}).items[0].title].length, 300);
});

test('mergeItems dedupes by repo and number, first copy wins', () => {
    const a = {repo: 'a/b', number: 7, reason: 'assigned'};
    const b = {repo: 'a/b', number: 7, reason: 'review'};
    const c = {repo: 'a/b', number: 8, reason: 'review'};
    assert.deepEqual(mergeItems([a], [b, c]), [a, c]);
});

test('close and reopen requests use the issues or pulls endpoint', () => {
    const issue = {kind: 'issue', repo: 'a/b', number: 3};
    const pr = {kind: 'pr', repo: 'a/b', number: 4};
    assert.deepEqual(closeRequest(issue, 'not_planned'),
        {method: 'PATCH', path: '/repos/a/b/issues/3', body: {state: 'closed', state_reason: 'not_planned'}});
    assert.deepEqual(closeRequest(pr), {method: 'PATCH', path: '/repos/a/b/pulls/4', body: {state: 'closed'}});
    assert.deepEqual(reopenRequest(issue),
        {method: 'PATCH', path: '/repos/a/b/issues/3', body: {state: 'open', state_reason: 'reopened'}});
    assert.deepEqual(reopenRequest(pr), {method: 'PATCH', path: '/repos/a/b/pulls/4', body: {state: 'open'}});
    assert.throws(() => closeRequest(issue, 'spam'));
});

test('write requests refuse items that would inject into the URL', () => {
    for (const bad of [
        {repo: '../../user', number: 1},
        {repo: 'unknown', number: 1},
        {repo: 'a/b', number: '1/../../x'},
        {repo: 'a/b', number: 0},
        null,
    ])
        assert.throws(() => closeRequest(bad), TypeError);
});

test('commentRequest trims and rejects empty or oversized comments', () => {
    const item = {kind: 'issue', repo: 'a/b', number: 3};
    assert.deepEqual(commentRequest(item, '  hi  '),
        {method: 'POST', path: '/repos/a/b/issues/3/comments', body: {body: 'hi'}});
    assert.equal(commentRequest(item, '   '), null);
    assert.equal(commentRequest(item, 'x'.repeat(MAX_COMMENT_LENGTH + 1)), null);
});

test('assignee and label requests validate names and encode label paths', () => {
    const item = {kind: 'pr', repo: 'a/b', number: 3};
    assert.deepEqual(assigneesRequest(item, ['omer-gh', 'omer-gh', 'bad login'], true),
        {method: 'POST', path: '/repos/a/b/issues/3/assignees', body: {assignees: ['omer-gh']}});
    assert.equal(assigneesRequest(item, ['omer-gh'], false).method, 'DELETE');
    assert.equal(assigneesRequest(item, ['bad login'], false), null);
    assert.deepEqual(addLabelsRequest(item, ['bug', 'bug', '']),
        {method: 'POST', path: '/repos/a/b/issues/3/labels', body: {labels: ['bug']}});
    assert.equal(removeLabelRequest(item, 'needs/triage ?').path,
        '/repos/a/b/issues/3/labels/needs%2Ftriage%20%3F');
    assert.throws(() => removeLabelRequest(item, ''), TypeError);
});

test('projectItemsRequest dedupes and validates node IDs', () => {
    const request = projectItemsRequest(['I_1', 'I_1', 'PR_2', 'bad id!', null]);
    assert.equal(request.path, '/graphql');
    assert.equal(request.graphql, true);
    assert.deepEqual(request.body.variables, {ids: ['I_1', 'PR_2']});
    assert.equal(request.body.query, PROJECT_ITEMS_QUERY);
    assert.equal(projectItemsRequest([]), null);
});

test('parseProjectItems keeps open boards with a Status field and tolerates gaps', () => {
    const board = (id, extra = {}) => ({
        id: `PVTI_${id}`,
        project: {id: `PVT_${id}`, title: `Board ${id}`, closed: false,
            field: {id: `PVTSSF_${id}`, options: [{id: 'a1', name: 'Todo'}, {id: 'b2', name: 'Done'}]}},
        fieldValueByName: {optionId: 'b2', name: 'Done'},
        ...extra,
    });
    const boards = parseProjectItems({
        data: {nodes: [
            {id: 'I_1', projectItems: {nodes: [
                board('x'),
                board('closed', {project: {...board('c').project, closed: true}}),
                board('nostatus', {project: {id: 'PVT_n', title: 'n', closed: false, field: null}}),
                board('unset', {fieldValueByName: null}),
                null,
            ]}},
            null,
            {id: 'PR_2', projectItems: null},
        ]},
        errors: [{type: 'FORBIDDEN'}],
    });
    assert.deepEqual(boards.get('I_1'), [
        {itemId: 'PVTI_x', projectId: 'PVT_x', title: 'Board x', fieldId: 'PVTSSF_x',
            options: [{id: 'a1', name: 'Todo'}, {id: 'b2', name: 'Done'}], optionId: 'b2', status: 'Done'},
        {itemId: 'PVTI_unset', projectId: 'PVT_unset', title: 'Board unset', fieldId: 'PVTSSF_unset',
            options: [{id: 'a1', name: 'Todo'}, {id: 'b2', name: 'Done'}], optionId: null, status: null},
    ]);
    assert.deepEqual(boards.get('PR_2'), []);
    assert.equal(parseProjectItems(null).size, 0);
});

test('moveStatusRequest only accepts the board\'s own options', () => {
    const board = {itemId: 'PVTI_x', projectId: 'PVT_x', fieldId: 'F_x', options: [{id: 'a1', name: 'Todo'}]};
    assert.deepEqual(moveStatusRequest(board, 'a1').body.variables,
        {project: 'PVT_x', item: 'PVTI_x', field: 'F_x', option: 'a1'});
    assert.throws(() => moveStatusRequest(board, 'zz'), TypeError);
    assert.throws(() => moveStatusRequest({...board, itemId: '"; drop'}, 'a1'), TypeError);
});

test('classifyGraphqlErrors maps GraphQL error types', () => {
    assert.equal(classifyGraphqlErrors([{type: 'FORBIDDEN'}]), 'forbidden');
    assert.equal(classifyGraphqlErrors([{type: 'INSUFFICIENT_SCOPES'}]), 'forbidden');
    assert.equal(classifyGraphqlErrors([{type: 'NOT_FOUND'}]), 'not-found');
    assert.equal(classifyGraphqlErrors([{message: 'x'}]), 'query');
    assert.equal(classifyGraphqlErrors(null), 'query');
});

test('gtypeName is stable per module URL and differs between builds', () => {
    const a = gtypeName('TabBar', 'file:///ext/dev/1/lib/tabs.js');
    assert.equal(a, gtypeName('TabBar', 'file:///ext/dev/1/lib/tabs.js'));
    assert.notEqual(a, gtypeName('TabBar', 'file:///ext/dev/2/lib/tabs.js'));
    assert.match(a, /^Sourceglance_TabBar_[0-9a-f]{8}$/);
});

test('normalizeButtons keeps known lists in toolbar order', () => {
    assert.deepEqual(normalizeButtons(['prs', 'issues', 'prs', 'evil', 'app']), ['issues', 'prs']);
    assert.deepEqual(normalizeButtons([]), []);
    assert.deepEqual(normalizeButtons(null), []);
    assert.deepEqual(normalizeButtons(TOOLBAR_LISTS), ['issues', 'prs', 'boards']);
});

test('closed searches count closed items still assigned to you', () => {
    assert.equal(buildSearchQuery([], 'issue-closed'), 'is:closed is:issue assignee:@me archived:false');
    assert.equal(buildSearchQuery(['a/b'], 'pr-closed'), 'is:closed is:pr assignee:@me archived:false repo:a/b');
    assert.ok(buildSearchPath([], 'issue-closed').endsWith('&per_page=1'));
    assert.ok(buildSearchPath([], 'issue').endsWith('&per_page=25'));
    const url = searchPageUrl('pr-closed');
    assert.ok(url.startsWith('https://github.com/pulls?q=is%3Aclosed%20is%3Apr'));
    assert.ok(isSafeGitHubUrl(url));
    assert.ok(searchPageUrl('issue-closed').startsWith('https://github.com/issues?q='));
});

test('parseViewerBoards keeps open boards and their non-archived drafts only', () => {
    const field = {id: 'F_1', options: [{id: 'o1', name: 'Todo'}, {id: 'o2', name: 'Done'}]};
    const board = (id, extra = {}) => ({
        id, title: `Board ${id}`, url: `https://github.com/users/me/projects/${id.length}`, closed: false, field,
        items: {totalCount: 3, nodes: [
            {id: 'PVTI_d1', type: 'DRAFT_ISSUE', isArchived: false, content: {id: 'DI_1', title: 'Draft one',
                assignees: {nodes: [{id: 'U_1', login: 'me'}, {id: 'U_x', login: '-bad-'}]}},
                fieldValueByName: {optionId: 'o2', name: 'Done'}},
            {id: 'PVTI_d2', type: 'DRAFT_ISSUE', isArchived: true, content: {title: 'Archived'}},
            {id: 'PVTI_i1', type: 'ISSUE', isArchived: false, content: {}},
            {id: 'PVTI_d3', type: 'DRAFT_ISSUE', isArchived: false, content: {title: 'No status'}, fieldValueByName: null},
        ]},
        ...extra,
    });
    const boards = parseViewerBoards({
        data: {viewer: {
            id: 'U_1', login: 'me',
            projectsV2: {nodes: [board('PVT_a'), board('PVT_closed', {closed: true}), null]},
            organizations: {nodes: [{projectsV2: {nodes: [board('PVT_a'), board('PVT_b', {url: 'https://evil.example/x'})]}}, null]},
        }},
        errors: [{type: 'FORBIDDEN'}],
    });
    assert.deepEqual(boards.map(b => b.projectId), ['PVT_a', 'PVT_b']);
    assert.deepEqual(boards[0].drafts, [
        {itemId: 'PVTI_d1', draftId: 'DI_1', title: 'Draft one', assignees: [{id: 'U_1', login: 'me'}],
            optionId: 'o2', status: 'Done'},
        {itemId: 'PVTI_d3', draftId: null, title: 'No status', assignees: [], optionId: null, status: null},
    ]);
    assert.deepEqual(boards[0].viewer, {id: 'U_1', login: 'me'});
    assert.equal(boards[0].truncated, false);
    assert.equal(boards[1].url, null);
    assert.deepEqual(parseViewerBoards(null), []);
    assert.deepEqual(parseViewerBoards({data: {viewer: {}}}), []);
});

test('groupDraftsByStatus follows column order with No status last', () => {
    const board = {
        options: [{id: 'o1', name: 'Todo'}, {id: 'o2', name: 'Doing'}, {id: 'o3', name: 'Done'}],
        drafts: [{itemId: 'a', optionId: 'o3'}, {itemId: 'b', optionId: null}, {itemId: 'c', optionId: 'o1'}],
    };
    assert.deepEqual(groupDraftsByStatus(board).map(g => [g.status, g.drafts.map(d => d.itemId)]),
        [['Todo', ['c']], ['Done', ['a']], [null, ['b']]]);
});

test('draftTarget builds an action target that moveStatusRequest accepts', () => {
    const board = {projectId: 'PVT_a', title: 'Roadmap', fieldId: 'F_1', options: [{id: 'o1', name: 'Todo'}]};
    const {item, board: target} = draftTarget(board, {itemId: 'PVTI_d1', title: 'Draft', optionId: null, status: null});
    assert.equal(item.kind, 'draft');
    assert.equal(itemKey(item), 'project#PVTI_d1');
    assert.equal(moveStatusRequest(target, 'o1').body.variables.item, 'PVTI_d1');
});

test('draftAssigneesRequest sets a draft\'s assignees by node ID', () => {
    const board = {projectId: 'PVT_a', title: 'Roadmap', fieldId: 'F_1', options: [], viewer: {id: 'U_me', login: 'me'}};
    const {item} = draftTarget(board, {itemId: 'PVTI_d1', draftId: 'DI_1', title: 'Draft',
        assignees: [{id: 'U_amy', login: 'amy'}], optionId: null, status: null});
    assert.deepEqual(item.assignees, ['amy']);
    assert.deepEqual(item.people.map(user => user.login), ['me', 'amy']);
    assert.deepEqual(draftAssigneesRequest(item, ['amy', 'me']).body.variables, {draft: 'DI_1', assignees: ['U_amy', 'U_me']});
    assert.deepEqual(draftAssigneesRequest(item, []).body.variables.assignees, []);
    assert.equal(draftAssigneesRequest(item, ['amy']), null);
    assert.throws(() => draftAssigneesRequest({...item, draftId: null}, ['me']), TypeError);
});

test('labelTextColor picks dark text on light labels', () => {
    assert.equal(labelTextColor('ffffff'), '#1f2328');
    assert.equal(labelTextColor('d73a4a'), '#ffffff');
    assert.equal(labelTextColor('a2eeef'), '#1f2328');
    assert.equal(labelTextColor(null), null);
    assert.equal(labelTextColor('fff'), null);
});

test('labelOptions counts each label once per item, sorted by name', () => {
    const item = (...names) => ({labels: names.map(name => ({name, color: null}))});
    const groups = [
        {repo: 'a/b', issues: [item('ui', 'bug'), item('bug', 'bug')]},
        {repo: 'c/d', issues: [item(), item('docs')]},
    ];
    assert.deepEqual(labelOptions(groups),
        [{name: 'bug', count: 2}, {name: 'docs', count: 1}, {name: 'ui', count: 1}]);
    assert.deepEqual(labelOptions([]), []);
});

test('filterByLabel keeps matching items and drops emptied repositories', () => {
    const item = (number, ...names) => ({number, labels: names.map(name => ({name, color: null}))});
    const groups = [
        {repo: 'a/b', issues: [item(1, 'bug'), item(2)]},
        {repo: 'c/d', issues: [item(3, 'docs')]},
    ];
    assert.deepEqual(filterByLabel(groups, 'bug'), [{repo: 'a/b', issues: [item(1, 'bug')]}]);
    assert.equal(filterByLabel(groups, null), groups);
    assert.deepEqual(filterByLabel(groups, 'none'), []);
});

test('diffSelection lists additions and removals', () => {
    assert.deepEqual(diffSelection(['a', 'b'], ['b', 'c']), {add: ['c'], remove: ['a']});
    assert.deepEqual(diffSelection([], []), {add: [], remove: []});
});

test('parseLabels and parseLogins drop malformed entries', () => {
    assert.deepEqual(parseLabels([{name: 'x', color: 'zzzzzz'}, 'bad', {name: 'y', color: 'ABCDEF'}]),
        [{name: 'x', color: null}, {name: 'y', color: 'abcdef'}]);
    assert.deepEqual(parseLabels(null), []);
    assert.deepEqual(parseLogins([{login: 'a-b'}, {login: '-bad'}, {}]), ['a-b']);
    assert.ok(isValidLogin('omer-gh'));
    assert.ok(!isValidLogin('a/b'));
});

test('groupIssues orders issues and repos by most recent update', () => {
    const issue = (repo, number, day) => ({repo, number, title: '', url: '', updatedAt: `2026-11-${day}T00:00:00Z`});
    const groups = groupIssues([issue('a/a', 1, '01'), issue('b/b', 2, '05'), issue('a/a', 3, '03')]);
    assert.deepEqual(groups.map(g => g.repo), ['b/b', 'a/a']);
    assert.deepEqual(groups[1].issues.map(i => i.number), [3, 1]);
    assert.deepEqual(groupIssues([]), []);
});

test('classifyHttpError maps statuses to kinds', () => {
    assert.equal(classifyHttpError(401).kind, 'auth');
    assert.equal(classifyHttpError(403).kind, 'forbidden');
    assert.equal(classifyHttpError(404).kind, 'not-found');
    assert.equal(classifyHttpError(410).kind, 'gone');
    assert.equal(classifyHttpError(422).kind, 'query');
    assert.equal(classifyHttpError(502).kind, 'server');
    assert.equal(classifyHttpError(0).kind, 'network');
    assert.equal(classifyHttpError(418).kind, 'unknown');
});

test('classifyHttpError detects rate limits and computes retry time', () => {
    const now = 1_000_000;
    assert.deepEqual(
        classifyHttpError(403, {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000'}, now),
        {kind: 'rate-limit', status: 403, retryAt: 2_000_000});
    assert.deepEqual(
        classifyHttpError(429, {'retry-after': '30'}, now),
        {kind: 'rate-limit', status: 429, retryAt: now + 30_000});
    assert.equal(classifyHttpError(403, {'x-ratelimit-remaining': '12'}).kind, 'forbidden');
});

test('nextRefreshDelaySeconds uses the interval or the rate-limit reset', () => {
    assert.equal(nextRefreshDelaySeconds(10), 600);
    assert.equal(nextRefreshDelaySeconds(0), 60);
    const now = 0;
    assert.equal(nextRefreshDelaySeconds(10, {kind: 'rate-limit', retryAt: 300_000}, now), 300);
    assert.equal(nextRefreshDelaySeconds(10, {kind: 'rate-limit', retryAt: 5_000}, now), 60);
    assert.equal(nextRefreshDelaySeconds(10, {kind: 'network', retryAt: null}, now), 600);
});

test('relativeTime picks the right unit', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    const ago = s => new Date(now - s * 1000);
    assert.deepEqual(relativeTime(ago(30), now), {unit: 'now', value: 0});
    assert.deepEqual(relativeTime(ago(125), now), {unit: 'minute', value: 2});
    assert.deepEqual(relativeTime(ago(3 * 3600), now), {unit: 'hour', value: 3});
    assert.deepEqual(relativeTime(ago(49 * 3600), now), {unit: 'day', value: 2});
    assert.deepEqual(relativeTime(ago(-10), now), {unit: 'now', value: 0});
});

test('truncate shortens long titles with an ellipsis', () => {
    assert.equal(truncate('short'), 'short');
    assert.equal(truncate('abcdefghij', 5), 'abcd…');
    assert.equal(truncate('abc def', 5), 'abc…');
    assert.equal([...truncate('é'.repeat(60))].length, 48);
});

test('countLabel hides zero and marks truncation', () => {
    assert.equal(countLabel(0, 0), '');
    assert.equal(countLabel(7, 7), '7');
    assert.equal(countLabel(31, 25), '25+');
});

test('appInstallUrl builds the install page only for valid slugs', () => {
    assert.equal(appInstallUrl('sourceglance'), 'https://github.com/apps/sourceglance/installations/new');
    assert.equal(appInstallUrl('git-glance-2'), 'https://github.com/apps/git-glance-2/installations/new');
    assert.equal(appInstallUrl(''), null);
    assert.equal(appInstallUrl(null), null);
    assert.equal(appInstallUrl('../evil'), null);
    assert.equal(appInstallUrl('Bad Slug'), null);
});

test('formEncode builds a form body', () => {
    assert.equal(formEncode({client_id: 'Iv1.abc', scope: 'repo'}), 'client_id=Iv1.abc&scope=repo');
    assert.equal(formEncode({grant_type: 'urn:a b&c'}), 'grant_type=urn%3Aa%20b%26c');
});

test('parseDeviceCodeResponse validates the code and pins the link to github.com', () => {
    const ok = {
        device_code: 'dc123',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 899,
        interval: 5,
    };
    assert.deepEqual(parseDeviceCodeResponse(ok), {
        deviceCode: 'dc123',
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 899,
        interval: 5,
    });
    const evil = parseDeviceCodeResponse({...ok, verification_uri: 'https://evil.example/login'});
    assert.equal(evil.verificationUri, DEVICE_VERIFICATION_URL);
    const defaults = parseDeviceCodeResponse({...ok, expires_in: 'x', interval: -1});
    assert.equal(defaults.expiresIn, 900);
    assert.equal(defaults.interval, 5);
    assert.equal(parseDeviceCodeResponse({error: 'device_flow_disabled'}), null);
    assert.equal(parseDeviceCodeResponse({...ok, user_code: '<b>hi</b>'}), null);
    assert.equal(parseDeviceCodeResponse(null), null);
});

test('classifyDeviceTokenResponse maps every poll outcome', () => {
    assert.deepEqual(classifyDeviceTokenResponse({access_token: 'gho_x', scope: 'repo'}, 5),
        {state: 'done', token: 'gho_x'});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'authorization_pending'}, 5),
        {state: 'pending', interval: 5});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'slow_down', interval: 10}, 5),
        {state: 'slow-down', interval: 10});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'slow_down'}, 5),
        {state: 'slow-down', interval: 10});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'expired_token'}, 5), {state: 'expired'});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'access_denied'}, 5), {state: 'denied'});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'device_flow_disabled'}, 5),
        {state: 'error', error: 'device_flow_disabled'});
    assert.deepEqual(classifyDeviceTokenResponse(null, 5), {state: 'error', error: 'unknown'});
});

test('launcherDesktopEntry runs launcher.js with gjs and quotes the path', () => {
    const entry = launcherDesktopEntry({
        launcherPath: '/home/me/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io/launcher.js',
        iconPath: '/home/me/x/icons/sourceglance-app.svg',
    });
    assert.ok(entry.startsWith('[Desktop Entry]\nType=Application\nName=Source Glance\n'));
    assert.ok(entry.includes('\nExec=gjs -m "/home/me/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io/launcher.js"\n'));
    assert.ok(entry.includes('\nIcon=/home/me/x/icons/sourceglance-app.svg\n'));
    // $, " and \ are escaped for the Exec quoting rules, then backslashes once more for the file.
    const odd = launcherDesktopEntry({launcherPath: '/a $b"c\\d/launcher.js', iconPath: '/i.svg'});
    assert.ok(odd.includes('Exec=gjs -m "/a \\\\$b\\\\"c\\\\\\\\d/launcher.js"'));
    assert.equal(LAUNCHER_ID, 'io.github.omer_gh.sourceglance');
});

test('assignee and label pickers: choices and change requests', () => {
    const item = {kind: 'issue', repo: 'a/b', number: 5, assignees: ['ann'], labels: [{name: 'bug', color: null}]};
    assert.deepEqual(assigneeChoices(item, 'me', ['bob', 'ann']), ['me', 'ann', 'bob']);
    assert.deepEqual(assigneeChoices(item, null, ['bob']), ['ann', 'bob']);
    assert.deepEqual(assigneeChangeRequests(item, ['me']).map(r => [r.method, r.body.assignees]),
        [['POST', ['me']], ['DELETE', ['ann']]]);
    assert.deepEqual(assigneeChangeRequests(item, ['ann']), []);
    assert.deepEqual(labelChoices(item, [{name: 'ui'}, {name: 'bug'}]), ['bug', 'ui']);
    assert.deepEqual(labelChangeRequests(item, ['ui']).map(r => [r.method, r.path]),
        [['POST', '/repos/a/b/issues/5/labels'], ['DELETE', '/repos/a/b/issues/5/labels/bug']]);
});

test('listBadge shows counts once loaded, 0 included', () => {
    const base = {platform: 'github', status: 'ready', updatedAt: new Date(), issueTotal: 0, issueShown: 0, prTotal: 30,
        prShown: 25, boards: [{drafts: [1, 2]}], boardsError: null};
    const one = source => ({sources: [source]});
    assert.equal(listBadge('issues', one(base)), '0');
    assert.equal(listBadge('prs', one(base)), '25+');
    assert.equal(listBadge('boards', one(base)), '2');
    assert.equal(listBadge('boards', one({...base, boards: null})), '…');
    assert.equal(listBadge('boards', one({...base, boards: null, boardsError: 'forbidden'})), '');
    assert.equal(listBadge('issues', one({...base, status: 'signed-out'})), '');
    assert.equal(listBadge('issues', one({...base, updatedAt: null})), '');
    assert.equal(listBadge('issues', {sources: []}), '');
});

test('widget card size follows the screen height', () => {
    assert.deepEqual([600, 720, 940, 1080, 1440, 2160, 2700, 5000].map(widgetCardRows), [3, 3, 3, 4, 5, 8, 10, 10]);
    // 1080: four rows in 1080 - 32 - 48 - 3 × 16; a 1920 screen gives 22% of its width.
    assert.deepEqual(widgetCardSize(1080, 1920), {width: 422, height: 238, rows: 4});
    // Never narrower than 40 characters of a title, nor wider than 80.
    assert.equal(widgetCardSize(768, 1366).width, 120 + 40 * 7);
    assert.equal(widgetCardSize(1440, 5120).width, 120 + 80 * 7);
    assert.equal(widgetCardSize(768, 1366).rows, 3);
});

test('widget sizes', () => {
    const medium = {width: 400, height: 200, rows: 4};
    assert.deepEqual(scaledCardSize(medium, 'medium'), medium);
    assert.deepEqual(scaledCardSize(medium, 'small'), {width: 340, height: 140, rows: 4});
    assert.deepEqual(scaledCardSize(medium, 'large'), {width: 500, height: 280, rows: 4});
    assert.deepEqual(scaledCardSize(medium, 'huge'), medium);
    assert.deepEqual(largestCardSize([{width: 340, height: 140}, {width: 400, height: 280}], medium),
        {width: 400, height: 280});
    assert.deepEqual(largestCardSize([], medium), medium);

    // Smaller cards keep to the arrangement's edge within their cell.
    const area = {x: 0, y: 32, width: 1280, height: 768};
    const cell = {width: 300, height: 200};
    const small = {width: 200, height: 100};
    const right = 1280 - 24 - 300;
    assert.deepEqual(defaultWidgetPositions(area, 2, 'right', cell, [small, cell]),
        [{x: right + 100, y: 56}, {x: right, y: 272}]);
    assert.deepEqual(defaultWidgetPositions(area, 1, 'left', cell, [small]), [{x: 24, y: 56}]);
    const floor = 32 + 768 - 24 - 200;
    assert.deepEqual(defaultWidgetPositions(area, 1, 'bottom', cell, [small]), [{x: 490 + 50, y: floor + 100}]);
});

test('desktop widget ids, default spots and clamping', () => {
    assert.deepEqual(normalizeWidgets(['boards', 'summary', 'x', 'summary']), ['summary', 'boards']);
    assert.deepEqual(normalizeWidgets(null), []);
    const area = {x: 0, y: 32, width: 1280, height: 768};
    const size = {width: 300, height: 200};
    const right = 1280 - 24 - 300;
    const step = 316;
    assert.deepEqual(defaultWidgetPositions(area, 0, 'top-right', size), []);
    // Top right: two across, rows down; 768 - 48 fits three rows of 200.
    assert.deepEqual(defaultWidgetPositions(area, 3, 'top-right', size), [
        {x: right - step, y: 56}, {x: right, y: 56}, {x: right, y: 56 + 216}]);
    // Six fill the screen; the seventh starts a block further left.
    assert.deepEqual(defaultWidgetPositions(area, 7, 'top-right', size).at(-1), {x: right - 2 * step, y: 56});
    // Right and left: columns of three, then another column further in.
    assert.deepEqual(defaultWidgetPositions(area, 4, 'right', size), [
        {x: right, y: 56}, {x: right, y: 272}, {x: right, y: 488}, {x: right - step, y: 56}]);
    assert.deepEqual(defaultWidgetPositions(area, 2, 'left', size), [{x: 24, y: 56}, {x: 24, y: 272}]);
    // Top: centred rows of as many as fit (three in 1280); bottom grows upwards.
    assert.deepEqual(defaultWidgetPositions(area, 5, 'top', size), [
        {x: 174, y: 56}, {x: 174 + step, y: 56}, {x: 174 + 2 * step, y: 56},
        {x: 332, y: 56 + 216}, {x: 332 + step, y: 56 + 216}]);
    const floor = 32 + 768 - 24 - 200;
    assert.deepEqual(defaultWidgetPositions(area, 2, 'bottom', size), [{x: 332, y: floor}, {x: 332 + step, y: floor}]);
    // Without a size, cards are sized from the area's height.
    assert.equal(defaultWidgetPositions(area, 1)[0].x, 1280 - 24 - widgetCardSize(768).width);

    const card = {width: 300, height: 200};
    assert.deepEqual(clampWidgetPosition({x: 5000, y: -40}, area, card), {x: 1280 - 300, y: 32});
    assert.deepEqual(clampWidgetPosition({x: 100.4, y: 300.6}, area, card), {x: 100, y: 301});
});

test('widget grid layout: packing, moving and order', () => {
    const grid = {columns: 3, rows: 2};
    // Saved spots are kept; missing, off-grid or shared ones take the first free spot.
    assert.deepEqual(normalizeWidgetLayout({}, ['summary', 'issues', 'prs', 'boards'], grid),
        {summary: [0, 0], issues: [1, 0], prs: [2, 0], boards: [0, 1]});
    assert.deepEqual(normalizeWidgetLayout({issues: [2, 1], summary: [9, 0], prs: [2, 1]}, ['summary', 'issues', 'prs'], grid),
        {summary: [0, 0], issues: [2, 1], prs: [1, 0]});
    assert.deepEqual(normalizeWidgetLayout(null, [], grid), {});
    // More cards than slots add rows.
    assert.equal(widgetGridRows(7, grid), 3);
    assert.equal(widgetGridRows(2, grid), 2);
    assert.deepEqual(normalizeWidgetLayout({}, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], grid).g, [0, 2]);

    // Dropping on another card swaps them; dropping on free space just moves.
    const two = {summary: [0, 0], issues: [1, 0]};
    assert.deepEqual(moveWidget(two, 'issues', [0, 0], grid), {issues: [0, 0], summary: [1, 0]});
    assert.deepEqual(moveWidget(two, 'issues', [1.6, 0.6], grid), {issues: [2, 1], summary: [0, 0]});
    assert.deepEqual(moveWidget(two, 'summary', [-3, 7], grid), {summary: [0, 1], issues: [1, 0]});

    assert.deepEqual(widgetOrder({prs: [0, 1], issues: [2, 0], summary: [0, 0]}), ['summary', 'issues', 'prs']);
});

test('custom widgets: settings, filters and ids', () => {
    assert.deepEqual(normalizeWidgets(['custom-b', 'issues', 'custom-x'], [{id: 'custom-a'}, {id: 'custom-b'}]),
        ['issues', 'custom-b']);
    const def = {id: 'custom-a1', name: '  Reviews ', icon: 'code', kind: 'prs', relation: 'review',
        repos: ['o/r', 'o/r', 3, ' '], labels: ['ui'], words: 'card'};
    assert.deepEqual(cleanCustomWidget(def), {id: 'custom-a1', name: 'Reviews', icon: 'code', kind: 'prs',
        account: '', relation: 'review', repos: ['o/r'], labels: ['ui'], words: 'card'});
    assert.equal(cleanCustomWidget({...def, id: 'summary'}), null);
    assert.equal(cleanCustomWidget({...def, name: ' '}), null);
    assert.deepEqual(cleanCustomWidget({...def, icon: 'x', kind: 'y', relation: 'z'}),
        {...cleanCustomWidget(def), icon: 'app', kind: 'issues', relation: 'any'});
    assert.deepEqual(parseCustomWidgets([JSON.stringify(def), '{', JSON.stringify(def), '"x"']).map(d => d.id),
        ['custom-a1']);
    assert.equal(newCustomWidgetId(['custom-000000'], (() => {
        const values = [0, 0.5];
        return () => values.shift();
    })()), `custom-${Math.floor(0.5 * 36 ** 6).toString(36)}`);
    assert.deepEqual(splitFilterList(' a/b, c  d,,a/b '), ['a/b', 'c', 'd']);

    const pr = (n, extra) => ({kind: 'pr', number: n, title: `PR ${n}`, repo: 'o/r', labels: [], reason: 'assigned', ...extra});
    const state = {sources: [
        {account: {id: 'gh'}, groups: [{issues: [{kind: 'issue', number: 1, title: 'Bug', repo: 'O/R', labels: [{name: 'UI'}]}]}],
            prGroups: [{issues: [pr(2), pr(3, {reason: 'review', labels: [{name: 'ui'}]}), pr(4, {repo: 'x/y', reason: 'review'})]}],
            boards: [{title: 'Plan', drafts: [{title: 'Write docs', status: 'Todo'}, {title: 'Ship', status: 'Done'}]}]},
        {account: {id: 'gl'}, groups: [], prGroups: [{issues: [pr(5, {reason: 'review'})]}], boards: null},
    ]};
    const ids = list => list.map(item => item.number);
    const clean = extra => cleanCustomWidget({...def, repos: [], labels: [], words: '', ...extra});
    assert.deepEqual(ids(customWidgetItems(clean({relation: 'review'}), state)), [3, 4, 5]);
    assert.deepEqual(ids(customWidgetItems(clean({relation: 'review', account: 'gh', repos: ['o/r']}), state)), [3]);
    assert.deepEqual(ids(customWidgetItems(clean({labels: ['UI']}), state)), [3]);
    assert.deepEqual(ids(customWidgetItems(clean({kind: 'issues', repos: ['o/r'], labels: ['ui']}), state)), [1]);
    assert.deepEqual(ids(customWidgetItems(clean({words: 'pr 4'}), state)), [4]);
    assert.deepEqual(customWidgetItems(clean({kind: 'boards', words: 'todo'}), state).map(({draft}) => draft.title),
        ['Write docs']);
    assert.deepEqual(customWidgetItems(clean({}), null), []);
});

test('isDoneStatus recognises finished board columns', () => {
    for (const name of ['Done', 'done', ' Closed ', 'Complete', 'COMPLETED'])
        assert.ok(isDoneStatus(name), name);
    for (const name of ['Todo', 'In progress', 'Not done', null, undefined])
        assert.ok(!isDoneStatus(name), String(name));
});

test('parseTeamItems splits the team\'s open items into issues and PRs, skipping archived repos', () => {
    assert.ok(teamItemsPath().startsWith('/issues?filter=all&state=open&sort=updated'));
    const repo = name => ({repository_url: `https://api.github.com/repos/${name}`, repository: {archived: false}});
    const json = [
        {number: 10, title: 'Unassigned', html_url: 'https://github.com/a/b/issues/10', ...repo('a/b'), assignees: []},
        {number: 11, title: 'PR', html_url: 'https://github.com/a/b/pull/11', ...repo('a/b'), pull_request: {}},
        {number: 12, title: 'Old', ...repo('a/old'), repository: {archived: true}},
        {number: 13, title: 'Elsewhere', html_url: 'https://github.com/c/d/issues/13', ...repo('c/d'), assignees: [{login: 'zed'}]},
        {title: 'no number', ...repo('a/b')},
    ];
    const all = parseTeamItems(json);
    assert.deepEqual(all.issues.map(item => [item.number, item.kind, item.reason, item.assignees]),
        [[10, 'issue', 'team', []], [13, 'issue', 'team', ['zed']]]);
    assert.deepEqual(all.prs.map(item => [item.number, item.kind, item.reason]), [[11, 'pr', 'team']]);
    // The repository filter keeps only its repositories.
    assert.deepEqual(parseTeamItems(json, ['c/d']).issues.map(item => item.number), [13]);
    assert.deepEqual(parseTeamItems(null), {issues: [], prs: []});
});

test('renameLegacyBoards maps saved Projects ids to Project Boards', () => {
    assert.equal(renameLegacyBoards('projects'), 'boards');
    assert.equal(renameLegacyBoards('projects:github:PVT_a'), 'boards:github:PVT_a');
    assert.equal(renameLegacyBoards('issues:github:o/r'), 'issues:github:o/r');
    assert.equal(renameLegacyBoards(7), 7);
    assert.deepEqual(normalizeButtons(['projects', 'issues']), ['issues', 'boards']);
    assert.equal(cleanCustomWidget({id: 'custom-a', name: 'x', kind: 'projects', icon: 'projects'}).kind, 'boards');
});

test('group by: organization, platform and the saved value', () => {
    assert.equal(normalizeGroupBy('organization'), 'organization');
    assert.equal(normalizeGroupBy('owner'), 'organization');
    assert.equal(normalizeGroupBy('nope'), 'project');
    assert.equal(organizationOf('octo/app'), 'octo');
    assert.equal(organizationOf('g/sub/p'), 'g');
    const groups = [{repo: 'octo/app', issues: [1, 2]}, {repo: 'acme/site', issues: [3]}, {repo: 'octo/api', issues: [4]}];
    const sources = [{platform: 'github', account: {id: 'a'}, groups},
        {platform: 'gitlab', account: {id: 'b'}, groups: [{repo: 'g/p', issues: [5]}]},
        {platform: 'github', account: {id: 'c'}, groups: [{repo: 'x/y', issues: [6]}]}];
    assert.deepEqual(groupByPlatform(sources, src => src.groups).map(p => [p.title, p.issues]),
        [['GitHub', [1, 2, 3, 4, 6]], ['GitLab', [5]]]);
    // g and x are the same person under one friendly name, so they share a group.
    const labelOf = (account, org) => ({key: ['g', 'x'].includes(org) ? 'me' : org, title: org});
    assert.deepEqual(groupByOrganization(sources, src => src.groups, labelOf).map(o => [o.id, o.issues]),
        [['octo', [1, 2, 4]], ['acme', [3]], ['me', [5, 6]]]);
});
