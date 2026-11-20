// The names platforms give users, organizations and groups ("Acme Inc"), shown with the
// login in parentheses: "Acme Inc (@acme)". Items only carry the login, so each name is
// fetched once per account and kept for the session. A name that can't be loaded just shows
// as "@login". Names come from the platform: treat them as plain text, never markup.
import {cappedString} from './model.js';

const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITLAB_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const MAX_NAME = 60;

/**
 * Read-only requests that may tell an organization's name, most likely first: GitHub's /users/{login}
 * covers users and organizations; GitLab has groups (by full path) and users (by username).
 * No requests for anything that isn't a valid login or path.
 */
export function nameRequests(platform, login) {
    if (platform === 'gitlab') {
        if (typeof login !== 'string' || login.length > 255 || !GITLAB_PATH_RE.test(login))
            return [];
        const requests = [{method: 'GET', path: `/groups/${encodeURIComponent(login)}`}];
        if (!login.includes('/'))
            requests.push({method: 'GET', path: `/users?username=${encodeURIComponent(login)}`});
        return requests;
    }
    return typeof login === 'string' && GITHUB_LOGIN_RE.test(login)
        ? [{method: 'GET', path: `/users/${login}`}]
        : [];
}

/** The display name in a response (an object, or GitLab's list of users), or '' for none. */
export function parseDisplayName(json) {
    const entry = Array.isArray(json) ? json[0] : json;
    const name = typeof entry?.name === 'string' ? entry.name : '';
    // eslint-disable-next-line no-control-regex
    return cappedString(name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), MAX_NAME);
}

/** "Name (@login)", or "@login" when there is no name or it's only the login again. */
export function friendlyName(name, login) {
    return name && name.toLowerCase() !== String(login).toLowerCase() ? `${name} (@${login})` : `@${login}`;
}

const GITHUB_ORGANIZATIONS_QUERY = 'query { viewer { organizations(first: 100) { nodes { login name } } } }';

/**
 * Read-only requests that list the organizations an account belongs to. GitHub gets two: GraphQL
 * (which the sourceglance GitHub App can read, like its boards) and REST /user/orgs (which tokens
 * with the org scope can). Each one may come back empty; the answers are combined.
 */
export function discoveryRequests(platform) {
    return platform === 'gitlab'
        ? [{method: 'GET', path: '/groups?min_access_level=10&top_level_only=true&per_page=100'}]
        : [{method: 'POST', path: '/graphql', graphql: true, partial: true, body: {query: GITHUB_ORGANIZATIONS_QUERY}},
            {method: 'GET', path: '/user/orgs?per_page=100'}];
}

/** [{login, name}] from a discovery response; `name` is '' where the response doesn't say. */
export function parseOrganizations(platform, json) {
    const entries = Array.isArray(json) ? json : json?.data?.viewer?.organizations?.nodes;
    if (!Array.isArray(entries))
        return [];
    const found = [];
    for (const entry of entries) {
        const login = platform === 'gitlab' ? entry?.full_path : entry?.login;
        if (nameRequests(platform, login).length === 0)
            continue;
        found.push({login, name: platform === 'gitlab' || entry?.name ? parseDisplayName(entry) : ''});
    }
    return found;
}
