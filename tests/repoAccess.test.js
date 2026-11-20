import test from 'node:test';
import assert from 'node:assert/strict';

import {addWatched, availableRepos, isWatched, mayHaveMore, parseRepos, reposByOrganization, reposRequest, searchReposRequest, parseSearchRepos, setWatched, toggleWatched} from '../src/lib/repoAccess.js';

test('repositories are read with a plain GET and parsed safely', () => {
    assert.deepEqual(reposRequest(2), {method: 'GET', path: '/user/repos?per_page=100&sort=pushed&page=2'});
    assert.ok(reposRequest(99).path.endsWith('page=3'));
    assert.deepEqual(parseRepos([{full_name: 'octo/app'}, {full_name: '../x'}, null, {}]), ['octo/app']);
    assert.deepEqual(parseRepos({message: 'nope'}), []);
    assert.equal(mayHaveMore(new Array(100).fill({})), true);
    assert.equal(mayHaveMore([{}]), false);
});

test('available repositories are unique ignoring case and sorted', () => {
    assert.deepEqual(availableRepos(['octo/b', 'Octo/A'], ['octo/a', 'x/y', 'bad']), ['Octo/A', 'octo/b', 'x/y']);
});

test('the watch list: empty is all; turning one off lists the rest; all on goes back to empty', () => {
    const all = ['a/one', 'a/two', 'a/three'];
    assert.equal(isWatched([], 'a/one'), true);
    assert.equal(isWatched(['a/two'], 'a/one'), false);
    assert.deepEqual(toggleWatched([], all, 'a/two', false), ['a/one', 'a/three']);
    assert.deepEqual(toggleWatched(['a/one', 'a/three'], all, 'a/two', true), []);
    assert.deepEqual(toggleWatched(['a/one'], all, 'a/two', true), ['a/one', 'a/two']);
    // The last watched one stays on: an empty list would mean everything.
    assert.deepEqual(toggleWatched(['a/one'], all, 'a/one', false), ['a/one']);
    // A watched repository the account no longer lists is kept.
    assert.deepEqual(toggleWatched(['a/one', 'gone/x'], all, 'a/two', true), ['a/one', 'a/two', 'gone/x']);
});

test('adding a repository keeps everything already watched', () => {
    const all = ['a/one', 'a/two'];
    // From "all", a typed public repository joins them instead of replacing them.
    assert.deepEqual(addWatched([], all, ['example/widgets']), ['a/one', 'a/two', 'example/widgets']);
    assert.deepEqual(addWatched(['a/one'], all, ['example/widgets', 'Example/Widgets']), ['a/one', 'example/widgets']);
    assert.deepEqual(addWatched([], all, ['A/One']), []);
    assert.deepEqual(addWatched(['a/one'], all, ['bad name']), ['a/one']);
});

test('an organization can be turned off or on as a whole', () => {
    const all = ['a/one', 'a/two', 'b/x'];
    assert.deepEqual(setWatched([], all, ['a/one', 'a/two'], false), ['b/x']);
    assert.deepEqual(setWatched(['b/x'], all, ['a/one', 'a/two'], true), []);
    assert.deepEqual(setWatched(['b/x'], all, ['b/x'], false), ['b/x']);
    assert.deepEqual(setWatched(['b/x', 'pub/lic'], all, ['a/one'], true), ['a/one', 'b/x', 'pub/lic']);
    assert.deepEqual(reposByOrganization(['b/x', 'A/one', 'a/two']).map(g => [g.organization, g.repos]),
        [['A', ['A/one', 'a/two']], ['b', ['b/x']]]);
});

test('public repositories are searched with a plain GET and the answer is checked', () => {
    assert.deepEqual(searchReposRequest(' widgets framework '), {method: 'GET', path: '/search/repositories?q=widgets%20framework&per_page=8'});
    const found = parseSearchRepos({items: [{full_name: 'example/widgets', description: 'A  widget\nlibrary', stargazers_count: 5},
        {full_name: '../bad'}, null, {full_name: 'a/b', description: 7}]});
    assert.deepEqual(found, [{name: 'example/widgets', description: 'A widget library', stars: 5}, {name: 'a/b', description: '', stars: 0}]);
    assert.deepEqual(parseSearchRepos(null), []);
});
