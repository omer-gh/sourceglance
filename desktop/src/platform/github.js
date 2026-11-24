// GitHub client for the desktop app. Same methods as src/lib/github.js, but requests go
// through Rust instead of Soup. `token` is a sign-in reference (see tauri.js).
import {GITHUB_COM, githubUrls, isSafeAccountUrl, parseGhesMeta} from '@shared/accounts.js';
import {
    DEVICE_GRANT_TYPE,
    buildSearchPath,
    classifyDeviceTokenResponse,
    classifyGraphqlErrors,
    isSafeGitHubUrl,
    isValidRepo,
    parseDeviceCodeResponse,
    parseLabels,
    parseLogins,
    parseProjectItems,
    parseSearchResponse,
    parseViewerBoards,
    projectItemsRequest,
    viewerBoardsRequest,
} from '@shared/model.js';
import {ApiError, DeviceFlowError, oauth, request} from './http.js';
import {sleep} from './tauri.js';

export class GitHubClient {
    /** `base` is the instance: https://github.com, or a GitHub Enterprise Server address. */
    constructor(_version = 'dev', base = GITHUB_COM) {
        this.base = base;
        this._urls = githubUrls(base);
        // Links in the data must be on the instance (threat model T7).
        this._isSafe = base === GITHUB_COM ? isSafeGitHubUrl : url => isSafeAccountUrl(url, base);
    }

    destroy() {}

    async _request(method, path, token, body, signal) {
        const url = path === '/graphql' ? this._urls.graphql : `${this._urls.api}${path}`;
        const headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (body !== null && body !== undefined)
            headers['Content-Type'] = 'application/json';
        const {json} = await request(this.base, {
            method,
            url,
            headers,
            body: body === null || body === undefined ? null : JSON.stringify(body),
            auth: token,
        }, signal);
        return json;
    }

    _get(path, token, signal) {
        return this._request('GET', path, token, null, signal);
    }

    async probeEnterprise(signal = null) {
        try {
            return parseGhesMeta(await this._get('/meta', null, signal));
        } catch (e) {
            if (e instanceof ApiError && e.kind !== 'network' && e.kind !== 'insecure' && e.kind !== 'local-network' &&
                e.kind !== 'rate-limit' && e.kind !== 'server')
                return null;
            throw e;
        }
    }

    async getViewer(token, signal = null) {
        const user = await this._get('/user', token, signal);
        return user.login;
    }

    async search(token, repos = [], search = 'issue', signal = null) {
        const json = await this._get(buildSearchPath(repos, search), token, signal);
        return parseSearchResponse(json, search, this._isSafe);
    }

    async countSearch(token, repos = [], search = 'issue-closed', signal = null) {
        const json = await this._get(buildSearchPath(repos, search), token, signal);
        return Number.isInteger(json?.total_count) ? json.total_count : 0;
    }

    async getViewerBoards(token, signal = null) {
        const req = viewerBoardsRequest();
        const json = await this._request(req.method, req.path, token, req.body, signal);
        if (!json?.data && json?.errors?.length)
            throw new ApiError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return parseViewerBoards(json, this._isSafe);
    }

    async send(token, req, signal = null) {
        if (!req)
            throw new TypeError('sourceglance: empty request');
        const json = await this._request(req.method, req.path, token, req.body, signal);
        // A `partial` request keeps what came back when only part of it couldn't be read.
        if (req.graphql && json?.errors?.length && !(req.partial && json.data))
            throw new ApiError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return json;
    }

    async getProjectBoards(token, nodeIds, signal = null) {
        const req = projectItemsRequest(nodeIds);
        if (!req)
            return new Map();
        const json = await this._request(req.method, req.path, token, req.body, signal);
        if (!json?.data && json?.errors?.length)
            throw new ApiError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return parseProjectItems(json);
    }

    async listLabels(token, repo, signal = null) {
        if (!isValidRepo(repo))
            throw new TypeError('sourceglance: not a valid repository');
        return parseLabels(await this._get(`/repos/${repo}/labels?per_page=100`, token, signal));
    }

    async listAssignable(token, repo, signal = null) {
        if (!isValidRepo(repo))
            throw new TypeError('sourceglance: not a valid repository');
        return parseLogins(await this._get(`/repos/${repo}/assignees?per_page=100`, token, signal));
    }

    async requestDeviceCode(clientId, scope = null, signal = null) {
        const form = scope ? {client_id: clientId, scope} : {client_id: clientId};
        const json = await oauth(this.base, 'github', this._urls.deviceCode, form, signal);
        const code = parseDeviceCodeResponse(json, {isSafe: this._isSafe, fallback: this._urls.deviceVerification});
        if (!code)
            throw new DeviceFlowError('error', json?.error ?? 'bad device code response');
        return code;
    }

    /** Polls until the user approves. Resolves to a `pending:<n>` reference. */
    async waitForDeviceToken(clientId, {deviceCode, expiresIn, interval}, signal = null) {
        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
            await sleep(interval, signal);
            const json = await oauth(this.base, 'github', this._urls.deviceToken, {
                client_id: clientId,
                device_code: deviceCode,
                grant_type: DEVICE_GRANT_TYPE,
            }, signal);
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
