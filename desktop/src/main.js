// The macOS window: accounts, settings and the Issues, Pull requests and Projects lists, using
// the shared code in src/lib. Text from the API is set with textContent, never as HTML.
import {removeAccount, saveAccount} from '@core/accountRegistry.js';
import {
    accountId,
    accountTitle,
    defaultBase,
    isDefaultBase,
    parseInstanceUrl,
    platformName,
} from '@core/accounts.js';
import {GITHUB_APP_CLIENT_ID, GITLAB_CLIENT_ID} from '@core/config.js';
import {listBadge} from '@core/model.js';
import {listen} from '@tauri-apps/api/event';

import {GitHubClient} from './platform/github.js';
import {GitLabClient} from './platform/gitlab.js';
import {
    Settings,
    allowInstance,
    copyDeviceCode,
    holdToken,
    openLink,
    secrets,
    setDockIcon,
    setStartAtLogin,
    startAtLogin,
    uninstall,
} from './platform/tauri.js';
import {Store} from './store.js';
import {LOCAL_NETWORK_TEXT, element, errorText, timeAgo} from './views.js';

const factory = {
    github: (version, base) => new GitHubClient(version, base),
    gitlab: (version, options) => new GitLabClient(version, options),
};

const $ = id => document.getElementById(id);

class App {
    constructor(settings) {
        this.settings = settings;
        this.store = new Store(settings, {follow: true});
        this.current = 'issues';
        this.signIn = null;
    }

    get accounts() {
        return this.store.accounts;
    }

    get state() {
        return this.store.state;
    }

    async start() {
        this._wire();
        this.store.connect(() => this.render());
        await listen('open-page', ({payload}) => this.openPage(payload));
        await this.store.start();
        // First run: the window opens before it can hear the popover ask for Accounts.
        if (this.accounts.length === 0)
            this.openPage('accounts');
    }

    /** "accounts", "settings" or "tasks" (the lists). */
    openPage(page) {
        $('accounts').hidden = page !== 'accounts';
        $('settings').hidden = page !== 'settings';
        if (page === 'settings')
            this._renderSettings();
    }

    _wire() {
        $('refresh').addEventListener('click', () => this.store.refresh());
        $('show-accounts').addEventListener('click', () => this.openPage($('accounts').hidden ? 'accounts' : 'tasks'));
        $('show-settings').addEventListener('click', () => this.openPage($('settings').hidden ? 'settings' : 'tasks'));
        for (const tab of document.querySelectorAll('[role=tab]')) {
            tab.addEventListener('click', () => {
                this.current = tab.dataset.list;
                this.render();
            });
        }
        for (const radio of document.querySelectorAll('input[name=method]'))
            radio.addEventListener('change', () => this._methodChanged());
        $('platform').addEventListener('change', () => this._methodChanged());
        $('add-account').addEventListener('submit', event => {
            event.preventDefault();
            this.addAccount().catch(e => this._signInFailed(e));
        });
        $('cancel-sign-in').addEventListener('click', () => this.signIn?.abort());

        // Settings: the menu bar, the Dock icon and starting at login.
        $('layout').addEventListener('change', () => this.settings.set('layout', $('layout').value));
        for (const box of document.querySelectorAll('input[name=button]')) {
            box.addEventListener('change', () => this.settings.set('toolbar-buttons',
                [...document.querySelectorAll('input[name=button]:checked')].map(b => b.value)));
        }
        $('dock-icon').addEventListener('change', async () => {
            await this.settings.set('show-dock-icon', $('dock-icon').checked);
            await setDockIcon($('dock-icon').checked);
        });
        $('start-at-login').addEventListener('change', async () => {
            const wanted = $('start-at-login').checked;
            try {
                await setStartAtLogin(wanted);
                await this.settings.set('start-automatically', wanted);
            } catch (e) {
                $('settings-message').textContent = `Couldn’t change the login item: ${e}`;
            }
            $('start-at-login').checked = await startAtLogin();
        });

        // Uninstall: asks first, in the page, then Rust removes the app and quits.
        $('uninstall').addEventListener('click', () => {
            $('uninstall-question').textContent = $('remove-data').checked
                ? 'Move Source Glance to the Trash and remove your sign-ins and settings? You’ll have to sign in again if you reinstall it.'
                : 'Move Source Glance to the Trash? Your sign-ins and settings are kept for when you reinstall it.';
            $('uninstall-confirm').hidden = false;
            $('uninstall').disabled = true;
        });
        $('uninstall-cancel').addEventListener('click', () => {
            $('uninstall-confirm').hidden = true;
            $('uninstall').disabled = false;
        });
        $('uninstall-yes').addEventListener('click', async () => {
            $('uninstall-yes').disabled = true;
            $('settings-message').textContent = 'Uninstalling…';
            try {
                await uninstall($('remove-data').checked);
                $('settings-message').textContent = 'Source Glance is in the Trash. Goodbye!';
            } catch (e) {
                $('settings-message').textContent = `Couldn’t uninstall: ${e}`;
                $('uninstall-confirm').hidden = true;
                $('uninstall').disabled = false;
                $('uninstall-yes').disabled = false;
            }
        });
    }

    async _renderSettings() {
        $('layout').value = this.settings.get('layout', 'separate');
        const buttons = this.settings.get('toolbar-buttons', ['issues', 'prs', 'projects']);
        for (const box of document.querySelectorAll('input[name=button]'))
            box.checked = buttons.includes(box.value);
        $('dock-icon').checked = this.settings.get('show-dock-icon', false);
        $('start-at-login').checked = await startAtLogin();
    }

    _methodChanged() {
        $('token-row').hidden = this._method() !== 'pat';
    }

    _method() {
        return document.querySelector('input[name=method]:checked').value;
    }

    _accountsMessage(text) {
        $('accounts-message').textContent = text;
    }

    _signInFailed(e) {
        if (e?.name === 'AbortError')
            this._signInMessage('Sign-in cancelled.');
        else if (e?.kind === 'local-network')
            this._signInMessage(LOCAL_NETWORK_TEXT);
        else
            this._signInMessage(`Sign-in failed: ${e?.kind ?? e?.message ?? e}`);
    }

    _signInMessage(text) {
        $('sign-in-message').textContent = text;
    }

    render() {
        this._renderStatus();
        this._renderCounts();
        this._renderAccounts();
        this._renderList();
    }

    _renderStatus() {
        const {status, problem, updatedAt: updated, refreshing} = this.state;
        let text = status === 'signed-out' ? 'Not signed in' : updated ? `Updated ${timeAgo(updated)}` : '';
        if (refreshing)
            text = 'Refreshing…';
        if (problem)
            text = `${problem.title}: ${problem.kind === 'signed-out' ? 'signed out' : problem.kind}`;
        $('status').textContent = text;
        $('status').classList.toggle('problem', Boolean(problem));
    }

    _renderCounts() {
        for (const badge of document.querySelectorAll('[data-count]'))
            badge.textContent = listBadge(badge.dataset.count, this.state) || '0';
        for (const tab of document.querySelectorAll('[role=tab]'))
            tab.setAttribute('aria-selected', String(tab.dataset.list === this.current));
    }

    _renderAccounts() {
        const list = $('account-list');
        list.replaceChildren(...this.accounts.map(account => {
            const remove = element('button', {text: 'Sign out', attrs: {type: 'button'}});
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                try {
                    // Taking the account off the list makes the popover reload.
                    await removeAccount(this.store.list, secrets, account);
                } catch (e) {
                    remove.disabled = false;
                    this._accountsMessage(`Couldn’t sign out of ${accountTitle(account)}: ${e?.message ?? e}`);
                }
            });
            return element('li', {}, [element('span', {text: accountTitle(account)}), remove]);
        }));
        $('no-accounts').hidden = this.accounts.length > 0;
    }

    _renderList() {
        const body = $('list-body');
        const sections = this.state.sources.map(source => {
            const heading = element('h3', {text: source.title});
            if (source.status === 'signed-out')
                return element('section', {className: 'source'}, [heading, element('p', {className: 'hint', text: 'Signed out. Sign in again under Accounts.'})]);
            if (source.status === 'error' && !source.updatedAt)
                return element('section', {className: 'source'}, [heading, element('p', {className: 'hint', text: errorText(source.error, this.state.intervalMinutes)})]);
            if (this.current === 'projects')
                return element('section', {className: 'source'}, [heading, ...this._boards(source)]);
            const groups = this.current === 'issues' ? source.groups : source.prGroups;
            if (groups.length === 0)
                return element('section', {className: 'source'}, [heading, element('p', {className: 'hint', text: 'Nothing assigned to you.'})]);
            return element('section', {className: 'source'}, [heading, ...groups.map(group => element('div', {className: 'group'}, [
                element('h4', {text: group.repo}),
                element('ul', {}, group.issues.map(item => this._item(item))),
            ]))]);
        });
        body.replaceChildren(...sections);
    }

    _item(item) {
        const link = element('a', {text: `#${item.number} ${item.title}`, attrs: {href: '#'}});
        link.addEventListener('click', event => {
            event.preventDefault();
            if (item.url)
                openLink(item.url).catch(e => console.warn('sourceglance: link refused', e));
        });
        const labels = item.labels.map(label => element('span', {className: 'label', text: label.name}));
        return element('li', {}, [link, ...labels]);
    }

    _boards(source) {
        if (source.platform !== 'github')
            return [element('p', {className: 'hint', text: 'Project boards are GitHub only.'})];
        if (source.boardsError)
            return [element('p', {className: 'hint', text: 'This sign-in can’t read your project boards.'})];
        return (source.boards ?? []).map(board => element('div', {className: 'group'}, [
            element('h4', {text: board.title}),
            element('ul', {}, board.drafts.map(draft => element('li', {text: `${draft.title}${draft.status ? ` · ${draft.status}` : ''}`}))),
        ]));
    }

    /** Adds a github.com, gitlab.com or self-hosted account. */
    async addAccount() {
        const platform = $('platform').value;
        const typed = $('instance').value.trim();
        const parsed = typed ? parseInstanceUrl(typed) : {base: defaultBase(platform)};
        if (parsed.error) {
            this._signInMessage('That isn’t a valid instance address.');
            return;
        }
        const base = parsed.base;
        const selfHosted = !isDefaultBase(platform, base);
        if (selfHosted) {
            await allowInstance(base);
            const client = factory[platform]('dev', platform === 'gitlab' ? {base} : base);
            const found = platform === 'gitlab' ? await client.probe() : await client.probeEnterprise();
            if (!found) {
                this._signInMessage(`No ${platformName(platform)} found at ${base}.`);
                return;
            }
        }
        const method = this._method();
        if (method === 'device' && selfHosted) {
            // Self-hosted browser sign-in needs the user's own OAuth app, which this form
            // doesn't ask for yet.
            this._signInMessage('On a self-hosted instance, sign in with a personal access token for now.');
            return;
        }
        const controller = new AbortController();
        this.signIn = controller;
        $('cancel-sign-in').hidden = false;
        try {
            const reference = method === 'pat'
                ? await holdToken(base, platform, $('token').value)
                : await this._device(platform, base, controller.signal);
            $('token').value = '';
            const login = await this._login(platform, base, reference, controller.signal);
            const account = await saveAccount(this.store.list, secrets, {
                id: accountId(platform, base, login),
                platform,
                base,
                login,
                method,
                clientId: null,
            }, reference);
            this._signInMessage(`Signed in: ${accountTitle(account)}`);
        } catch (e) {
            this._signInFailed(e);
        } finally {
            this.signIn = null;
            $('cancel-sign-in').hidden = true;
        }
    }

    async _device(platform, base, signal) {
        if (platform === 'gitlab') {
            const client = new GitLabClient('dev', {base});
            const code = await client.requestDeviceCode(GITLAB_CLIENT_ID, signal);
            this._showCode(code);
            return (await client.waitForDeviceToken(GITLAB_CLIENT_ID, code, signal)).access;
        }
        const client = new GitHubClient('dev', base);
        const code = await client.requestDeviceCode(GITHUB_APP_CLIENT_ID, null, signal);
        this._showCode(code);
        return client.waitForDeviceToken(GITHUB_APP_CLIENT_ID, code, signal);
    }

    _showCode(code) {
        this._signInMessage(`Enter the code ${code.userCode} in your browser, then approve. Waiting…`);
        copyDeviceCode(code.userCode).catch(e => console.warn('sourceglance: copying the code failed', e));
        openLink(code.verificationUri).catch(e => console.warn('sourceglance: link refused', e));
    }

    async _login(platform, base, reference, signal) {
        if (platform === 'gitlab')
            return (await new GitLabClient('dev', {base}).getViewer(reference, signal)).username;
        return new GitHubClient('dev', base).getViewer(reference, signal);
    }
}

const settings = await new Settings().load();
new App(settings).start();
