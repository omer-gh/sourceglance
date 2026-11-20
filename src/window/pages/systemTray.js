// Glance → System Tray: how sourceglance looks in the top bar. Two tiles preview the layouts;
// click one to use it. On the previews, each list's button (a top-bar icon, or a tab in the
// menu) shows or hides that list. The Top bar switch, Group by and the refresh interval sit beside the heading.
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {TOOLBAR_LISTS, normalizeButtons} from '../../lib/model.js';

import {groupByControl} from './common.js';

const LAYOUTS = ['separate', 'tabs'];

function listInfo(id, icons) {
    return {
        issues: {title: _('Issues'), short: _('Issues'), gicon: icons.issue},
        prs: {title: _('Pull requests'), short: _('PRs'), gicon: icons.pr},
        boards: {title: _('Project Boards'), short: _('Boards'), gicon: icons.boards},
    }[id];
}

function placeholderLines(box, widths) {
    for (const width of widths) {
        box.append(new Gtk.Box({css_classes: ['sourceglance-tray-line'], width_request: width,
            halign: Gtk.Align.START}));
    }
}

/** `ctx` is {settings, icons, window}. Returns {suffix, widget}. */
export function buildSystemTraySection({settings, icons, window}) {
    // Beside the heading: minutes between checks.
    const suffix = new Gtk.Box({spacing: 12, valign: Gtk.Align.CENTER});
    // Top bar on or off: off takes down the top bar and desktop widgets until you switch it on again.
    const bar = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER, tooltip_text: _('Show Source Glance in the top bar')});
    bar.append(new Gtk.Label({label: _('Top bar'), css_classes: ['dim-label']}));
    const barSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
    barSwitch.update_property([Gtk.AccessibleProperty.LABEL], [_('Top bar')]);
    settings.bind('bar-enabled', barSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    bar.append(barSwitch);
    suffix.append(bar);
    suffix.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL, margin_top: 4, margin_bottom: 4}));
    suffix.append(groupByControl(settings));
    const refresh = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER, tooltip_text: _('Minutes between checks')});
    suffix.append(refresh);
    refresh.append(new Gtk.Image({icon_name: 'view-refresh-symbolic', css_classes: ['dim-label']}));
    const interval = new Gtk.SpinButton({adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1,
        page_increment: 10}), width_chars: 3, valign: Gtk.Align.CENTER});
    settings.bind('refresh-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
    refresh.append(interval);
    refresh.append(new Gtk.Label({label: _('min'), css_classes: ['dim-label']}));

    // The list buttons on both previews, by list id, kept in step with the setting.
    const toggles = new Map(TOOLBAR_LISTS.map(id => [id, []]));
    const shown = () => normalizeButtons(settings.get_strv('toolbar-buttons'));
    const trigger = (id, withLabel) => {
        const info = listInfo(id, icons);
        const content = new Gtk.Box({spacing: 4, halign: Gtk.Align.CENTER});
        content.append(new Gtk.Image({gicon: info.gicon}));
        if (withLabel)
            content.append(new Gtk.Label({label: info.short}));
        const badge = new Gtk.Image({halign: Gtk.Align.END, valign: Gtk.Align.START, pixel_size: 8,
            css_classes: ['sourceglance-tray-badge'], can_target: false});
        const overlay = new Gtk.Overlay({child: content});
        overlay.add_overlay(badge);
        const button = new Gtk.ToggleButton({child: overlay, css_classes: ['sourceglance-tray-trigger'],
            hexpand: withLabel});
        button.connect('toggled', () => {
            const others = shown().filter(other => other !== id);
            settings.set_strv('toolbar-buttons', normalizeButtons(button.active ? [...others, id] : others));
        });
        toggles.get(id).push({button, badge, title: info.title});
        return button;
    };
    const syncToggles = () => {
        const on = shown();
        for (const [id, list] of toggles) {
            for (const {button, badge, title} of list) {
                const active = on.includes(id);
                if (button.active !== active)
                    button.active = active;
                badge.icon_name = active ? 'object-select-symbolic' : 'list-add-symbolic';
                button.tooltip_text = (active ? _('%s is shown. Click to hide it.') : _('%s is hidden. Click to show it.'))
                    .format(title);
            }
        }
    };

    const tiles = new Gtk.Box({spacing: 12, homogeneous: true});
    let group = null;
    const radios = [];
    const tile = (layout, label) => {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8,
            css_classes: ['card', 'sourceglance-tray-tile']});
        const bar = new Gtk.Box({spacing: 6, css_classes: ['sourceglance-tray-bar']});
        bar.append(new Gtk.Box({hexpand: true}));
        bar.append(new Gtk.Image({gicon: icons.app, css_classes: ['sourceglance-tray-app'],
            tooltip_text: _('The Source Glance button is always shown')}));
        const menu = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, halign: Gtk.Align.END,
            width_request: 200, css_classes: ['sourceglance-tray-menu']});
        if (layout === 'separate') {
            for (const id of TOOLBAR_LISTS)
                bar.append(trigger(id, false));
        } else {
            const tabs = new Gtk.Box({spacing: 4});
            for (const id of TOOLBAR_LISTS)
                tabs.append(trigger(id, true));
            menu.append(tabs);
        }
        placeholderLines(menu, [130, 170, 100]);
        box.append(bar);
        box.append(menu);
        const radio = new Gtk.CheckButton({label, group, active: settings.get_string('layout') === layout});
        group ??= radio;
        radio.connect('toggled', () => {
            if (radio.active)
                settings.set_string('layout', layout);
        });
        radios.push([layout, radio, box]);
        box.append(radio);
        // A click anywhere else on the tile chooses it too.
        const click = new Gtk.GestureClick();
        click.connect('released', () => {
            radio.active = true;
        });
        box.add_controller(click);
        tiles.append(box);
    };
    tile('separate', _('Separate top-bar icons'));
    tile('tabs', _('Tabs in one menu'));
    const syncLayout = () => {
        const layout = LAYOUTS.includes(settings.get_string('layout')) ? settings.get_string('layout') : 'separate';
        for (const [id, radio, box] of radios) {
            if (id === layout && !radio.active)
                radio.active = true;
            if (id === layout)
                box.add_css_class('selected');
            else
                box.remove_css_class('selected');
        }
    };

    const ids = [
        settings.connect('changed::toolbar-buttons', syncToggles),
        settings.connect('changed::layout', syncLayout),
    ];
    window.connect('close-request', () => {
        ids.forEach(id => settings.disconnect(id));
        return false;
    });
    syncToggles();
    syncLayout();
    return {suffix, widget: tiles};
}
