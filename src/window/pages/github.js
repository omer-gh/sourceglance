// Accounts, GitHub: how to sign in to github.com or GitHub Enterprise Server, for the add-account
// dialog (addAccount.js).

import {gettext as _} from '../i18n.js';

import {GITHUB_COM, githubUrls} from '../../lib/accounts.js';
import {GITHUB_APP_CLIENT_ID, OAUTH_CLIENT_ID, SHOW_OTHER_SIGN_IN_OPTIONS} from '../../lib/config.js';
import {DeviceFlowError, GitHubClient, GitHubError} from '../../lib/github.js';
import {FULL_ACCESS_SCOPE} from '../../lib/model.js';

export function describeError(error) {
    if (error instanceof DeviceFlowError) {
        switch (error.kind) {
        case 'expired':
            return _('The sign-in code expired. Try again.');
        case 'denied':
            return _('Sign-in was cancelled on GitHub.');
        default:
            return _('GitHub sign-in failed (%s).').format(error.detail);
        }
    }
    if (!(error instanceof GitHubError))
        return _('Something went wrong: %s').format(error.message);
    switch (error.kind) {
    case 'auth':
        return _('GitHub rejected this sign-in.');
    case 'forbidden':
        return _('This token doesn’t have the required permissions.');
    case 'rate-limit':
        return _('GitHub rate limit reached. Try again later.');
    case 'network':
        return _('Couldn’t connect. Check the address and your connection, and that this computer trusts the instance’s certificate.');
    case 'insecure':
        return _('This address uses plain http:// but isn’t on your local network. Use https://.');
    default:
        return _('GitHub returned an error (HTTP %d).').format(error.status);
    }
}

/**
 * Signing in to GitHub, for the add-account dialog. `base` is github.com or a GitHub
 * Enterprise Server instance. Each method says which repositories it reaches (the notes come
 * from GitHub's documentation on GitHub Apps, OAuth apps and personal access tokens).
 */
export function githubProvider({version, base = GITHUB_COM}) {
    const dotCom = base === GITHUB_COM;
    const urls = githubUrls(base);
    const methods = [];
    if (dotCom) {
        methods.push({
            id: 'app', method: 'device', clientId: GITHUB_APP_CLIENT_ID, scope: null,
            title: _('Sign in with GitHub'),
            note: _('Only repositories where the Source Glance app is installed: yours and those of organizations that install it. Other public repositories are read-only.'),
            unavailable: GITHUB_APP_CLIENT_ID ? null : _('Not available in this build: the GitHub App isn’t configured.'),
            works: [_('Issues and pull requests assigned to you, where the app is installed'),
                _('Comment, close, label and assign there'),
                _('Project boards (an organization’s once the app is installed)')],
            wont: [_('Repositories without the app (public ones are read-only)'),
                _('Grouping git submodules on its own: the app can’t read code')],
        });
        if (SHOW_OTHER_SIGN_IN_OPTIONS && OAUTH_CLIENT_ID) {
            // GitHub Apps ignore scopes; this OAuth App needs `repo` and `project`.
            methods.push({
                id: 'oauth', method: 'device', clientId: OAUTH_CLIENT_ID, scope: FULL_ACCESS_SCOPE,
                title: _('Sign in with full access'),
                note: _('Every repository you can view, unless an organization blocks third-party apps. Grants write access to all of them.'),
                works: [_('Every repository you can view'), _('Project boards'), _('Grouping git submodules on its own')],
                wont: [_('Organizations that block third-party apps'), _('Narrow permissions: it can write to every repository')],
            });
        }
    } else {
        methods.push({
            id: 'device', method: 'device', clientId: null, needsClientId: true, scope: FULL_ACCESS_SCOPE,
            title: _('Sign in with the browser'),
            note: _('With an OAuth app: every repository you can view, unless an organization restricts OAuth apps. With a GitHub App: only repositories where that app is installed. You register the app on your instance, with Device Flow enabled.'),
            registerUrl: urls.newApp,
            works: [_('Everything the app you register can reach'), _('Comment, close, label and assign')],
            wont: [_('Repositories without the app, if it’s a GitHub App'),
                _('Grouping git submodules on its own, unless it’s an OAuth app')],
        });
    }
    methods.push({
        id: 'pat', method: 'pat',
        title: _('Personal access token'),
        note: dotCom
            ? _('Fine-grained token: only the repositories of one owner, you or one organization (which may need to approve it). Classic token with the repo scope: every repository you can view.')
            : _('Classic token with the repo scope: every repository you can view. Fine-grained token (where your instance offers it): only the repositories of one owner, you or one organization.'),
        tokenUrl: urls.newToken,
        tokenHint: dotCom
            ? _('Fine-grained: Issues and Pull requests (read and write), Metadata (read); Contents (read) only if you want submodules found. Classic: repo and project.')
            : _('Scopes: repo and project.'),
        works: [_('Issues, pull requests, comments, labels and assignees, as far as the token allows'),
            _('Grouping git submodules on its own, with Contents (read) or the repo scope')],
        wont: [dotCom ? _('Repositories of other owners: a fine-grained token covers one owner')
            : _('Repositories the token can’t see'),
        _('Organizations that haven’t approved the token')],
    });

    return {
        platform: 'github',
        base,
        methods,
        describeError,
        createClient: () => new GitHubClient(version, base),
        /** Device flow: `onCode(code)` shows the code. Resolves to {login, secret}. */
        async device(client, method, clientId, onCode, cancellable) {
            const code = await client.requestDeviceCode(clientId, method.scope, cancellable);
            onCode(code);
            const token = await client.waitForDeviceToken(clientId, code, cancellable);
            return {login: await client.getViewer(token, cancellable), secret: token};
        },
        /** A pasted token, checked by reading the user. Resolves to {login, secret}. */
        async token(client, text, cancellable) {
            return {login: await client.getViewer(text, cancellable), secret: text};
        },
    };
}
