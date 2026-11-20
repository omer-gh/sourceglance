// Accounts, GitLab: how to sign in to gitlab.com or a GitLab self-managed instance, for the
// add-account dialog (addAccount.js).
import {gettext as _} from '../i18n.js';

import {GITLAB_COM, gitlabUrls} from '../../lib/accounts.js';
import {GITLAB_CLIENT_ID} from '../../lib/config.js';
import {DeviceFlowError, GitHubError} from '../../lib/github.js';
import {GitLabClient} from '../../lib/gitlab.js';

function describeError(error) {
    if (error instanceof DeviceFlowError) {
        switch (error.kind) {
        case 'expired':
            return _('The sign-in code expired. Try again.');
        case 'denied':
            return _('Sign-in was cancelled on GitLab.');
        default:
            return _('GitLab sign-in failed (%s).').format(error.detail);
        }
    }
    if (error instanceof GitHubError) {
        switch (error.kind) {
        case 'auth':
            return _('GitLab rejected the sign-in.');
        case 'forbidden':
            return _('This token doesn’t have the required scope (api, or read_api to only read).');
        case 'network':
            return _('Couldn’t connect. Check the address and your connection, and that this computer trusts the instance’s certificate.');
        case 'insecure':
            return _('This address uses plain http:// but isn’t on your local network. Use https://.');
        case 'rate-limit':
            return _('GitLab rate limit reached. Try again later.');
        default:
            return _('GitLab returned an error (HTTP %d).').format(error.status);
        }
    }
    return _('Something went wrong: %s').format(error.message);
}

/**
 * Signing in to GitLab, for the add-account dialog. `base` is gitlab.com or a self-managed
 * instance; `probe` is what the instance check found ({device}: whether it offers browser
 * sign-in, GitLab 17.1 and later). The notes on reach come from GitLab's documentation on
 * OAuth scopes and personal access tokens.
 */
export function gitlabProvider({version, base = GITLAB_COM, probe = null}) {
    const dotCom = base === GITLAB_COM;
    const urls = gitlabUrls(base);
    const deviceOffered = dotCom || probe?.device;
    const methods = [{
        id: 'device', method: 'device',
        clientId: dotCom ? GITLAB_CLIENT_ID : null,
        needsClientId: !dotCom,
        title: _('Sign in with the browser'),
        note: dotCom
            ? _('Every project you can view, with the api scope.')
            : _('Every project you can view, with the api scope. You register an application on your instance: not confidential, scope api.'),
        registerUrl: dotCom ? null : urls.newApp,
        unavailable: dotCom && !GITLAB_CLIENT_ID ? _('Not available in this build: the GitLab application isn’t configured.')
            : !deviceOffered ? _('This instance doesn’t offer browser sign-in for apps (GitLab 17.1 or later does).') : null,
        works: [_('Every project you can view'), _('Comment, close, label and assign'), _('Grouping git submodules on its own')],
        wont: dotCom ? [] : [_('Instances older than GitLab 17.1')],
    }, {
        id: 'pat', method: 'pat',
        title: _('Personal access token'),
        note: _('Every project you can view. Group and project access tokens reach only their own group or project, so they don’t suit Source Glance.'),
        tokenUrl: urls.newToken,
        tokenHint: _('Scope: api (or read_api to only read).'),
        works: [_('Every project you can view'), _('Comment, close, label and assign, with the api scope'),
            _('Grouping git submodules on its own')],
        wont: [_('Changing anything with read_api: it only reads'),
            _('Group and project access tokens: they reach only their own group or project')],
    }];

    return {
        platform: 'gitlab',
        base,
        methods,
        describeError,
        createClient: () => new GitLabClient(version, {base}),
        /** Device flow: `onCode(code)` shows the code. Resolves to {login, secret}. */
        async device(client, _method, clientId, onCode, cancellable) {
            const code = await client.requestDeviceCode(clientId, cancellable);
            onCode(code);
            const auth = await client.waitForDeviceToken(clientId, code, cancellable);
            const viewer = await client.getViewer(auth.access, cancellable);
            return {login: viewer.username, secret: JSON.stringify(auth)};
        },
        /** A pasted personal access token: stored like a sign-in that never needs renewing. */
        async token(client, text, cancellable) {
            const viewer = await client.getViewer(text, cancellable);
            return {login: viewer.username, secret: JSON.stringify({access: text, refresh: null, expiresAt: null})};
        },
    };
}
