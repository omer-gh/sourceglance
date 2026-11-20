import test from 'node:test';
import assert from 'node:assert/strict';

import {
    boardKey,
    dominantOrganization,
    boardOwner,
    setHiddenBoards,
    buildProjects,
    dropAutomatic,
    gitmodulesRequest,
    parseGitmodules,
    submoduleRepos,
    withSubmodules,
    groupByProject,
    groupByProjectNames,
    normalizeBoardNames,
    normalizeRepoMap,
    projectNameOf,
    savedProjects,
} from '../src/lib/projects.js';

test('saved maps are checked and names are unique ignoring case', () => {
    assert.deepEqual(normalizeRepoMap({'Octo/App': 'Web', 'octo/site': ' web ', 'bad repo': 'X', 'a/b': ''}),
        {'octo/app': 'Web', 'octo/site': 'Web'});
    assert.deepEqual(normalizeRepoMap(null), {});
    assert.deepEqual(normalizeBoardNames(['Roadmap', 'roadmap', '', 7]), ['Roadmap']);
});

test('a repository without a project is a project named after itself', () => {
    assert.equal(projectNameOf('octo/app', {}), 'octo/app');
    assert.equal(projectNameOf('Octo/App', {'octo/app': 'Web'}), 'Web');
    const groups = [{repo: 'octo/app', issues: [1]}, {repo: 'octo/api', issues: [2]}, {repo: 'acme/x', issues: [3]}];
    assert.deepEqual(groupByProjectNames(groups, {'octo/app': 'Web', 'octo/api': 'web'}),
        [{repo: 'Web', issues: [1, 2]}, {repo: 'acme/x', issues: [3]}]);
});

test('buildProjects lists repositories as projects, joins mapped ones, and keeps board projects', () => {
    const projects = buildProjects({repos: ['octo/app', 'octo/api', 'acme/x'], repoMap: {'octo/app': 'Web', 'octo/api': 'Web'},
        boardNames: ['Roadmap']});
    assert.deepEqual(projects.map(p => [p.name, p.kind, p.repos]),
        [['acme/x', 'repo', ['acme/x']], ['Roadmap', 'board', []], ['Web', 'repo', ['octo/api', 'octo/app']]]);
});

test('savedProjects drops empty repository projects, keeps board ones, and has no duplicates', () => {
    const saved = savedProjects([
        {name: 'Web', kind: 'repo', repos: ['octo/app']},
        {name: 'web', kind: 'repo', repos: ['octo/api']},
        {name: 'Empty', kind: 'repo', repos: []},
        {name: 'Roadmap', kind: 'board', repos: []},
        {name: 'acme/x', kind: 'repo', repos: ['acme/x']},
    ]);
    assert.deepEqual(saved.repoMap, {'octo/app': 'Web', 'octo/api': 'Web'});
    assert.deepEqual(saved.boardNames, ['Roadmap']);
    assert.deepEqual(saved.removed, ['Empty']);
});

test('groupByProject merges the same project across accounts', () => {
    const sources = [{groups: [{repo: 'octo/app', issues: [1]}, {repo: 'octo/api', issues: [2]}]},
        {groups: [{repo: 'g/web', issues: [3]}, {repo: 'g/other', issues: [4]}]}];
    const map = {'octo/app': 'Web', 'g/web': 'web'};
    assert.deepEqual(groupByProject(sources, src => src.groups, map).map(p => [p.title, p.issues]),
        [['Web', [1, 3]], ['octo/api', [2]], ['g/other', [4]]]);
});

test('.gitmodules urls become repositories on the same host only', () => {
    const text = '[submodule "a"]\n\tpath = a\n\turl = https://github.com/octo/lib.git\n[submodule "b"]\n\turl = git@github.com:octo/tools.git\n'
        + '[submodule "c"]\n\turl = ../sibling.git\n[submodule "d"]\n\turl = https://gitlab.com/g/x.git\n[submodule "e"]\n\turl = ../../..\n';
    assert.equal(parseGitmodules(text).length, 5);
    assert.deepEqual(submoduleRepos(parseGitmodules(text), 'octo/app', 'github.com'), ['octo/lib', 'octo/tools', 'octo/sibling']);
    assert.deepEqual(submoduleRepos(['https://github.com/octo/app.git'], 'octo/app', 'github.com'), []);
    assert.deepEqual(gitmodulesRequest('github', 'octo/app'), {method: 'GET', path: '/repos/octo/app/contents/.gitmodules'});
    assert.equal(gitmodulesRequest('gitlab', 'g/sub/p').path, '/projects/g%2Fsub%2Fp/repository/files/.gitmodules?ref=HEAD');
    assert.equal(gitmodulesRequest('github', '../x'), null);
});

test('submodules join their parent\'s project unless you placed them, and stay automatic when saved', () => {
    const links = {'octo/lib': 'octo/app', 'octo/deep': 'octo/lib'};
    assert.deepEqual(withSubmodules({}, links), {'octo/lib': 'octo/app', 'octo/deep': 'octo/app'});
    assert.deepEqual(withSubmodules({'octo/app': 'Web'}, links), {'octo/app': 'Web', 'octo/lib': 'Web', 'octo/deep': 'Web'});
    assert.deepEqual(withSubmodules({'octo/lib': 'Other'}, links), {'octo/lib': 'Other', 'octo/deep': 'Other'});
    assert.deepEqual(withSubmodules({}, {'a/x': 'a/y', 'a/y': 'a/x'})['a/x'] !== undefined, true);
    assert.deepEqual(dropAutomatic({'octo/app': 'Web', 'octo/lib': 'Web'}, links), {'octo/app': 'Web'});
    assert.deepEqual(dropAutomatic({'octo/app': 'Web', 'octo/lib': 'Other'}, links), {'octo/app': 'Web', 'octo/lib': 'Other'});
});

test('boardKey remembers a board by its address, else its title', () => {
    assert.equal(boardKey({url: 'https://github.com/users/me/projects/1', title: 'Roadmap'}), 'https://github.com/users/me/projects/1');
    assert.equal(boardKey({url: null, title: '  Road   map '}), 'Road map');
});

test('boards belong to the organization or user in their address; hiding them as a set', () => {
    assert.equal(boardOwner({url: 'https://github.com/orgs/acme/projects/3'}), 'acme');
    assert.equal(boardOwner({url: 'https://github.com/users/me/projects/1'}), 'me');
    assert.equal(boardOwner({url: null}), '');
    assert.deepEqual(setHiddenBoards(['x'], ['a', 'b'], true), ['x', 'a', 'b']);
    assert.deepEqual(setHiddenBoards(['x', 'a'], ['a', 'b'], false), ['x']);
});

test('a project sits under the organization most of its repositories belong to', () => {
    assert.equal(dominantOrganization({repos: ['Octo/app', 'octo/api', 'acme/x']}), 'Octo');
    assert.equal(dominantOrganization({repos: ['b/x', 'a/y']}), 'a');
    assert.equal(dominantOrganization({repos: []}), '');
});
