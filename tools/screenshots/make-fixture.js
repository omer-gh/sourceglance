// Builds the made-up data the screenshots use: tests/fixtures/screenshots/lists.json (the lists the
// window shows) and settings.ini (the saved settings). Nothing here is real: names, repositories,
// people and items are invented. Run: node tools/screenshots/make-fixture.js
import {mkdirSync, writeFileSync} from 'node:fs';
import {parseSearchResponse} from '../../src/lib/model.js';
import {sourceFrom, aggregateStatus} from '../../src/lib/accounts.js';

const OUT = 'tests/fixtures/screenshots';
mkdirSync(OUT, {recursive: true});

const now = Date.now();
const ago = minutes => new Date(now - minutes * 60_000).toISOString();
const label = (name, color) => ({name, color});

const gh = {id: 'github:github.com:jane-doe', platform: 'github', base: 'https://github.com', login: 'jane-doe', method: 'pat', clientId: null};
const gl = {id: 'gitlab:gitlab.com:jane-doe', platform: 'gitlab', base: 'https://gitlab.com', login: 'jane-doe', method: 'pat', clientId: null};

const apiItem = (repo, number, title, minutes, labels = [], {pr = false, comments = 0, assignees = ['jane-doe']} = {}) => ({
    number, title, state: 'open', comments, updated_at: ago(minutes),
    html_url: `https://github.com/${repo}/${pr ? 'pull' : 'issues'}/${number}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    node_id: `FAKE_${repo.replace('/', '_')}_${number}`,
    labels, assignees: assignees.map(login => ({login})),
    ...(pr ? {pull_request: {}} : {}),
});

const issues = parseSearchResponse({items: [
    apiItem('acme-labs/web', 412, 'Checkout button is unresponsive on the order summary page', 14, [label('bug', 'd73a4a'), label('checkout', '0e8a16')], {comments: 3}),
    apiItem('acme-labs/web', 405, 'Add dark mode to the account settings screen', 95, [label('enhancement', 'a2eeef')]),
    apiItem('acme-labs/api', 188, 'Rate limit headers are missing on the search endpoint', 160, [label('bug', 'd73a4a'), label('api', '5319e7')], {comments: 1}),
    apiItem('acme-labs/api', 181, 'Document the pagination parameters', 420, [label('docs', '0075ca')]),
    apiItem('acme-labs/docs', 57, 'Getting started guide skips the install step', 640, [label('docs', '0075ca')]),
    apiItem('jane-doe/notes', 12, 'Sync notes between devices', 1500, [label('idea', 'fbca04')]),
]}, 'issue').items;
const prs = parseSearchResponse({items: [
    apiItem('acme-labs/web', 419, 'Fix focus ring on the checkout form', 40, [label('accessibility', '1d76db')], {pr: true, comments: 2}),
    apiItem('acme-labs/api', 190, 'Return a retry-after header when throttled', 210, [label('api', '5319e7')], {pr: true}),
    apiItem('acme-labs/mobile', 73, 'Update the onboarding illustrations', 900, [], {pr: true, assignees: []}),
]}, 'pr-assigned').items;

const glIssues = [
    {kind: 'issue', reason: 'assigned', platform: 'gitlab', number: 31, title: 'Rotate the staging certificates before they expire', repo: 'acme-labs/infra',
        url: 'https://gitlab.com/acme-labs/infra/-/issues/31', nodeId: null, state: 'open', labels: [label('ops', 'c5def5')], assignees: ['jane-doe'], comments: 0, updatedAt: ago(75)},
    {kind: 'issue', reason: 'assigned', platform: 'gitlab', number: 28, title: 'Alert noise from the nightly backup job', repo: 'acme-labs/infra',
        url: 'https://gitlab.com/acme-labs/infra/-/issues/28', nodeId: null, state: 'open', labels: [label('ops', 'c5def5')], assignees: ['jane-doe'], comments: 4, updatedAt: ago(700)},
];
const glPrs = [
    {kind: 'pr', reason: 'review', platform: 'gitlab', number: 9, title: 'Move the cache settings into one file', repo: 'acme-labs/infra',
        url: 'https://gitlab.com/acme-labs/infra/-/merge_requests/9', nodeId: null, state: 'open', labels: [], assignees: [], comments: 1, updatedAt: ago(300)},
];

const boards = [{
    projectId: 'FAKE_PVT_1', title: 'Roadmap', url: 'https://github.com/orgs/acme-labs/projects/3', closed: false,
    fieldId: 'FAKE_F1', options: [{id: 'a', name: 'Todo'}, {id: 'b', name: 'In progress'}, {id: 'c', name: 'Done'}], viewer: {id: 'U_1', login: 'jane-doe'},
    truncated: false,
    drafts: [
        {itemId: 'FAKE_D1', draftId: 'FAKE_DI1', title: 'Plan the spring release', status: 'In progress', assignees: [{login: 'jane-doe'}], optionId: 'b'},
        {itemId: 'FAKE_D2', draftId: 'FAKE_DI2', title: 'Collect feedback on the new navigation', status: 'Todo', assignees: [{login: 'jane-doe'}], optionId: 'a'},
        {itemId: 'FAKE_D3', draftId: 'FAKE_DI3', title: 'Write the migration notes', status: 'Done', assignees: [{login: 'jane-doe'}], optionId: 'c'},
    ],
}];

const withAccount = (items, account) => items.map(item => ({...item, accountId: account.id}));
const github = sourceFrom(gh, {status: 'ready', updatedAt: ago(1), login: 'jane-doe', issues: withAccount(issues, gh), prs: withAccount(prs, gh),
    issueTotal: issues.length, prTotal: prs.length, closedCounts: {issues: 3, prs: 5}, boards});
const gitlab = sourceFrom(gl, {status: 'ready', updatedAt: ago(1), login: 'jane-doe', issues: withAccount(glIssues, gl), prs: withAccount(glPrs, gl),
    issueTotal: glIssues.length, prTotal: glPrs.length, closedCounts: {issues: 1, prs: 2}});
const sources = [github, gitlab];

writeFileSync(`${OUT}/lists.json`, JSON.stringify({status: aggregateStatus(sources), sources, error: null, busy: [], refreshing: false,
    intervalMinutes: 10, recentlyClosed: []}, null, 1) + '\n');

const accounts = [gh, gl].map(a => JSON.stringify(a).replace(/'/g, "\\'"));
writeFileSync(`${OUT}/settings.ini`, `[org/gnome/shell/extensions/sourceglance]
accounts=[${accounts.map(a => `'${a}'`).join(', ')}]
group-by='project'
organization-names={'acme-labs': 'Acme Labs', 'jane-doe': 'Jane Doe'}
project-repos={'acme-labs/web': 'Storefront', 'acme-labs/api': 'Storefront', 'acme-labs/docs': 'Acme Docs', 'acme-labs/mobile': 'Acme Docs'}
sidebar-narrow=false
`);
console.log(`fixture written to ${OUT}`);
