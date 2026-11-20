// The menu-bar popover. It's always loaded (hidden), refreshes the lists on the interval,
// keeps the menu-bar counts up to date, and shows the page for whichever item was clicked.
import {listBadge, menuWidth} from '@core/model.js';
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
import {render, toolbarButtons} from './views.js';

const $ = id => document.getElementById(id);

const settings = await new Settings().load();
const store = new Store(settings);

const ui = {
    root: $('menu'),
    settings,
    state: store.state,
    page: 'app',
    tab: 'issues',
    // Label filters are per session, as on Ubuntu.
    filters: {},
    expanded: null,
    badge: id => listBadge(id, store.state) || '0',
    rerender: () => show(),
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

function showPanel(panel) {
    const layer = $('panel-layer');
    layer.replaceChildren(...panel ? [panel] : []);
    layer.hidden = !panel;
    $('menu').hidden = Boolean(panel);
    fit();
}

ui.actions = new Actions({store, showPanel, notify});

/** Sizes the window to its content: Ubuntu's menu width, and at most 70 % of the screen high. */
function fit() {
    const width = menuWidth(window.screen.width);
    document.body.style.width = `${width}px`;
    const height = Math.min(document.body.scrollHeight, Math.round(window.screen.availHeight * 0.7));
    sizePopover(width, height);
}

function show() {
    ui.state = store.state;
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
        projects: listBadge('projects', state),
        problem: Boolean(state.problem),
    };
    try {
        tray.images = await trayImages({
            layout: tray.layout,
            buttons: tray.buttons,
            counts: {issues: tray.issues, prs: tray.prs, projects: tray.projects},
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
    ui.expanded = null;
    showPanel(null);
    ui.app.startAtLogin = await startAtLogin();
    show();
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape')
        return;
    if (!$('panel-layer').hidden)
        showPanel(null);
    else
        hidePopover();
});

await store.start();
// First run: nothing to show in the menu bar yet, so open the window on Accounts.
if (store.accounts.length === 0)
    openMain('accounts');
