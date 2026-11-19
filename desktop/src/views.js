// What each menu-bar popover shows, the same as the Ubuntu top-bar menus (src/lib/views.js):
// one section per account, repository headings that collapse, a label filter, and the
// closed-items footer. `ui` is {root, state, settings, filters, rerender, actions, page}.
import {hostLabel, isDefaultBase} from '@core/accounts.js';
import {
    draftTarget,
    filterByLabel,
    groupCollapseId,
    groupDraftsByStatus,
    isDoneStatus,
    isGroupCollapsed,
    itemKey,
    itemRef,
    labelOptions,
    relativeTime,
    sourceBadge,
    toggleId,
    truncate,
} from '@core/model.js';
import {closedPageUrl, profileUrl} from '@core/requests.js';

import issueIcon from '../../src/icons/issue-symbolic.svg';
import issueClosedIcon from '../../src/icons/issue-closed-symbolic.svg';
import prIcon from '../../src/icons/git-pull-request-symbolic.svg';
import prClosedIcon from '../../src/icons/pr-closed-symbolic.svg';
import mergeIcon from '../../src/icons/git-merge-symbolic.svg';
import projectsIcon from '../../src/icons/checklist-symbolic.svg';
import {openLink} from './platform/tauri.js';

export const ICONS = {
    issue: issueIcon,
    issueClosed: issueClosedIcon,
    pr: prIcon,
    prClosed: prClosedIcon,
    prMerged: mergeIcon,
    projects: projectsIcon,
};

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

export function errorText(error, intervalMinutes) {
    switch (error?.kind) {
    case 'insecure':
        return 'This instance uses plain http:// and isn’t on your local network now. Source Glance won’t send your sign-in to it.';
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

function info(ui, text, className = 'message') {
    ui.root.append(element('p', {className, text}));
}

function action(ui, text, onClick, icon = null) {
    const button = element('button', {className: 'row action', attrs: {type: 'button'}},
        [iconNode(icon), element('span', {className: 'label', text})]);
    button.addEventListener('click', onClick);
    ui.root.append(button);
    return button;
}

/** A heading that collapses a section or a repository; the setting remembers it. */
function toggle(ui, text, count, collapsed, key, id, className) {
    const button = element('button', {
        className: `row toggle ${className}`,
        attrs: {'type': 'button', 'aria-expanded': String(!collapsed)},
    }, [
        element('span', {className: 'chevron', text: collapsed ? '▸' : '▾'}),
        element('span', {className: 'label', text}),
        element('span', {className: 'count', text: count}),
    ]);
    button.addEventListener('click', () => ui.settings.set(key, toggleId(ui.settings.get(key, []), id)));
    ui.root.append(button);
}

function openText(item, ui) {
    const account = ui.state.sources.find(source => source.account.id === item.accountId)?.account;
    if (account && !isDefaultBase(account.platform, account.base))
        return `Open on ${hostLabel(account.base)}`;
    return item.platform === 'gitlab' ? 'Open on GitLab' : 'Open on GitHub';
}

function itemLabel(item) {
    const label = `${itemRef(item)}  ${truncate(item.title)}`;
    return item.kind === 'pr' && item.reason === 'review' ? `${label} · review requested` : label;
}

/** An issue or PR row. Clicking it shows its actions under it. */
function addItem(ui, item) {
    const key = itemKey(item);
    const busy = ui.state.busy.includes(key);
    let icon = item.kind === 'pr' ? ICONS.pr : ICONS.issue;
    if (item.state === 'closed')
        icon = item.kind === 'pr' ? ICONS.prClosed : ICONS.issueClosed;
    const open = ui.expanded === key;
    const row = element('button', {className: 'row item', attrs: {'type': 'button', 'aria-expanded': String(open)}}, [
        iconNode(icon),
        element('span', {className: 'label', text: busy ? `${itemLabel(item)} · working…` : itemLabel(item)}),
        element('span', {className: 'chevron', text: open ? '▾' : '▸'}),
    ]);
    row.addEventListener('click', () => {
        ui.expanded = open ? null : key;
        ui.rerender();
    });
    ui.root.append(row);
    if (!open)
        return;

    const menu = element('div', {className: 'item-actions'});
    const add = (text, onClick, enabled = true) => {
        const button = element('button', {className: 'row sub', text, attrs: {type: 'button'}});
        button.disabled = busy || !enabled;
        button.addEventListener('click', onClick);
        menu.append(button);
    };
    const gitlab = item.platform === 'gitlab';
    add(openText(item, ui), () => item.url && openLink(item.url), Boolean(item.url));
    if (item.state === 'closed') {
        add('Reopen', () => ui.actions.run(item, 'reopen'));
    } else {
        add('Comment…', () => ui.actions.run(item, 'comment'));
        if (item.kind === 'pr')
            add(gitlab ? 'Close merge request…' : 'Close pull request…', () => ui.actions.run(item, 'close'));
        else
            add('Close issue…', () => ui.actions.run(item, 'close'));
        add('Assignees…', () => ui.actions.run(item, 'assignees'));
        add('Labels…', () => ui.actions.run(item, 'labels'));
        for (const board of item.boards ?? [])
            add(`${truncate(board.title, 30)}: ${board.status ?? 'No status'}…`, () => ui.actions.run(item, 'status', board));
    }
    ui.root.append(menu);
}

/** A section heading with its label filter, then items grouped by repository. */
function addSection(ui, title, groups, key, list, section) {
    const options = labelOptions(groups);
    let filter = ui.filters[key] ?? null;
    // The label disappeared after a refresh: show everything again.
    if (filter !== null && !options.some(option => option.name === filter))
        filter = ui.filters[key] = null;

    const select = element('select', {className: 'label-filter', attrs: {'aria-label': `Filter ${title} by label`}});
    select.append(element('option', {text: 'All labels', attrs: {value: ''}}));
    for (const option of options)
        select.append(element('option', {text: `${truncate(option.name, 40)} (${option.count})`, attrs: {value: option.name}}));
    select.value = filter ?? '';
    select.addEventListener('change', () => {
        ui.filters[key] = select.value || null;
        ui.rerender();
    });
    ui.root.append(element('div', {className: 'section-header'}, [element('span', {text: title}), select]));

    for (const group of filterByLabel(groups, filter)) {
        // Same ids as Ubuntu's menus and window, so a repository collapses everywhere.
        const id = groupCollapseId(list, section, group.repo);
        const collapsed = isGroupCollapsed(ui.settings.get('collapsed-groups', []), id);
        toggle(ui, truncate(group.repo, 48), String(group.issues.length), collapsed, 'collapsed-groups', id, 'repo');
        if (!collapsed) {
            for (const item of group.issues)
                addItem(ui, item);
        }
    }
}

function addClosedFooter(ui, count, url, text, icon) {
    ui.root.append(element('hr'));
    action(ui, text(count ?? null), () => url && openLink(url), icon).classList.add('footer');
}

const LISTS = {
    issues: {
        key: 'issues',
        kind: 'issue',
        title: 'Issues',
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
        title: 'Pull requests',
        empty: 'No open pull requests for you',
        emptyGitLab: 'No open merge requests for you',
        closedIcon: 'prMerged',
        closedText: n => n === null ? 'Merged or closed pull requests still assigned to you'
            : `${n} merged or closed pull request${n === 1 ? '' : 's'} still assigned to you`,
        closedTextGitLab: n => n === null ? 'Merged or closed merge requests still assigned to you'
            : `${n} merged or closed merge request${n === 1 ? '' : 's'} still assigned to you`,
    },
};

function renderSource(ui, cfg, src) {
    const gitlab = src.platform === 'gitlab';
    if (src.status === 'signed-out') {
        info(ui, 'Not signed in. Sign in again under Settings → Accounts.');
        return;
    }
    if (!src.updatedAt) {
        info(ui, src.status === 'error' ? errorText(src.error, ui.state.intervalMinutes) : 'Loading…');
        return;
    }
    if (src.status === 'error')
        info(ui, errorText(src.error, ui.state.intervalMinutes));
    const groups = cfg.key === 'issues' ? src.groups : src.prGroups;
    if (groups.length === 0)
        info(ui, gitlab ? cfg.emptyGitLab : cfg.empty);
    else
        addSection(ui, cfg.title, groups, `${cfg.key}:${src.key}`, cfg.key, src.key);
    addClosedFooter(ui, src.closedCounts[cfg.key], closedPageUrl(src.account, cfg.kind, ui.settings.get('repositories', [])),
        gitlab ? cfg.closedTextGitLab : cfg.closedText, ICONS[cfg.closedIcon]);
}

function renderItemList(ui, cfg) {
    const {sources} = ui.state;
    if (sources.length === 0) {
        info(ui, 'Not signed in. Open the Source Glance menu to sign in.');
    } else if (sources.length === 1) {
        // One account: no section headers.
        renderSource(ui, cfg, sources[0]);
    } else {
        for (const src of sources) {
            const id = `${cfg.key}:${src.key}`;
            const collapsed = ui.settings.get('collapsed-sections', []).includes(id);
            toggle(ui, truncate(src.title, 48), sourceBadge(cfg.key, src), collapsed, 'collapsed-sections', id, 'account');
            if (!collapsed)
                renderSource(ui, cfg, src);
        }
    }
}

function renderBoards(ui, src) {
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
        action(ui, truncate(board.title, 48), () => board.url && openLink(board.url), ICONS.projects).classList.add('board');
        for (const group of groupDraftsByStatus(board)) {
            ui.root.append(element('p', {className: 'status-heading', text: group.status ?? 'No status'}));
            for (const draft of group.drafts) {
                const {item, board: target} = draftTarget(board, draft);
                const busy = ui.state.busy.includes(itemKey(item));
                const title = truncate(draft.title || 'Untitled draft');
                const row = action(ui, busy ? `${title} · working…` : title,
                    () => ui.actions.run(item, 'status', target), isDoneStatus(draft.status) ? ICONS.issueClosed : ICONS.issue);
                row.title = 'Move to status…';
                row.disabled = busy || !board.fieldId || board.options.length === 0;
            }
        }
        if (board.truncated)
            action(ui, 'More on GitHub', () => board.url && openLink(board.url));
    }
}

function renderProjects(ui) {
    const sources = ui.state.sources.filter(src => src.platform === 'github' && src.status !== 'signed-out');
    if (ui.state.status === 'signed-out' || sources.length === 0) {
        info(ui, 'Project boards come from GitHub accounts. Add one under Settings → Accounts.');
        return;
    }
    if (sources.length === 1) {
        renderBoards(ui, sources[0]);
        return;
    }
    for (const src of sources) {
        const id = `projects:${src.key}`;
        const collapsed = ui.settings.get('collapsed-sections', []).includes(id);
        toggle(ui, truncate(src.title, 48), sourceBadge('projects', src), collapsed, 'collapsed-sections', id, 'account');
        if (!collapsed)
            renderBoards(ui, src);
    }
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

/** The Source Glance menu: status, Open All Tasks, profiles, Refresh, Settings, and the footer. */
function renderApp(ui) {
    const {state} = ui;
    info(ui, headerText(state), 'header');
    if (state.problem)
        info(ui, `${state.problem.title}: ${errorText({kind: state.problem.kind, retryAt: state.problem.retryAt}, state.intervalMinutes)}`);
    ui.root.append(element('hr'));
    const signedIn = state.status !== 'signed-out';
    if (signedIn) {
        action(ui, 'Open All Tasks', () => ui.app.openMain('tasks'));
        const profiles = state.sources.map(src => ({src, url: profileUrl(src.account)})).filter(({url}) => url);
        for (const {src, url} of profiles) {
            action(ui, profiles.length === 1 && src.platform === 'github' ? 'Your GitHub profile'
                : `Profile: ${truncate(src.title, 40)}`, () => openLink(url));
        }
        action(ui, 'Refresh', () => ui.app.refresh()).disabled = state.refreshing;
        action(ui, 'Settings', () => ui.app.openMain('settings'));
    } else {
        action(ui, 'Sign in…', () => ui.app.openMain('accounts'));
    }
    ui.root.append(element('hr'));
    const login = element('input', {attrs: {type: 'checkbox'}});
    login.checked = ui.app.startAtLogin;
    login.addEventListener('change', () => ui.app.setStartAtLogin(login.checked));
    ui.root.append(element('label', {className: 'row switch'}, [element('span', {className: 'label', text: 'Start automatically'}), login]));
    action(ui, 'Quit', () => ui.app.quit());
}

const LIST_IDS = ['issues', 'prs', 'projects'];

/** The lists chosen in `toolbar-buttons`, ignoring unknown names and repeats. */
export function toolbarButtons(settings) {
    const chosen = settings.get('toolbar-buttons', LIST_IDS);
    if (!Array.isArray(chosen))
        return LIST_IDS;
    return chosen.filter((id, index) => LIST_IDS.includes(id) && chosen.indexOf(id) === index);
}

/** The tabs layout: one tab per list, like Ubuntu's "tabs" top bar. */
function renderTabs(ui) {
    const tabs = ['app', ...toolbarButtons(ui.settings)];
    if (!tabs.includes(ui.tab))
        ui.tab = tabs[1] ?? 'app';
    const titles = {app: 'Source Glance', issues: 'Issues', prs: 'Pull requests', projects: 'Projects'};
    const bar = element('div', {className: 'tabs', attrs: {role: 'tablist'}});
    for (const id of tabs) {
        const badge = id === 'app' ? '' : ui.badge(id);
        const tab = element('button', {
            className: 'tab',
            attrs: {'type': 'button', 'role': 'tab', 'aria-selected': String(ui.tab === id)},
        }, [element('span', {text: titles[id]}), ...badge ? [element('span', {className: 'badge', text: badge})] : []]);
        tab.addEventListener('click', () => {
            ui.tab = id;
            ui.expanded = null;
            ui.rerender();
        });
        bar.append(tab);
    }
    ui.root.append(bar);
    PAGES[ui.tab](ui);
}

const PAGES = {
    app: renderApp,
    issues: ui => renderItemList(ui, LISTS.issues),
    prs: ui => renderItemList(ui, LISTS.prs),
    projects: renderProjects,
    tabs: renderTabs,
};

export function render(ui) {
    ui.root.replaceChildren();
    (PAGES[ui.page] ?? renderApp)(ui);
}
