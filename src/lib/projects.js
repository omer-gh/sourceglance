// Projects you define (Settings → Projects): a project is a friendly name with the repositories
// that belong to it. A repository with no project of its own is a project named after itself.
// Projects that come from the platforms (a GitHub Project board, and other platforms later) are
// kept even with no repository; one made from repositories goes when its last repository
// leaves. Names are unique ignoring case. Pure: no gi:// imports, so Node tests it.
import {cappedString, organizationOf} from './model.js';

const MAX_PROJECT_NAME = 60;
const REPO_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;

/** A project name as kept: plain text, one line, capped; '' if nothing is left. */
export function cleanProjectName(name) {
    // eslint-disable-next-line no-control-regex
    return cappedString((typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), MAX_PROJECT_NAME);
}

/** What makes two project names the same. */
export function projectKey(name) {
    return cleanProjectName(name).toLowerCase();
}

/** The key a repository ("owner/name", or "group/sub/name") is stored by; '' if it isn't one. */
export function repoKey(repo) {
    return typeof repo === 'string' && REPO_RE.test(repo) && !repo.split('/').some(part => /^\.+$/.test(part))
        ? repo.toLowerCase() : '';
}

/** The `project-repos` setting as saved text → {repo key: project name}, checked, one name per project. */
export function normalizeRepoMap(map) {
    const names = new Map();
    const clean = {};
    for (const [repo, name] of Object.entries(map && typeof map === 'object' ? map : {})) {
        const key = repoKey(repo);
        const project = cleanProjectName(name);
        if (!key || !project)
            continue;
        // The first spelling of a name wins, so "Web" and "web" are one project.
        clean[key] = names.get(projectKey(project)) ?? project;
        names.set(projectKey(project), clean[key]);
    }
    return clean;
}

/** The `project-boards` setting → unique, clean names of projects that came from a platform. */
export function normalizeBoardNames(list) {
    const seen = new Map();
    for (const name of Array.isArray(list) ? list : []) {
        const clean = cleanProjectName(name);
        if (clean && !seen.has(projectKey(clean)))
            seen.set(projectKey(clean), clean);
    }
    return [...seen.values()];
}

/** The project `repo` belongs to: the one you gave it, or the repository itself. */
export function projectNameOf(repo, repoMap) {
    return repoMap[repoKey(repo)] ?? repo;
}

/** `groups` ([{repo, issues}], by repository) regrouped by project name, first appearance first. */
export function groupByProjectNames(groups, repoMap) {
    const projects = new Map();
    for (const group of groups) {
        const name = projectNameOf(group.repo, repoMap);
        const key = projectKey(name);
        if (!projects.has(key))
            projects.set(key, {repo: name, issues: []});
        projects.get(key).issues.push(...group.issues);
    }
    return [...projects.values()];
}

/**
 * The projects to show: [{name, kind: 'repo' | 'board', repos}], by name. `repos` are the
 * repositories seen on your items (any case); `repoMap` and `boardNames` are the saved ones.
 * Repositories with no project become projects of their own; board names always show.
 */
export function buildProjects({repos, repoMap, boardNames}) {
    const projects = new Map();
    const ensure = (name, kind) => {
        const key = projectKey(name);
        if (!projects.has(key))
            projects.set(key, {name, kind, repos: []});
        else if (kind === 'board')
            projects.get(key).kind = 'board';
        return projects.get(key);
    };
    for (const name of boardNames)
        ensure(name, 'board');
    const shown = new Map();
    for (const repo of repos) {
        if (repoKey(repo) && !shown.has(repoKey(repo)))
            shown.set(repoKey(repo), repo);
    }
    for (const key of Object.keys(repoMap))
        shown.set(key, shown.get(key) ?? key);
    for (const [key, repo] of shown) {
        const project = ensure(repoMap[key] ?? repo, 'repo');
        project.repos.push(repo);
    }
    return [...projects.values()]
        .map(project => ({...project, repos: project.repos.sort((a, b) => a.localeCompare(b))}))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What to save from edited `projects` ([{name, kind, repos}]): {repoMap, boardNames, removed}.
 * Projects are merged by name; one made from repositories with none left is dropped (listed in
 * `removed`); a repository alone in the project named after it needs no entry; board projects stay.
 */
export function savedProjects(projects) {
    const merged = new Map();
    for (const project of projects) {
        const name = cleanProjectName(project.name);
        if (!name)
            continue;
        const key = projectKey(name);
        if (!merged.has(key))
            merged.set(key, {name, kind: project.kind, repos: []});
        const entry = merged.get(key);
        if (project.kind === 'board')
            entry.kind = 'board';
        entry.repos.push(...project.repos.filter(repo => repoKey(repo)));
    }
    const repoMap = {};
    const boardNames = [];
    const removed = [];
    for (const {name, kind, repos} of merged.values()) {
        if (kind === 'board')
            boardNames.push(name);
        else if (repos.length === 0)
            removed.push(name);
        for (const repo of repos) {
            // One project per repository: a repository named after itself needs no entry.
            if (projectKey(name) !== repoKey(repo))
                repoMap[repoKey(repo)] = name;
        }
    }
    return {repoMap, boardNames, removed};
}

/**
 * The lists of all `sources` grouped by project name, merged across accounts (the same project
 * on GitHub and GitLab is one): [{id, title, issues}], first appearance first.
 */
export function groupByProject(sources, groupsOf, repoMap) {
    const projects = new Map();
    for (const source of sources) {
        for (const group of groupByProjectNames(groupsOf(source) ?? [], repoMap)) {
            const key = projectKey(group.repo);
            if (!projects.has(key))
                projects.set(key, {id: key, title: group.repo, issues: []});
            projects.get(key).issues.push(...group.issues);
        }
    }
    return [...projects.values()];
}

// Git submodules: a repository that is a submodule of another joins that repository's project,
// unless you put it somewhere yourself.

const SUBMODULE_URL_RE = /^\s*url\s*=\s*(.+?)\s*$/;

/** The urls in the text of a .gitmodules file. */
export function parseGitmodules(text) {
    return String(text ?? '').split('\n').map(line => SUBMODULE_URL_RE.exec(line)?.[1]).filter(Boolean).slice(0, 100);
}

/**
 * The repositories ("owner/name") the submodule `urls` of `parentRepo` point to, on `host`
 * (e.g. github.com). Urls on other hosts are left out; "../name" is in the parent's namespace.
 */
export function submoduleRepos(urls, parentRepo, host) {
    const namespace = parentRepo.includes('/') ? parentRepo.slice(0, parentRepo.lastIndexOf('/')) : '';
    const repos = [];
    for (const raw of urls) {
        const url = raw.replace(/\/+$/, '').replace(/\.git$/, '');
        let path = null;
        const absolute = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)([^/:]+)[/:](.+)$/.exec(url);
        if (absolute) {
            if (absolute[1].toLowerCase() === String(host).toLowerCase())
                path = absolute[2].replace(/^\d+\//, '');
        } else if (url.startsWith('../') && !url.slice(3).includes('..')) {
            path = url.slice(3).includes('/') ? url.slice(3) : `${namespace}/${url.slice(3)}`;
        }
        if (path && repoKey(path) && repoKey(path) !== repoKey(parentRepo))
            repos.push(path);
    }
    return [...new Set(repos)];
}

/** The read-only request for a repository's .gitmodules (the answer carries base64 `content`). */
export function gitmodulesRequest(platform, repo) {
    if (!repoKey(repo))
        return null;
    return platform === 'gitlab'
        ? {method: 'GET', path: `/projects/${encodeURIComponent(repo)}/repository/files/.gitmodules?ref=HEAD`}
        : {method: 'GET', path: `/repos/${repo}/contents/.gitmodules`};
}

/**
 * `repoMap` plus the projects submodules join: {repo key: project name}. `links` is {submodule
 * key: parent repo}. A repository you placed yourself stays where you put it. A chain of
 * submodules ends at the first repository that isn't one.
 */
export function withSubmodules(repoMap, links) {
    const effective = {...repoMap};
    const nameOf = (repo, depth) => {
        const key = repoKey(repo);
        if (repoMap[key])
            return repoMap[key];
        const parent = links[key];
        return parent && depth < 10 ? nameOf(parent, depth + 1) : repo;
    };
    for (const key of Object.keys(links)) {
        if (!repoMap[key])
            effective[key] = nameOf(links[key], 1);
    }
    return effective;
}

/** `repoMap` without the entries a submodule would get anyway, so they stay automatic. */
export function dropAutomatic(repoMap, links) {
    const kept = {};
    for (const [key, name] of Object.entries(repoMap)) {
        const others = {...repoMap};
        delete others[key];
        const automatic = links[key] ? withSubmodules(others, links)[key] : null;
        if (!automatic || projectKey(automatic) !== projectKey(name))
            kept[key] = name;
    }
    return kept;
}

/** What a project board is remembered by when you hide it: its address (plain text), else its title. */
export function boardKey(board) {
    return typeof board?.url === 'string' && board.url ? board.url : cleanProjectName(board?.title);
}

/** Who owns a GitHub project board: the organization or user in its address, '' if it doesn't say. */
export function boardOwner(board) {
    const match = /^https:\/\/[^/]+\/(?:orgs|users)\/([^/]+)\/projects\//.exec(typeof board?.url === 'string' ? board.url : '');
    return match ? match[1] : '';
}

/** The hidden-boards list after hiding or showing every board in `keys`. */
export function setHiddenBoards(hidden, keys, hide) {
    const without = hidden.filter(key => !keys.includes(key));
    return hide ? [...without, ...keys] : without;
}

/**
 * The organization a project sits under: the one most of its repositories belong to (the first by
 * name on a tie), as its login; '' for a project with no repository.
 */
export function dominantOrganization(project) {
    const counts = new Map();
    for (const repo of project.repos ?? []) {
        const organization = organizationOf(repo);
        const key = organization.toLowerCase();
        counts.set(key, {organization: counts.get(key)?.organization ?? organization, count: (counts.get(key)?.count ?? 0) + 1});
    }
    const best = [...counts.values()].sort((a, b) => b.count - a.count || a.organization.localeCompare(b.organization))[0];
    return best?.organization ?? '';
}
