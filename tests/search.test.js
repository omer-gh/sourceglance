import {test} from 'node:test';
import assert from 'node:assert/strict';

import {itemMatches, searchBoards, searchCount, searchGroups, searchTerms} from '../src/lib/model.js';

const issue = (n, title, extra = {}) => ({kind: 'issue', reason: 'assigned', number: n, title, repo: 'example/web-app',
    labels: [], assignees: ['alex'], boards: [], ...extra});

test('searchTerms splits and lowercases; empty means no search', () => {
    assert.deepEqual(searchTerms('  Login  BUG '), ['login', 'bug']);
    assert.deepEqual(searchTerms(''), []);
    assert.deepEqual(searchTerms(null), []);
});

test('itemMatches checks title, repo, number, labels, people, boards and platform; every word must match', () => {
    const item = issue(42, 'Fix the login redirect', {labels: [{name: 'bug'}], boards: [{title: 'Roadmap', status: 'In progress'}]});
    assert.ok(itemMatches(item, []));
    assert.ok(itemMatches(item, searchTerms('LOGIN')));
    assert.ok(itemMatches(item, searchTerms('#42')));
    assert.ok(itemMatches(item, searchTerms('web-app bug')));
    assert.ok(itemMatches(item, searchTerms('@alex')));
    assert.ok(itemMatches(item, searchTerms('in progress')));
    assert.ok(itemMatches(item, searchTerms('github')));
    assert.ok(!itemMatches(item, searchTerms('login docs')));
    const mr = {...issue(3, 'Retry webhooks'), platform: 'gitlab', kind: 'pr', repo: 'acme/api'};
    assert.ok(itemMatches(mr, searchTerms('!3 gitlab')));
    assert.ok(!itemMatches(mr, searchTerms('#3')));
});

test('searchGroups drops non-matching items and empty groups', () => {
    const groups = [
        {repo: 'example/web-app', issues: [issue(42, 'Fix the login redirect'), issue(37, 'Dark mode')]},
        {repo: 'example/docs', issues: [issue(12, 'Update the guide', {repo: 'example/docs'})]},
    ];
    assert.equal(searchGroups(groups, []), groups);
    const found = searchGroups(groups, searchTerms('dark'));
    assert.deepEqual(found.map(group => [group.repo, group.issues.map(item => item.number)]), [['example/web-app', [37]]]);
});

test('searchBoards and searchCount count matches across lists and platforms', () => {
    const boards = [{title: 'Roadmap', drafts: [{title: 'Write release notes', status: 'Todo'}, {title: 'Plan the beta', status: 'Done'}]}];
    assert.equal(searchBoards(boards, searchTerms('beta'))[0].drafts.length, 1);
    assert.equal(searchBoards(boards, searchTerms('roadmap'))[0].drafts.length, 2);
    const github = {
        platform: 'github', status: 'ready',
        groups: [{repo: 'example/web-app', issues: [issue(42, 'Fix the login redirect'), issue(37, 'Dark mode')]}],
        prGroups: [{repo: 'example/web-app', issues: [issue(45, 'Login health checks', {kind: 'pr'})]}],
        boards,
    };
    const gitlab = {platform: 'gitlab', status: 'ready', boards: null, prGroups: [],
        groups: [{repo: 'acme/api', issues: [issue(7, 'Login rate limit', {platform: 'gitlab', repo: 'acme/api'})]}]};
    const state = {sources: [github, gitlab]};
    const terms = searchTerms('login');
    assert.equal(searchCount('issues', state, terms), 2);
    assert.equal(searchCount('prs', state, terms), 1);
    assert.equal(searchCount('boards', state, terms), 0);
    assert.equal(searchCount('issues', {sources: [github, {...gitlab, status: 'signed-out'}]}, terms), 1);
    assert.equal(searchCount('boards', {sources: [{...github, boards: null}]}, terms), 0);
    assert.equal(searchCount('boards', {sources: [github, {...github, boards}]}, searchTerms('beta')), 2);
});
