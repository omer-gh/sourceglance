// What each top-bar list shows. Each view fills a PopupMenu from the state (see indicator.js).
// `ui` is {menu, state, icons, scheduleRebuild, onAction, onOpenTasks, onOpenPage, onSettings, onAbout, repos, groupBy, projectRepos, organizationNames}.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    draftTarget,
    groupByOrganization,
    groupByPlatform,
    groupDraftsByStatus,
    gtypeName,
    isDoneStatus,
    itemKey,
    itemRef,
    relativeTime,
    truncate,
} from './model.js';
import {groupByProject} from './projects.js';
import {hostLabel, isDefaultBase} from './accounts.js';
import {closedPageUrl, isSafeLink} from './requests.js';

function formatRelative(date) {
    const {unit, value} = relativeTime(date);
    switch (unit) {
    case 'now':
        return _('just now');
    case 'minute':
        return ngettext('%d min ago', '%d min ago', value).format(value);
    case 'hour':
        return ngettext('%d hour ago', '%d hours ago', value).format(value);
    default:
        return ngettext('%d day ago', '%d days ago', value).format(value);
    }
}

function formatClock(ms) {
    return GLib.DateTime.new_from_unix_local(Math.floor(ms / 1000)).format('%H:%M');
}

function errorText(error, intervalMinutes) {
    switch (error?.kind) {
    case 'insecure':
        return _('This instance uses plain http:// and isn’t on your local network now. Source Glance won’t send your sign-in to it.');
    case 'auth':
        return _('Your sign-in was rejected. Sign in again in Settings.');
    case 'forbidden':
        return _('Your sign-in can’t read these issues. Check its permissions in Settings.');
    case 'rate-limit':
        return error.retryAt
            ? _('GitHub rate limit reached. Retrying at %s.').format(formatClock(error.retryAt))
            : _('GitHub rate limit reached. Retrying later.');
    case 'query':
        return _('A watched repository doesn’t exist or isn’t visible to your sign-in. Check Settings.');
    default:
        return ngettext('Couldn’t reach GitHub. Retrying in %d min.',
            'Couldn’t reach GitHub. Retrying in %d min.', intervalMinutes).format(intervalMinutes);
    }
}

export function openUri(uri) {
    if (!isSafeLink(uri)) {
        console.warn('sourceglance: refusing to open a link that isn\u2019t on a signed-in account\u2019s instance');
        return;
    }
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        console.error(`sourceglance: could not open ${uri}`, e);
    }
}

function addInfo(ui, text, styleClass) {
    const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
    item.label.clutter_text.line_wrap = true;
    item.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    item.add_style_class_name(styleClass);
    ui.menu.addMenuItem(item);
    return item;
}

// Icons for menu rows, from the icon theme. Each exists in both Adwaita and Yaru; the ones
// that don't (issue, label) ship in icons/ and come in through ui.icons.
const THEMED = {
    open: 'web-browser-symbolic',
    comment: 'chat-message-new-symbolic',
    reopen: 'edit-undo-symbolic',
    assignees: 'system-users-symbolic',
    draft: 'edit-symbolic',
    refresh: 'view-refresh-symbolic',
    glance: 'view-grid-symbolic',
    tasks: 'view-list-bullet-symbolic',
    settings: 'emblem-system-symbolic',
    profile: 'avatar-default-symbolic',
    signIn: 'dialog-password-symbolic',
    quit: 'application-exit-symbolic',
    about: 'help-about-symbolic',
};

function icon(name) {
    return Gio.ThemedIcon.new(THEMED[name]);
}

function addAction(ui, text, callback, gicon = null) {
    const item = gicon ? new PopupMenu.PopupImageMenuItem(text, gicon) : new PopupMenu.PopupMenuItem(text);
    item.connect('activate', callback);
    ui.menu.addMenuItem(item);
    return item;
}

// A row for an issue, PR or draft. Clicking it opens its actions in a menu of their own beside
// the list, which stays open behind it. Running an action closes both.
const ItemRow = GObject.registerClass({GTypeName: gtypeName('ItemRow', import.meta.url)},
class ItemRow extends PopupMenu.PopupImageMenuItem {
    _init(text, gicon) {
        super._init(text, gicon);
        this.add_style_class_name('sourceglance-issue');
        this.add_child(new St.Icon({icon_name: 'pan-end-symbolic', style_class: 'popup-menu-arrow',
            x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER}));

        // St.Side.RIGHT puts the actions to the left of the list; the shell flips it if there's no room.
        this._actionsMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.RIGHT);
        this._actionsMenu.actor.add_style_class_name('sourceglance-actions');
        this._actionsMenu.actor.hide();
        Main.uiGroup.add_child(this._actionsMenu.actor);
        this._manager = new PopupMenu.PopupMenuManager(this);
        this._manager.addMenu(this._actionsMenu);
        this.connect('destroy', () => this._actionsMenu.destroy());
    }

    addAction(text, callback, gicon) {
        return this._actionsMenu.addAction(text, () => {
            this._parent?._getTopMenu().close();
            callback();
        }, gicon);
    }

    activate(_event) {
        this._actionsMenu.toggle();
    }
});

/** An issue, PR or draft row; add its actions with row.addAction(). */
function addItemRow(ui, text, gicon) {
    const row = new ItemRow(text, gicon);
    ui.menu.addMenuItem(row);
    return row;
}

function signedIn(state) {
    return state.status === 'ready' || state.status === 'error';
}

/** True if the list has data to show; otherwise adds a short status message. */
function listReady(ui) {
    const {state} = ui;
    if (state.status === 'signed-out') {
        addInfo(ui, _('Not signed in. Open the Source Glance menu to sign in.'), 'sourceglance-message');
        return false;
    }
    if (state.status === 'loading') {
        addInfo(ui, _('Loading…'), 'sourceglance-message');
        return false;
    }
    if (state.status === 'error')
        addInfo(ui, errorText(state.error, state.intervalMinutes), 'sourceglance-message');
    return state.status === 'ready' || state.updatedAt !== null;
}

export {listBadge as badgeText} from './model.js';

/** "Open on GitHub", or the instance's address for a self-hosted one. */
function openText(item, ui) {
    const account = ui.state.sources.find(source => source.account.id === item.accountId)?.account;
    if (account && !isDefaultBase(account.platform, account.base))
        return _('Open on %s').format(hostLabel(account.base));
    return item.platform === 'gitlab' ? _('Open on GitLab') : _('Open on GitHub');
}

function itemLabel(item, context = '') {
    // `context` is the repository, where the heading above isn't the repository.
    const label = `${context}${itemRef(item)}  ${truncate(item.title)}`;
    return item.kind === 'pr' && item.reason === 'review'
        ? _('%s · review requested').format(label)
        : label;
}

/** An issue or PR row with its actions in a submenu. */
function addItem(ui, item, context = '') {
    const busy = ui.state.busy.includes(itemKey(item));
    let kindIcon = item.kind === 'pr' ? ui.icons.prs : ui.icons.issue;
    if (item.state === 'closed')
        kindIcon = item.kind === 'pr' ? ui.icons.prClosed : ui.icons.issueClosed;
    const row = addItemRow(ui, busy ? _('%s · working…').format(itemLabel(item, context)) : itemLabel(item, context), kindIcon);

    const add = (text, gicon, callback) => {
        const entry = row.addAction(text, callback, gicon);
        entry.setSensitive(!busy);
        return entry;
    };
    const gitlab = item.platform === 'gitlab';
    add(openText(item, ui), icon('open'), () => openUri(item.url)).setSensitive(Boolean(item.url));
    if (item.state === 'closed') {
        add(_('Reopen'), icon('reopen'), () => ui.onAction(item, 'reopen'));
        return;
    }
    add(_('Comment…'), icon('comment'), () => ui.onAction(item, 'comment'));
    if (item.kind === 'pr')
        add(gitlab ? _('Close merge request…') : _('Close pull request…'), ui.icons.prClosed, () => ui.onAction(item, 'close'));
    else
        add(_('Close issue…'), ui.icons.issueClosed, () => ui.onAction(item, 'close'));
    add(_('Assignees…'), icon('assignees'), () => ui.onAction(item, 'assignees'));
    add(_('Labels…'), ui.icons.label, () => ui.onAction(item, 'labels'));
    for (const board of item.boards ?? []) {
        add(_('%s: %s…').format(truncate(board.title, 30), board.status ?? _('No status')),
            ui.icons.boards, () => ui.onAction(item, 'status', board));
    }
}

/** A heading for a group of items, with how many there are: plain, not a control. */
function addGroupHeading(ui, title, count) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'sourceglance-repo'});
    item.add_child(new St.Label({text: truncate(title, 48), x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
    item.add_child(new St.Label({text: String(count), style_class: 'sourceglance-count', y_align: Clutter.ActorAlign.CENTER}));
    ui.menu.addMenuItem(item);
    return item;
}

/** The always-visible footer: closed items still assigned to you, linking to them. */
function addClosedFooter(ui, count, url, text, gicon) {
    ui.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    const row = addAction(ui, text(count ?? null), () => openUri(url), gicon);
    row.add_style_class_name('sourceglance-footer');
}

/** The items as groups, built the way Glance → System Tray says (group by): [{id, title, issues}]. */
function groupsFor(ui, sources, groupsOf) {
    if (ui.groupBy === 'platform')
        return groupByPlatform(sources, groupsOf);
    if (ui.groupBy === 'organization') {
        // The names you gave organizations (the window keeps the platform's own names).
        return groupByOrganization(sources, groupsOf, (_account, login) => {
            const name = ui.organizationNames[login.toLowerCase()] ?? '';
            return {key: (name || login).toLowerCase(), title: name ? `${name} (@${login})` : `@${login}`};
        });
    }
    return groupByProject(sources, groupsOf, ui.projectRepos);
}

/** The list for one kind (issues or pull requests): flat groups across all accounts, no filters, no sections. */
function renderItemList(ui, cfg) {
    const {state} = ui;
    const sources = state.sources;
    if (sources.length === 0) {
        addInfo(ui, _('Not signed in. Open the Source Glance menu to sign in.'), 'sourceglance-message');
        return;
    }
    const loaded = sources.filter(src => src.status !== 'signed-out' && src.updatedAt);
    const groupsOf = src => (cfg.key === 'issues' ? src.groups : src.prGroups) ?? [];
    const groups = groupsFor(ui, loaded, groupsOf).filter(group => group.issues.length > 0);
    if (groups.length === 0 && loaded.length > 0) {
        const gitlabOnly = loaded.every(src => src.platform === 'gitlab');
        addInfo(ui, gitlabOnly ? cfg.emptyGitLab : cfg.empty, 'sourceglance-message');
    }
    for (const group of groups) {
        addGroupHeading(ui, group.title, group.issues.length);
        for (const item of group.issues)
            addItem(ui, item, ui.groupBy === 'project' && group.title === item.repo ? '' : item.repo);
    }

    // An account that didn't load says so, and each account's closed-but-assigned count follows.
    for (const src of sources) {
        const gitlab = src.platform === 'gitlab';
        if (src.status === 'signed-out') {
            addInfo(ui, _('%s: not signed in. Sign in again under Settings → Accounts.').format(src.title), 'sourceglance-message');
            continue;
        }
        if (!src.updatedAt) {
            addInfo(ui, src.status === 'error' ? errorText(src.error, state.intervalMinutes) : _('Loading…'),
                'sourceglance-message');
            continue;
        }
        if (src.status === 'error')
            addInfo(ui, errorText(src.error, state.intervalMinutes), 'sourceglance-message');
        addClosedFooter(ui, src.closedCounts[cfg.key], closedPageUrl(src.account, cfg.kind, ui.repos),
            gitlab ? cfg.closedTextGitLab : cfg.closedText, ui.icons[cfg.closedIcon]);
    }

    const closed = state.recentlyClosed.filter(item => item.kind === cfg.kind);
    if (closed.length > 0 && signedIn(state)) {
        addInfo(ui, _('Recently closed'), 'sourceglance-section');
        for (const item of closed)
            addItem(ui, item);
    }
}

export function renderIssues(ui) {
    renderItemList(ui, {
        key: 'issues',
        kind: 'issue',
        title: _('Issues'),
        empty: _('No open issues assigned to you'),
        emptyGitLab: _('No open GitLab issues assigned to you'),
        closedSearch: 'issue-closed',
        closedTextGitLab: n => n === null
            ? _('Closed GitLab issues still assigned to you')
            : ngettext('%d closed GitLab issue still assigned to you', '%d closed GitLab issues still assigned to you', n).format(n),
        closedIcon: 'issueClosed',
        closedText: n => n === null
            ? _('Closed issues still assigned to you')
            : ngettext('%d closed issue still assigned to you', '%d closed issues still assigned to you', n).format(n),
    });
}

export function renderPrs(ui) {
    renderItemList(ui, {
        key: 'prs',
        kind: 'pr',
        title: _('Pull requests'),
        empty: _('No open pull requests for you'),
        emptyGitLab: _('No open merge requests for you'),
        closedSearch: 'pr-closed',
        closedTextGitLab: n => n === null
            ? _('Merged or closed merge requests still assigned to you')
            : ngettext('%d merged or closed merge request still assigned to you',
                '%d merged or closed merge requests still assigned to you', n).format(n),
        closedIcon: 'prMerged',
        closedText: n => n === null
            ? _('Merged or closed pull requests still assigned to you')
            : ngettext('%d merged or closed pull request still assigned to you',
                '%d merged or closed pull requests still assigned to you', n).format(n),
    });
}

/** One GitHub account's boards and their draft items. */
function renderSourceBoards(ui, src) {
    const {busy} = ui.state;
    if (src.boardsError) {
        addInfo(ui, _('Source Glance can’t read the project boards of this account. Organization boards need the ' +
            'app installed on the organization.'), 'sourceglance-message');
        return;
    }
    if (src.boards === null) {
        addInfo(ui, src.updatedAt || src.status !== 'error' ? _('Loading project boards…')
            : errorText(src.error, ui.state.intervalMinutes), 'sourceglance-message');
        return;
    }
    const withDrafts = src.boards.filter(board => board.drafts.length > 0);
    if (withDrafts.length === 0) {
        addInfo(ui, _('No draft items on your project boards'), 'sourceglance-message');
        return;
    }
    for (const board of withDrafts) {
        const header = addAction(ui, truncate(board.title, 48), () => openUri(board.url), ui.icons.boards);
        header.add_style_class_name('sourceglance-section');
        header.setSensitive(Boolean(board.url));
        for (const group of groupDraftsByStatus(board)) {
            addInfo(ui, group.status ?? _('No status'), 'sourceglance-repo');
            for (const draft of group.drafts) {
                const {item, board: target} = draftTarget(board, draft);
                const isBusy = busy.includes(itemKey(item));
                const title = truncate(draft.title || _('Untitled draft'));
                const row = addItemRow(ui, isBusy ? _('%s · working…').format(title) : title,
                    isDoneStatus(draft.status) ? ui.icons.issueClosed : icon('draft'));
                const move = row.addAction(_('Move to status…'), () => ui.onAction(item, 'status', target),
                    ui.icons.boards);
                move.setSensitive(!isBusy && Boolean(board.fieldId) && board.options.length > 0);
                row.addAction(_('Open board'), () => openUri(board.url), icon('open')).setSensitive(Boolean(board.url));
            }
        }
        if (board.truncated)
            addAction(ui, _('More on GitHub'), () => openUri(board.url), icon('open')).setSensitive(Boolean(board.url));
    }
}

export function renderBoards(ui) {
    if (!listReady(ui))
        return;
    // Project boards are GitHub's. All the GitHub accounts' boards in one flat list, no sections.
    const sources = ui.state.sources.filter(src => src.platform === 'github' && src.status !== 'signed-out');
    if (sources.length === 0) {
        addInfo(ui, _('Project boards come from GitHub accounts. Add one under Settings → Accounts.'), 'sourceglance-message');
        return;
    }
    for (const src of sources)
        renderSourceBoards(ui, src);
}

function headerText(state) {
    const {status, sources, refreshing, updatedAt} = state;
    if (status === 'signed-out')
        return _('Sign in to see your issues');
    const logins = sources.filter(src => src.login).map(src => `@${src.login}`);
    if (logins.length === 0)
        return status === 'error' ? _('Source Glance') : _('Loading…');
    const who = logins.length === 1 ? logins[0]
        : ngettext('%d account', '%d accounts', sources.length).format(sources.length);
    if (refreshing)
        return _('%s · Refreshing…').format(who);
    if (updatedAt)
        return _('%s · updated %s').format(who, formatRelative(updatedAt));
    return who;
}

/** The sourceglance list: status, profiles, Refresh, Settings and About. */
export function renderApp(ui) {
    const {state} = ui;
    addInfo(ui, headerText(state), 'sourceglance-header');
    if (state.status === 'error')
        addInfo(ui, errorText(state.error, state.intervalMinutes), 'sourceglance-message');
    ui.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // The window's primary sidebar entries, each opening its page, then About after Settings.
    addAction(ui, _('Glance'), () => ui.onOpenPage('widgets'), icon('glance'));
    addAction(ui, _('Tasks'), () => ui.onOpenTasks(), icon('tasks'));
    if (signedIn(state))
        addAction(ui, _('Settings'), () => ui.onSettings(), icon('settings'));
    else
        addAction(ui, _('Sign in…'), () => ui.onSettings(), icon('signIn'));
    addAction(ui, _('About'), () => ui.onAbout(), icon('about'));
}

// A switch row that flips without closing the menu, so you see the new state.
const ToggleItem = GObject.registerClass({GTypeName: gtypeName('ToggleItem', import.meta.url)},
class ToggleItem extends PopupMenu.PopupSwitchMenuItem {
    activate(_event) {
        this.toggle();
    }
});

/** The sourceglance menu's footer: Start automatically and Quit. */
export function addAppFooter(ui) {
    ui.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    const autostart = new ToggleItem(_('Start automatically'), ui.getAutostart());
    autostart.connect('toggled', (_item, active) => ui.setAutostart(active));
    ui.menu.addMenuItem(autostart);
    addAction(ui, _('Quit'), () => ui.onQuit(), icon('quit'));
}

export const VIEWS = {issues: renderIssues, prs: renderPrs, boards: renderBoards, app: renderApp};
