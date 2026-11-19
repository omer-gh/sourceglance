// Sends requests through Rust (net.rs). Errors are ApiErrors with a `kind` from
// classifyHttpError(), like on GNOME, or an AbortError when cancelled.
import {invoke} from '@tauri-apps/api/core';

import {classifyHttpError} from '@core/model.js';
import {abortError, throwIfAborted} from './tauri.js';

/** Same fields as GitHubError in src/lib/github.js. */
export class ApiError extends Error {
    constructor({kind, status, retryAt}) {
        super(`Request failed: ${kind} (HTTP ${status})`);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
        this.retryAt = retryAt;
    }
}

/** Device-flow sign-in ended without a token: kind is expired, denied or error. */
export class DeviceFlowError extends Error {
    constructor(kind, detail = kind) {
        super(`Sign-in failed: ${detail}`);
        this.name = 'DeviceFlowError';
        this.kind = kind;
        this.detail = detail;
    }
}

/**
 * Turns a NetError from Rust into an ApiError. A host Rust refuses (not one of the
 * accounts' instances) is reported like a refused sign-in, so the user is sent to Accounts.
 */
function netError(kind) {
    if (kind === 'insecure')
        return new ApiError({kind: 'insecure', status: 0, retryAt: null});
    if (kind === 'not-allowed')
        return new ApiError({kind: 'forbidden', status: 0, retryAt: null});
    return new ApiError(classifyHttpError(0));
}

/** Rejects as cancelled as soon as `signal` aborts. */
function abortable(promise, signal) {
    if (!signal)
        return promise;
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, {once: true});
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/**
 * Sends one request to `base`; `auth` is a sign-in reference or null. Resolves to {status,
 * headers, json}. Throws ApiError on HTTP errors unless `allowError` is set, and on a body
 * that isn't JSON when `strictJson` is set.
 */
export async function request(base, {method = 'GET', url, headers = {}, body = null, auth = null}, signal = null,
    {allowError = false, strictJson = true} = {}) {
    throwIfAborted(signal);
    let response;
    try {
        response = await abortable(invoke('api_request', {
            request: {base, method, url, headers, body, auth},
        }), signal);
    } catch (e) {
        if (e?.name === 'AbortError')
            throw e;
        throw netError(typeof e === 'string' ? e : null);
    }
    const {status} = response;
    if ((status < 200 || status >= 300) && !allowError)
        throw new ApiError(classifyHttpError(status, response.headers, Date.now()));
    let json = null;
    if (response.body) {
        try {
            json = JSON.parse(response.body);
        } catch {
            // GitLab's client returns null for a body that isn't JSON; GitHub's throws.
            if (strictJson && !allowError && status !== 204)
                throw new ApiError({kind: 'unknown', status, retryAt: null});
        }
    }
    return {status, headers: response.headers, json};
}

/**
 * Posts an OAuth form and resolves to the JSON answer. Rust swaps any token in it for a
 * reference. As on GNOME, GitHub's HTTP errors and non-JSON answers throw ApiError, while
 * GitLab's are returned (its token endpoint answers 400 while waiting).
 */
export async function oauth(base, platform, url, form, signal = null) {
    throwIfAborted(signal);
    let response;
    try {
        response = await abortable(invoke('oauth_request', {base, platform, url, form}), signal);
    } catch (e) {
        if (e?.name === 'AbortError')
            throw e;
        throw netError(typeof e === 'string' ? e : null);
    }
    const {status, headers, json} = response;
    if (platform === 'github') {
        if (status < 200 || status >= 300)
            throw new ApiError(classifyHttpError(status, headers, Date.now()));
        if (json === null && status !== 204)
            throw new ApiError({kind: 'unknown', status, retryAt: null});
    }
    return json;
}
