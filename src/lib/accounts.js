// Accounts: the GitHub and GitLab sign-ins Source Glance uses, on github.com, gitlab.com or a
// self-hosted instance (ADR 0007). Pure: no gi:// or resource:// imports, unit-tested with
// Node like model.js (ADR 0004).
import {groupIssues, isMine, isValidLogin} from './model.js';

export const PLATFORMS = ['github', 'gitlab'];
export const GITHUB_COM = 'https://github.com';
export const GITLAB_COM = 'https://gitlab.com';
// Keyring ids of the sign-ins from before multiple accounts. They stay as they are, so those
// sign-ins carry over without signing in again.
export const LEGACY_IDS = {github: 'github.com', gitlab: 'gitlab.com'};
// 'device': browser sign-in (OAuth device flow); 'pat': a personal access token.
export const SIGN_IN_METHODS = ['device', 'pat'];

const DEFAULT_BASES = {github: GITHUB_COM, gitlab: GITLAB_COM};
const PLATFORM_NAMES = {github: 'GitHub', gitlab: 'GitLab'};

// Instance URLs

const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(text) {
    const match = IPV4_RE.exec(text);
    if (!match)
        return null;
    const octets = match.slice(1).map(Number);
    return octets.every(n => n <= 255) && match.slice(1).every(part => part === String(Number(part))) ? octets : null;
}

/** Eight 16-bit groups from an IPv6 address (no brackets, no zone), or null. */
function parseIpv6(text) {
    if (typeof text !== 'string' || !/^[0-9A-Fa-f:.]+$/.test(text) || !text.includes(':'))
        return null;
    let body = text;
    // An IPv4 address in the last 32 bits, as in ::ffff:192.168.1.5.
    const lastColon = body.lastIndexOf(':');
    const last = body.slice(lastColon + 1);
    if (last.includes('.')) {
        const v4 = parseIpv4(last);
        if (!v4)
            return null;
        body = `${body.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    }
    const halves = body.split('::');
    if (halves.length > 2)
        return null;
    const groups = part => (part === '' ? [] : part.split(':'));
    const left = groups(halves[0]);
    const right = halves.length === 2 ? groups(halves[1]) : [];
    if ([...left, ...right].some(group => !/^[0-9A-Fa-f]{1,4}$/.test(group)))
        return null;
    const known = left.length + right.length;
    if (halves.length === 1 ? known !== 8 : known > 7)
        return null;
    return [...left, ...new Array(8 - known).fill('0'), ...right].map(group => Number.parseInt(group, 16));
}

/** True for an IPv4 or IPv6 address literal (IPv6 without brackets). */
export function isIpLiteral(text) {
    return parseIpv4(text) !== null || parseIpv6(text) !== null;
}

function isLanIpv4([a, b]) {
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 169 && b === 254);
}

/**
 * True for an address that can only be on this computer or the local network: loopback,
 * private IPv4 (10/8, 172.16/12, 192.168/16), link-local, and IPv6 unique local (fc00::/7) or
 * link-local (fe80::/10). Plain http:// is only allowed to these (ADR 0007).
 */
export function isLanAddress(text) {
    const v4 = parseIpv4(text);
    if (v4)
        return isLanIpv4(v4);
    const v6 = parseIpv6(typeof text === 'string' ? text.replace(/%.*$/, '') : text);
    if (!v6)
        return false;
    if (v6.slice(0, 7).every(g => g === 0) && v6[7] === 1)
        return true;
    // IPv4-mapped (::ffff:a.b.c.d): judged as the IPv4 address.
    if (v6.slice(0, 5).every(g => g === 0) && v6[5] === 0xffff)
        return isLanIpv4([v6[6] >> 8, v6[6] & 0xff]);
    return (v6[0] & 0xfe00) === 0xfc00 || (v6[0] & 0xffc0) === 0xfe80;
}

/** True when every resolved address is on the local network (and there is at least one). */
export function allLanAddresses(addresses) {
    return Array.isArray(addresses) && addresses.length > 0 && addresses.every(isLanAddress);
}

/**
 * Checks an instance address typed by the user. Resolves to {base, scheme, hostname, port,
 * path} or {error}: 'empty', 'scheme' (not http or https), 'credentials' (user:pass@),
 * 'query' (? or #), or 'invalid'. Without a scheme, https:// is assumed. `base` is the
 * normalized form, e.g. https://git.example.com/gitlab, without a trailing slash.
 */
export function parseInstanceUrl(text) {
    let input = typeof text === 'string' ? text.trim() : '';
    if (!input)
        return {error: 'empty'};
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(input)?.[1]?.toLowerCase();
    if (!scheme)
        input = `https://${input}`;
    else if (scheme !== 'http' && scheme !== 'https')
        return {error: 'scheme'};
    const match = /^(https?):\/\/([^/?#]*)([^?#]*)([?#].*)?$/i.exec(input);
    if (!match)
        return {error: 'invalid'};
    const [, rawScheme, authority, rawPath, extra] = match;
    if (authority.includes('@'))
        return {error: 'credentials'};
    if (extra && extra !== '?' && extra !== '#')
        return {error: 'query'};
    const hostMatch = /^(\[[0-9A-Fa-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/.exec(authority);
    if (!hostMatch)
        return {error: 'invalid'};
    let hostname = hostMatch[1].toLowerCase().replace(/\.$/, '');
    const port = hostMatch[2] ? Number(hostMatch[2]) : null;
    if (port !== null && (port < 1 || port > 65535))
        return {error: 'invalid'};
    if (hostname.startsWith('[')) {
        if (!parseIpv6(hostname.slice(1, -1)))
            return {error: 'invalid'};
    } else if (!parseIpv4(hostname) && !hostname.split('.').every(label => LABEL_RE.test(label))) {
        return {error: 'invalid'};
    } else if (/^\d+(\.\d+)*$/.test(hostname) && !parseIpv4(hostname)) {
        return {error: 'invalid'};
    }
    const segments = rawPath.split('/').filter(Boolean);
    if (!segments.every(segment => PATH_SEGMENT_RE.test(segment) && segment !== '.' && segment !== '..'))
        return {error: 'invalid'};
    const lowerScheme = rawScheme.toLowerCase();
    const defaultPort = lowerScheme === 'https' ? 443 : 80;
    const portPart = port !== null && port !== defaultPort ? `:${port}` : '';
    const path = segments.length ? `/${segments.join('/')}` : '';
    return {
        base: `${lowerScheme}://${hostname}${portPart}${path}`,
        scheme: lowerScheme,
        // Without brackets, for resolving and for isLanAddress().
        hostname: hostname.replace(/^\[|\]$/g, ''),
        port: port ?? defaultPort,
        path,
    };
}

/**
 * Whether plain http:// may even be tried for this instance: an IP address must be a LAN
 * address; a name is allowed here, and its resolved addresses are checked on every
 * connection instead (lib/transport.js). https:// is always allowed.
 */
export function httpAllowed(parsed) {
    if (parsed?.scheme !== 'http')
        return true;
    return isIpLiteral(parsed.hostname) ? isLanAddress(parsed.hostname) : true;
}

// Accounts

/** github.com or gitlab.com, as opposed to a self-hosted instance. */
export function isDefaultBase(platform, base) {
    return DEFAULT_BASES[platform] === base;
}

export function defaultBase(platform) {
    return DEFAULT_BASES[platform] ?? null;
}

export function platformName(platform) {
    return PLATFORM_NAMES[platform] ?? platform;
}

/** "git.example.com/gitlab" from https://git.example.com/gitlab (http:// stays visible). */
export function hostLabel(base) {
    return typeof base === 'string' ? base.replace(/^https:\/\//, '') : '';
}

/** A new account's keyring id, e.g. "github:github.com:alice". */
export function accountId(platform, base, login) {
    return `${platform}:${hostLabel(base)}:${String(login).toLowerCase()}`;
}

export function isLegacyId(id) {
    return id === LEGACY_IDS.github || id === LEGACY_IDS.gitlab;
}

/** Two records for the same person on the same instance. */
export function sameAccount(a, b) {
    if (a.id === b.id)
        return true;
    return a.platform === b.platform && a.base === b.base && Boolean(a.login) &&
        String(a.login).toLowerCase() === String(b.login ?? '').toLowerCase();
}

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidClientId(id) {
    return typeof id === 'string' && CLIENT_ID_RE.test(id);
}

/** A GitHub or GitLab username, as far as shown or used in ids. */
export function isValidAccountLogin(login) {
    return typeof login === 'string' && (isValidLogin(login) || /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/.test(login));
}

/** One stored account, checked; null if it doesn't hold up. */
export function parseAccount(value) {
    let json;
    try {
        json = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return null;
    }
    const {id, platform, base, login = null, method = 'device', clientId = null} = json ?? {};
    if (typeof id !== 'string' || !id || id.length > 300 || !PLATFORMS.includes(platform))
        return null;
    const parsed = parseInstanceUrl(base);
    if (parsed.error || parsed.base !== base || !httpAllowed(parsed))
        return null;
    if (login !== null && !isValidAccountLogin(login))
        return null;
    if (!SIGN_IN_METHODS.includes(method) || (clientId !== null && !isValidClientId(clientId)))
        return null;
    return {id, platform, base, login, method, clientId};
}

/** Accounts from the `accounts` setting (JSON strings), dropping bad entries and duplicate ids. */
export function parseAccounts(strv) {
    const accounts = [];
    for (const value of Array.isArray(strv) ? strv : []) {
        const account = parseAccount(value);
        if (account && !accounts.some(other => other.id === account.id))
            accounts.push(account);
    }
    return accounts;
}

export function serializeAccounts(accounts) {
    return accounts.map(({id, platform, base, login, method, clientId}) =>
        JSON.stringify({id, platform, base, login, method, clientId}));
}

/**
 * The account list with the sign-ins from before multiple accounts added, first, when their
 * keyring entry exists (`stored` is {github: bool, gitlab: bool}) and they aren't listed yet.
 */
export function migrateAccounts(accounts, stored) {
    const added = [];
    for (const platform of PLATFORMS) {
        const id = LEGACY_IDS[platform];
        if (stored?.[platform] && !accounts.some(account => account.id === id))
            added.push({id, platform, base: DEFAULT_BASES[platform], login: null, method: 'device', clientId: null});
    }
    return added.length ? [...added, ...accounts] : accounts;
}

/** `accounts` with `account` added, replacing an earlier record of the same person. */
export function withAccount(accounts, account) {
    const index = accounts.findIndex(other => sameAccount(other, account));
    if (index < 0)
        return [...accounts, account];
    const copy = [...accounts];
    copy[index] = {...account, id: accounts[index].id};
    return copy;
}

export function withoutAccount(accounts, id) {
    return accounts.filter(account => account.id !== id);
}

/** `accounts` with the login of account `id` set, or the same list if nothing changes. */
export function withLogin(accounts, id, login) {
    const account = accounts.find(other => other.id === id);
    if (!account || account.login === login || !isValidAccountLogin(login))
        return accounts;
    return accounts.map(other => (other.id === id ? {...other, login} : other));
}

/**
 * The id part a section is remembered by in collapsed-sections and collapsed-groups. The
 * sign-ins from before multiple accounts keep "github" and "gitlab", so what was collapsed
 * stays collapsed.
 */
export function sectionKey(account) {
    if (account.id === LEGACY_IDS.github)
        return 'github';
    if (account.id === LEGACY_IDS.gitlab)
        return 'gitlab';
    return account.id;
}

/** "GitHub · @alice", or "GitLab · git.example.com · @bob" for a self-hosted instance. */
/**
 * The account as the assignee in the Tasks filters: "@alice · GitHub", or the instance's host
 * for a self-hosted one ("@bob · git.example.com"); the platform name until the login is known.
 */
export function assigneeTitle(account) {
    const where = isDefaultBase(account.platform, account.base) ? platformName(account.platform) : hostLabel(account.base);
    return account.login ? `@${account.login} · ${where}` : where;
}

export function accountTitle(account) {
    const parts = [platformName(account.platform)];
    if (!isDefaultBase(account.platform, account.base))
        parts.push(hostLabel(account.base));
    if (account.login)
        parts.push(`@${account.login}`);
    return parts.join(' · ');
}

// Where to send requests.

/** API, GraphQL and sign-in URLs for an instance. */
export function githubUrls(base = GITHUB_COM) {
    const dotCom = base === GITHUB_COM;
    return {
        api: dotCom ? 'https://api.github.com' : `${base}/api/v3`,
        graphql: dotCom ? 'https://api.github.com/graphql' : `${base}/api/graphql`,
        deviceCode: `${base}/login/device/code`,
        deviceToken: `${base}/login/oauth/access_token`,
        deviceVerification: `${base}/login/device`,
        newToken: dotCom ? `${base}/settings/personal-access-tokens/new` : `${base}/settings/tokens/new`,
        newApp: `${base}/settings/applications/new`,
    };
}

export function gitlabUrls(base = GITLAB_COM) {
    return {
        api: `${base}/api/v4`,
        oauth: base,
        deviceVerification: `${base}/oauth/device`,
        discovery: `${base}/.well-known/openid-configuration`,
        newToken: `${base}/-/user_settings/personal_access_tokens?name=Source+Glance&scopes=api`,
        newApp: `${base}/-/user_settings/applications`,
    };
}

const SAFE_PATH_RE = /^[A-Za-z0-9._~%/#?=&+!-]*$/;

/** Only links on the account's own instance may be opened (its data is untrusted). */
export function isSafeAccountUrl(url, base) {
    if (typeof url !== 'string' || typeof base !== 'string' || !base)
        return false;
    if (url === base)
        return true;
    return url.startsWith(`${base}/`) && SAFE_PATH_RE.test(url.slice(base.length));
}

// Checking an instance in the self-hosted wizard.

/** GitHub Enterprise Server's /api/v3/meta: {version}, or null if it isn't one. */
export function parseGhesMeta(json) {
    const version = json?.installed_version;
    return typeof version === 'string' && /^[0-9][0-9A-Za-z.+-]{0,40}$/.test(version) ? {version} : null;
}

/**
 * GitLab's OpenID discovery document: {device} (whether browser sign-in is offered; GitLab
 * 17.1 and later), or null if it isn't GitLab at `base`.
 */
export function parseGitLabDiscovery(json, base) {
    const issuer = typeof json?.issuer === 'string' ? json.issuer.replace(/\/+$/, '') : null;
    const scopes = Array.isArray(json?.scopes_supported) ? json.scopes_supported : [];
    if (issuer !== base || !scopes.includes('read_api'))
        return null;
    const grants = Array.isArray(json.grant_types_supported) ? json.grant_types_supported : [];
    return {device: grants.includes('device_code')};
}

// What the lists show per account.

/**
 * One account's part of the state: the account, its section key and title, and its lists
 * grouped by repository. `result` is what the loaders return plus status, updatedAt and
 * error; `hidden(item)` leaves out items closed from the menu and `hiddenBoard(board)` project
 * boards you chose to hide (the unfiltered ones stay in `allBoards`, for the picker).
 */
export function sourceFrom(account, result = {}, hidden = () => false, hiddenBoard = () => false) {
    const issues = result.issues ?? [];
    const prs = result.prs ?? [];
    const shownIssues = issues.filter(item => !hidden(item));
    const shownPrs = prs.filter(item => !hidden(item));
    // The counts are yours; the team's items (window only) are extra.
    const mine = list => list.filter(isMine);
    const login = result.login ?? account.login;
    const withLoginAccount = {...account, login};
    return {
        account: withLoginAccount,
        key: sectionKey(account),
        title: accountTitle(withLoginAccount),
        assignee: assigneeTitle(withLoginAccount),
        platform: account.platform,
        login,
        status: result.status ?? 'loading',
        updatedAt: result.updatedAt ?? null,
        error: result.error ?? null,
        groups: groupIssues(shownIssues),
        prGroups: groupIssues(shownPrs),
        issueTotal: Math.max(0, (result.issueTotal ?? 0) - (mine(issues).length - mine(shownIssues).length)),
        issueShown: mine(shownIssues).length,
        prTotal: Math.max(0, (result.prTotal ?? 0) - (mine(prs).length - mine(shownPrs).length)),
        prShown: mine(shownPrs).length,
        closedCounts: result.closedCounts ?? {issues: null, prs: null},
        boards: account.platform === 'github' ? (result.boards ?? null)?.filter(board => !hiddenBoard(board)) ?? null : null,
        allBoards: account.platform === 'github' ? result.boards ?? null : null,
        boardsError: result.boardsError ?? null,
    };
}

/** The status of all lists together: signed-out with no accounts, ready once any account loaded. */
export function aggregateStatus(sources) {
    if (sources.length === 0 || sources.every(source => source.status === 'signed-out'))
        return 'signed-out';
    if (sources.some(source => source.updatedAt))
        return 'ready';
    if (sources.some(source => source.status === 'error'))
        return 'error';
    return 'loading';
}

/** The most recent refresh of any account, or null. */
export function latestUpdate(sources) {
    const times = sources.map(source => source.updatedAt).filter(Boolean);
    return times.length ? new Date(Math.max(...times.map(time => time.getTime()))) : null;
}

/** The first error of an account that has nothing loaded, for the overall status. */
export function firstError(sources) {
    return sources.find(source => source.error)?.error ?? null;
}

/**
 * The first account whose lists didn't load, for the window's warning: {kind, title, retryAt},
 * or null. An account that's added but signed out counts; no accounts at all doesn't (that's a
 * fresh start, not a problem).
 */
export function fetchProblem(sources) {
    const source = sources.find(s => s.status === 'error' || s.status === 'signed-out');
    if (!source)
        return null;
    return {
        kind: source.status === 'signed-out' ? 'signed-out' : source.error?.kind ?? 'unknown',
        title: source.title,
        retryAt: source.error?.retryAt ?? null,
    };
}

/** Where a fetchProblem() kind gets fixed: 'accounts' (sign in again, or check access) or 'retry'. */
export function problemFix(kind) {
    return ['auth', 'signed-out', 'forbidden', 'insecure', 'not-found', 'gone'].includes(kind) ? 'accounts' : 'retry';
}

/**
 * The id of the account an item came from. Items from before multiple accounts (in memory
 * only, e.g. recently closed) fall back to the first sign-in of their platform.
 */
export function accountForItem(item) {
    return item?.accountId ?? (item?.platform === 'gitlab' ? LEGACY_IDS.gitlab : LEGACY_IDS.github);
}
