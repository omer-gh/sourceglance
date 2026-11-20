// Desktop widgets: cards with your lists, on the desktop below every window. They sit just
// above the desktop-icons window when there is one (Desktop Icons draws the desktop as a
// window), so they stay visible and clickable. Drag a card by its header; positions are saved.
// Which cards, their order and opacity come from the window's Glance → Widgets.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    clampWidgetPosition,
    customWidgetItems,
    defaultWidgetPositions,
    isDoneStatus,
    itemRef,
    listBadge,
    normalizeWidgetLayout,
    normalizeWidgets,
    parseCustomWidgets,
    relativeTime,
    searchPageUrl,
    truncate,
    largestCardSize,
    scaledCardSize,
    widgetCardSize,
    widgetOrder,
} from './model.js';
import {GITHUB_COM} from './accounts.js';
import {openUri} from './views.js';

// A list row's height and the rest of a card (header, footer), to work out how many rows fit.
const ROW_HEIGHT = 28;
const CARD_CHROME = 64;

/** The window Desktop Icons (or another desktop app) draws the desktop with. */
function isDesktopWindow(metaWindow) {
    return metaWindow.get_window_type() === Meta.WindowType.DESKTOP;
}

function updatedText(state) {
    if (state.status === 'signed-out')
        return _('Not signed in');
    if (!state.updatedAt)
        return _('Loading…');
    const {unit, value} = relativeTime(state.updatedAt);
    if (unit === 'now')
        return _('Updated just now');
    if (unit === 'minute')
        return ngettext('Updated %d min ago', 'Updated %d min ago', value).format(value);
    if (unit === 'hour')
        return ngettext('Updated %d hour ago', 'Updated %d hours ago', value).format(value);
    return ngettext('Updated %d day ago', 'Updated %d days ago', value).format(value);
}

class Card {
    /** `def` is a custom widget's settings (parseCustomWidgets()), null for the built-in cards. */
    constructor({id, def = null, title, gicon, onDragEnd}) {
        this.id = id;
        this.def = def;
        this._onDragEnd = onDragEnd;
        this.actor = new St.BoxLayout({style_class: 'sourceglance-widget', reactive: true, clip_to_allocation: true});
        this._maxRows = 1;
        // GNOME 48 replaced St.BoxLayout's `vertical` with `orientation`.
        if ('orientation' in this.actor)
            this.actor.orientation = Clutter.Orientation.VERTICAL;
        else
            this.actor.vertical = true;

        this._header = new St.BoxLayout({style_class: 'sourceglance-widget-header', reactive: true, track_hover: true});
        this._header.add_child(new St.Icon({gicon, style_class: 'sourceglance-widget-icon'}));
        this._header.add_child(new St.Label({text: title, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._count = new St.Label({style_class: 'sourceglance-widget-count', y_align: Clutter.ActorAlign.CENTER});
        this._header.add_child(this._count);
        this.actor.add_child(this._header);

        this._body = new St.BoxLayout({style_class: 'sourceglance-widget-body'});
        if ('orientation' in this._body)
            this._body.orientation = Clutter.Orientation.VERTICAL;
        else
            this._body.vertical = true;
        this.actor.add_child(this._body);
        this._footer = new St.Label({style_class: 'sourceglance-widget-footer'});
        this.actor.add_child(this._footer);

        this._header.connect('button-press-event', (_actor, event) => this._startDrag(event));
    }

    /** widgetCardSize(), scaled to the card's size (scaledCardSize()); the list shows as many rows as fit. */
    setSize({width, height}) {
        this.actor.set_size(width, height);
        this._body.y_expand = true;
        this._maxRows = Math.max(1, Math.floor((height - CARD_CHROME) / ROW_HEIGHT) - 1);
    }

    destroy() {
        this._endDrag(false);
        this.actor.destroy();
    }

    // Dragging by the header: follow the pointer until release, then save the spot.
    _startDrag(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        // A press while one is still tracked (its release was missed) must not leave a handler behind.
        this._endDrag(false);
        const [x, y] = event.get_coords();
        this._drag = {dx: x - this.actor.x, dy: y - this.actor.y};
        this._dragId = global.stage.connect('captured-event', (_stage, e) => {
            if (!this._drag)
                return Clutter.EVENT_PROPAGATE;
            const type = e.type();
            if (type === Clutter.EventType.MOTION) {
                const [mx, my] = e.get_coords();
                this.actor.set_position(Math.round(mx - this._drag.dx), Math.round(my - this._drag.dy));
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE) {
                this._endDrag(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _endDrag(save) {
        if (this._dragId)
            global.stage.disconnect(this._dragId);
        this._dragId = 0;
        if (save && this._drag)
            this._onDragEnd(this);
        this._drag = null;
    }

    _row({gicon = null, iconName = null, text, detail = '', onClick}) {
        const box = new St.BoxLayout({style_class: 'sourceglance-widget-row-box', x_expand: true});
        // Only one of the two: an empty icon_name would clear a themed gicon.
        box.add_child(new St.Icon({...gicon ? {gicon} : {icon_name: iconName}, style_class: 'sourceglance-widget-icon'}));
        const label = new St.Label({text, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        // Cards have a fixed width; long titles end in an ellipsis.
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(label);
        if (detail)
            box.add_child(new St.Label({text: detail, style_class: 'sourceglance-widget-detail', y_align: Clutter.ActorAlign.CENTER}));
        const row = new St.Button({child: box, style_class: 'sourceglance-widget-row', x_expand: true, can_focus: true});
        if (onClick)
            row.connect('clicked', onClick);
        else
            row.reactive = false;
        this._body.add_child(row);
    }

    _message(text) {
        this._body.add_child(new St.Label({text, style_class: 'sourceglance-widget-message'}));
    }

    render(state, icons, repos) {
        this._body.destroy_all_children();
        this._footer.text = updatedText(state);
        const signedIn = state.status === 'ready' || state.status === 'error';
        this._count.text = this.id === 'summary' || this.def ? '' : listBadge(this.id, state);
        if (!signedIn) {
            this._message(state.status === 'signed-out'
                ? _('Sign in from the Source Glance menu.')
                : _('Loading…'));
            return;
        }
        if (this.def) {
            this._renderCustom(state, icons);
            return;
        }
        switch (this.id) {
        case 'summary':
            this._renderSummary(state, icons, repos);
            break;
        case 'issues':
        case 'prs':
            this._renderItems(state, icons);
            break;
        case 'boards':
            this._renderBoards(state, icons);
            break;
        }
    }

    _renderSummary(state, icons, repos) {
        // The rows link to github.com's search pages when a github.com account is signed in.
        const dotCom = state.sources.some(src => src.account.base === GITHUB_COM && src.updatedAt);
        const github = page => (dotCom ? () => openUri(page) : null);
        this._row({gicon: icons.issues, text: _('Issues'), detail: listBadge('issues', state),
            onClick: github(searchPageUrl('issue', repos))});
        this._row({gicon: icons.prs, text: _('Pull requests'), detail: listBadge('prs', state),
            onClick: github('https://github.com/pulls')});
        this._row({gicon: icons.boards, text: _('Project drafts'), detail: listBadge('boards', state) || '–'});
        // Every account's closed counts, added up.
        const sum = key => {
            const known = state.sources.map(src => src.closedCounts?.[key]).filter(n => Number.isInteger(n));
            return known.length ? String(known.reduce((a, b) => a + b, 0)) : '–';
        };
        this._row({gicon: icons.issueClosed, text: _('Closed issues still assigned'), detail: sum('issues'),
            onClick: github(searchPageUrl('issue-closed', repos))});
        this._row({gicon: icons.prMerged, text: _('Merged or closed PRs still assigned'), detail: sum('prs'),
            onClick: github(searchPageUrl('pr-closed', repos))});
    }

    _renderItems(state, icons) {
        const pr = this.id === 'prs';
        const several = state.sources.length > 1;
        const titles = new Map(state.sources.map(src => [src.account.id, src.title]));
        const items = state.sources.flatMap(src => (pr ? src.prGroups : src.groups).flatMap(group => group.issues));
        if (items.length === 0) {
            this._message(pr ? _('No open pull requests for you') : _('No open issues assigned to you'));
            return;
        }
        for (const item of items.slice(0, this._maxRows)) {
            this._row({gicon: pr ? icons.prs : icons.issue, text: `${itemRef(item)}  ${truncate(item.title, 80)}`,
                // With several accounts, say whose it is (e.g. "GitLab · @bob").
                detail: [several ? truncate(titles.get(item.accountId) ?? '', 24) : '', pr && item.reason === 'review' ? _('review') : '']
                    .filter(Boolean).join(' · '),
                onClick: item.url ? () => openUri(item.url) : null});
        }
        if (items.length > this._maxRows) {
            this._row({iconName: 'view-more-horizontal-symbolic',
                text: ngettext('%d more in the Source Glance window', '%d more in the Source Glance window',
                    items.length - this._maxRows).format(items.length - this._maxRows)});
        }
    }

    _renderCustom(state, icons) {
        const found = customWidgetItems(this.def, state);
        this._count.text = String(found.length);
        if (found.length === 0) {
            this._message(_('Nothing matches this widget’s filters'));
            return;
        }
        for (const entry of found.slice(0, this._maxRows)) {
            if (this.def.kind === 'boards') {
                const {board, draft} = entry;
                this._row({iconName: 'edit-symbolic', text: truncate(draft.title || _('Untitled draft'), 80),
                    detail: draft.status ?? _('No status'), onClick: board.url ? () => openUri(board.url) : null});
            } else {
                const pr = this.def.kind === 'prs';
                this._row({gicon: pr ? icons.prs : icons.issue, text: `${itemRef(entry)}  ${truncate(entry.title, 80)}`,
                    detail: pr && entry.reason === 'review' ? _('review') : '',
                    onClick: entry.url ? () => openUri(entry.url) : null});
            }
        }
        if (found.length > this._maxRows) {
            this._row({iconName: 'view-more-horizontal-symbolic',
                text: ngettext('%d more in the Source Glance window', '%d more in the Source Glance window',
                    found.length - this._maxRows).format(found.length - this._maxRows)});
        }
    }

    _renderBoards(state, icons) {
        const sources = state.sources.filter(src => src.platform === 'github' && src.updatedAt);
        if (sources.length === 0 || sources.every(src => src.boardsError)) {
            this._message(_('Can’t read your project boards.'));
            return;
        }
        if (sources.some(src => src.boards === null && !src.boardsError)) {
            this._message(_('Loading project boards…'));
            return;
        }
        const drafts = sources.flatMap(src => (src.boards ?? []).flatMap(board => board.drafts.map(draft => ({board, draft}))));
        if (drafts.length === 0) {
            this._message(_('No draft items on your project boards'));
            return;
        }
        for (const {board, draft} of drafts.slice(0, this._maxRows)) {
            this._row({
                gicon: isDoneStatus(draft.status) ? icons.issueClosed : null,
                iconName: isDoneStatus(draft.status) ? null : 'edit-symbolic',
                text: truncate(draft.title || _('Untitled draft'), 80),
                detail: draft.status ?? _('No status'),
                onClick: board.url ? () => openUri(board.url) : null,
            });
        }
    }
}

export class DesktopWidgets {
    /** `icons` are the extension's Gio.Icons; `getRepos()` returns the watched repositories. */
    constructor({settings, icons, getRepos}) {
        this._settings = settings;
        this._icons = icons;
        this._getRepos = getRepos;
        this._cards = new Map();
        this._state = null;
        this._restackedId = global.display.connect('restacked', () => this._restack());
        // A new screen size means a new card size too.
        this._workareasId = global.display.connect('workareas-changed', () => this._resizeAll());
        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (key === 'custom-widgets') {
                // Names, icons and filters may have changed: build those cards again.
                for (const [id, card] of this._cards) {
                    if (card.def) {
                        card.destroy();
                        this._cards.delete(id);
                    }
                }
                this._sync();
            } else if (key === 'widgets' || key === 'widgets-off-desktop' || key === 'widget-layout') {
                this._sync();
            } else if (key === 'widget-opacity' || key === 'widget-opacities') {
                this._applyOpacity();
            } else if (key === 'widget-size' || key === 'widget-sizes') {
                this._resizeAll();
            } else if (key === 'widget-positions' || key === 'widget-arrangement') {
                this._placeAll();
            }
        });
        this._sync();
    }

    destroy() {
        global.display.disconnect(this._restackedId);
        global.display.disconnect(this._workareasId);
        this._settings.disconnect(this._settingsId);
        for (const card of this._cards.values())
            card.destroy();
        this._cards.clear();
    }

    update(state) {
        this._state = state;
        for (const card of this._cards.values())
            card.render(state, this._icons, this._getRepos());
        this._placeAll();
    }

    /** Creates and removes cards to match the `widgets` settings, in the window's order. */
    _sync() {
        const custom = parseCustomWidgets(this._settings.get_strv('custom-widgets'));
        const shown = normalizeWidgets(this._settings.get_strv('widgets'), custom);
        const off = this._settings.get_strv('widgets-off-desktop');
        const wanted = widgetOrder(normalizeWidgetLayout(this._settings.get_value('widget-layout').deep_unpack(), shown))
            .filter(id => !off.includes(id));
        for (const [id, card] of this._cards) {
            if (!wanted.includes(id)) {
                card.destroy();
                this._cards.delete(id);
            }
        }
        const titles = {summary: _('Source Glance'), issues: _('Issues'), prs: _('Pull requests'), boards: _('Project Boards')};
        const icons = {summary: this._icons.app, issues: this._icons.issues, prs: this._icons.prs, boards: this._icons.boards};
        for (const id of wanted) {
            if (this._cards.has(id))
                continue;
            const def = custom.find(other => other.id === id) ?? null;
            const card = new Card({id, def, title: def?.name ?? titles[id], gicon: def ? this._icons[`widget-${def.icon}`] : icons[id],
                onDragEnd: c => this._savePosition(c)});
            global.window_group.add_child(card.actor);
            this._cards.set(id, card);
            card.setSize(this._size(id));
            if (this._state)
                card.render(this._state, this._icons, this._getRepos());
        }
        // Keep display order (Map insertion order) stable for default placement.
        this._cards = new Map(wanted.map(id => [id, this._cards.get(id)]));
        this._applyOpacity();
        this._placeAll();
        this._restack();
    }

    _applyOpacity() {
        const fallback = this._settings.get_int('widget-opacity');
        const own = this._settings.get_value('widget-opacities').deep_unpack();
        for (const card of this._cards.values())
            card.actor.opacity = Math.round(255 * (own[card.id] ?? fallback) / 100);
    }

    _savedPositions() {
        return this._settings.get_value('widget-positions').deep_unpack();
    }

    /** Card `id`'s size, or with no id the screen's medium size. */
    _size(id = null) {
        const monitor = Main.layoutManager.primaryMonitor;
        const size = widgetCardSize(monitor?.height ?? 1080, monitor?.width ?? 1920);
        if (!id)
            return size;
        return scaledCardSize(size, this._settings.get_value('widget-sizes').deep_unpack()[id] ??
            this._settings.get_string('widget-size'));
    }

    _resizeAll() {
        for (const card of this._cards.values()) {
            card.setSize(this._size(card.id));
            if (this._state)
                card.render(this._state, this._icons, this._getRepos());
        }
        this._placeAll();
    }

    /** Saved spots (kept on screen), or the chosen arrangement for cards never moved. */
    _placeAll() {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const saved = this._savedPositions();
        const unmoved = [...this._cards.values()].filter(card => !saved[card.id]);
        // Cells fit the largest card; smaller ones keep to the arrangement's edge.
        const sizes = unmoved.map(card => this._size(card.id));
        const defaults = defaultWidgetPositions(area, unmoved.length, this._settings.get_string('widget-arrangement'),
            largestCardSize(sizes, this._size()), sizes);
        for (const card of this._cards.values()) {
            const spot = saved[card.id]
                ? {x: saved[card.id][0], y: saved[card.id][1]}
                : defaults[unmoved.indexOf(card)];
            const {x, y} = clampWidgetPosition(spot, area, this._size(card.id));
            card.actor.set_position(x, y);
        }
    }

    _savePosition(card) {
        const positions = this._savedPositions();
        positions[card.id] = [Math.round(card.actor.x), Math.round(card.actor.y)];
        this._settings.set_value('widget-positions', new GLib.Variant('a{s(ii)}', positions));
    }

    /** Just above the desktop window if there is one, else right above the wallpaper. */
    _restack() {
        // Desktop Icons hides its windows from global.get_window_actors(), so look at the
        // window layer itself.
        const desktop = global.window_group.get_children()
            .find(actor => actor instanceof Meta.WindowActor && isDesktopWindow(actor.meta_window));
        let below = desktop ?? Main.layoutManager._backgroundGroup;
        for (const card of this._cards.values()) {
            if (below?.get_parent() === global.window_group) {
                global.window_group.set_child_above_sibling(card.actor, below);
                below = card.actor;
            } else {
                global.window_group.set_child_at_index(card.actor, 0);
            }
        }
    }
}
