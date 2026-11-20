// Glance → Widgets: the cards drawn in the window (widgetCanvas.js), which also show on the
// desktop unless a card says otherwise. Hidden cards, and a way to make your own, wait under
// Add widget. The gear under the cards (All widgets) holds what applies to every card: the
// desktop, opacity, where cards go on the desktop, and the background.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from '../i18n.js';

import {WIDGET_ARRANGEMENTS, WIDGET_IDS, wallpaperChoice} from '../../lib/model.js';
import {applyRecommendedWallpaper, backgroundSettings, currentWallpaper, recommendedWallpaperInstalled,
    restoreSavedWallpaper, savedWallpaper} from '../../lib/wallpaper.js';
import {openCustomWidgetDialog} from './customWidget.js';
import {WidgetCanvas, buildSizeChoice, loadPreview, widgetInfo} from './widgetCanvas.js';


/** Shows the wallpaper set now behind the cards, following changes and the dark style. */
function followWallpaper(window, picture) {
    const background = backgroundSettings();
    const style = Adw.StyleManager.get_default();
    const show = () => {
        const uri = background.get_string(style.dark ? 'picture-uri-dark' : 'picture-uri') ||
            background.get_string('picture-uri');
        if (uri)
            loadPreview(picture, uri);
        else
            picture.paintable = null;
    };
    const backgroundId = background.connect('changed', show);
    const darkId = style.connect('notify::dark', show);
    show();
    window.connect('close-request', () => {
        background.disconnect(backgroundId);
        style.disconnect(darkId);
        return false;
    });
}

/**
 * The recommended wallpaper, in All widgets: Apply (keeping yours) or Reset (putting yours
 * back). Reset is only offered until the wallpaper changes some other way.
 */
function buildWallpaperChoice({window, settings, toast}, popover) {
    const row = new Gtk.Box({spacing: 10, tooltip_text: _('From GNOME Backgrounds')});
    row.append(new Gtk.Image({icon_name: 'preferences-desktop-wallpaper-symbolic', valign: Gtk.Align.START}));
    const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true});
    text.append(new Gtk.Label({label: _('Adwaita wallpaper'), xalign: 0}));
    const status = new Gtk.Label({xalign: 0, wrap: true, max_width_chars: 26, css_classes: ['dim-label', 'caption']});
    text.append(status);
    row.append(text);
    const button = new Gtk.Button({valign: Gtk.Align.CENTER});
    row.append(button);

    const background = backgroundSettings();
    const update = () => {
        const choice = wallpaperChoice(currentWallpaper(background), savedWallpaper(settings));
        button.visible = choice !== 'in-use';
        if (choice === 'apply') {
            status.label = _('The cards are made to sit on it. Yours is kept to put back.');
            button.label = _('Apply');
            button.css_classes = ['suggested-action'];
        } else if (choice === 'reset') {
            status.label = _('Your wallpaper now. Reset puts your previous one back.');
            button.label = _('Reset');
            button.css_classes = [];
        } else {
            status.label = _('Already your wallpaper');
        }
    };
    button.connect('clicked', () => {
        popover.popdown();
        if (wallpaperChoice(currentWallpaper(background), savedWallpaper(settings)) === 'apply') {
            applyRecommendedWallpaper(background, settings);
            toast(_('Wallpaper set to Adwaita'));
        } else {
            restoreSavedWallpaper(background, settings);
            toast(_('Your wallpaper is back'));
        }
    });
    const backgroundId = background.connect('changed', update);
    const savedId = settings.connect('changed::saved-wallpaper', update);
    update();
    window.connect('close-request', () => {
        background.disconnect(backgroundId);
        settings.disconnect(savedId);
        return false;
    });
    return row;
}

// Each arrangement's preview: a small screen with cards where they'd go, as [x, y] on a
// 44 × 28 screen.
const ARRANGEMENT_PREVIEWS = {
    'top-right': [[30, 3], [37, 3], [30, 10], [37, 10]],
    'right': [[37, 3], [37, 10], [37, 17]],
    'top': [[11, 3], [18, 3], [25, 3], [32, 3]],
    'left': [[3, 3], [3, 10], [3, 17]],
    'bottom': [[11, 20], [18, 20], [25, 20], [32, 20]],
};

function arrangementPreview(arrangement) {
    const area = new Gtk.DrawingArea({content_width: 44, content_height: 28, halign: Gtk.Align.CENTER});
    area.set_draw_func((widget, cr, width, height) => {
        Gdk.cairo_set_source_rgba(cr, widget.get_color());
        cr.setLineWidth(1);
        cr.rectangle(0.5, 0.5, width - 1, height - 1);
        cr.stroke();
        for (const [x, y] of ARRANGEMENT_PREVIEWS[arrangement])
            cr.rectangle(x, y, 5, 4);
        cr.fill();
        cr.$dispose();
    });
    return area;
}

function sectionTitle(label) {
    return new Gtk.Label({label, xalign: 0, margin_top: 6, css_classes: ['dim-label', 'caption-heading']});
}

function controlRow(icon, label, control) {
    const row = new Gtk.Box({spacing: 10});
    row.append(icon);
    row.append(new Gtk.Label({label, xalign: 0, hexpand: !control.hexpand}));
    row.append(control);
    return row;
}

/**
 * All widgets, under the gear: every card on or off the desktop, one opacity and size for all, where
 * cards go on the desktop, Tidy up and Reset desktop positions, then the background.
 */
function buildAllWidgets(ctx, canvas) {
    const {window, settings, icons, toast} = ctx;
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 8, margin_bottom: 8,
        margin_start: 8, margin_end: 8, width_request: 300});
    const popover = new Gtk.Popover({child: box});
    canvas.gear.popover = popover;
    box.append(new Gtk.Label({label: _('All widgets'), xalign: 0, css_classes: ['heading']}));
    // Set while following the settings, so the controls don't write back what they just read.
    let syncing = false;

    box.append(sectionTitle(_('Desktop')));
    const desktop = new Gtk.Switch({valign: Gtk.Align.CENTER,
        tooltip_text: _('Show every widget on the desktop too, or keep them all in this window')});
    desktop.connect('notify::active', () => {
        if (!syncing)
            canvas.setAllOnDesktop(desktop.active);
    });
    box.append(controlRow(new Gtk.Image({gicon: icons.desktop}), _('On desktop'), desktop));

    const opacity = new Gtk.Adjustment({lower: 30, upper: 100, step_increment: 5, page_increment: 10});
    const scale = new Gtk.Box({spacing: 8, hexpand: true});
    scale.append(new Gtk.Scale({adjustment: opacity, draw_value: false, hexpand: true, valign: Gtk.Align.CENTER,
        css_classes: ['sourceglance-mini-scale'], tooltip_text: _('Sets every widget at once')}));
    const percent = new Gtk.Label({width_chars: 4, xalign: 1, css_classes: ['numeric', 'dim-label']});
    scale.append(percent);
    opacity.connect('value-changed', () => {
        percent.label = `${Math.round(opacity.value)}%`;
        if (!syncing)
            canvas.setAllOpacity(Math.round(opacity.value));
    });
    box.append(controlRow(new Gtk.Image({gicon: icons.opacity}), _('Opacity'), scale));

    // One size for every card; each card's size button sets its own.
    const sizes = buildSizeChoice(choice => {
        if (!syncing)
            canvas.setAllSizeChoice(choice);
    });
    sizes.widget.hexpand = true;
    box.append(controlRow(new Gtk.Image({gicon: icons.size}), _('Size'), sizes.widget));

    // Where cards go on the desktop.
    const arrangements = new Gtk.Box({spacing: 4, homogeneous: true, margin_top: 2});
    const names = {'top-right': _('Top right'), 'right': _('Right'), 'top': _('Top'), 'left': _('Left'),
        'bottom': _('Bottom')};
    let group = null;
    const choices = new Map();
    for (const arrangement of WIDGET_ARRANGEMENTS) {
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
        content.append(arrangementPreview(arrangement));
        content.append(new Gtk.Label({label: names[arrangement], css_classes: ['caption']}));
        const button = new Gtk.ToggleButton({child: content, group, css_classes: ['flat', 'sourceglance-arrangement'],
            tooltip_text: _('Where widgets you haven’t moved go on the desktop')});
        group ??= button;
        button.connect('toggled', () => {
            if (button.active && !syncing)
                settings.set_string('widget-arrangement', arrangement);
        });
        choices.set(arrangement, button);
        arrangements.append(button);
    }
    box.append(arrangements);

    const buttons = new Gtk.Box({spacing: 6, homogeneous: true, margin_top: 2});
    const tidy = new Gtk.Button({label: _('Tidy up'), tooltip_text: _('Put the widgets here back in order, top left first')});
    tidy.connect('clicked', () => canvas.tidy());
    buttons.append(tidy);
    const reset = new Gtk.Button({label: _('Reset desktop positions'),
        tooltip_text: _('Put every card dragged on the desktop back in the arrangement')});
    reset.connect('clicked', () => {
        popover.popdown();
        settings.reset('widget-positions');
        toast(_('Cards moved back'));
    });
    buttons.append(reset);
    box.append(buttons);

    box.append(new Gtk.Separator({margin_top: 6}));
    box.append(sectionTitle(_('Background')));
    const backdrop = new Gtk.Switch({valign: Gtk.Align.CENTER, tooltip_text: _('Show your wallpaper behind the widgets here')});
    settings.bind('widget-backdrop', backdrop, 'active', Gio.SettingsBindFlags.DEFAULT);
    box.append(controlRow(new Gtk.Image({icon_name: 'image-x-generic-symbolic'}), _('Wallpaper behind widgets'), backdrop));
    if (recommendedWallpaperInstalled())
        box.append(buildWallpaperChoice(ctx, popover));

    const sync = () => {
        syncing = true;
        desktop.active = canvas.allOnDesktop();
        opacity.value = settings.get_int('widget-opacity');
        sizes.set(settings.get_string('widget-size'));
        (choices.get(settings.get_string('widget-arrangement')) ?? choices.get('top-right')).active = true;
        syncing = false;
    };
    const ids = ['widgets', 'widgets-off-desktop', 'widget-opacity', 'widget-size', 'widget-arrangement']
        .map(key => settings.connect(`changed::${key}`, sync));
    window.connect('close-request', () => {
        ids.forEach(id => settings.disconnect(id));
        return false;
    });
    sync();
    percent.label = `${Math.round(opacity.value)}%`;
}

/**
 * Add widget: hidden cards as small cards with a + button, then Custom widget. Starts
 * collapsed, and collapses again once a card is added.
 */
function buildAddWidget(ctx, canvas, openCustom) {
    const {settings, icons} = ctx;
    const frame = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['card', 'sourceglance-add-widget'],
        margin_top: 12});
    // The chevron goes first.
    const chevron = new Gtk.Image({icon_name: 'pan-end-symbolic'});
    const count = new Gtk.Label({css_classes: ['dim-label', 'caption'], hexpand: true, xalign: 1});
    const headerBox = new Gtk.Box({spacing: 10});
    headerBox.append(chevron);
    headerBox.append(new Gtk.Image({gicon: icons.widgetCustom}));
    headerBox.append(new Gtk.Label({label: _('Add widget'), xalign: 0}));
    headerBox.append(count);
    const header = new Gtk.Button({child: headerBox, css_classes: ['flat', 'sourceglance-add-widget-header']});
    frame.append(header);

    const tiles = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 10, row_spacing: 10,
        min_children_per_line: 2, max_children_per_line: 4, homogeneous: true, margin_start: 12, margin_end: 12,
        margin_bottom: 12});
    const revealer = new Gtk.Revealer({child: tiles, reveal_child: false, transition_duration: 200,
        transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
    frame.append(revealer);
    const expand = open => {
        revealer.reveal_child = open;
        chevron.icon_name = open ? 'pan-down-symbolic' : 'pan-end-symbolic';
    };
    header.connect('clicked', () => expand(!revealer.reveal_child));

    const miniCard = (id, def) => {
        const info = widgetInfo(id, icons, def);
        const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['sourceglance-card', 'sourceglance-mini-card'],
            tooltip_text: info.subtitle});
        const top = new Gtk.Box({spacing: 6, css_classes: ['sourceglance-card-header']});
        top.append(new Gtk.Image({gicon: info.gicon}));
        top.append(new Gtk.Label({label: info.title, xalign: 0, hexpand: true, ellipsize: 3}));
        const add = new Gtk.Button({icon_name: 'list-add-symbolic', css_classes: ['circular', 'suggested-action', 'sourceglance-card-button'],
            tooltip_text: _('Add to the widget area')});
        add.connect('clicked', () => {
            canvas.show(id);
            expand(false);
        });
        top.append(add);
        card.append(top);
        for (const width of [0.7, 1, 0.5]) {
            card.append(new Gtk.Box({css_classes: ['sourceglance-mini-line'], width_request: Math.round(110 * width),
                halign: Gtk.Align.START}));
        }
        return card;
    };
    const customTile = () => {
        const custom = new Gtk.Button({css_classes: ['sourceglance-custom-tile'],
            tooltip_text: _('Make your own widget from filters')});
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, valign: Gtk.Align.CENTER});
        box.append(new Gtk.Image({gicon: icons.widgetCustom, pixel_size: 24}));
        box.append(new Gtk.Label({label: _('Custom widget…')}));
        custom.child = box;
        custom.connect('clicked', () => openCustom(null));
        return custom;
    };

    const update = () => {
        tiles.remove_all();
        const shown = canvas.shown();
        const defs = canvas.customWidgets();
        const hidden = [...WIDGET_IDS.map(id => [id, null]), ...defs.map(def => [def.id, def])]
            .filter(([id]) => !shown.includes(id));
        for (const [id, def] of hidden)
            tiles.append(miniCard(id, def));
        tiles.append(customTile());
        count.label = hidden.length ? ngettext('%d hidden', '%d hidden', hidden.length).format(hidden.length) : '';
    };
    const ids = ['widgets', 'custom-widgets'].map(key => settings.connect(`changed::${key}`, update));
    ctx.window.connect('close-request', () => {
        ids.forEach(id => settings.disconnect(id));
        return false;
    });
    update();
    return frame;
}

/** `ctx` is {window, settings, icons, toast}. Returns {suffix (none), widget, update(state)}. */
export function buildWidgetsSection(ctx) {
    let canvas = null;
    const openCustom = def => openCustomWidgetDialog(ctx, def, id => canvas.show(id));
    canvas = new WidgetCanvas({...ctx, onEdit: openCustom});
    followWallpaper(ctx.window, canvas.backdrop);

    const widget = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    widget.append(canvas.widget);
    widget.append(buildAddWidget(ctx, canvas, openCustom));
    buildAllWidgets(ctx, canvas);
    return {suffix: null, widget, update: state => canvas.update(state)};
}
