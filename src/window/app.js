// Fills a window with Source Glance's sidebar layout: the lists, the settings and their
// toolbar. launcher.js shows it in Source Glance's own app; prefs.js in GNOME's Extensions app.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {AccountClients} from '../lib/accountStore.js';
import {DisplayNames} from '../lib/displayNames.js';
import {ProjectStore} from '../lib/projectStore.js';
import {GitHubClient} from '../lib/github.js';
import {WIDGET_ICONS, listBadge, searchCount, searchTerms} from '../lib/model.js';
import {WindowActions} from './actions.js';
import {WindowData} from './data.js';
import {gettext as _, ngettext} from './i18n.js';
import {buildMainWindow, loadTheme} from './mainWindow.js';
import {AccountsButton, RefreshButton} from './headerButtons.js';
import {UpdateButton} from './updateButton.js';
import {buildAboutPage} from './pages/about.js';
import {buildAccountsPage} from './pages/accounts.js';
import {buildGlancePage} from './pages/glance.js';
import {ListPage} from './pages/list.js';
import {BoardsPage} from './pages/boards.js';
import {TasksPage} from './pages/tasks.js';
import {buildStartupPage} from './pages/systemStart.js';

/**
 * @param {Adw.Window} window
 * @param {object} params
 * @param {Gio.Settings} params.settings the extension's settings
 * @param {Gio.File} params.dir the folder with this version's files
 * @param {string} params.version e.g. "0.4.2"
 */
export function fillWindow(window, {settings, dir, version}) {
    // For the update check: sourceglance's releases are on github.com.
    const client = new GitHubClient(version);
    // One client per account, for the lists, the actions and the Accounts page.
    const clients = new AccountClients(version);
    const names = new DisplayNames(clients, settings);
    const projects = new ProjectStore(settings, clients);
    window.set_default_size(960, 680);
    loadTheme(window, dir);

    const icon = name => Gio.FileIcon.new(dir.get_child('icons').get_child(`${name}.svg`));
    const icons = {
        issue: icon('issue-symbolic'),
        issueClosed: icon('issue-closed-symbolic'),
        prMerged: icon('git-merge-symbolic'),
        prClosed: icon('pr-closed-symbolic'),
        pr: icon('git-pull-request-symbolic'),
        label: icon('label-symbolic'),
        boards: icon('checklist-symbolic'),
        code: icon('code-symbolic'),
        github: icon('github-symbolic'),
        gitlab: icon('gitlab-symbolic'),
        app: icon('sourceglance-symbolic'),
        opacity: icon('opacity-symbolic'),
        size: icon('size-symbolic'),
        desktop: icon('desktop-symbolic'),
        desktopOff: icon('desktop-off-symbolic'),
        widgetCustom: icon('widget-custom-symbolic'),
        // Custom widgets' icons (WIDGET_ICONS in model.js).
        ...Object.fromEntries(Object.entries(WIDGET_ICONS).map(([key, name]) => [`widget-${key}`, icon(`${name}-symbolic`)])),
    };
    const overlay = new Adw.ToastOverlay();
    const toast = title => overlay.add_toast(new Adw.Toast({title}));
    const ctx = {window, settings, client, clients, names, projects, version, toast, dir: dir, icons};

    // One search box, on the right of the title bar, filters all three lists. While it has text, the
    // sidebar counts and the title's subtitle show matches; clearing it shows everything.
    // Tasks first: a search from a settings page shows it.
    const LISTS = ['tasks', 'issues', 'prs', 'boards'];
    const search = new Gtk.SearchEntry({placeholder_text: _('Search lists'), width_chars: 20, valign: Gtk.Align.CENTER,
        tooltip_text: _('Search issues, pull requests and project items (Ctrl+F). Esc clears it.')});
    let currentPage = null;
    let terms = [];
    // Set once the layout is built; pages can change (and call back) while it's being built.
    let main = null;
    // The title bar's Refresh and Accounts (headerButtons.js), built below.
    let refresh = null;
    let accountsButton = null;
    const showCounts = () => {
        const state = data.state;
        for (const id of LISTS)
            main?.setCount(id, terms.length ? String(searchCount(id, state, terms)) : listBadge(id, state));
        const n = terms.length && LISTS.includes(currentPage) ? searchCount(currentPage, state, terms) : null;
        main?.setSubtitle(n === null ? '' : ngettext('%d result', '%d results', n).format(n));
    };

    const pages = [];
    // Glance → Widgets draws the cards with the lists too; built below.
    let glancePage = null;
    const data = new WindowData({clients, settings, onChange: state => {
        for (const page of pages)
            page.update(state);
        showCounts();
        refresh?.update(state);
        accountsButton?.update(state);
        glancePage?.update(state);
    }});
    // The preview shows in the window's right panel (built with the layout, below).
    const panel = {
        show: params => main?.showPanel(params),
        hide: () => main?.hidePanel(),
        isFor: owner => main?.isPanelFor(owner) ?? false,
        isOpen: () => main?.isPanelOpen() ?? false,
    };
    const actions = new WindowActions({window, clients, data, toast, icons, panel});
    const repos = () => settings.get_strv('repositories');
    const onClearSearch = () => {
        search.text = '';
    };
    const issuesPage = new ListPage({key: 'issues', icons, actions, repos, settings, names, projects, onClearSearch});
    const prsPage = new ListPage({key: 'prs', icons, actions, repos, settings, names, projects, onClearSearch});
    const boardsPage = new BoardsPage({icons, actions, settings, projects, onClearSearch});
    const tasksPage = new TasksPage({icons, actions, onClearSearch});
    pages.push(tasksPage, issuesPage, prsPage, boardsPage);

    search.connect('search-changed', () => {
        terms = searchTerms(search.text);
        // Searching from a settings page shows the first list; clearing it there does too.
        // On a list, the selection stays.
        if (!LISTS.includes(currentPage))
            main?.select(LISTS[0]);
        for (const page of pages)
            page.setSearch(search.text.trim(), terms);
        showCounts();
    });
    // Esc in the box clears it.
    search.connect('stop-search', onClearSearch);

    const update = new UpdateButton({window, client, settings, toast, version: version,
        currentPage: () => main?.current()});
    const showPage = id => main?.select(id);
    refresh = new RefreshButton({openPage: showPage, onRefresh: () => {
        data.refresh();
        update.check();
    }});
    accountsButton = new AccountsButton({openPage: showPage, window, settings, toast, names, icons,
        // Add another account: Settings → Accounts, at its Add an account buttons.
        openAdd: () => {
            showPage('accounts');
            accountsPages.scrollTo('add');
        }});
    // The search box sits on the right of the title, always shown, next to the buttons.
    const headerEnd = new Gtk.Box({spacing: 6});
    headerEnd.append(search);
    headerEnd.append(update.widget);
    headerEnd.append(refresh.widget);
    headerEnd.append(accountsButton.widget);

    // Widgets and System Tray share the Glance page.
    glancePage = buildGlancePage(ctx);
    // Settings: Accounts, then the settings, then About, on one page.
    // The right panel also shows an account's Limit repositories & boards. It lists: every board it can read, even the ones hidden.
    ctx.panel = panel;
    ctx.boardsOf = account => {
        const source = data.state.sources.find(src => src.account.id === account.id);
        return {boards: source?.allBoards ?? [], error: source?.boardsError ?? null};
    };
    const accountsPages = buildAccountsPage(ctx);
    const startupPage = buildStartupPage(ctx);
    const aboutPage = buildAboutPage({window, settings, appIcon: icon('sourceglance-app'), version});

    // Whether the sidebar shows icons only. Kept in settings when this version's schema has it.
    const hasNarrowKey = settings.settings_schema.has_key('sidebar-narrow');
    main = buildMainWindow(window, {
        appIcon: icon('sourceglance-app'),
        exitIcon: icon('exit-symbolic'),
        overlay,
        headerEnd,
        narrow: hasNarrowKey && settings.get_boolean('sidebar-narrow'),
        onNarrowChanged: narrow => hasNarrowKey && settings.set_boolean('sidebar-narrow', narrow),
        // Quits everything: the top bar and widgets stop (extension.js follows quit-request) and
        // the window closes (below), which also quits Source Glance's own app.
        onQuit: () => settings.set_int('quit-request', settings.get_int('quit-request') + 1),
        onPageChanged: id => {
            currentPage = id;
            showCounts();
            accountsButton.setPage(id);
        },
        entries: [
            // Glance first, and open at launch: Widgets and System Tray on one page.
            {id: 'glance', title: _('Glance'), gicon: icon('sourceglance-symbolic'), group: true},
            {id: 'widgets', parent: 'glance', title: _('Widgets'),
                iconName: 'view-grid-symbolic', page: glancePage.widget, pageId: 'glance', pageTitle: _('Glance'),
                onShow: () => glancePage.scrollTo('widgets')},
            {id: 'tray', parent: 'glance', title: _('System Tray'), shortTitle: _('Tray'),
                iconName: 'preferences-desktop-display-symbolic', page: glancePage.widget, pageId: 'glance',
                pageTitle: _('Glance'), onShow: () => glancePage.scrollTo('tray')},
            // Tasks: everything in one list, then the lists by kind.
            {id: 'tasks-group', title: _('Tasks'), iconName: 'view-list-bullet-symbolic', group: true},
            {id: 'tasks', parent: 'tasks-group', title: _('All Tasks'), shortTitle: _('All'),
                iconName: 'view-list-symbolic', page: tasksPage.widget, count: true},
            {id: 'issues', parent: 'tasks-group', title: _('Issues'), iconName: 'checkbox-checked-symbolic',
                page: issuesPage.widget, count: true},
            {id: 'prs', parent: 'tasks-group', title: _('Pull requests'), shortTitle: _('PRs'), gicon: icons.pr,
                page: prsPage.widget, count: true},
            {id: 'boards', parent: 'tasks-group', title: _('Project Boards'), gicon: icons.boards,
                page: boardsPage.widget, count: true},
            // Settings sits above Exit; each entry under it is a page of its own. 'accounts' is also where
            // the title bar's popover goes.
            {id: 'settings', title: _('Settings'), iconName: 'emblem-system-symbolic', group: true, bottom: true},
            {id: 'accounts', parent: 'settings', title: _('Accounts'), iconName: 'avatar-default-symbolic',
                page: accountsPages.page, pageTitle: _('Accounts')},
            {id: 'settings-preferences', parent: 'settings', title: _('Preferences'), iconName: 'preferences-system-symbolic',
                page: accountsPages.preferencesPage, pageTitle: _('Preferences')},
            {id: 'settings-startup', parent: 'settings', title: _('Startup'), iconName: 'system-run-symbolic',
                page: startupPage, pageTitle: _('Startup')},
            {id: 'settings-about', parent: 'settings', title: _('About'), iconName: 'help-about-symbolic',
                page: aboutPage, pageTitle: _('About')},
        ],
    });

    // The top-bar menu sets open-page (e.g. "about") before opening this window, and
    // again if the window is already open.
    const openPage = () => {
        const id = settings.get_string('open-page');
        if (!id)
            return;
        // 'about' from the top bar, and 'start' (the Settings page before it had a submenu, now Startup).
        main.select(id === 'about' ? 'settings-about' : id === 'start' ? 'settings-startup' : id);
        settings.set_string('open-page', '');
    };
    const openPageId = settings.connect('changed::open-page', openPage);
    openPage();

    // Esc clears a search first, wherever the focus is; GNOME's Extensions app would otherwise close the window.
    const escape = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    escape.connect('key-pressed', (_controller, keyval) => {
        if (keyval !== Gdk.KEY_Escape || search.text === '')
            return false;
        // In a dialog (close, pickers), Esc closes the dialog as usual.
        if (window.get_focus()?.get_ancestor(Adw.Dialog.$gtype))
            return false;
        onClearSearch();
        return true;
    });
    window.add_controller(escape);

    // Typing on a list goes into the search box; Ctrl+F jumps there from any page.
    search.set_key_capture_widget(window);
    const shortcuts = new Gtk.ShortcutController({scope: Gtk.ShortcutScope.LOCAL});
    shortcuts.add_shortcut(new Gtk.Shortcut({
        trigger: Gtk.ShortcutTrigger.parse_string('<Control>f'),
        action: Gtk.CallbackAction.new(() => {
            search.grab_focus();
            return true;
        }),
    }));
    window.add_controller(shortcuts);

    // The update notification's Install sets install-update before opening this window, or
    // while it's open.
    const installUpdate = () => {
        if (!settings.get_boolean('install-update'))
            return;
        settings.set_boolean('install-update', false);
        update.install();
    };
    const installUpdateId = settings.connect('changed::install-update', installUpdate);

    // Quit in the top bar closes the window too.
    const quitRequestId = settings.connect('changed::quit-request', () => window.close());

    // Adding or removing an account on the Accounts page reloads the lists.
    const tokenChangedId = settings.connect('changed::token-changed', () => data.refresh());
    window.connect('close-request', () => {
        settings.disconnect(tokenChangedId);
        settings.disconnect(quitRequestId);
        settings.disconnect(openPageId);
        settings.disconnect(installUpdateId);
        update.destroy();
        refresh.destroy();
        accountsButton.destroy();
        data.stop();
        client.destroy();
        clients.destroy();
        return false;
    });
    for (const page of pages)
        page.update(data.state);
    refresh.update(data.state);
    accountsButton.update(data.state);
    data.start();
    update.check();
    installUpdate();
}
