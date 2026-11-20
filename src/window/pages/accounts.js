// The Accounts part of Settings: every signed-in account, adding
// one (github.com, gitlab.com, or a self-hosted instance through the wizard in addAccount.js).
// Each GitHub account has a Limit repositories & boards button, opening the right panel. Returns the page with these groups and the groups by id, so the
// Settings page can add its own after them and scroll to any section.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {loadAccounts, removeAccount} from '../../lib/accountStore.js';
import {GITHUB_COM, GITLAB_COM, accountTitle, hostLabel, isDefaultBase} from '../../lib/accounts.js';
import {GITHUB_APP_CLIENT_ID} from '../../lib/config.js';
import {GitHubError, isCancelled} from '../../lib/github.js';
import {openAddAccountDialog} from './addAccount.js';
import {openAccountAccessPanel} from './accountAccess.js';
import {makeScroller} from './scrollTo.js';
import {buildOrganizationsGroup} from './organizations.js';
import {buildProjectsGroup} from './projectsPanel.js';

function methodText(account) {
    return account.method === 'pat' ? _('Personal access token') : _('Browser sign-in');
}

function checkErrorText(error) {
    if (!(error instanceof GitHubError))
        return _('Couldn’t check the sign-in');
    switch (error.kind) {
    case 'auth':
        return _('Sign-in rejected: sign in again');
    case 'insecure':
        return _('Not on your local network now (plain http://)');
    case 'network':
        return _('Couldn’t reach the instance');
    default:
        return _('Couldn’t check the sign-in (HTTP %d)').format(error.status);
    }
}

/** `ctx` is {window, settings, clients, version, toast, panel, boardsOf}. Returns {page, scrollTo(id), preferencesPage}: the Accounts page (`id` accounts or add) and the Preferences page. */
export function buildAccountsPage(ctx) {
    const {window, settings, clients, toast} = ctx;
    const page = new Adw.PreferencesPage();

    const list = new Adw.PreferencesGroup({
        title: _('Accounts'),
        description: _('Items from every account show in the lists, each account in its own section. Changes run as the account the item came from.'),
    });
    page.add(list);
    const organizations = buildOrganizationsGroup(ctx);
    const projects = buildProjectsGroup(ctx).group;
    let rows = [];

    const confirmRemove = account => {
        const dialog = new Adw.AlertDialog({
            heading: _('Sign out of %s?').format(accountTitle(account)),
            body: _('Source Glance forgets this account’s sign-in from the keyring and stops showing its items. A personal access token stays valid until you revoke it on the instance.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('remove', _('Sign out'));
        dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', async (_dialog, response) => {
            if (response !== 'remove')
                return;
            try {
                await removeAccount(settings, account);
                toast(_('Signed out of %s').format(accountTitle(account)));
            } catch (e) {
                toast(_('Couldn’t sign out: %s').format(e.message));
            }
        });
        dialog.present(window);
    };

    const accountRow = account => {
        const row = new Adw.ActionRow({
            title: accountTitle(account),
            subtitle: `${isDefaultBase(account.platform, account.base) ? '' : `${hostLabel(account.base)} · `}${methodText(account)} · ${_('Checking…')}`,
            use_markup: false,
        });
        row.add_prefix(new Gtk.Image({icon_name: 'avatar-default-symbolic'}));
        const again = new Gtk.Button({label: _('Sign in again'), valign: Gtk.Align.CENTER, visible: false});
        again.connect('clicked', () => openAddAccountDialog(ctx, {platform: account.platform, base: account.base}));
        const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: _('Sign out'),
            valign: Gtk.Align.CENTER, css_classes: ['flat']});
        remove.connect('clicked', () => confirmRemove(account));
        row.add_suffix(again);
        // Which repositories and project boards this account brings in (GitHub accounts).
        if (account.platform === 'github') {
            const select = new Gtk.Button({label: _('Limit repositories & boards'), valign: Gtk.Align.CENTER,
                css_classes: ['flat'], tooltip_text: _('Choose repositories and project boards, and widen or limit access')});
            select.connect('clicked', () => openAccountAccessPanel(ctx, account));
            row.add_suffix(select);
        }
        // The default GitHub sign-in can't read code, so it can't find submodules: a fine-grained
        // token you choose can (its own repositories and permissions).
        if (account.platform === 'github' && account.base === GITHUB_COM && account.clientId === GITHUB_APP_CLIENT_ID) {
            const token = new Gtk.Button({label: _('Use a fine-grained token'), valign: Gtk.Align.CENTER,
                css_classes: ['flat'], tooltip_text: _('Sign in to this account with a fine-grained personal access token')});
            token.connect('clicked', () => openAddAccountDialog(ctx, {platform: 'github', base: GITHUB_COM, startWith: 'pat'}));
            row.add_suffix(token);
        }
        row.add_suffix(remove);
        const prefix = row.subtitle.slice(0, row.subtitle.lastIndexOf(' · '));
        (async () => {
            try {
                const token = await clients.tokenFor(account);
                if (!token) {
                    row.subtitle = `${prefix} · ${_('Not signed in')}`;
                    again.visible = true;
                    return;
                }
                await clients.clientFor(account).getViewer(token);
                row.subtitle = `${prefix} · ${_('Signed in')}`;
            } catch (e) {
                if (isCancelled(e))
                    return;
                row.subtitle = `${prefix} · ${checkErrorText(e)}`;
                again.visible = e instanceof GitHubError && e.kind === 'auth';
            }
        })();
        return row;
    };

    const rebuild = async () => {
        let accounts;
        try {
            accounts = await loadAccounts(settings);
        } catch (e) {
            console.warn(`sourceglance: couldn’t read the accounts: ${e.message}`);
            accounts = [];
        }
        for (const row of rows)
            list.remove(row);
        rows = accounts.length ? accounts.map(accountRow)
            : [new Adw.ActionRow({title: _('No accounts yet. Add one below.'), css_classes: ['dim-label']})];
        for (const row of rows)
            list.add(row);
        organizations.refresh(accounts);
    };
    const changedId = settings.connect('changed::accounts', () => rebuild());
    window.connect('close-request', () => {
        settings.disconnect(changedId);
        return false;
    });
    rebuild();

    const add = new Adw.PreferencesGroup({
        title: _('Add an account'),
        description: _('You can add several accounts of each, for example a personal and a work account.'),
    });
    const addRow = (title, subtitle, options) => {
        const row = new Adw.ActionRow({title, subtitle, activatable: true});
        row.add_suffix(new Gtk.Image({icon_name: 'list-add-symbolic'}));
        row.connect('activated', () => openAddAccountDialog(ctx, options));
        add.add(row);
    };
    addRow('GitHub', 'github.com', {platform: 'github', base: GITHUB_COM});
    addRow('GitLab', 'gitlab.com', {platform: 'gitlab', base: GITLAB_COM});
    addRow(_('Connect a self-hosted instance'), _('GitLab self-managed or GitHub Enterprise Server'), {});
    page.add(add);

    // Preferences is its own page: big tabs for the organizations found for the accounts (and the names
    // they're grouped by) and for the projects.
    // The tab names are the titles; the groups keep only their descriptions.
    organizations.group.title = '';
    projects.title = '';
    const tabs = new Adw.ViewStack({vhomogeneous: false});
    tabs.add_titled(organizations.group, 'organizations', _('Organizations')).icon_name = 'system-users-symbolic';
    tabs.add_titled(projects, 'projects', _('Projects')).icon_name = 'folder-symbolic';
    const switcher = new Adw.ViewSwitcher({stack: tabs, policy: Adw.ViewSwitcherPolicy.WIDE, halign: Gtk.Align.CENTER,
        margin_top: 12, margin_bottom: 6, css_classes: ['sourceglance-main-tabs']});
    const preferencesPage = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    preferencesPage.append(switcher);
    preferencesPage.append(new Gtk.Separator());
    preferencesPage.append(new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true,
        child: new Adw.Clamp({child: tabs, maximum_size: 720, margin_top: 18, margin_bottom: 24, margin_start: 12, margin_end: 12})}));

    return {page, scrollTo: makeScroller(page, {accounts: list, add}), preferencesPage};
}
