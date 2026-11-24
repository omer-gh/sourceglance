// What each menu-bar popover shows, the same as the Ubuntu top-bar menus (src/lib/views.js and
// src/lib/indicator.js): Issues and Pull requests as one flat list across all accounts, grouped
// by the Group by setting, each account's closed-items footer, Project Boards as one flat list,
// and the Source Glance menu. Clicking an item opens its actions in a menu beside the list.
// `ui` is {root, state, settings, page, tab, rerender, openActions, actions, app}.
import {hostLabel, isDefaultBase} from '@shared/accounts.js';
import {
    TOOLBAR_LISTS,
    draftTarget,
    groupByOrganization,
    groupByPlatform,
    groupDraftsByStatus,
    isDoneStatus,
    itemKey,
    itemRef,
    listBadge,
    normalizeButtons,
    normalizeGroupBy,
    relativeTime,
    truncate,
} from '@shared/model.js';
import {groupByProject, normalizeRepoMap} from '@shared/projects.js';
import {closedPageUrl} from '@shared/requests.js';

import issueIcon from '../../src/icons/issue-symbolic.svg';
import issueClosedIcon from '../../src/icons/issue-closed-symbolic.svg';
import prIcon from '../../src/icons/git-pull-request-symbolic.svg';
import prClosedIcon from '../../src/icons/pr-closed-symbolic.svg';
import mergeIcon from '../../src/icons/git-merge-symbolic.svg';
import boardsIcon from '../../src/icons/checklist-symbolic.svg';
import labelIcon from '../../src/icons/label-symbolic.svg';
import appIcon from '../../src/icons/sourceglance-symbolic.svg';
import githubIcon from '../../src/icons/github-symbolic.svg';
import gitlabIcon from '../../src/icons/gitlab-symbolic.svg';
import {openLink} from './platform/tauri.js';
import {SYMBOLIC} from './symbolicIcons.js';

export const ICONS = {
    app: appIcon,
    github: githubIcon,
    gitlab: gitlabIcon,
    issue: issueIcon,
    issueClosed: issueClosedIcon,
    pr: prIcon,
    prClosed: prClosedIcon,
    prMerged: mergeIcon,
    boards: boardsIcon,
    label: labelIcon,
    ...SYMBOLIC,
};

const NAMES = {issues: 'Issues', prs: 'Pull requests', boards: 'Project Boards', app: 'Source Glance'};

export function element(tag, {text = null, className = null, attrs = {}} = {}, children = []) {
    const node = document.createElement(tag);
    if (text !== null)
        node.textContent = text;
    if (className)
        node.className = className;
    for (const [name, value] of Object.entries(attrs))
        node.setAttribute(name, value);
    node.append(...children);
    return node;
}

/** A small icon, tinted with the text color (a CSS mask over the SVG). */
export function iconNode(url) {
    const node = element('span', {className: url ? 'icon' : 'icon blank', attrs: {'aria-hidden': 'true'}});
    if (url) {
        node.style.maskImage = `url("${url}")`;
        node.style.webkitMaskImage = `url("${url}")`;
    }
    return node;
}

export function timeAgo(date) {
    const {unit, value} = relativeTime(date);
    if (unit === 'now')
        return 'just now';
    if (unit === 'minute')
        return `${value} min ago`;
    return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

function clock(ms) {
    return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/** macOS blocks local-network servers until the user allows it. */
export const LOCAL_NETWORK_TEXT = 'Couldn’t reach this server on your local network. If it’s running, allow Source Glance in System Settings → Privacy & Security → Local Network.';

export function errorText(error, intervalMinutes) {
    switch (error?.kind) {
    case 'insecure':
        return 'This instance uses plain http:// and isn’t on your local network now. Source Glance won’t send your sign-in to it.';
    case 'local-network':
        return LOCAL_NETWORK_TEXT;
    case 'auth':
        return 'Your sign-in was rejected. Sign in again in Settings.';
    case 'forbidden':
        return 'Your sign-in can’t read these issues. Check its permissions in Settings.';
    case 'rate-limit':
        return error.retryAt ? `GitHub rate limit reached. Retrying at ${clock(error.retryAt)}.`
            : 'GitHub rate limit reached. Retrying later.';
    case 'query':
        return 'A watched repository doesn’t exist or isn’t visible to your sign-in. Check Settings.';
    default:
        return `Couldn’t reach GitHub. Retrying in ${intervalMinutes} min.`;
    }
}

/** The lists chosen in `toolbar-buttons`, in their fixed order (old ids renamed). */
export function toolbarButtons(settings) {
    return normalizeButtons(settings.get('toolbar-buttons', TOOLBAR_LISTS));
}

/** A line of text that isn't a control: the header, a message or a heading. */
function info(ui, text, className = 'message') {
    ui.root.append(element('p', {className, text}));
}

function separator(ui) {
    ui.root.append(element('hr', {attrs: {role: 'separator'}}));
}

function action(ui, text, onClick, icon = null) {
    const button = element('button', {className: 'row action', attrs: {type: 'button', role: 'menuitem'}},
        [iconNode(icon), element('span', {className: 'label', text})]);
    button.addEventListener('click', onClick);
    ui.root.append(button);
    return button;
}

/** An issue, PR or draft row. Clicking it opens `entries` in a menu beside the list. */
function itemRow(ui, text, icon, entries) {
    const row = element('button', {
        className: 'row item',
        attrs: {'type': 'button', 'role': 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false'},
    }, [iconNode(icon), element('span', {className: 'label', text}), iconNode(ICONS.chevron)]);
    row.classList.add('has-arrow');
    row.addEventListener('click', () => ui.openActions(row, entries));
    ui.root.append(row);
    return row;
}

/** A heading for a group of items, with how many there are: plain, not a control. */
function groupHeading(ui, title, count) {
    ui.root.append(element('div', {className: 'group-heading'}, [
        element('span', {className: 'label', text: truncate(title, 48)}),
        element('span', {className: 'count', text: String(count)}),
    ]));
}

function signedIn(state) {
    return state.status === 'ready' || state.status === 'error';
}

/** True if the list has data to show; otherwise adds a short status message. */
function listReady(ui) {
    const {state} = ui;
    if (state.status === 'signed-out') {
        info(ui, 'Not signed in. Open the Source Glance menu to sign in.');
        return false;
    }
    if (state.status === 'loading') {
        info(ui, 'Loading…');
        return false;
    }
    if (state.status === 'error' && state.problem)
        info(ui, errorText({kind: state.problem.kind, retryAt: state.problem.retryAt}, state.intervalMinutes));
    return state.status === 'ready' || state.updatedAt !== null;
}

/** "Open on GitHub", or the instance's address for a self-hosted one. */
function openText(item, ui) {
    const account = ui.state.sources.find(source => source.account.id === item.accountId)?.account;
    if (account && !isDefaultBase(account.platform, account.base))
        return `Open on ${hostLabel(account.base)}`;
    return item.platform === 'gitlab' ? 'Open on GitLab' : 'Open on GitHub';
}

function itemLabel(item, context = '') {
    // `context` is the repository, where the heading above isn't the repository.
    const label = `${context}${itemRef(item)}  ${truncate(item.title)}`;
    return item.kind === 'pr' && item.reason === 'review' ? `${label} · review requested` : label;
}

/** An issue or PR row with its actions in the side menu. */
function addItem(ui, item, context = '') {
    const busy = ui.state.busy.includes(itemKey(item));
    let icon = item.kind === 'pr' ? ICONS.pr : ICONS.issue;
    if (item.state === 'closed')
        icon = item.kind === 'pr' ? ICONS.prClosed : ICONS.issueClosed;
    const run = (name, board) => () => ui.actions.run(item, name, board);
    const gitlab = item.platform === 'gitlab';
    const entries = [{text: openText(item, ui), icon: ICONS.open, onClick: () => item.url && openLink(item.url), enabled: Boolean(item.url)}];
    if (item.state === 'closed') {
        entries.push({text: 'Reopen', icon: ICONS.reopen, onClick: run('reopen')});
    } else {
        entries.push({text: 'Comment…', icon: ICONS.comment, onClick: run('comment')});
        if (item.kind === 'pr')
            entries.push({text: gitlab ? 'Close merge request…' : 'Close pull request…', icon: ICONS.prClosed, onClick: run('close')});
        else
            entries.push({text: 'Close issue…', icon: ICONS.issueClosed, onClick: run('close')});
        entries.push({text: 'Assignees…', icon: ICONS.assignees, onClick: run('assignees')});
        entries.push({text: 'Labels…', icon: ICONS.label, onClick: run('labels')});
        for (const board of item.boards ?? []) {
            entries.push({text: `${truncate(board.title, 30)}: ${board.status ?? 'No status'}…`, icon: ICONS.boards,
                onClick: run('status', board)});
        }
    }
    if (busy) {
        for (const entry of entries)
            entry.enabled = false;
    }
    const text = itemLabel(item, context);
    itemRow(ui, busy ? `${text} · working…` : text, icon, entries);
}

/** The always-visible footer: closed items still assigned to you, linking to them. */
function addClosedFooter(ui, count, url, text, icon) {
    separator(ui);
    action(ui, text(count ?? null), () => url && openLink(url), icon).classList.add('footer');
}

/** The items as groups, built the way Glance → System Tray says (Group by): [{title, issues}]. */
export function groupsFor(ui, sources, groupsOf) {
    const groupBy = normalizeGroupBy(ui.settings.get('group-by', 'project'));
    if (groupBy === 'platform')
        return groupByPlatform(sources, groupsOf);
    if (groupBy === 'organization') {
        // The names you gave organizations.
        const names = ui.settings.get('organization-names', {}) ?? {};
        return groupByOrganization(sources, groupsOf, (_account, login) => {
            const name = names[login.toLowerCase()] ?? '';
            return {key: (name || login).toLowerCase(), title: name ? `${name} (@${login})` : `@${login}`};
        });
    }
    return groupByProject(sources, groupsOf, normalizeRepoMap(ui.settings.get('project-repos', {}) ?? {}));
}

const LISTS = {
    issues: {
        key: 'issues',
        kind: 'issue',
        empty: 'No open issues assigned to you',
        emptyGitLab: 'No open GitLab issues assigned to you',
        closedIcon: 'issueClosed',
        closedText: n => n === null ? 'Closed issues still assigned to you'
            : `${n} closed issue${n === 1 ? '' : 's'} still assigned to you`,
        closedTextGitLab: n => n === null ? 'Closed GitLab issues still assigned to you'
            : `${n} closed GitLab issue${n === 1 ? '' : 's'} still assigned to you`,
    },
    prs: {
        key: 'prs',
        kind: 'pr',
        empty: 'No open pull requests for you',
        emptyGitLab: 'No open merge requests for you',
        closedIcon: 'prMerged',
        closedText: n => n === null ? 'Merged or closed pull requests still assigned to you'
            : `${n} merged or closed pull request${n === 1 ? '' : 's'} still assigned to you`,
        closedTextGitLab: n => n === null ? 'Merged or closed merge requests still assigned to you'
            : `${n} merged or closed merge request${n === 1 ? '' : 's'} still assigned to you`,
    },
};

/** Issues or pull requests: flat groups across all accounts, no filters, no sections. */
function renderItemList(ui, cfg) {
    const {state} = ui;
    const {sources} = state;
    if (sources.length === 0) {
        info(ui, 'Not signed in. Open the Source Glance menu to sign in.');
        return;
    }
    const loaded = sources.filter(src => src.status !== 'signed-out' && src.updatedAt);
    const groupsOf = src => (cfg.key === 'issues' ? src.groups : src.prGroups) ?? [];
    const groups = groupsFor(ui, loaded, groupsOf).filter(group => group.issues.length > 0);
    if (groups.length === 0 && loaded.length > 0)
        info(ui, loaded.every(src => src.platform === 'gitlab') ? cfg.emptyGitLab : cfg.empty);
    const byProject = normalizeGroupBy(ui.settings.get('group-by', 'project')) === 'project';
    for (const group of groups) {
        groupHeading(ui, group.title, group.issues.length);
        for (const item of group.issues)
            addItem(ui, item, byProject && group.title === item.repo ? '' : item.repo);
    }

    // An account that didn't load says so, and each account's closed-but-assigned count follows.
    for (const src of sources) {
        const gitlab = src.platform === 'gitlab';
        if (src.status === 'signed-out') {
            info(ui, `${src.title}: not signed in. Sign in again under Settings → Accounts.`);
            continue;
        }
        if (!src.updatedAt) {
            info(ui, src.status === 'error' ? errorText(src.error, state.intervalMinutes) : 'Loading…');
            continue;
        }
        if (src.status === 'error')
            info(ui, errorText(src.error, state.intervalMinutes));
        addClosedFooter(ui, src.closedCounts[cfg.key], closedPageUrl(src.account, cfg.kind, ui.settings.get('repositories', [])),
            gitlab ? cfg.closedTextGitLab : cfg.closedText, ICONS[cfg.closedIcon]);
    }
}

/** One GitHub account's boards and their draft items. */
function renderSourceBoards(ui, src) {
    if (src.boardsError) {
        info(ui, 'Source Glance can’t read the project boards of this account. Organization boards need the app installed on the organization.');
        return;
    }
    if (src.boards === null) {
        info(ui, src.updatedAt || src.status !== 'error' ? 'Loading project boards…' : errorText(src.error, ui.state.intervalMinutes));
        return;
    }
    const withDrafts = src.boards.filter(board => board.drafts.length > 0);
    if (withDrafts.length === 0) {
        info(ui, 'No draft items on your project boards');
        return;
    }
    for (const board of withDrafts) {
        const header = action(ui, truncate(board.title, 48), () => board.url && openLink(board.url), ICONS.boards);
        header.classList.add('board');
        header.disabled = !board.url;
        for (const group of groupDraftsByStatus(board)) {
            info(ui, group.status ?? 'No status', 'group-heading status');
            for (const draft of group.drafts) {
                const {item, board: target} = draftTarget(board, draft);
                const busy = ui.state.busy.includes(itemKey(item));
                const title = truncate(draft.title || 'Untitled draft');
                itemRow(ui, busy ? `${title} · working…` : title, isDoneStatus(draft.status) ? ICONS.issueClosed : ICONS.draft, [
                    {text: 'Move to status…', icon: ICONS.boards, onClick: () => ui.actions.run(item, 'status', target),
                        enabled: !busy && Boolean(board.fieldId) && board.options.length > 0},
                    {text: 'Open board', icon: ICONS.open, onClick: () => board.url && openLink(board.url), enabled: Boolean(board.url)},
                ]);
            }
        }
        if (board.truncated)
            action(ui, 'More on GitHub', () => board.url && openLink(board.url), ICONS.open).disabled = !board.url;
    }
}

/** Project Boards: all the GitHub accounts' boards in one flat list, no sections. */
function renderBoards(ui) {
    if (!listReady(ui))
        return;
    const sources = ui.state.sources.filter(src => src.platform === 'github' && src.status !== 'signed-out');
    if (sources.length === 0) {
        info(ui, 'Project boards come from GitHub accounts. Add one under Settings → Accounts.');
        return;
    }
    for (const src of sources)
        renderSourceBoards(ui, src);
}

function headerText(state) {
    const {status, sources, refreshing, updatedAt} = state;
    if (status === 'signed-out')
        return 'Sign in to see your issues';
    const logins = sources.filter(src => src.login).map(src => `@${src.login}`);
    if (logins.length === 0)
        return status === 'error' ? 'Source Glance' : 'Loading…';
    const who = logins.length === 1 ? logins[0] : `${sources.length} accounts`;
    if (refreshing)
        return `${who} · Refreshing…`;
    if (updatedAt)
        return `${who} · updated ${timeAgo(updatedAt)}`;
    return who;
}

/** The Source Glance menu: status, then the window's pages, each opening there. */
function renderApp(ui) {
    const {state} = ui;
    info(ui, headerText(state), 'header');
    if (state.status === 'error' && state.problem)
        info(ui, errorText({kind: state.problem.kind, retryAt: state.problem.retryAt}, state.intervalMinutes));
    separator(ui);
    action(ui, 'Glance', () => ui.app.openMain('widgets'), ICONS.glance);
    action(ui, 'Tasks', () => ui.app.openMain('tasks'), ICONS.tasks);
    if (signedIn(state))
        action(ui, 'Settings', () => ui.app.openMain('accounts'), ICONS.settings);
    else
        action(ui, 'Sign in…', () => ui.app.openMain('accounts'), ICONS.signIn);
    action(ui, 'About', () => ui.app.openMain('about'), ICONS.about);
}

/** The Source Glance menu's footer: Start automatically and Quit. */
function appFooter(ui) {
    separator(ui);
    const box = element('input', {className: 'switch', attrs: {'type': 'checkbox', 'role': 'switch', 'aria-label': 'Start automatically'}});
    box.checked = ui.app.startAtLogin;
    box.addEventListener('change', () => ui.app.setStartAtLogin(box.checked));
    ui.root.append(element('label', {className: 'row toggle'}, [element('span', {className: 'label', text: 'Start automatically'}), box]));
    action(ui, 'Quit', () => ui.app.quit(), ICONS.quit);
}

const VIEWS = {
    app: renderApp,
    issues: ui => renderItemList(ui, LISTS.issues),
    prs: ui => renderItemList(ui, LISTS.prs),
    boards: renderBoards,
};

/** The Grouped layout's tab bar: each list with its count, then Source Glance. */
function tabBar(ui, ids) {
    const bar = element('div', {className: 'tabs', attrs: {role: 'tablist'}});
    for (const id of ids) {
        const badge = id === 'app' ? '' : listBadge(id, ui.state);
        const tab = element('button', {
            className: 'tab',
            attrs: {'type': 'button', 'role': 'tab', 'aria-selected': String(ui.tab === id), 'aria-label': NAMES[id], 'title': NAMES[id]},
        }, [iconNode(id === 'app' ? ICONS.app : ICONS[id === 'prs' ? 'pr' : id]),
            ...badge ? [element('span', {className: 'count', text: badge})] : []]);
        tab.addEventListener('click', () => {
            ui.tab = id;
            ui.rerender();
        });
        bar.append(tab);
    }
    ui.root.append(bar);
}

/**
 * Draws the popover for `ui.page`: a list ("issues", "prs", "boards"), the Source Glance menu
 * ("app", in the Separate layout), or "tabs" (the Grouped layout's one menu).
 */
export function render(ui) {
    ui.root.replaceChildren();
    if (ui.page === 'tabs') {
        const ids = [...toolbarButtons(ui.settings), 'app'];
        if (!ids.includes(ui.tab))
            ui.tab = ids[0];
        tabBar(ui, ids);
        VIEWS[ui.tab](ui);
        // In the Grouped layout the footer stays at the bottom whichever tab is open.
        appFooter(ui);
        return;
    }
    const view = VIEWS[ui.page] ?? renderApp;
    view(ui);
    if (view === renderApp)
        appFooter(ui);
}
