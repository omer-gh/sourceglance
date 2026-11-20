// Which repositories an account can see, and which of them the github.com lists watch (the
// `repositories` setting: empty means all of them). Read-only requests; pure, so Node tests it.
import {isValidRepo, organizationOf} from './model.js';

const PAGE_SIZE = 100;
export const MAX_PAGES = 3;

/** The read-only request for one page of the repositories the account's sign-in can see. */
export function reposRequest(page = 1) {
    return {method: 'GET', path: `/user/repos?per_page=${PAGE_SIZE}&sort=pushed&page=${Math.max(1, Math.min(page, MAX_PAGES))}`};
}

/** [owner/name] from one page of the response; nothing for anything else. */
export function parseRepos(json) {
    return (Array.isArray(json) ? json : []).map(entry => entry?.full_name).filter(name => isValidRepo(name));
}

/** Whether a page was full, so there may be another. */
export function mayHaveMore(json) {
    return Array.isArray(json) && json.length >= PAGE_SIZE;
}

/** Every repository in `repos` and `seen` once (ignoring case), sorted by name. */
export function availableRepos(repos, seen = []) {
    const found = new Map();
    for (const repo of [...repos, ...seen]) {
        if (isValidRepo(repo) && !found.has(repo.toLowerCase()))
            found.set(repo.toLowerCase(), repo);
    }
    return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The watch list after turning `repos` on or off together. Empty means everything, so from there
 * turning some off lists all the others; listing everything goes back to empty; and the last ones
 * can't be turned off (an empty list would mean all). Repositories on the list that `all` doesn't
 * know (a public one you added) are kept.
 */
export function setWatched(watched, all, repos, on) {
    const changing = new Set(repos.map(name => name.toLowerCase()));
    const lower = new Set((watched.length ? watched : all).map(name => name.toLowerCase()));
    for (const name of changing) {
        if (on)
            lower.add(name);
        else
            lower.delete(name);
    }
    if (lower.size === 0)
        return watched;
    if (all.every(name => lower.has(name.toLowerCase())))
        return [];
    const known = new Set(all.map(name => name.toLowerCase()));
    return all.filter(name => lower.has(name.toLowerCase()))
        .concat(watched.filter(name => !known.has(name.toLowerCase()) && lower.has(name.toLowerCase())));
}

/** The watch list after turning one repository on or off (see setWatched). */
export function toggleWatched(watched, all, repo, on) {
    return setWatched(watched, all, [repo], on);
}

/** `repos` grouped by their organization (ignoring case): [{organization, repos}], by name. */
export function reposByOrganization(repos) {
    const groups = new Map();
    for (const repo of repos) {
        const organization = organizationOf(repo);
        const key = organization.toLowerCase();
        if (!groups.has(key))
            groups.set(key, {organization, repos: []});
        groups.get(key).repos.push(repo);
    }
    return [...groups.values()].sort((a, b) => a.organization.localeCompare(b.organization));
}

/** Whether `repo` is watched: listed, or the list is empty. */
export function isWatched(watched, repo) {
    return watched.length === 0 || watched.some(name => name.toLowerCase() === repo.toLowerCase());
}

/**
 * The watch list after adding `names` (typed owner/name entries). Everything already watched
 * stays watched: from the empty list (all) that is every available repository plus the new ones.
 */
export function addWatched(watched, all, names) {
    const base = watched.length ? watched : all;
    const seen = new Set(base.map(name => name.toLowerCase()));
    const added = names.filter(name => isValidRepo(name) && !seen.has(name.toLowerCase()));
    const list = [...base, ...added.filter((name, i) => added.findIndex(other => other.toLowerCase() === name.toLowerCase()) === i)];
    // Only what's already watched, or all of them: nothing to change.
    return added.length === 0 && watched.length === 0 ? [] : list;
}

/** The read-only request that searches public repositories by name or words. */
export function searchReposRequest(query) {
    return {method: 'GET', path: `/search/repositories?q=${encodeURIComponent(String(query).trim().slice(0, 100))}&per_page=8`};
}

/** [{name, description, stars}] from a repository search, checked; nothing for anything else. */
export function parseSearchRepos(json) {
    return (Array.isArray(json?.items) ? json.items : [])
        .filter(item => isValidRepo(item?.full_name))
        .map(item => ({name: item.full_name,
            description: typeof item.description === 'string' ? item.description.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
            stars: Number.isInteger(item.stargazers_count) ? item.stargazers_count : 0}));
}
