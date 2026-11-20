// Accounts → an account's Limit repositories and boards, in the window's right-hand panel: where to
// widen or narrow what the sign-in can reach (GitHub's own page), which repositories the github.com
// lists watch, and which project boards show. Repositories and boards are folded into one
// accordion per organization; its switch turns all of that organization's repositories (or boards)
// off or on and the organization stays listed. All of it is kept in Source Glance's settings.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {GITHUB_COM, accountTitle, githubUrls} from '../../lib/accounts.js';
import {GITHUB_APP_CLIENT_ID, GITHUB_APP_SLUG} from '../../lib/config.js';
import {appInstallUrl, parseRepoList} from '../../lib/model.js';
import {boardKey, boardOwner, setHiddenBoards} from '../../lib/projects.js';
import {
    MAX_PAGES,
    addWatched,
    availableRepos,
    isWatched,
    mayHaveMore,
    parseRepos,
    reposByOrganization,
    parseSearchRepos,
    reposRequest,
    searchReposRequest,
    setWatched,
} from '../../lib/repoAccess.js';
import {collapsibleGroup} from './common.js';

/** A switch for an accordion's header: all of its organization's repositories or boards. */
function masterSwitch(label) {
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, margin_end: 6});
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    return toggle;
}

/**
 * `ctx` is {window, settings, clients, names, projects, panel, boardsOf(account)}: `panel` the
 * window's right panel, `names` the DisplayNames, `projects` the ProjectStore (it has seen
 * repositories on your items) and `boardsOf` the account's boards as {boards, error}. Pressing the
 * button again closes the panel.
 */
export function openAccountAccessPanel({window, settings, clients, names, projects, panel, boardsOf}, account) {
    const owner = `access:${account.id}`;
    if (panel.isFor(owner)) {
        panel.hide();
        return;
    }
    const page = new Adw.PreferencesPage();

    const dotCom = account.base === GITHUB_COM;
    const usesApp = account.clientId !== null && account.clientId === GITHUB_APP_CLIENT_ID;

    // What the sign-in can reach is decided on GitHub: first, since it widens everything below.
    const accessUrl = usesApp ? appInstallUrl(GITHUB_APP_SLUG)
        : dotCom ? 'https://github.com/settings/personal-access-tokens' : `${githubUrls(account.base).newToken.replace(/\/new$/, '')}`;
    if (accessUrl) {
        const access = new Adw.PreferencesGroup({title: _('Access on GitHub')});
        const row = new Adw.ActionRow({
            title: usesApp ? _('Limit or expand the repositories this app can reach') : _('Limit or expand what this token can reach'),
            subtitle: usesApp
                ? _('Pick the repositories the Source Glance app may change and, if private, see')
                : _('Change the token’s repositories and permissions on GitHub'),
            activatable: true,
            use_markup: false,
        });
        row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        row.connect('activated', () => new Gtk.UriLauncher({uri: accessUrl}).launch(window, null, null));
        access.add(row);
        page.add(access);
    }

    // Repositories to watch: github.com only (the lists load other instances in full).
    if (dotCom) {
        const available = new Adw.PreferencesGroup({
            title: _('Watch repositories'),
            description: _('Choose which repositories show in your lists, and search GitHub for public ones to add. Switch an organization off to stop watching all of its repositories.'),
        });
        // A search box for finding public repositories on GitHub (it doesn't filter your own list below): the
        // matches show under it with an Add button, and a full owner/name entered with Enter is added.
        // Adding keeps what's already watched (an empty list means all).
        const search = new Gtk.SearchEntry({placeholder_text: _('Find a public repository to add'), hexpand: true,
            sensitive: false, margin_bottom: 8});
        const results = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list'],
            visible: false, margin_bottom: 12});
        const loading = new Gtk.Label({label: _('Loading…'), xalign: 0, css_classes: ['dim-label']});
        available.add(search);
        available.add(results);
        available.add(loading);
        page.add(available);
        const switches = new Map();
        // Per organization: its repositories, its master switch and its count.
        const accordions = new Map();
        let all = [];
        let syncing = false;
        const resync = () => {
            syncing = true;
            const watched = settings.get_strv('repositories');
            for (const [repo, row] of switches)
                row.active = isWatched(watched, repo);
            for (const {repos, master, group} of accordions.values()) {
                const on = repos.filter(repo => isWatched(watched, repo));
                master.active = on.length > 0;
                group.setCount(`${on.length}/${repos.length}`);
            }
            syncing = false;
        };
        const change = (repos, on) => {
            settings.set_strv('repositories', setWatched(settings.get_strv('repositories'), all, repos, on));
            // A change the list refused (the last ones can't go off) puts the switches back.
            resync();
        };
        const addSwitch = (group, repo) => {
            const row = new Adw.SwitchRow({title: repo, use_markup: false,
                active: isWatched(settings.get_strv('repositories'), repo)});
            row.connect('notify::active', () => {
                if (!syncing)
                    change([repo], row.active);
            });
            switches.set(repo, row);
            group.add(row);
        };
        const addOrganization = ({organization, repos}) => {
            const master = masterSwitch(_('Watch all repositories of %s').format(organization));
            const group = collapsibleGroup({title: names.label(account, organization), count: `${repos.length}/${repos.length}`,
                collapsed: true, suffix: master, onToggle: () => {}});
            master.connect('notify::active', () => {
                if (!syncing)
                    change(accordions.get(organization.toLowerCase()).repos, master.active);
            });
            accordions.set(organization.toLowerCase(), {repos, master, group});
            for (const repo of repos)
                addSwitch(group, repo);
            available.add(group);
        };
        const handler = settings.connect('changed::repositories', resync);
        page.connect('unrealize', () => settings.disconnect(handler));
        const known = repo => all.some(other => other.toLowerCase() === repo.toLowerCase());
        const addRepos = repos => {
            const fresh = repos.filter(repo => !known(repo));
            if (fresh.length === 0)
                return;
            const next = addWatched(settings.get_strv('repositories'), all, fresh);
            for (const repo of fresh) {
                all = availableRepos([...all, repo]);
                const {organization} = reposByOrganization([repo])[0];
                const existing = accordions.get(organization.toLowerCase());
                if (existing) {
                    existing.repos.push(repo);
                    addSwitch(existing.group, repo);
                } else {
                    addOrganization({organization, repos: [repo]});
                }
            }
            settings.set_strv('repositories', next);
            resync();
        };
        const showResults = found => {
            for (let row = results.get_first_child(); row; row = results.get_first_child())
                results.remove(row);
            for (const {name, description, stars} of found) {
                const row = new Adw.ActionRow({title: name, use_markup: false, subtitle: description || null,
                    subtitle_lines: 1});
                if (stars > 0)
                    row.add_prefix(new Gtk.Label({label: `★ ${stars.toLocaleString()}`, css_classes: ['dim-label', 'caption']}));
                const add = new Gtk.Button({label: known(name) ? _('Added') : _('Add'), valign: Gtk.Align.CENTER,
                    sensitive: !known(name), css_classes: ['flat']});
                add.connect('clicked', () => {
                    addRepos([name]);
                    add.label = _('Added');
                    add.sensitive = false;
                });
                row.add_suffix(add);
                results.append(row);
            }
            results.visible = found.length > 0;
        };
        // Searches GitHub shortly after you stop typing; an older answer never replaces a newer one.
        let searchToken = 0;
        let searchTimer = 0;
        const runSearch = async () => {
            searchTimer = 0;
            const query = search.get_text().trim();
            const mine = ++searchToken;
            if (query.length < 2) {
                showResults([]);
                return;
            }
            try {
                const token = await clients.tokenFor(account);
                const client = token ? clients.clientFor(account) : null;
                const found = client ? parseSearchRepos(await client.send(token, searchReposRequest(query))) : [];
                if (mine === searchToken)
                    showResults(found);
            } catch {
                if (mine === searchToken)
                    showResults([]);
            }
        };
        search.connect('search-changed', () => {
            if (searchTimer)
                GLib.source_remove(searchTimer);
            searchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                runSearch();
                return GLib.SOURCE_REMOVE;
            });
        });
        page.connect('unrealize', () => {
            if (searchTimer)
                GLib.source_remove(searchTimer);
            searchTimer = 0;
            searchToken++;
        });
        // A full owner/name you type is added on Enter, without waiting for a search.
        search.connect('activate', () => {
            const {repos, invalid} = parseRepoList(search.get_text());
            if (invalid.length > 0 || repos.length === 0)
                return;
            addRepos(repos);
            search.set_text('');
            showResults([]);
        });
        (async () => {
            const found = [];
            try {
                const token = await clients.tokenFor(account);
                const client = token ? clients.clientFor(account) : null;
                for (let n = 1; client && n <= MAX_PAGES; n++) {
                    const json = await client.send(token, reposRequest(n));
                    found.push(...parseRepos(json));
                    if (!mayHaveMore(json))
                        break;
                }
            } catch {
                // What the lists have seen is still offered.
            }
            // Repositories already on the list that this sign-in doesn't show (a public one) are here too.
            all = availableRepos(found, [...projects.seenRepos(), ...settings.get_strv('repositories')]);
            available.remove(loading);
            search.sensitive = true;
            if (all.length === 0)
                available.add(new Gtk.Label({label: _('No repositories found'), xalign: 0, css_classes: ['dim-label']}));
            for (const organization of reposByOrganization(all))
                addOrganization(organization);
            resync();
        })();
    }

    // Project boards, one accordion per owner: its switch hides or shows all of that owner's boards.
    const boardsGroup = new Adw.PreferencesGroup({
        title: _('Project boards'),
        description: _('Switch an organization off to hide all of its boards, or untick single ones. Hidden boards stay in Source Glance’s settings and nothing changes on GitHub.'),
    });
    const {boards, error} = boardsOf(account);
    if (boards.length === 0) {
        boardsGroup.add(new Adw.ActionRow({
            title: error ? _('Can’t read the project boards of this account') : _('No project boards found'),
            subtitle: error ? _('Organization boards need the Source Glance app installed on the organization.') : '',
            use_markup: false, css_classes: ['dim-label']}));
    }
    const owners = new Map();
    for (const board of boards) {
        const login = boardOwner(board);
        if (!owners.has(login.toLowerCase()))
            owners.set(login.toLowerCase(), {login, boards: []});
        owners.get(login.toLowerCase()).boards.push(board);
    }
    const boardRows = new Map();
    const boardAccordions = [];
    let boardSyncing = false;
    const resyncBoards = () => {
        boardSyncing = true;
        const hidden = settings.get_strv('hidden-boards');
        for (const [key, row] of boardRows)
            row.active = !hidden.includes(key);
        for (const {keys, master, group} of boardAccordions) {
            const shown = keys.filter(key => !hidden.includes(key));
            master.active = shown.length > 0;
            group.setCount(`${shown.length}/${keys.length}`);
        }
        boardSyncing = false;
    };
    const hiddenHandler = settings.connect('changed::hidden-boards', resyncBoards);
    page.connect('unrealize', () => settings.disconnect(hiddenHandler));
    for (const {login, boards: ownerBoards} of [...owners.values()].sort((a, b) => a.login.localeCompare(b.login))) {
        const keys = ownerBoards.map(board => boardKey(board));
        const title = login ? names.label(account, login) : _('Other boards');
        const master = masterSwitch(_('Show all project boards of %s').format(title));
        const group = collapsibleGroup({title, count: `${keys.length}/${keys.length}`,
            collapsed: true, suffix: master, onToggle: () => {}});
        master.connect('notify::active', () => {
            if (!boardSyncing)
                settings.set_strv('hidden-boards', setHiddenBoards(settings.get_strv('hidden-boards'), keys, !master.active));
        });
        boardAccordions.push({keys, master, group});
        for (const board of ownerBoards) {
            const key = boardKey(board);
            const row = new Adw.SwitchRow({title: board.title, use_markup: false,
                subtitle: board.url ? board.url.replace(/^https:\/\//, '') : '',
                active: !settings.get_strv('hidden-boards').includes(key)});
            row.connect('notify::active', () => {
                if (!boardSyncing)
                    settings.set_strv('hidden-boards', setHiddenBoards(settings.get_strv('hidden-boards'), [key], !row.active));
            });
            boardRows.set(key, row);
            group.add(row);
        }
        boardsGroup.add(group);
    }
    resyncBoards();
    page.add(boardsGroup);

    panel.show({title: _('Limit repositories & boards'), subtitle: accountTitle(account), child: page, owner, overlay: true});
}
