// Minimal GitHub REST client on Soup 3 (ADR 0003), for github.com or a GitHub Enterprise
// Server instance (ADR 0007).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {GITHUB_COM, githubUrls, isSafeAccountUrl, parseGhesMeta} from './accounts.js';
import {InsecureHostError, Transport} from './transport.js';
import {isCancelled, setCancelledCheck} from './cancellation.js';
import {
    DEVICE_GRANT_TYPE,
    buildSearchPath,
    classifyDeviceTokenResponse,
    classifyGraphqlErrors,
    classifyHttpError,
    formEncode,
    isSafeGitHubUrl,
    isValidRepo,
    parseDeviceCodeResponse,
    parseLabels,
    parseLogins,
    parseProjectItems,
    parseSearchResponse,
    parseTeamItems,
    parseViewerBoards,
    projectItemsRequest,
    teamItemsPath,
    viewerBoardsRequest,
} from './model.js';
import {DOWNLOAD_PREFIX, RELEASES_PATH} from './updates.js';


/** Device-flow sign-in ended without a token: kind is expired, denied or error. */
export class DeviceFlowError extends Error {
    constructor(kind, detail = kind) {
        super(`GitHub sign-in failed: ${detail}`);
        this.name = 'DeviceFlowError';
        this.kind = kind;
        this.detail = detail;
    }
}

function cancelledError() {
    return new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

/** Resolves after `seconds`, or rejects as cancelled. */
function sleep(seconds, cancellable) {
    return new Promise((resolve, reject) => {
        if (cancellable?.is_cancelled()) {
            reject(cancelledError());
            return;
        }
        let handlerId = 0;
        const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            if (handlerId)
                cancellable.disconnect(handlerId);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        if (cancellable) {
            handlerId = cancellable.connect(() => {
                GLib.source_remove(sourceId);
                reject(cancelledError());
            });
        }
    });
}

export class GitHubError extends Error {
    constructor({kind, status, retryAt}) {
        super(`GitHub request failed: ${kind} (HTTP ${status})`);
        this.name = 'GitHubError';
        this.kind = kind;
        this.status = status;
        this.retryAt = retryAt;
    }
}

// Cancellation is a Gio CANCELLED error here; the pure loaders ask through cancellation.js.
setCancelledCheck(error => error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
export {isCancelled};

/** A transport failure as the GitHubError the callers expect. */
export function transportError(error) {
    if (isCancelled(error))
        return error;
    if (error instanceof InsecureHostError)
        return new GitHubError({kind: 'insecure', status: 0, retryAt: null});
    return new GitHubError(classifyHttpError(0));
}

export class GitHubClient {
    /** `base` is the instance: https://github.com, or a GitHub Enterprise Server address. */
    constructor(version = 'dev', base = GITHUB_COM) {
        this.base = base;
        this._urls = githubUrls(base);
        this._transport = new Transport(version, base === GITHUB_COM ? null : base);
        // Links in the data must be on the instance (threat model T7).
        this._isSafe = base === GITHUB_COM ? isSafeGitHubUrl : url => isSafeAccountUrl(url, base);
    }

    destroy() {
        this._transport?.destroy();
        this._transport = null;
    }

    async _get(path, token, cancellable) {
        return this._request('GET', path, token, null, cancellable);
    }

    /**
     * REST call with an optional JSON body. Resolves to the parsed JSON, or null for 204.
     * `features` asks GraphQL for preview features (the GraphQL-Features header).
     */
    async _request(method, path, token, body, cancellable, features = null) {
        const url = path === '/graphql' ? this._urls.graphql : `${this._urls.api}${path}`;
        const message = Soup.Message.new(method, url);
        const headers = message.get_request_headers();
        headers.append('Accept', 'application/vnd.github+json');
        headers.append('X-GitHub-Api-Version', '2022-11-28');
        if (token)
            headers.append('Authorization', `Bearer ${token}`);
        if (features && /^[a-z_,]+$/.test(features))
            headers.append('GraphQL-Features', features);
        if (body !== null && body !== undefined) {
            message.set_request_body_from_bytes('application/json',
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        }
        return this._send(message, cancellable);
    }

    /** Form POST to the instance's OAuth endpoints, which answer JSON when asked to. */
    async _postForm(url, fields, cancellable) {
        const message = Soup.Message.new('POST', url);
        message.get_request_headers().append('Accept', 'application/json');
        message.set_request_body_from_bytes('application/x-www-form-urlencoded',
            new GLib.Bytes(new TextEncoder().encode(formEncode(fields))));
        return this._send(message, cancellable);
    }

    async _send(message, cancellable) {
        let bytes;
        try {
            bytes = await this._transport.send(message, cancellable);
        } catch (e) {
            throw transportError(e);
        }

        const status = message.get_status();
        if (status < 200 || status >= 300) {
            const responseHeaders = {};
            message.get_response_headers().foreach((name, value) => {
                responseHeaders[name.toLowerCase()] = value;
            });
            throw new GitHubError(classifyHttpError(status, responseHeaders, Date.now()));
        }

        const text = new TextDecoder().decode(bytes.toArray());
        if (status === Soup.Status.NO_CONTENT || !text)
            return null;
        try {
            return JSON.parse(text);
        } catch {
            throw new GitHubError({kind: 'unknown', status, retryAt: null});
        }
    }

    /** sourceglance's published releases (public, no sign-in), for the update check. */
    async listReleases(cancellable = null) {
        return this._get(RELEASES_PATH, null, cancellable);
    }

    /** Downloads one of sourceglance's release files. Resolves to its GLib.Bytes. */
    async download(url, cancellable = null) {
        if (!url.startsWith(DOWNLOAD_PREFIX))
            throw new TypeError('sourceglance: not a sourceglance release download');
        const message = Soup.Message.new('GET', url);
        let bytes;
        try {
            bytes = await this._transport.send(message, cancellable);
        } catch (e) {
            throw transportError(e);
        }
        const status = message.get_status();
        if (status < 200 || status >= 300)
            throw new GitHubError(classifyHttpError(status, {}, Date.now()));
        return bytes;
    }

    /**
     * For the self-hosted wizard: resolves to {version} if the instance is GitHub Enterprise
     * Server (its /api/v3/meta needs no sign-in), else null.
     */
    async probeEnterprise(cancellable = null) {
        try {
            return parseGhesMeta(await this._get('/meta', null, cancellable));
        } catch (e) {
            // Another site answers with its own error page or status (404, 410…).
            if (e instanceof GitHubError && e.kind !== 'network' && e.kind !== 'insecure' &&
                e.kind !== 'rate-limit' && e.kind !== 'server')
                return null;
            throw e;
        }
    }

    /** Resolves to the login of the token's owner. */
    async getViewer(token, cancellable = null) {
        const user = await this._get('/user', token, cancellable);
        return user.login;
    }

    /**
     * Resolves to {total, items} for one search: 'issue' (open issues assigned to you),
     * 'pr-assigned' or 'pr-review' (open PRs assigned to you / awaiting your review).
     */
    async search(token, repos = [], search = 'issue', cancellable = null) {
        const json = await this._get(buildSearchPath(repos, search), token, cancellable);
        return parseSearchResponse(json, search, this._isSafe);
    }

    /**
     * Resolves to {issues, prs}: what's open in your repositories and your organizations',
     * whoever it's assigned to (see parseTeamItems()). `repos` keeps only those repositories.
     */
    async listTeam(token, repos = [], cancellable = null) {
        return parseTeamItems(await this._get(teamItemsPath(), token, cancellable), repos, this._isSafe);
    }

    /** Resolves to how many items a search finds, e.g. 'issue-closed' or 'pr-closed'. */
    async countSearch(token, repos = [], search = 'issue-closed', cancellable = null) {
        const json = await this._get(buildSearchPath(repos, search), token, cancellable);
        return Number.isInteger(json?.total_count) ? json.total_count : 0;
    }

    /**
     * Resolves to your project boards with their draft items (see parseViewerBoards()). Rejects
     * only if GitHub returned no data at all, e.g. the sign-in can't read projects.
     */
    async getViewerBoards(token, cancellable = null) {
        const request = viewerBoardsRequest();
        const json = await this._request(request.method, request.path, token, request.body, cancellable);
        if (!json?.data && json?.errors?.length)
            throw new GitHubError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return parseViewerBoards(json, this._isSafe);
    }

    /**
     * Runs a request built by model.js (closeRequest(), moveStatusRequest() and so on).
     * GraphQL requests fail on any `errors`, since a write must apply fully; reads marked
     * `partial` keep what came back (boards the sign-in can't see are just missing).
     */
    async send(token, request, cancellable = null) {
        if (!request)
            throw new TypeError('sourceglance: empty request');
        const json = await this._request(request.method, request.path, token, request.body, cancellable, request.features);
        if (request.graphql && json?.errors?.length && !(request.partial && json.data))
            throw new GitHubError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return json;
    }

    /**
     * Resolves to a Map of item node ID → project boards (see parseProjectItems()). Boards the
     * sign-in can't see are left out instead of failing the whole call.
     */
    async getProjectBoards(token, nodeIds, cancellable = null) {
        const request = projectItemsRequest(nodeIds);
        if (!request)
            return new Map();
        const json = await this._request(request.method, request.path, token, request.body, cancellable);
        if (!json?.data && json?.errors?.length)
            throw new GitHubError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return parseProjectItems(json);
    }

    /** Resolves to the repository's labels, [{name, color}] (first 100). */
    async listLabels(token, repo, cancellable = null) {
        if (!isValidRepo(repo))
            throw new TypeError('sourceglance: not a valid repository');
        return parseLabels(await this._get(`/repos/${repo}/labels?per_page=100`, token, cancellable));
    }

    /** Resolves to the logins that can be assigned in the repository (first 100). */
    async listAssignable(token, repo, cancellable = null) {
        if (!isValidRepo(repo))
            throw new TypeError('sourceglance: not a valid repository');
        return parseLogins(await this._get(`/repos/${repo}/assignees?per_page=100`, token, cancellable));
    }

    /** Starts device-flow sign-in. Resolves to {deviceCode, userCode, verificationUri, expiresIn, interval}. */
    async requestDeviceCode(clientId, scope = null, cancellable = null) {
        const fields = scope ? {client_id: clientId, scope} : {client_id: clientId};
        const json = await this._postForm(this._urls.deviceCode, fields, cancellable);
        const code = parseDeviceCodeResponse(json, {isSafe: this._isSafe, fallback: this._urls.deviceVerification});
        if (!code)
            throw new DeviceFlowError('error', json?.error ?? 'bad device code response');
        return code;
    }

    /**
     * Polls until the user approves the code in the browser. Resolves to the access token;
     * rejects with DeviceFlowError, GitHubError, or a cancelled GLib.Error.
     */
    async waitForDeviceToken(clientId, {deviceCode, expiresIn, interval}, cancellable = null) {
        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
            await sleep(interval, cancellable);
            const json = await this._postForm(this._urls.deviceToken, {
                client_id: clientId,
                device_code: deviceCode,
                grant_type: DEVICE_GRANT_TYPE,
            }, cancellable);
            const result = classifyDeviceTokenResponse(json, interval);
            switch (result.state) {
            case 'done':
                return result.token;
            case 'pending':
            case 'slow-down':
                interval = result.interval;
                break;
            default:
                throw new DeviceFlowError(result.state, result.error);
            }
        }
        throw new DeviceFlowError('expired');
    }
}
