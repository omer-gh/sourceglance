// Glance → Widgets' widget area: the cards drawn in the window, on your wallpaper, the size they
// are on the desktop (widgetCardSize() in model.js). It fills the page's width, as many cards
// across as fit, and two rows down (more when the cards need them); drag a card by its header
// to another slot. Empty slots show as dashed outlines.
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from '../i18n.js';

import {GITHUB_COM} from '../../lib/accounts.js';
import {WIDGET_GAP, WIDGET_SIZES, customWidgetItems, isDoneStatus, itemRef, largestCardSize, listBadge, moveWidget,
    normalizeWidgetLayout, normalizeWidgets, parseCustomWidgets, relativeTime, scaledCardSize, searchPageUrl, truncate,
    widgetCardSize, widgetGridRows} from '../../lib/model.js';

// Rows of slots in the area, at least; more when there are more cards than fit in them.
const GRID_ROWS = 2;
// Below the cards: room for the All widgets button.
const STRIP_HEIGHT = 56;
// A list row's height and the rest of a card (header, footer, the On desktop row), to work
// out how many rows fit.
const ROW_HEIGHT = 26;
const CARD_CHROME = 92;
// Wallpapers are loaded this wide.
const PREVIEW_WIDTH = 1600;

/** The screen the window is on, else the first one: {width, height}. */
function screenSize(widget) {
    const display = Gdk.Display.get_default();
    const surface = widget.get_native()?.get_surface();
    const monitor = (surface && display.get_monitor_at_surface(surface)) ?? display.get_monitors().get_item(0);
    const geometry = monitor?.get_geometry();
    return geometry ? {width: geometry.width, height: geometry.height} : {width: 1920, height: 1080};
}

/** Shows the picture at `uri` scaled down, loaded off the main thread (wallpapers are several MB). */
export function loadPreview(picture, uri, width = PREVIEW_WIDTH) {
    const file = Gio.File.new_for_uri(uri);
    file.read_async(GLib.PRIORITY_DEFAULT, null, (_file, readResult) => {
        try {
            const stream = file.read_finish(readResult);
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, width, -1, true, null, (_stream, result) => {
                try {
                    picture.paintable = Gdk.Texture.new_for_pixbuf(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                } catch (e) {
                    console.debug(`sourceglance: no wallpaper preview: ${e.message}`);
                }
            });
        } catch (e) {
            console.debug(`sourceglance: no wallpaper preview: ${e.message}`);
        }
    });
}

/**
 * A card's title, Gio.Icon (from `icons`) and what it holds. `def` is the custom widget with
 * this id, if it is one.
 */
export function widgetInfo(id, icons, def = null) {
    if (def) {
        const kind = {issues: _('Issues'), prs: _('Pull requests'), boards: _('Project drafts')}[def.kind];
        return {title: def.name, gicon: icons[`widget-${def.icon}`], subtitle: kind};
    }
    return {
        summary: {title: _('Summary'), gicon: icons.app,
            subtitle: _('All counts, including closed and merged items still assigned to you')},
        issues: {title: _('Issues'), gicon: icons.issue, subtitle: _('Open issues assigned to you')},
        prs: {title: _('Pull requests'), gicon: icons.pr, subtitle: _('Assigned to you or awaiting your review')},
        boards: {title: _('Project Boards'), gicon: icons.boards, subtitle: _('Draft items on your project boards')},
    }[id];
}

function updatedText(state) {
    if (state?.status === 'signed-out')
        return _('Not signed in');
    if (!state?.updatedAt)
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

// Each size's preview: a card this many pixels wide and tall, at the bottom left of a 22 × 16 box.
const SIZE_PREVIEWS = {small: [11, 7], medium: [15, 11], large: [21, 15]};

function sizePreview(choice) {
    const area = new Gtk.DrawingArea({content_width: 22, content_height: 16, halign: Gtk.Align.CENTER});
    area.set_draw_func((widget, cr, _width, height) => {
        const [w, h] = SIZE_PREVIEWS[choice];
        Gdk.cairo_set_source_rgba(cr, widget.get_color());
        cr.rectangle(0.5, height - h + 0.5, w - 1, h - 1);
        cr.setLineWidth(1);
        cr.stroke();
        cr.rectangle(2, height - h + 2, w - 4, 2);
        cr.fill();
        cr.$dispose();
    });
    return area;
}

/**
 * Small, Medium and Large side by side, each with its preview; `onPick(choice)` when one is
 * chosen. Returns {widget, set(choice)}.
 */
export function buildSizeChoice(onPick) {
    const widget = new Gtk.Box({spacing: 4, homogeneous: true});
    const names = {small: _('Small'), medium: _('Medium'), large: _('Large')};
    const buttons = new Map();
    let group = null;
    // Set while showing a setting, so it isn't written back.
    let syncing = false;
    for (const choice of WIDGET_SIZES) {
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
        content.append(sizePreview(choice));
        content.append(new Gtk.Label({label: names[choice], css_classes: ['caption']}));
        const button = new Gtk.ToggleButton({child: content, group, css_classes: ['flat', 'sourceglance-arrangement']});
        group ??= button;
        button.connect('toggled', () => {
            if (button.active && !syncing)
                onPick(choice);
        });
        buttons.set(choice, button);
        widget.append(button);
    }
    return {
        widget,
        set(choice) {
            syncing = true;
            (buttons.get(choice) ?? buttons.get('medium')).active = true;
            syncing = false;
        },
    };
}

function headerButton(params) {
    return new Gtk.Button({css_classes: ['flat', 'sourceglance-card-button'], valign: Gtk.Align.CENTER, ...params});
}

/**
 * One card, as on the desktop (lib/widgets.js). Its header has Size, Remove (trash: it waits
 * under Add widget) and, on custom widgets, Settings (gear). Under its list, a row holds On desktop
 * and its opacity slider.
 */
class Card {
    /**
     * `canvas` gives the buttons their settings: isOnDesktop(id), setOnDesktop(id, on),
     * opacity(id), setOpacity(id, percent), sizeChoice(id), setSizeChoice(id, choice), hide(id)
     * and edit(def). `size` is this card's own {width, height}.
     */
    constructor({id, def, icons, window, canvas, size}) {
        this.id = id;
        this.def = def;
        this._icons = icons;
        this._window = window;
        // What fits, keeping a row for "N more".
        this._maxRows = Math.max(1, Math.floor((size.height - CARD_CHROME) / ROW_HEIGHT) - 1);
        const info = widgetInfo(id, icons, def);
        this.widget = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['sourceglance-card'],
            width_request: size.width, height_request: size.height, overflow: Gtk.Overflow.HIDDEN});

        this.header = new Gtk.Box({spacing: 4, css_classes: ['sourceglance-card-header'], tooltip_text: _('Drag to move')});
        this.header.set_cursor_from_name('grab');
        this.header.append(new Gtk.Image({gicon: info.gicon, pixel_size: 18, margin_end: 4}));
        const title = id === 'summary' ? 'Source Glance' : info.title;
        this.header.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3,
            css_classes: ['sourceglance-card-title']}));
        const sizes = buildSizeChoice(choice => {
            sizeButton.popover.popdown();
            canvas.setSizeChoice(id, choice);
        });
        sizes.set(canvas.sizeChoice(id));
        const sizeBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 6,
            margin_bottom: 6, margin_start: 6, margin_end: 6, width_request: 220});
        sizeBox.append(new Gtk.Label({label: _('Size'), xalign: 0, css_classes: ['heading']}));
        sizeBox.append(sizes.widget);
        const sizeButton = new Gtk.MenuButton({child: new Gtk.Image({gicon: icons.size}), valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'sourceglance-card-button'], tooltip_text: _('Size'),
            popover: new Gtk.Popover({child: sizeBox})});
        this.header.append(sizeButton);
        const remove = headerButton({icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove from this area. It waits under Add widget.')});
        remove.connect('clicked', () => canvas.hide(id));
        this.header.append(remove);
        if (def) {
            const settings = headerButton({icon_name: 'emblem-system-symbolic',
                tooltip_text: _('Widget settings: name, icon and filters')});
            settings.connect('clicked', () => canvas.edit(def));
            this.header.append(settings);
        }
        this._count = new Gtk.Label({css_classes: ['sourceglance-card-count', 'sourceglance-card-title'], margin_start: 4});
        this.header.append(this._count);
        this.widget.append(this.header);

        this._body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, vexpand: true,
            css_classes: ['sourceglance-card-body']});
        this.widget.append(this._body);
        this._footer = new Gtk.Label({xalign: 0, css_classes: ['sourceglance-card-footer']});
        this.widget.append(this._footer);

        // On desktop, then the opacity slider.
        const bar = new Gtk.Box({spacing: 16, css_classes: ['sourceglance-card-bar']});
        this._desktopIcon = new Gtk.Image();
        const desktopBox = new Gtk.Box({spacing: 6});
        desktopBox.append(this._desktopIcon);
        desktopBox.append(new Gtk.Label({label: _('On desktop')}));
        this._desktop = new Gtk.ToggleButton({child: desktopBox, css_classes: ['flat', 'sourceglance-card-toggle'],
            active: canvas.isOnDesktop(id)});
        this._showDesktop();
        this._desktop.connect('toggled', () => {
            this._showDesktop();
            canvas.setOnDesktop(id, this._desktop.active);
        });
        bar.append(this._desktop);

        this._opacity = new Gtk.Adjustment({lower: 30, upper: 100, step_increment: 5, page_increment: 10,
            value: canvas.opacity(id)});
        const slider = new Gtk.Box({spacing: 8, hexpand: true, tooltip_text: _('Opacity')});
        slider.append(new Gtk.Image({gicon: icons.opacity, css_classes: ['dim-label']}));
        slider.append(new Gtk.Scale({adjustment: this._opacity, draw_value: false, hexpand: true,
            valign: Gtk.Align.CENTER, css_classes: ['sourceglance-mini-scale']}));
        const percent = new Gtk.Label({width_chars: 4, xalign: 1, css_classes: ['numeric', 'sourceglance-card-percent']});
        slider.append(percent);
        const showPercent = () => {
            percent.label = `${Math.round(this._opacity.value)}%`;
        };
        showPercent();
        this._opacity.connect('value-changed', () => {
            showPercent();
            this.widget.opacity = this._opacity.value / 100;
            canvas.setOpacity(id, Math.round(this._opacity.value));
        });
        bar.append(slider);
        this.widget.append(bar);
    }

    // The monitor, struck through when the card stays in the window only.
    _showDesktop() {
        const on = this._desktop.active;
        this._desktopIcon.gicon = on ? this._icons.desktop : this._icons.desktopOff;
        this._desktop.tooltip_text = on
            ? _('On the desktop too. Click to keep it in this window only.')
            : _('Only in this window. Click to show it on the desktop too.');
    }

    /** Follows the settings when they change some other way. */
    syncSettings(canvas) {
        if (this._desktop.active !== canvas.isOnDesktop(this.id))
            this._desktop.active = canvas.isOnDesktop(this.id);
        if (Math.round(this._opacity.value) !== canvas.opacity(this.id))
            this._opacity.value = canvas.opacity(this.id);
        this.widget.opacity = canvas.opacity(this.id) / 100;
    }

    _clear() {
        for (let child = this._body.get_first_child(); child;) {
            const next = child.get_next_sibling();
            this._body.remove(child);
            child = next;
        }
    }

    _row({gicon = null, iconName = null, text, detail = '', url = null}) {
        const box = new Gtk.Box({spacing: 8});
        box.append(gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName}));
        box.append(new Gtk.Label({label: text, xalign: 0, hexpand: true, ellipsize: 3}));
        if (detail)
            box.append(new Gtk.Label({label: detail, css_classes: ['sourceglance-card-count']}));
        const row = new Gtk.Button({child: box, css_classes: ['flat', 'sourceglance-card-row'], can_target: Boolean(url)});
        if (url)
            row.connect('clicked', () => new Gtk.UriLauncher({uri: url}).launch(this._window, null, null));
        this._body.append(row);
    }

    _message(text) {
        this._body.append(new Gtk.Label({label: text, xalign: 0, wrap: true,
            css_classes: ['sourceglance-card-message']}));
    }

    render(state, repos) {
        this._clear();
        this._footer.label = updatedText(state);
        this._count.label = this.id === 'summary' || this.def || !state ? '' : listBadge(this.id, state);
        if (state?.status !== 'ready' && state?.status !== 'error') {
            this._message(state?.status === 'signed-out'
                ? _('Sign in from Accounts, in the title bar.')
                : _('Loading…'));
            return;
        }
        if (this.def)
            this._renderCustom(state);
        else if (this.id === 'summary')
            this._renderSummary(state, repos);
        else if (this.id === 'boards')
            this._renderBoards(state);
        else
            this._renderItems(state);
    }

    _renderSummary(state, repos) {
        const icons = this._icons;
        // The rows link to github.com's search pages when a github.com account is signed in.
        const dotCom = state.sources.some(src => src.account.base === GITHUB_COM && src.updatedAt);
        const github = page => (dotCom ? page : null);
        const sum = key => {
            const known = state.sources.map(src => src.closedCounts?.[key]).filter(n => Number.isInteger(n));
            return known.length ? String(known.reduce((a, b) => a + b, 0)) : '–';
        };
        this._row({gicon: icons.issue, text: _('Issues'), detail: listBadge('issues', state),
            url: github(searchPageUrl('issue', repos))});
        this._row({gicon: icons.pr, text: _('Pull requests'), detail: listBadge('prs', state),
            url: github('https://github.com/pulls')});
        this._row({gicon: icons.boards, text: _('Project drafts'), detail: listBadge('boards', state) || '–'});
        this._row({gicon: icons.issueClosed, text: _('Closed issues still assigned'), detail: sum('issues'),
            url: github(searchPageUrl('issue-closed', repos))});
        this._row({gicon: icons.prMerged, text: _('Merged or closed PRs still assigned'), detail: sum('prs'),
            url: github(searchPageUrl('pr-closed', repos))});
    }

    _renderList(items, row, empty) {
        if (items.length === 0) {
            this._message(empty);
            return;
        }
        for (const item of items.slice(0, this._maxRows))
            this._row(row(item));
        if (items.length > this._maxRows) {
            this._row({iconName: 'view-more-horizontal-symbolic',
                text: ngettext('%d more', '%d more', items.length - this._maxRows).format(items.length - this._maxRows)});
        }
    }

    _itemRow(item) {
        const pr = item.kind === 'pr';
        return {gicon: pr ? this._icons.pr : this._icons.issue, text: `${itemRef(item)}  ${item.title}`,
            detail: pr && item.reason === 'review' ? _('review') : '', url: item.url};
    }

    _draftRow({board, draft}) {
        return {
            gicon: isDoneStatus(draft.status) ? this._icons.issueClosed : null,
            iconName: isDoneStatus(draft.status) ? null : 'edit-symbolic',
            text: truncate(draft.title || _('Untitled draft'), 80),
            detail: draft.status ?? _('No status'),
            url: board.url,
        };
    }

    _renderItems(state) {
        const pr = this.id === 'prs';
        const items = state.sources.flatMap(src => (pr ? src.prGroups : src.groups).flatMap(group => group.issues));
        this._renderList(items, item => this._itemRow(item),
            pr ? _('No open pull requests for you') : _('No open issues assigned to you'));
    }

    _renderBoards(state) {
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
        this._renderList(drafts, entry => this._draftRow(entry), _('No draft items on your project boards'));
    }

    _renderCustom(state) {
        const found = customWidgetItems(this.def, state);
        this._count.label = String(found.length);
        this._renderList(found, entry => (this.def.kind === 'boards' ? this._draftRow(entry) : this._itemRow(entry)),
            _('Nothing matches this widget’s filters'));
    }
}

/**
 * The widget area. `ctx` is {window, settings, icons}; `onEdit(def)` opens a custom widget's
 * settings. `backdrop` is the wallpaper picture behind it and `gear` the All widgets button
 * under the cards (widgets.js fills both). Call update(state) with the window's lists.
 */
export class WidgetCanvas {
    constructor({window, settings, icons, onEdit}) {
        this._window = window;
        this._settings = settings;
        this._icons = icons;
        this._onEdit = onEdit;
        this._cards = new Map();
        // Where each card is in the area: Gtk.Fixed.get_child_position() always gives 0, 0 in GJS.
        this._positions = new Map();
        this._state = null;
        // Medium cards' size, from the screen, and a slot's: room for the largest card shown.
        this._size = widgetCardSize(1080, 1920);
        this._cell = this._size;
        this._width = 0;
        this._columns = 1;

        this.backdrop = new Gtk.Picture({content_fit: Gtk.ContentFit.COVER, can_shrink: true,
            alternative_text: _('Your wallpaper')});
        // The empty slots' outlines; its size tells the area how wide it is.
        this._slots = new Gtk.DrawingArea({can_target: false});
        this._slots.set_draw_func((_area, cr) => this._drawSlots(cr));
        this._slots.connect('resize', (_area, width) => {
            if (width === this._width)
                return;
            this._width = width;
            // Not while GTK is laying out: placing cards asks for another layout.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._relayout();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._fixed = new Gtk.Fixed();
        // Where a dragged card will land.
        this._slot = new Gtk.Box({css_classes: ['sourceglance-canvas-slot'], visible: false, can_target: false});
        this._fixed.put(this._slot, 0, 0);
        this._empty = new Gtk.Label({label: _('Every widget is hidden. Add one from Add widget, below.'),
            wrap: true, justify: Gtk.Justification.CENTER, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER,
            css_classes: ['sourceglance-canvas-empty']});

        this.widget = new Gtk.Overlay({child: this.backdrop, overflow: Gtk.Overflow.HIDDEN, hexpand: true,
            css_classes: ['sourceglance-canvas']});
        this.widget.add_overlay(this._slots);
        this.widget.add_overlay(this._empty);
        this.widget.add_overlay(this._fixed);
        // All widgets: widgets.js gives it its popover. Faint until pointed at.
        this.gear = new Gtk.MenuButton({icon_name: 'emblem-system-symbolic', halign: Gtk.Align.END, valign: Gtk.Align.END,
            margin_end: 12, margin_bottom: 12, css_classes: ['sourceglance-canvas-gear'], tooltip_text: _('All widgets')});
        this.widget.add_overlay(this.gear);
        // Cards are sized for the screen the window is on.
        this.widget.connect('realize', () => this._resize());

        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (key === 'custom-widgets') {
                // Names, icons and filters may have changed: build those cards again.
                for (const [id, card] of this._cards) {
                    if (card.def)
                        this._removeCard(id, card);
                }
                this._sync();
            } else if (key === 'widgets' || key === 'widget-layout') {
                this._sync();
            } else if (key === 'widget-opacity' || key === 'widget-opacities' || key === 'widgets-off-desktop') {
                for (const card of this._cards.values())
                    card.syncSettings(this);
            } else if (key === 'widget-size' || key === 'widget-sizes') {
                this._rebuild();
            } else if (key === 'widget-backdrop') {
                this._applyBackdrop();
            }
        });
        window.connect('close-request', () => {
            settings.disconnect(this._settingsId);
            return false;
        });
        this._applyBackdrop();
        this._sync();
    }

    update(state) {
        this._state = state;
        for (const card of this._cards.values())
            card.render(state, this._settings.get_strv('repositories'));
    }

    customWidgets() {
        return parseCustomWidgets(this._settings.get_strv('custom-widgets'));
    }

    /** The cards in the area, in display order. */
    shown() {
        return normalizeWidgets(this._settings.get_strv('widgets'), this.customWidgets());
    }

    _grid() {
        return {columns: this._columns, rows: GRID_ROWS};
    }

    _layout(ids = this.shown()) {
        return normalizeWidgetLayout(this._settings.get_value('widget-layout').deep_unpack(), ids, this._grid());
    }

    _saveLayout(layout) {
        this._settings.set_value('widget-layout', new GLib.Variant('a{s(ii)}', layout));
    }

    isOnDesktop(id) {
        return !this._settings.get_strv('widgets-off-desktop').includes(id);
    }

    setOnDesktop(id, on) {
        const off = this._settings.get_strv('widgets-off-desktop').filter(other => other !== id);
        this._settings.set_strv('widgets-off-desktop', on ? off : [...off, id]);
    }

    opacity(id) {
        return this._settings.get_value('widget-opacities').deep_unpack()[id] ?? this._settings.get_int('widget-opacity');
    }

    setOpacity(id, percent) {
        if (percent === this.opacity(id))
            return;
        const own = this._settings.get_value('widget-opacities').deep_unpack();
        own[id] = percent;
        this._settings.set_value('widget-opacities', new GLib.Variant('a{si}', own));
    }

    sizeChoice(id) {
        return this._settings.get_value('widget-sizes').deep_unpack()[id] ?? this._settings.get_string('widget-size');
    }

    setSizeChoice(id, choice) {
        if (choice === this.sizeChoice(id))
            return;
        const own = this._settings.get_value('widget-sizes').deep_unpack();
        own[id] = choice;
        this._settings.set_value('widget-sizes', new GLib.Variant('a{ss}', own));
    }

    /** One size for every card: the default, with each card's own size dropped. */
    setAllSizeChoice(choice) {
        this._settings.set_string('widget-size', choice);
        this._settings.reset('widget-sizes');
    }

    _cardSize(id) {
        return scaledCardSize(this._size, this.sizeChoice(id));
    }

    edit(def) {
        this._onEdit(def);
    }

    hide(id) {
        // Keep the others where they are, so hiding one doesn't shuffle the rest.
        const layout = this._layout();
        delete layout[id];
        this._saveLayout(layout);
        this._settings.set_strv('widgets', this.shown().filter(other => other !== id));
    }

    /** Shows `id` again (or for the first time), in the first free slot. */
    show(id) {
        const shown = normalizeWidgets([...this.shown(), id], this.customWidgets());
        this._saveLayout(this._layout(shown));
        this._settings.set_strv('widgets', shown);
    }

    /** Puts every card shown here on the desktop, or keeps them all in the window. */
    setAllOnDesktop(on) {
        const shown = this.shown();
        const others = this._settings.get_strv('widgets-off-desktop').filter(id => !shown.includes(id));
        this._settings.set_strv('widgets-off-desktop', on ? others : [...others, ...shown]);
    }

    allOnDesktop() {
        return this.shown().every(id => this.isOnDesktop(id));
    }

    /** One opacity for every card: the default, with each card's own setting dropped. */
    setAllOpacity(percent) {
        this._settings.set_int('widget-opacity', percent);
        this._settings.reset('widget-opacities');
    }

    /** Back to the first free slots, in the usual order. */
    tidy() {
        this._saveLayout(normalizeWidgetLayout({}, this.shown(), this._grid()));
        this._relayout();
    }

    _removeCard(id, card) {
        this._fixed.remove(card.widget);
        this._positions.delete(card.widget);
        this._cards.delete(id);
    }

    // A new screen: new card sizes, so the cards are built again.
    _resize() {
        const screen = screenSize(this.widget);
        const size = widgetCardSize(screen.height, screen.width);
        if (size.width === this._size.width && size.height === this._size.height && size.rows === this._size.rows)
            return;
        this._size = size;
        this._rebuild();
    }

    // New card sizes: the cards are built again.
    _rebuild() {
        for (const [id, card] of this._cards)
            this._removeCard(id, card);
        this._sync();
    }

    _sync() {
        const custom = this.customWidgets();
        const shown = this.shown();
        for (const [id, card] of this._cards) {
            if (!shown.includes(id))
                this._removeCard(id, card);
        }
        for (const id of shown) {
            if (this._cards.has(id))
                continue;
            const card = new Card({id, def: custom.find(other => other.id === id) ?? null, icons: this._icons,
                window: this._window, canvas: this, size: this._cardSize(id)});
            this._fixed.put(card.widget, 0, 0);
            this._drag(card);
            this._cards.set(id, card);
            card.syncSettings(this);
            card.render(this._state, this._settings.get_strv('repositories'));
        }
        this._empty.visible = shown.length === 0;
        this._cell = largestCardSize(shown.map(id => this._cardSize(id)), this._size);
        this._slot.width_request = this._cell.width;
        this._slot.height_request = this._cell.height;
        this.widget.width_request = this._cell.width + 2 * WIDGET_GAP;
        this._relayout();
    }

    /** As many columns as the area's width fits; the height follows the rows. */
    _relayout() {
        const {width, height} = this._cell;
        this._columns = Math.max(1, Math.floor((this._width - WIDGET_GAP) / (width + WIDGET_GAP)));
        const rows = widgetGridRows(this._cards.size, this._grid());
        this.widget.height_request = WIDGET_GAP + rows * (height + WIDGET_GAP) + STRIP_HEIGHT;
        this._place();
        this._slots.queue_draw();
    }

    _place() {
        for (const [id, [column, row]] of Object.entries(this._layout()))
            this._move(this._cards.get(id).widget, ...this._spotPosition(column, row));
    }

    _move(widget, x, y) {
        this._fixed.move(widget, x, y);
        this._positions.set(widget, [x, y]);
    }

    // The cards are centred across the area.
    _left() {
        const {width} = this._cell;
        return Math.max(WIDGET_GAP, Math.round((this._width - this._columns * width - (this._columns - 1) * WIDGET_GAP) / 2));
    }

    _spotPosition(column, row) {
        return [this._left() + column * (this._cell.width + WIDGET_GAP), WIDGET_GAP + row * (this._cell.height + WIDGET_GAP)];
    }

    _drawSlots(cr) {
        const taken = Object.values(this._layout());
        const rows = widgetGridRows(this._cards.size, this._grid());
        cr.setSourceRGBA(1, 1, 1, 0.22);
        cr.setLineWidth(1);
        cr.setDash([6, 4], 0);
        const radius = 14;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < this._columns; column++) {
                if (taken.some(([c, r]) => c === column && r === row))
                    continue;
                const [x, y] = this._spotPosition(column, row);
                const w = this._cell.width - 1;
                const h = this._cell.height - 1;
                cr.newSubPath();
                cr.arc(x + 0.5 + w - radius, y + 0.5 + radius, radius, -Math.PI / 2, 0);
                cr.arc(x + 0.5 + w - radius, y + 0.5 + h - radius, radius, 0, Math.PI / 2);
                cr.arc(x + 0.5 + radius, y + 0.5 + h - radius, radius, Math.PI / 2, Math.PI);
                cr.arc(x + 0.5 + radius, y + 0.5 + radius, radius, Math.PI, 3 * Math.PI / 2);
                cr.closePath();
                cr.stroke();
            }
        }
        cr.$dispose();
    }

    _applyBackdrop() {
        const on = this._settings.get_boolean('widget-backdrop');
        this.backdrop.visible = on;
        if (on)
            this.widget.remove_css_class('sourceglance-canvas-plain');
        else
            this.widget.add_css_class('sourceglance-canvas-plain');
    }

    // Dragging by the header: the card follows the pointer, the slot it will land in shows
    // under it, and on release it snaps there (swapping with a card already there).
    _drag(card) {
        const gesture = new Gtk.GestureDrag();
        let start = null;
        const step = () => [this._cell.width + WIDGET_GAP, this._cell.height + WIDGET_GAP];
        const rows = () => widgetGridRows(this._cards.size, this._grid());
        const spotUnder = (x, y) => [(x - this._left()) / step()[0], (y - WIDGET_GAP) / step()[1]];
        const clampedSpot = ([column, row]) => [
            Math.min(Math.max(Math.round(column), 0), this._columns - 1),
            Math.min(Math.max(Math.round(row), 0), rows() - 1),
        ];
        gesture.connect('drag-begin', () => {
            start = this._positions.get(card.widget) ?? [0, 0];
            // Last child draws on top.
            card.widget.insert_before(this._fixed, null);
            card.header.set_cursor_from_name('grabbing');
        });
        gesture.connect('drag-update', (_gesture, dx, dy) => {
            if (!start)
                return;
            const x = Math.min(Math.max(start[0] + dx, 0), Math.max(0, this._width - this._cell.width));
            const y = Math.min(Math.max(start[1] + dy, 0), WIDGET_GAP + rows() * step()[1] - this._cell.height);
            this._move(card.widget, x, y);
            this._fixed.move(this._slot, ...this._spotPosition(...clampedSpot(spotUnder(x, y))));
            this._slot.visible = true;
        });
        gesture.connect('drag-end', () => {
            if (!start)
                return;
            const [x, y] = this._positions.get(card.widget);
            start = null;
            this._slot.visible = false;
            card.header.set_cursor_from_name('grab');
            this._saveLayout(moveWidget(this._layout(), card.id, spotUnder(x, y), this._grid()));
            // Also when nothing changed, so the card snaps back.
            this._relayout();
        });
        card.header.add_controller(gesture);
    }
}
