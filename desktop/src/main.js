// The macOS window, laid out like Ubuntu's (src/window/app.js): Glance (Widgets, System Tray),
// Tasks (All Tasks, Issues, Pull requests, Project Boards) and Settings (Accounts, Preferences,
// Startup, About), with search, Refresh and the Accounts card in the header. It uses the shared
// code in src/shared. Text from the API is set with textContent, never as HTML.
import {removeAccount, saveAccount} from '@shared/accountRegistry.js';
import {
    accountId,
    accountTitle,
    defaultBase,
    isDefaultBase,
    parseInstanceUrl,
    platformName,
} from '@shared/accounts.js';
import {AUTHOR_GITHUB, AUTHOR_NAME, GITHUB_APP_CLIENT_ID, GITLAB_CLIENT_ID, REPO_URL} from '@lib/config.js';
import {
    allTasks,
    draftTarget,
    filterTasks,
    isMine,
    itemMatches,
    itemRef,
    listBadge,
    normalizeGroupBy,
    organizationOf,
    searchTerms,
} from '@shared/model.js';
import {listen} from '@tauri-apps/api/event';

import {GitHubClient} from './platform/github.js';
import {GitLabClient} from './platform/gitlab.js';
import {
    Settings,
    allowInstance,
    quitApp,
    copyDeviceCode,
    holdToken,
    openLink,
    secrets,
    setDockIcon,
    setStartAtLogin,
    startAtLogin,
    uninstall,
} from './platform/tauri.js';
import {AccessPanel} from './accessPanel.js';
import {BoardsList} from './boardsList.js';
import {DisplayNames} from './displayNames.js';
import {ProjectStore} from './projectStore.js';
import {ProjectsEditor} from './projectsEditor.js';
import {Store} from './store.js';
import {WatchList} from './watchList.js';
import {ICONS, LOCAL_NETWORK_TEXT, element, errorText, groupsFor, iconNode, timeAgo, toolbarButtons} from './views.js';
import appIcon from '../../src/icons/sourceglance-app.svg';

const factory = {
    github: (version, base) => new GitHubClient(version, base),
    gitlab: (version, options) => new GitLabClient(version, options),
};

const $ = id => document.getElementById(id);

// The sections and their pages, as in Ubuntu's sidebar. Glance's two entries are parts of one
// page; the Tasks pages share the list page.
const SECTIONS = {
    glance: {title: 'Glance', pages: [
        {id: 'widgets', title: 'Widgets', icon: 'glance', page: 'page-glance', anchor: 'widgets'},
        {id: 'tray', title: 'System Tray', icon: 'settings', page: 'page-glance', anchor: 'tray'},
    ]},
    tasks: {title: 'Tasks', pages: [
        {id: 'tasks', title: 'All Tasks', icon: 'tasks', page: 'page-tasks', count: 'tasks'},
        {id: 'issues', title: 'Issues', icon: 'issues', page: 'page-tasks', count: 'issues'},
        {id: 'prs', title: 'Pull requests', icon: 'pr', page: 'page-tasks', count: 'prs'},
        {id: 'boards', title: 'Project Boards', icon: 'boards', page: 'page-tasks', count: 'boards'},
    ]},
    settings: {title: 'Settings', pages: [
        {id: 'accounts', title: 'Accounts', icon: 'assignees', page: 'accounts'},
        {id: 'settings-preferences', title: 'Preferences', icon: 'settings', page: 'page-preferences'},
        {id: 'settings-startup', title: 'Startup', icon: 'startup', page: 'page-startup'},
        {id: 'settings-about', title: 'About', icon: 'about', page: 'page-about'},
    ]},
};

// Other names pages are asked for by: the popover's menu and the older ids.
const ALIASES = {glance: 'widgets', settings: 'accounts', about: 'settings-about', preferences: 'settings-preferences',
    startup: 'settings-startup', projects: 'boards'};

function pageInfo(id) {
    const wanted = ALIASES[id] ?? id;
    for (const [section, {pages}] of Object.entries(SECTIONS)) {
        const page = pages.find(entry => entry.id === wanted);
        if (page)
            return {section, ...page};
    }
    return null;
}

class App {
    constructor(settings) {
        this.settings = settings;
        this.store = new Store(settings, {follow: true});
        // Organization names: the platform's, and the ones you set (Settings → Organizations).
        this.names = new DisplayNames(this.store.clients, settings);
        // Projects and the repositories to watch, as in Ubuntu's Preferences and Limit repositories.
        this.projects = new ProjectStore(settings, this.store.clients);
        this._organizations = 0;
        this.page = 'issues';
        this.signIn = null;
        // Which section shows; the page last open in each section is kept.
        this._lastPage = {glance: 'widgets', tasks: 'issues', settings: 'accounts'};
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
        this.names.connectChanged(() => this._renderOrganizations());
        this.projectsEditor = new ProjectsEditor({
            store: this.projects,
            list: $('project-list'),
            note: $('projects-note'),
            more: $('projects-more'),
            resetBox: $('projects-reset'),
            resetYes: $('projects-reset-yes'),
            resetCancel: $('projects-reset-cancel'),
            notify: text => {
                $('settings-message').textContent = text;
            },
        });
        // Limit repositories & boards, per GitHub account, in a panel at the window's right.
        this.access = new AccessPanel({
            panel: $('access-panel'),
            title: $('access-title'),
            subtitle: $('access-subtitle'),
            body: $('access-body'),
            close: $('access-close'),
            watchList: new WatchList({
                settings: this.settings,
                clients: this.store.clients,
                names: this.names,
                // Only github.com's items: the watch list is github.com's.
                seenRepos: () => this.state.sources
                    .filter(src => src.platform === 'github' && src.account.base === 'https://github.com')
                    .flatMap(src => (src.groups ?? []).concat(src.prGroups ?? []).map(group => group.repo)),
            }),
            boardsList: new BoardsList({settings: this.settings, names: this.names}),
            sourceOf: account => this.state.sources.find(src => src.account.id === account.id),
        });
        await listen('open-page', ({payload}) => this.openPage(payload));
        this.openPage('issues');
        await this.store.start();
        // First run: the window opens before it can hear the popover ask for Accounts.
        if (this.accounts.length === 0)
            this.openPage('accounts');
    }

    /** Shows a page by id (see SECTIONS), selecting its section and entry in the sidebars. */
    openPage(id) {
        const info = pageInfo(id) ?? pageInfo('issues');
        this.page = info.id;
        this._lastPage[info.section] = info.id;
        for (const button of document.querySelectorAll('[data-section]'))
            button.setAttribute('aria-current', String(button.dataset.section === info.section));
        $('section-title').textContent = SECTIONS[info.section].title;
        this._renderSectionPages(info.section);
        for (const page of document.querySelectorAll('.page'))
            page.hidden = page.id !== info.page;
        $('page-title').textContent = info.section === 'glance' ? 'Glance' : info.title;
        // Search is for the lists.
        $('search').hidden = info.section !== 'tasks';
        if (info.anchor)
            $(info.anchor).scrollIntoView({block: 'start'});
        else
            document.querySelector('.pages').scrollTop = 0;
        this._hideCard();
        if (info.section === 'tasks')
            this._renderList();
        else
            this._renderSettings();
    }

    /** The section's pages in the second sidebar, with counts for the lists. */
    _renderSectionPages(section) {
        $('section-pages').replaceChildren(...SECTIONS[section].pages.map(page => {
            const count = page.count ? listBadge(page.count, this.state) || '' : '';
            const button = element('button', {attrs: {'type': 'button', 'aria-current': String(page.id === this.page)}}, [
                iconNode(ICONS[page.icon]),
                element('span', {className: 'label', text: page.title}),
                ...count ? [element('span', {className: 'badge', text: count})] : [],
            ]);
            button.addEventListener('click', () => this.openPage(page.id));
            return element('li', {}, [button]);
        }));
    }

    _wire() {
        // Icons named in the page (data-icon) and the app icon.
        for (const node of document.querySelectorAll('[data-icon]')) {
            const url = ICONS[node.dataset.icon];
            node.style.maskImage = `url("${url}")`;
            node.style.webkitMaskImage = `url("${url}")`;
        }
        for (const image of document.querySelectorAll('.app-icon, .about-icon'))
            image.src = appIcon;
        $('about-version').textContent = `Version ${__APP_VERSION__}`;
        $('about-author').textContent = AUTHOR_NAME;
        $('about-author-login').textContent = `@${AUTHOR_GITHUB}`;
        const links = {
            author: `https://github.com/${AUTHOR_GITHUB}`,
            issues: `${REPO_URL}/issues`,
            fork: `${REPO_URL}/fork`,
            contributing: `${REPO_URL}/blob/main/CONTRIBUTING.md`,
        };
        for (const button of document.querySelectorAll('[data-link]'))
            button.addEventListener('click', () => openLink(links[button.dataset.link]).catch(e => console.warn('sourceglance: link refused', e)));

        for (const button of document.querySelectorAll('[data-section]'))
            button.addEventListener('click', () => this.openPage(this._lastPage[button.dataset.section]));
        $('exit').addEventListener('click', () => quitApp());
        $('refresh').addEventListener('click', () => this.store.refresh());
        $('search').addEventListener('input', () => this._renderList());
        $('accounts-button').addEventListener('click', () => ($('accounts-card').hidden ? this._showCard() : this._hideCard()));
        document.addEventListener('mousedown', event => {
            if (!$('accounts-card').hidden && !$('accounts-card').contains(event.target) && !$('accounts-button').contains(event.target))
                this._hideCard();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape')
                this._hideCard();
        });
        for (const tab of document.querySelectorAll('.big-tabs [role=tab]')) {
            tab.addEventListener('click', () => {
                for (const other of document.querySelectorAll('.big-tabs [role=tab]'))
                    other.setAttribute('aria-selected', String(other === tab));
                $('tab-organizations').hidden = tab.dataset.tab !== 'organizations';
                $('tab-projects').hidden = tab.dataset.tab !== 'projects';
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
        $('bar-enabled').addEventListener('change', () => this.settings.set('bar-enabled', $('bar-enabled').checked));
        for (const radio of document.querySelectorAll('input[name=layout]'))
            radio.addEventListener('change', () => this.settings.set('layout', radio.value));
        $('refresh-interval').addEventListener('change', () => {
            const minutes = Math.min(120, Math.max(1, Math.round(Number($('refresh-interval').value) || 10)));
            $('refresh-interval').value = String(minutes);
            this.settings.set('refresh-interval', minutes);
        });
        $('group-by').addEventListener('change', () => this.settings.set('group-by', $('group-by').value));
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
                $('startup-message').textContent = `Couldn’t change the login item: ${e}`;
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
            $('uninstall-message').textContent = 'Uninstalling…';
            try {
                await uninstall($('remove-data').checked);
                $('uninstall-message').textContent = 'Source Glance is in the Trash. Goodbye!';
            } catch (e) {
                $('uninstall-message').textContent = `Couldn’t uninstall: ${e}`;
                $('uninstall-confirm').hidden = true;
                $('uninstall').disabled = false;
                $('uninstall-yes').disabled = false;
            }
        });
    }

    async _renderSettings() {
        $('bar-enabled').checked = this.settings.get('bar-enabled', true) !== false;
        const layout = this.settings.get('layout', 'separate');
        for (const radio of document.querySelectorAll('input[name=layout]'))
            radio.checked = radio.value === layout;
        $('refresh-interval').value = String(this.settings.get('refresh-interval', 10));
        $('group-by').value = normalizeGroupBy(this.settings.get('group-by', 'project'));
        this._renderOrganizations();
        this.projectsEditor.render();
        const buttons = toolbarButtons(this.settings);
        for (const box of document.querySelectorAll('input[name=button]'))
            box.checked = buttons.includes(box.value);
        $('dock-icon').checked = this.settings.get('show-dock-icon', false);
        $('start-at-login').checked = await startAtLogin();
    }

    /**
     * Settings → Organizations, as on Ubuntu (src/window/pages/organizations.js): one row per
     * organization login across accounts, the platforms that have it, and an editable name that
     * offers every organization's name. Typing waits for Enter or leaving the field.
     */
    async _renderOrganizations() {
        if ($('page-preferences').hidden)
            return;
        const list = $('organization-list');
        // Don't redraw under someone typing a name.
        if (list.contains(document.activeElement))
            return;
        const generation = ++this._organizations;
        const found = await Promise.all(this.accounts.map(async account => ({account, orgs: await this.names.discover(account)})));
        if (generation !== this._organizations || list.contains(document.activeElement))
            return;
        const unique = new Map();
        for (const {account, orgs} of found) {
            for (const org of orgs) {
                const key = org.login.toLowerCase();
                if (!unique.has(key))
                    unique.set(key, {account, org, platforms: []});
                const where = accountTitle({...account, login: ''});
                if (!unique.get(key).platforms.includes(where))
                    unique.get(key).platforms.push(where);
            }
        }
        // What the field offers: every organization of every account, by its name (or login).
        const choices = [];
        for (const {account, org} of unique.values()) {
            const choice = this.names.nameOf(account, org.login) || org.login;
            if (!choices.some(known => known.toLowerCase() === choice.toLowerCase()))
                choices.push(choice);
        }
        $('organization-choices').replaceChildren(...choices.map(choice => element('option', {attrs: {value: choice}})));
        const entries = [...unique.values()].sort((a, b) => a.org.login.localeCompare(b.org.login));
        list.replaceChildren(...entries.map(({account, org, platforms}) => this._organizationRow(account, org.login, platforms)));
        list.hidden = entries.length === 0;
        $('no-organizations').hidden = entries.length > 0;
        this.names.load(found.flatMap(({account, orgs}) => orgs.map(({login}) => ({account, login}))));
    }

    _organizationRow(account, login, platforms) {
        const input = element('input', {attrs: {'type': 'text', 'list': 'organization-choices', 'maxlength': '60',
            'aria-label': `Name for ${login}`, 'spellcheck': 'false'}});
        input.value = this.names.nameOf(account, login) || login;
        let saved = input.value.trim();
        const save = () => {
            const name = input.value.trim();
            if (name === saved)
                return;
            saved = name;
            // The login alone is no name: it goes back to what the platform says.
            this.names.setOverride(account, login, name.toLowerCase() === login.toLowerCase() ? '' : name)
                .catch(e => console.error('sourceglance: saving the name failed', e));
        };
        input.addEventListener('change', save);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                save();
            }
        });
        return element('li', {}, [
            element('span', {className: 'who'}, [element('span', {text: `@${login}`}), element('small', {text: platforms.join(' · ')})]),
            input,
        ]);
    }

    /**
     * What the loaded items tell Settings, as on Ubuntu: their organizations and repositories,
     * the submodules of those repositories, and the project boards (platform projects).
     */
    _noteOrganizations() {
        for (const src of this.state.sources) {
            const groups = (src.groups ?? []).concat(src.prGroups ?? []);
            this.names.noteSeen(src.account, [...new Set(groups.map(group => organizationOf(group.repo)))]);
            const repos = [...new Set(groups.map(group => group.repo))];
            this.projects.noteRepos(repos);
            this.projects.discoverSubmodules(src.account, repos);
        }
        this.projects.noteBoards(this.state.sources.flatMap(src => (src.boards ?? []).map(board => board.title)));
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
        this._noteOrganizations();
        this._renderStatus();
        this._renderSectionPages(pageInfo(this.page).section);
        this._renderAccounts();
        if (!$('accounts-card').hidden)
            this._showCard();
        if (pageInfo(this.page).section === 'tasks')
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
            const actions = [remove];
            if (account.platform === 'github') {
                const limit = element('button', {text: 'Limit repositories & boards', attrs: {type: 'button'}});
                limit.addEventListener('click', () => this.access.toggle(account));
                actions.unshift(limit);
            }
            return element('li', {}, [element('span', {text: accountTitle(account)}),
                element('span', {className: 'account-actions'}, actions)]);
        }));
        $('no-accounts').hidden = this.accounts.length > 0;
        // An account signed out: its panel goes too.
        if (this.access.owner && !this.accounts.some(account => account.id === this.access.owner))
            this.access.hide();
    }

    /**
     * The Tasks pages: All Tasks (one list, newest first), Issues and Pull requests (grouped by
     * Group by, like the popovers), and Project Boards. The header's search filters them.
     */
    _renderList() {
        const body = $('list-body');
        const terms = searchTerms($('search').value);
        const loaded = this.state.sources.filter(src => src.status !== 'signed-out' && src.updatedAt);
        const notes = this.state.sources.flatMap(src => {
            if (src.status === 'signed-out')
                return [element('p', {className: 'hint', text: `${src.title}: not signed in. Sign in again under Settings → Accounts.`})];
            if (src.status === 'error')
                return [element('p', {className: 'hint', text: `${src.title}: ${errorText(src.error, this.state.intervalMinutes)}`})];
            return [];
        });
        if (this.accounts.length === 0) {
            body.replaceChildren(element('p', {className: 'empty-state', text: 'Sign in to see what’s assigned to you.'}));
            return;
        }
        if (this.page === 'tasks') {
            const tasks = filterTasks(allTasks(loaded).filter(task => !task.item || isMine(task.item)), [], terms);
            body.replaceChildren(...notes, tasks.length
                ? element('ul', {className: 'tasks'}, tasks.map(task => (task.item ? this._item(task.item, true) : this._draft(task.board, task.draft))))
                : element('p', {className: 'empty-state', text: terms.length ? 'Nothing matches your search.' : 'Nothing assigned to you.'}));
            return;
        }
        if (this.page === 'boards') {
            const boards = loaded.filter(src => src.platform === 'github').flatMap(src => src.boards ?? []);
            const groups = boards.map(board => ({board, drafts: board.drafts.filter(draft =>
                filterTasks([{title: draft.title, status: draft.status, repo: board.title}], [], terms).length > 0)}))
                .filter(({drafts}) => drafts.length > 0);
            body.replaceChildren(...notes, ...groups.length ? groups.map(({board, drafts}) => element('section', {className: 'task-group'}, [
                element('h3', {}, [element('span', {text: board.title}), element('span', {className: 'count', text: String(drafts.length)})]),
                element('ul', {className: 'tasks'}, drafts.map(draft => this._draft(board, draft))),
            ])) : [element('p', {className: 'empty-state', text: terms.length ? 'Nothing matches your search.' : 'No draft items on your project boards.'})]);
            return;
        }
        const groupsOf = src => (this.page === 'issues' ? src.groups : src.prGroups) ?? [];
        const ui = {settings: this.settings};
        const byProject = normalizeGroupBy(this.settings.get('group-by', 'project')) === 'project';
        const groups = groupsFor(ui, loaded, groupsOf)
            .map(group => ({...group, issues: group.issues.filter(item => isMine(item) && itemMatches(item, terms))}))
            .filter(group => group.issues.length > 0);
        body.replaceChildren(...notes, ...groups.length ? groups.map(group => element('section', {className: 'task-group'}, [
            element('h3', {}, [element('span', {text: group.title}), element('span', {className: 'count', text: String(group.issues.length)})]),
            element('ul', {className: 'tasks'}, group.issues.map(item => this._item(item, !(byProject && group.title === item.repo)))),
        ])) : [element('p', {className: 'empty-state', text: terms.length ? 'Nothing matches your search.'
            : this.page === 'issues' ? 'No open issues assigned to you.' : 'No open pull requests for you.'})]);
    }

    /** An issue or pull request: its state, number and title, its repository, labels, and Open. */
    _item(item, showRepo) {
        const pr = item.kind === 'pr';
        const open = element('button', {className: 'flat', attrs: {type: 'button', title: 'Open in the browser'}}, [iconNode(ICONS.open)]);
        open.disabled = !item.url;
        open.addEventListener('click', () => openLink(item.url).catch(e => console.warn('sourceglance: link refused', e)));
        const labels = (item.labels ?? []).map(label => element('span', {className: 'label', text: label.name}));
        const state = iconNode(pr ? ICONS.pr : ICONS.issue);
        state.classList.add(pr ? 'state-pr' : 'state-open');
        return element('li', {}, [
            state,
            iconNode(item.platform === 'gitlab' ? ICONS.gitlab : ICONS.github),
            element('span', {className: 'who'}, [
                element('span', {text: `${itemRef(item)}  ${item.title}${pr && item.reason === 'review' ? ' · review requested' : ''}`}),
                element('small', {text: showRepo ? item.repo : ''}),
            ]),
            ...labels.length ? [element('span', {className: 'labels'}, labels)] : [],
            open,
        ]);
    }

    /** A draft on a project board: its title, status and the board. */
    _draft(board, draft) {
        const {item} = draftTarget(board, draft);
        const open = element('button', {className: 'flat', attrs: {type: 'button', title: 'Open the board'}}, [iconNode(ICONS.open)]);
        open.disabled = !board.url;
        open.addEventListener('click', () => openLink(board.url).catch(e => console.warn('sourceglance: link refused', e)));
        return element('li', {className: 'draft', attrs: {'data-key': item.number ?? ''}}, [
            iconNode(ICONS.draft),
            element('span', {className: 'who'}, [element('span', {text: draft.title || 'Untitled draft'}),
                element('small', {text: [draft.status ?? 'No status', board.title].join(' · ')})]),
            open,
        ]);
    }

    /** The Accounts card under the header's button, as on Ubuntu. */
    _showCard() {
        const card = $('accounts-card');
        const people = this.state.sources.map(src => {
            const initials = (src.login ?? src.title).replace(/^@/, '').slice(0, 2).toUpperCase();
            const status = src.status === 'signed-out' || src.error?.kind === 'auth' ? 'bad'
                : src.status === 'error' || !src.updatedAt ? 'wait' : 'ok';
            const label = {ok: 'Signed in', wait: src.status === 'error' ? 'Couldn’t load' : 'Loading', bad: 'Signed out'}[status];
            return element('div', {className: 'person'}, [
                element('span', {className: 'avatar', attrs: {'aria-hidden': 'true'}}, [initials,
                    element('span', {className: 'platform'}, [iconNode(src.platform === 'gitlab' ? ICONS.gitlab : ICONS.github)])]),
                element('span', {className: 'who'}, [element('span', {text: accountTitle({...src.account, login: ''})}),
                    element('small', {text: src.login ? `@${src.login}` : ''})]),
                element('span', {className: `dot ${status}`, attrs: {title: label, 'aria-label': label}}),
            ]);
        });
        const action = (text, icon, onClick) => {
            const button = element('button', {className: 'action', attrs: {type: 'button'}}, [iconNode(icon), element('span', {text})]);
            button.addEventListener('click', onClick);
            return button;
        };
        const signOutAll = action('Sign out of all', ICONS.quit, () => {
            confirm.hidden = false;
        });
        const confirm = element('div', {className: 'confirm', attrs: {hidden: ''}}, [
            element('p', {text: 'Sign out of every account? You’ll need to sign in again to see your lists.'}),
        ]);
        const cancel = element('button', {text: 'Cancel', attrs: {type: 'button'}});
        const yes = element('button', {className: 'danger', text: 'Sign out of all', attrs: {type: 'button'}});
        cancel.addEventListener('click', () => {
            confirm.hidden = true;
        });
        yes.addEventListener('click', async () => {
            for (const account of [...this.accounts]) {
                try {
                    await removeAccount(this.store.list, secrets, account);
                } catch (e) {
                    this._accountsMessage(`Couldn’t sign out of ${accountTitle(account)}: ${e?.message ?? e}`);
                }
            }
            this._hideCard();
        });
        confirm.append(element('div', {className: 'row-buttons'}, [cancel, yes]));
        card.replaceChildren(...people, ...people.length ? [element('hr')] : [],
            action(people.length ? 'Add another account' : 'Add an account', ICONS.signIn, () => {
                this.openPage('accounts');
                $('platform').focus();
            }),
            action('Manage accounts', ICONS.settings, () => this.openPage('accounts')),
            ...people.length ? [signOutAll, confirm] : []);
        card.hidden = false;
        $('accounts-button').setAttribute('aria-expanded', 'true');
    }

    _hideCard() {
        $('accounts-card').hidden = true;
        $('accounts-button').setAttribute('aria-expanded', 'false');
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
                // As on Ubuntu: the browser sign-in remembers which app it used (the GitHub App
                // can't read repository files, so nothing asks it to).
                clientId: method === 'device' && !selfHosted ? (platform === 'gitlab' ? GITLAB_CLIENT_ID : GITHUB_APP_CLIENT_ID) : null,
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
