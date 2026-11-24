// The menu-bar popover. It's always loaded (hidden), refreshes the lists on the interval,
// keeps the menu-bar counts up to date, and shows the page for whichever item was clicked.
import {listBadge, menuWidth} from '@shared/model.js';
import {listen} from '@tauri-apps/api/event';

import {Actions} from './actions.js';
import {
    Settings,
    hidePopover,
    openMain,
    quitApp,
    setStartAtLogin,
    sizePopover,
    startAtLogin,
    updateTray,
} from './platform/tauri.js';
import {Store} from './store.js';
import {trayImages} from './trayImages.js';
import {element, iconNode, render, toolbarButtons} from './views.js';

const $ = id => document.getElementById(id);

const settings = await new Settings().load();
const store = new Store(settings);

const ui = {
    root: $('menu'),
    settings,
    state: store.state,
    page: 'app',
    tab: 'issues',
    rerender: () => show(),
    openActions: (row, entries) => openActions(row, entries),
    app: {
        startAtLogin: false,
        openMain: page => openMain(page),
        refresh: () => store.refresh(),
        quit: () => quitApp(),
        setStartAtLogin: async enabled => {
            try {
                await setStartAtLogin(enabled);
                await settings.set('start-automatically', enabled);
            } catch (e) {
                notify(`Couldn’t change the login item: ${e}`);
            }
            ui.app.startAtLogin = await startAtLogin();
            show();
        },
    },
};

let toastTimer = null;
function notify(text) {
    const toast = $('toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.hidden = true;
        fit();
    }, 5000);
    fit();
}

/** The item whose actions are open beside the list, if any. */
let actionsFor = null;

/** Opens an item's actions in a menu beside the list, level with its row, as on Ubuntu. */
function openActions(row, entries) {
    if (actionsFor === row) {
        closeActions();
        return;
    }
    closeActions();
    actionsFor = row;
    row.setAttribute('aria-expanded', 'true');
    const box = $('actions');
    box.replaceChildren(...entries.map(entry => {
        const button = element('button', {className: 'row action', attrs: {type: 'button', role: 'menuitem'}},
            [iconNode(entry.icon), element('span', {className: 'label', text: entry.text})]);
        button.disabled = entry.enabled === false;
        button.addEventListener('click', () => {
            closeActions();
            entry.onClick();
        });
        return button;
    }));
    box.hidden = false;
    // Centred on the row, kept inside the window.
    const rowBox = row.getBoundingClientRect();
    const top = Math.max(0, rowBox.top + rowBox.height / 2 - box.offsetHeight / 2);
    box.style.marginTop = `${Math.round(top)}px`;
    fit();
    box.querySelector('button:not(:disabled)')?.focus();
}

function closeActions() {
    actionsFor?.setAttribute('aria-expanded', 'false');
    actionsFor = null;
    const box = $('actions');
    if (!box.hidden) {
        box.hidden = true;
        box.replaceChildren();
        fit();
    }
}

// A click anywhere outside the actions closes them.
document.addEventListener('mousedown', event => {
    if (actionsFor && !$('actions').contains(event.target) && !actionsFor.contains(event.target))
        closeActions();
});

function showPanel(panel) {
    closeActions();
    const layer = $('panel-layer');
    layer.replaceChildren(...panel ? [panel] : []);
    layer.hidden = !panel;
    $('menu').hidden = Boolean(panel);
    fit();
}

ui.actions = new Actions({store, showPanel, notify});

/**
 * Sizes the window to its content: Ubuntu's menu width (plus the actions beside it while
 * they're open), and at most the screen's height. Rust keeps the window's right edge in place.
 */
function fit() {
    const width = menuWidth(window.screen.width);
    $('box').style.width = `${width}px`;
    const actions = $('actions');
    const extra = actions.hidden ? 0 : actions.offsetWidth + 6;
    const limit = window.screen.availHeight - 40;
    $('box').style.maxHeight = `${limit}px`;
    const height = Math.min(limit, Math.max($('box').scrollHeight + 2,
        actions.hidden ? 0 : actions.offsetTop + actions.offsetHeight));
    sizePopover(width + extra, height);
}

function show() {
    ui.state = store.state;
    // A redraw replaces the rows, so the open actions would point at a row that's gone.
    closeActions();
    render(ui);
    fit();
}

/** The menu-bar items: their layout, counts and pill images. */
async function trayState(state) {
    const tray = {
        // Separate items by default, as on Ubuntu. On a crowded menu bar (the notch), Grouped
        // keeps it to one item.
        layout: settings.get('layout', 'separate'),
        buttons: toolbarButtons(settings),
        issues: listBadge('issues', state),
        prs: listBadge('prs', state),
        boards: listBadge('boards', state),
        problem: Boolean(state.problem),
    };
    try {
        tray.images = await trayImages({
            layout: tray.layout,
            buttons: tray.buttons,
            counts: {issues: tray.issues, prs: tray.prs, boards: tray.boards},
            problem: tray.problem,
        });
    } catch (e) {
        // Rust falls back to plain icons and text.
        console.error('sourceglance: drawing the menu bar failed', e);
    }
    return tray;
}

// Updates run one at a time, newest last, so a slow drawing can't overwrite a newer state.
let trayQueue = Promise.resolve();
function refreshTray() {
    trayQueue = trayQueue
        .then(() => trayState(store.state))
        .then(updateTray)
        .catch(e => console.error('sourceglance: menu bar update failed', e));
}

store.connect(() => {
    refreshTray();
    show();
});

settings.connect(key => {
    if (key === 'layout' || key === 'toolbar-buttons')
        refreshTray();
});

// Redraw the icons in the new text colour when the menu bar turns light or dark.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTray);

await listen('popover:show', async ({payload}) => {
    ui.page = payload;
    showPanel(null);
    ui.app.startAtLogin = await startAtLogin();
    show();
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape')
        return;
    if (actionsFor)
        closeActions();
    else if (!$('panel-layer').hidden)
        showPanel(null);
    else
        hidePopover();
});

await store.start();
// First run: nothing to show in the menu bar yet, so open the window on Accounts.
if (store.accounts.length === 0)
    openMain('accounts');
