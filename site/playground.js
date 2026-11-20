// The home page's "Try it" section: a top bar and a Tasks window the visitor clicks through
// themselves (demo.js plays the animated ones). Everything here is made-up sample data.
'use strict';

const ITEMS = [
    {kind: 'issue', ref: '#42', title: 'Fix the login redirect', repo: 'example/web-app', account: 'GitHub', labels: ['bug']},
    {kind: 'issue', ref: '#37', title: 'Dark mode for settings', repo: 'example/web-app', account: 'GitHub', labels: ['design']},
    {kind: 'issue', ref: '#12', title: 'Crash when offline', repo: 'acme/api', account: 'GitLab', labels: ['bug']},
    {kind: 'issue', ref: '#9', title: 'Document the setup', repo: 'acme/docs', account: 'GitLab', labels: ['docs']},
    {kind: 'pr', ref: '#88', title: 'New onboarding screens', repo: 'example/web-app', account: 'GitHub', labels: ['design'], review: true},
    {kind: 'pr', ref: '!19', title: 'Retry on rate limits', repo: 'acme/api', account: 'GitLab', labels: ['bug']},
    {kind: 'draft', ref: '', title: 'Plan the Q3 roadmap', repo: 'Team board · In progress', account: 'GitHub', labels: []},
];

const LISTS = [
    {id: 'all', name: 'All Tasks', icon: 'ic-list', kinds: ['issue', 'pr', 'draft']},
    {id: 'issues', name: 'Issues', icon: 'ic-check', kinds: ['issue']},
    {id: 'prs', name: 'Pull requests', icon: 'ic-pr', kinds: ['pr']},
    {id: 'projects', name: 'Project Boards', icon: 'ic-checklist', kinds: ['draft']},
];

// How the top bar menu groups its lists (Group by in Glance → System Tray).
const PROJECT_OF = {'example/web-app': 'Storefront', 'acme/api': 'Storefront', 'acme/docs': 'Acme Docs'};
const ORGANIZATIONS = {example: 'Example Co (@example)', acme: 'Acme (@acme)'};

function groupOf(item, by) {
    if (item.kind === 'draft')
        return 'Team board';
    if (by === 'platform')
        return item.account;
    if (by === 'organization') {
        const organization = item.repo.split('/')[0];
        return ORGANIZATIONS[organization] ?? `@${organization}`;
    }
    return PROJECT_OF[item.repo] ?? item.repo;
}

const KIND_ICON = {issue: 'ic-issue k-issue', pr: 'ic-pr k-pr', draft: 'ic-draft k-draft'};

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

const icon = classes => el('i', {className: `ic ${classes}`, ariaHidden: 'true'});

function itemRow(item) {
    const text = el('p', {}, [el('b', {textContent: `${item.ref} ${item.title}`.trim()}), el('small', {textContent: item.repo})]);
    const row = el('div', {className: 'row'}, [icon(KIND_ICON[item.kind]), text]);
    if (item.review)
        row.append(el('span', {className: 'try-tag', textContent: 'review'}));
    return row;
}

function setupTopBar(root) {
    const $ = name => root.querySelector(`[data-el="${name}"]`);
    const section = root.closest('.try-block');
    const state = {layout: 'group', group: 'project', lists: new Set(['issues', 'prs', 'projects']), open: 'issues'};

    const render = () => {
        const buttons = $('buttons');
        buttons.replaceChildren();
        buttons.classList.toggle('tabs', state.layout === 'tabs');
        buttons.append(el('span', {className: 'seg app'}, [icon('ic-sourceglance'), 'Source Glance']));
        for (const list of LISTS.slice(1)) {
            if (!state.lists.has(list.id))
                continue;
            const count = ITEMS.filter(item => list.kinds.includes(item.kind)).length;
            const label = state.layout === 'tabs' ? [icon(list.icon), list.name, el('b', {textContent: count})]
                : [icon(list.icon), el('b', {textContent: count})];
            const button = el('button', {type: 'button', className: `seg${state.open === list.id ? ' on' : ''}`,
                ariaLabel: `${list.name}: ${count}`, ariaExpanded: String(state.open === list.id)}, label);
            button.addEventListener('click', () => {
                state.open = state.open === list.id ? null : list.id;
                render();
            });
            buttons.append(button);
        }

        const menu = $('menu');
        menu.replaceChildren();
        const list = LISTS.find(other => other.id === state.open && state.lists.has(other.id));
        menu.hidden = !list;
        if (!list)
            return;
        menu.append(el('div', {className: 'menu-head'}, [el('b', {textContent: list.name})]));
        // One flat list across accounts: a plain heading per group, then its items.
        const items = ITEMS.filter(item => list.kinds.includes(item.kind));
        const groups = new Map();
        for (const item of items) {
            const group = groupOf(item, state.group);
            if (!groups.has(group))
                groups.set(group, []);
            groups.get(group).push(item);
        }
        for (const [group, mine] of groups) {
            menu.append(el('div', {className: 'menu-section'}, [group, el('em', {textContent: mine.length})]));
            for (const item of mine) {
                // The repository leads the reference when the heading isn't the repository.
                const ref = item.kind === 'draft' || group === item.repo ? item.ref : `${item.repo}${item.ref}`;
                menu.append(el('div', {className: 'menu-item'}, [icon(KIND_ICON[item.kind]),
                    el('span', {textContent: ref}), ` ${item.title}`]));
            }
        }
    };

    for (const button of section.querySelectorAll('[data-group]')) {
        button.addEventListener('click', () => {
            state.group = button.dataset.group;
            for (const other of section.querySelectorAll('[data-group]'))
                other.setAttribute('aria-checked', String(other === button));
            render();
        });
    }
    for (const button of section.querySelectorAll('[data-layout]')) {
        button.addEventListener('click', () => {
            state.layout = button.dataset.layout;
            for (const other of section.querySelectorAll('[data-layout]'))
                other.setAttribute('aria-checked', String(other === button));
            render();
        });
    }
    for (const button of section.querySelectorAll('[data-list]')) {
        button.addEventListener('click', () => {
            const id = button.dataset.list;
            // Keep at least one list in the top bar, as the extension does.
            if (state.lists.has(id) && state.lists.size === 1)
                return;
            if (state.lists.has(id))
                state.lists.delete(id);
            else
                state.lists.add(id);
            button.setAttribute('aria-pressed', String(state.lists.has(id)));
            if (!state.lists.has(state.open))
                state.open = [...state.lists][0];
            render();
        });
    }
    render();
}

function setupTasks(root) {
    const $ = name => root.querySelector(`[data-el="${name}"]`);
    const state = {list: 'all', label: null, search: ''};
    const labels = [...new Set(ITEMS.flatMap(item => item.labels))];

    const matches = item => {
        const words = state.search.toLowerCase().split(/\s+/).filter(Boolean);
        const text = `${item.ref} ${item.title} ${item.repo} ${item.labels.join(' ')}`.toLowerCase();
        return (!state.label || item.labels.includes(state.label)) && words.every(word => text.includes(word));
    };

    const render = () => {
        const lists = $('lists');
        lists.replaceChildren(el('b', {className: 'sub-h', textContent: 'Tasks'}));
        for (const list of LISTS) {
            const count = ITEMS.filter(item => list.kinds.includes(item.kind) && matches(item)).length;
            const button = el('button', {type: 'button', role: 'tab', className: `sub-i${state.list === list.id ? ' on' : ''}`,
                ariaSelected: String(state.list === list.id)}, [icon(list.icon), list.name, el('em', {textContent: count})]);
            button.addEventListener('click', () => {
                state.list = list.id;
                render();
            });
            lists.append(button);
        }

        const list = LISTS.find(other => other.id === state.list);
        $('title').textContent = list.name;
        const chips = $('labels');
        chips.replaceChildren();
        for (const label of labels) {
            const chip = el('button', {type: 'button', className: 'fchip', ariaPressed: String(state.label === label)},
                [icon('ic-label'), label]);
            chip.addEventListener('click', () => {
                state.label = state.label === label ? null : label;
                render();
            });
            chips.append(chip);
        }

        const rows = $('rows');
        const shown = ITEMS.filter(item => list.kinds.includes(item.kind) && matches(item));
        rows.replaceChildren(...shown.map(itemRow));
        if (shown.length === 0)
            rows.append(el('p', {className: 'try-empty', textContent: 'Nothing matches. Clear the search or the label.'}));
    };

    $('search').addEventListener('input', event => {
        state.search = event.target.value;
        render();
    });
    render();
}

document.querySelectorAll('[data-try="topbar"]').forEach(setupTopBar);
document.querySelectorAll('[data-try="tasks"]').forEach(setupTasks);
