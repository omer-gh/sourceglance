// GitLab client for the desktop app. Same methods as src/lib/gitlab.js, but requests go
// through Rust, which also renews the token. `token` is a sign-in reference (see tauri.js).
import {invoke} from '@tauri-apps/api/core';

import {GITLAB_COM, gitlabUrls, parseGitLabDiscovery} from '@core/accounts.js';
import {GITLAB_CLIENT_ID} from '@core/config.js';
import {
    GITLAB_SCOPE,
    closedCountPaths,
    listPath,
    parseGitLabDeviceCode,
    parseGitLabItems,
    parseGitLabLabels,
    parseGitLabMembers,
    parseGitLabToken,
} from '@core/gitlabModel.js';
import {DEVICE_GRANT_TYPE, classifyDeviceTokenResponse} from '@core/model.js';
import {ApiError, DeviceFlowError, oauth, request} from './http.js';
import {sleep, throwIfAborted} from './tauri.js';

export class GitLabClient {
    /** `base` is the instance; `accountId` the Keychain item; `clientId` the OAuth app (null: ours). */
    constructor(_version = 'dev', {base = GITLAB_COM, accountId = 'gitlab.com', clientId = null} = {}) {
        this.base = base;
        this._urls = gitlabUrls(base);
        this._accountId = accountId;
        this._clientId = clientId ?? GITLAB_CLIENT_ID;
    }

    destroy() {}

    async _api(method, path, token, body, signal) {
        return request(this.base, {
            method,
            url: `${this._urls.api}${path}`,
            headers: body === null || body === undefined ? {} : {'Content-Type': 'application/json'},
            body: body === null || body === undefined ? null : JSON.stringify(body),
            auth: token,
        }, signal, {strictJson: false});
    }

    async requestDeviceCode(clientId, signal = null) {
        const json = await oauth(this.base, 'gitlab', `${this.base}/oauth/authorize_device`,
            {client_id: clientId, scope: GITLAB_SCOPE}, signal);
        const code = parseGitLabDeviceCode(json, this.base);
        if (!code)
            throw new DeviceFlowError('error', json?.error ?? 'bad device code response');
        return code;
    }

    /** Polls until the user approves. `access` in the result is a `pending:<n>` reference. */
    async waitForDeviceToken(clientId, {deviceCode, expiresIn, interval}, signal = null) {
        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
            await sleep(interval, signal);
            const json = await oauth(this.base, 'gitlab', `${this.base}/oauth/token`, {
                client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT_TYPE,
            }, signal);
            const auth = parseGitLabToken(json);
            if (auth)
                return auth;
            const result = classifyDeviceTokenResponse(json, interval);
            if (result.state === 'pending' || result.state === 'slow-down')
                interval = result.interval;
            else
                throw new DeviceFlowError(result.state, result.error);
        }
        throw new DeviceFlowError('expired');
    }

    /** The account's sign-in reference, or null when signed out. */
    async accessToken(signal = null) {
        throwIfAborted(signal);
        return invoke('gitlab_access', {id: this._accountId, clientId: this._clientId});
    }

    async probe(signal = null) {
        const {json, status} = await request(this.base, {url: this._urls.discovery}, signal, {allowError: true, strictJson: false});
        return status >= 200 && status < 300 ? parseGitLabDiscovery(json, this.base) : null;
    }

    async getViewer(token, signal = null) {
        const {json} = await this._api('GET', '/user', token, null, signal);
        return {id: json?.id, username: json?.username};
    }

    async list(token, search, username = null, signal = null) {
        const {json, headers} = await this._api('GET', listPath(search, username), token, null, signal);
        const items = parseGitLabItems(json, search, this.base);
        const total = Number.parseInt(headers['x-total'], 10);
        return {total: Number.isNaN(total) ? items.length : total, items};
    }

    async closedCounts(token, signal = null) {
        const count = async paths => {
            let sum = 0;
            for (const path of paths) {
                const {headers} = await this._api('GET', path, token, null, signal);
                const total = Number.parseInt(headers['x-total'], 10);
                if (Number.isNaN(total))
                    return null;
                sum += total;
            }
            return sum;
        };
        const paths = closedCountPaths();
        return {issues: await count(paths.issues), prs: await count(paths.prs)};
    }

    async listMembers(token, projectId, signal = null) {
        const {json} = await this._api('GET', `/projects/${projectId}/members/all?per_page=100`, token, null, signal);
        return parseGitLabMembers(json);
    }

    async listLabels(token, projectId, signal = null) {
        const {json} = await this._api('GET', `/projects/${projectId}/labels?per_page=100`, token, null, signal);
        return parseGitLabLabels(json);
    }

    async send(token, req, signal = null) {
        if (!req)
            throw new TypeError('sourceglance: empty request');
        return (await this._api(req.method, req.path, token, req.body, signal)).json;
    }
}

export {ApiError};
