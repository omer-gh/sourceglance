// The add-account dialog (ADR 0007). For github.com and gitlab.com it starts at the choice of
// sign-in method. "Connect a self-hosted instance" first asks for the platform and the
// instance's address, checks that it's reachable and really that platform, then signs in.
// Each sign-in method says which repositories it reaches.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {saveAccount} from '../../lib/accountStore.js';
import {
    GITHUB_COM,
    GITLAB_COM,
    accountId,
    accountTitle,
    hostLabel,
    httpAllowed,
    isValidClientId,
    parseInstanceUrl,
} from '../../lib/accounts.js';
import {GitHubClient, isCancelled} from '../../lib/github.js';
import {GitLabClient} from '../../lib/gitlab.js';
import {githubProvider} from './github.js';
import {gitlabProvider} from './gitlab.js';

/** A page of the dialog: a header bar over a preferences page. */
function navPage(title, groups) {
    const content = new Adw.PreferencesPage();
    for (const group of groups)
        content.add(group);
    const view = new Adw.ToolbarView({content});
    view.add_top_bar(new Adw.HeaderBar());
    return new Adw.NavigationPage({title, child: view});
}

/** A row that leads to the next step. */
function nextRow(title, subtitle, onActivate) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true, use_markup: false});
    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    row.connect('activated', onActivate);
    return row;
}

/** Small ticks and crosses under a sign-in method: what works with it and what won't. */
function featureRow({works = [], wont = []}) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 3, margin_top: 4, margin_bottom: 10,
        margin_start: 14, margin_end: 14});
    const add = (iconName, cssClass, text) => {
        const line = new Gtk.Box({spacing: 8});
        line.append(new Gtk.Image({icon_name: iconName, css_classes: [cssClass], valign: Gtk.Align.START, pixel_size: 12,
            margin_top: 2}));
        line.append(new Gtk.Label({label: text, xalign: 0, wrap: true, hexpand: true, css_classes: ['caption']}));
        box.append(line);
    };
    for (const text of works)
        add('emblem-ok-symbolic', 'success', text);
    for (const text of wont)
        add('window-close-symbolic', 'error', text);
    return new Adw.PreferencesRow({child: box, activatable: false, focusable: false});
}

function linkRow(window, title, subtitle, uri) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true, use_markup: false});
    row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    row.connect('activated', () => new Gtk.UriLauncher({uri}).launch(window, null, null));
    return row;
}

/** A full-width button in a group of its own. */
function buttonGroup(label, onClick) {
    const group = new Adw.PreferencesGroup();
    const button = new Gtk.Button({label, css_classes: ['suggested-action', 'pill'], halign: Gtk.Align.CENTER});
    button.connect('clicked', onClick);
    group.add(button);
    return {group, button};
}

function urlErrorText(error) {
    switch (error) {
    case 'empty':
        return _('Enter the address of your instance.');
    case 'scheme':
        return _('Use an https:// address.');
    case 'credentials':
        return _('Leave out the user name and password: you sign in in the next step.');
    case 'query':
        return _('Enter just the address, without ? or #.');
    default:
        return _('That isn’t a valid address.');
    }
}

/**
 * Opens the dialog. `platform` and `base` given: github.com or gitlab.com start at the
 * sign-in methods; a self-hosted address starts at the check, filled in. Neither: the
 * self-hosted wizard from the start. `startWith: 'pat'` opens github.com at the token page.
 */
export function openAddAccountDialog({window, settings, version, toast}, {platform = null, base = null, startWith = null} = {}) {
    const dialog = new Adw.Dialog({title: _('Add an account'), content_width: 520, content_height: 620});
    const nav = new Adw.NavigationView();
    dialog.set_child(nav);
    const cancellable = new Gio.Cancellable();
    dialog.connect('closed', () => cancellable.cancel());

    const finish = async (provider, method, clientId, {login, secret}) => {
        const account = await saveAccount(settings, {
            id: accountId(provider.platform, provider.base, login),
            platform: provider.platform,
            base: provider.base,
            login,
            method: method.method,
            clientId: method.needsClientId ? clientId : null,
        }, secret);
        toast(_('Signed in: %s').format(accountTitle(account)));
        dialog.close();
    };

    // Sign in in the browser: show the code, copy it, open the instance's page, wait.
    const devicePage = (provider, method) => {
        const groups = [];
        let clientRow = null;
        if (method.needsClientId) {
            const register = new Adw.PreferencesGroup({
                title: _('Your application'),
                description: provider.platform === 'gitlab'
                    ? _('Register an application on your instance: name it Source Glance, untick Confidential, choose the api scope; any redirect address will do. Then paste its Application ID here.')
                    : _('Register an OAuth app on your instance with Enable Device Flow ticked; any callback address will do. Then paste its Client ID here.'),
            });
            register.add(linkRow(window, _('Register an application'), hostLabel(provider.base), method.registerUrl));
            clientRow = new Adw.EntryRow({title: provider.platform === 'gitlab' ? _('Application ID') : _('Client ID')});
            register.add(clientRow);
            groups.push(register);
        }
        const codeGroup = new Adw.PreferencesGroup({visible: false});
        const codeRow = new Adw.ActionRow({
            subtitle: _('Code copied. Paste it in the browser and approve. Waiting…'),
            title_selectable: true,
            css_classes: ['property'],
        });
        const reopen = new Gtk.Button({icon_name: 'adw-external-link-symbolic', tooltip_text: _('Open the page again'),
            valign: Gtk.Align.CENTER, css_classes: ['flat']});
        codeRow.add_suffix(reopen);
        codeGroup.add(codeRow);
        const {group: startGroup, button: start} = buttonGroup(_('Sign in'), () => {});
        groups.push(codeGroup, startGroup);

        let verificationUri = null;
        const openVerification = () => {
            if (verificationUri)
                new Gtk.UriLauncher({uri: verificationUri}).launch(window, null, null);
        };
        reopen.connect('clicked', openVerification);
        start.connect('clicked', async () => {
            const clientId = method.needsClientId ? clientRow.get_text().trim() : method.clientId;
            if (!isValidClientId(clientId)) {
                clientRow?.add_css_class('error');
                toast(_('Paste the ID of the application you registered.'));
                return;
            }
            clientRow?.remove_css_class('error');
            start.sensitive = false;
            if (clientRow)
                clientRow.sensitive = false;
            try {
                const client = provider.createClient();
                try {
                    const result = await provider.device(client, method, clientId, code => {
                        verificationUri = code.verificationUri;
                        codeRow.title = code.userCode;
                        codeGroup.visible = true;
                        window.get_clipboard().set_content(Gdk.ContentProvider.new_for_bytes(
                            'text/plain;charset=utf-8', new GLib.Bytes(new TextEncoder().encode(code.userCode))));
                        openVerification();
                    }, cancellable);
                    await finish(provider, method, clientId, result);
                } finally {
                    client.destroy();
                }
            } catch (e) {
                if (!isCancelled(e))
                    toast(provider.describeError(e));
            } finally {
                if (!cancellable.is_cancelled()) {
                    codeGroup.visible = false;
                    start.sensitive = true;
                    if (clientRow)
                        clientRow.sensitive = true;
                }
            }
        });
        return navPage(method.title, groups);
    };

    // Paste a personal access token.
    const tokenPage = (provider, method) => {
        const group = new Adw.PreferencesGroup({description: method.note});
        group.add(linkRow(window, _('Create a token'), method.tokenHint, method.tokenUrl));
        const tokenRow = new Adw.PasswordEntryRow({title: _('Token')});
        group.add(tokenRow);
        const signIn = async () => {
            const text = tokenRow.get_text().trim();
            if (!text)
                return;
            button.sensitive = false;
            tokenRow.sensitive = false;
            const client = provider.createClient();
            try {
                await finish(provider, method, null, await provider.token(client, text, cancellable));
            } catch (e) {
                if (!isCancelled(e))
                    toast(provider.describeError(e));
            } finally {
                client.destroy();
                if (!cancellable.is_cancelled()) {
                    button.sensitive = true;
                    tokenRow.sensitive = true;
                }
            }
        };
        const {group: buttons, button} = buttonGroup(_('Sign in'), signIn);
        tokenRow.connect('entry-activated', signIn);
        return navPage(method.title, [group, buttons]);
    };

    // The ways to sign in, each with what it reaches.
    const methodsPage = (provider, notice = null) => {
        const group = new Adw.PreferencesGroup({
            title: _('How to sign in'),
            description: notice ?? _('Each way reaches different repositories, as described under it.'),
        });
        for (const method of provider.methods) {
            const row = nextRow(method.title, method.unavailable ? `${method.note}\n${method.unavailable}` : method.note,
                () => nav.push(method.method === 'pat' ? tokenPage(provider, method) : devicePage(provider, method)));
            row.subtitle_lines = 0;
            row.sensitive = !method.unavailable;
            group.add(row);
            if (method.works?.length || method.wont?.length)
                group.add(featureRow(method));
        }
        const name = provider.platform === 'gitlab' ? 'GitLab' : 'GitHub';
        const title = provider.base === GITHUB_COM || provider.base === GITLAB_COM
            ? name : `${name} · ${hostLabel(provider.base)}`;
        return navPage(title, [group]);
    };

    // The self-hosted instance's address, checked before going on.
    const instancePage = (selfPlatform, prefill = '') => {
        const github = selfPlatform === 'github';
        const group = new Adw.PreferencesGroup({
            title: _('Address'),
            description: _('Use https://. Plain http:// works only for an instance on your local network (a private address such as 192.168.x.x), and Source Glance checks that each time it connects.'),
        });
        const urlRow = new Adw.EntryRow({
            title: github ? _('e.g. https://github.example.com') : _('e.g. https://gitlab.example.com'),
            text: prefill,
            input_purpose: Gtk.InputPurpose.URL,
        });
        group.add(urlRow);
        const result = new Adw.ActionRow({visible: false, use_markup: false, subtitle_lines: 0});
        group.add(result);
        const spinner = new Gtk.Spinner({visible: false});
        result.add_prefix(spinner);

        const check = async () => {
            const parsed = parseInstanceUrl(urlRow.get_text());
            const show = (title, subtitle = '') => {
                result.title = title;
                result.subtitle = subtitle;
                result.visible = true;
            };
            if (parsed.error) {
                show(urlErrorText(parsed.error));
                return;
            }
            if (parsed.base === GITHUB_COM || parsed.base === GITLAB_COM) {
                show(_('That’s %s itself: add it with its own button on the Accounts page.').format(hostLabel(parsed.base)));
                return;
            }
            if (!httpAllowed(parsed)) {
                show(_('Plain http:// is only for an instance on your local network. Use https://.'));
                return;
            }
            button.sensitive = false;
            spinner.visible = spinner.spinning = true;
            show(_('Checking %s…').format(hostLabel(parsed.base)));
            const client = github ? new GitHubClient(version, parsed.base) : new GitLabClient(version, {base: parsed.base});
            const provider = github ? githubProvider({version, base: parsed.base}) : null;
            try {
                const lan = parsed.scheme === 'http'
                    ? _('On your local network over plain http://: your sign-in crosses it unencrypted.') : null;
                if (github) {
                    const meta = await client.probeEnterprise(cancellable);
                    if (!meta) {
                        show(_('No GitHub Enterprise Server answers at this address.'),
                            _('Check the address. github.com and GitHub Enterprise Cloud are added with the GitHub button.'));
                        return;
                    }
                    nav.push(methodsPage(provider, [_('GitHub Enterprise Server %s found.').format(meta.version), lan]
                        .filter(Boolean).join(' ')));
                } else {
                    const probe = await client.probe(cancellable);
                    if (!probe) {
                        show(_('No GitLab answers at this address.'),
                            _('Check the address, including the path if GitLab runs under one (e.g. /gitlab).'));
                        return;
                    }
                    nav.push(methodsPage(gitlabProvider({version, base: parsed.base, probe}),
                        [probe.device ? _('GitLab found.') : _('GitLab found. Browser sign-in for apps needs GitLab 17.1 or later; use a personal access token.'), lan]
                            .filter(Boolean).join(' ')));
                }
                result.visible = false;
            } catch (e) {
                if (!isCancelled(e))
                    show((provider ?? gitlabProvider({version, base: parsed.base})).describeError(e));
            } finally {
                client.destroy();
                if (!cancellable.is_cancelled()) {
                    spinner.visible = spinner.spinning = false;
                    button.sensitive = true;
                }
            }
        };
        const {group: buttons, button} = buttonGroup(_('Check'), check);
        urlRow.connect('entry-activated', check);
        if (prefill)
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                check();
                return GLib.SOURCE_REMOVE;
            });
        return navPage(github ? _('GitHub Enterprise Server') : _('GitLab self-managed'), [group, buttons]);
    };

    const platformPage = () => {
        const group = new Adw.PreferencesGroup({
            title: _('Platform'),
            description: _('Which platform does your instance run?'),
        });
        group.add(nextRow(_('GitLab self-managed'),
            _('Browser sign-in on GitLab 17.1 or later, or a personal access token on any version'),
            () => nav.push(instancePage('gitlab'))));
        group.add(nextRow(_('GitHub Enterprise Server'),
            _('Browser sign-in with an app you register on the instance, or a personal access token'),
            () => nav.push(instancePage('github'))));
        return navPage(_('Connect a self-hosted instance'), [group]);
    };

    if (platform === 'github' && base === GITHUB_COM) {
        const provider = githubProvider({version});
        nav.add(methodsPage(provider));
        // `startWith: 'pat'` goes straight to pasting a token, with the ways to sign in one step back.
        const token = provider.methods.find(method => method.id === 'pat');
        if (startWith === 'pat' && token)
            nav.push(tokenPage(provider, token));
    }
    else if (platform === 'gitlab' && base === GITLAB_COM)
        nav.add(methodsPage(gitlabProvider({version})));
    else if (platform && base)
        nav.add(instancePage(platform, base));
    else
        nav.add(platformPage());
    dialog.present(window);
}
