// The filter bar above a list: a button per kind of filter (Kind, Accounts, Labels,
// Assignee), each a check list with counts, then what's checked as chips on a row of their
// own, each with × to remove it, and Clear filters. All Tasks shows all four; the lists by
// kind show Labels and Assignee (their accounts and kinds are already sections and pages).
// Assignee starts as your accounts (defaultTaskFilters()); it also offers Unassigned and the
// rest of the team, and Clear filters shows everyone's.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {UNASSIGNED, defaultTaskFilters, taskFilterGroups, toggleTaskFilter} from '../../lib/model.js';

function kindTitle(kind) {
    return {issue: _('Issues'), pr: _('Pull requests'), draft: _('Project Boards')}[kind];
}

function typeTitle(type) {
    return {kind: _('Kind'), account: _('Accounts'), label: _('Labels'), assignee: _('Assignee')}[type];
}

function typeTooltip(type) {
    return {
        kind: _('Show issues, pull requests or project drafts'),
        account: _('Show what one of your accounts has'),
        label: _('Show items with a label'),
        assignee: _('Show items assigned to you, someone else, or no one'),
    }[type];
}

/** What an option or chip says: the kind's name, "Unassigned", "@alice", or "@me (you)". */
function optionTitle(type, value, mine) {
    if (type === 'kind')
        return kindTitle(value);
    if (type !== 'assignee')
        return null;
    if (value === UNASSIGNED)
        return _('Unassigned');
    return mine ? _('@%s (you)').format(value) : `@${value}`;
}

// The chip's kind of filter as a small icon before its name (the word is its tooltip).
const LABEL_ICON = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
    .get_child('icons').get_child('label-symbolic.svg');

function chipIcon(type) {
    if (type === 'label')
        return new Gtk.Image({gicon: new Gio.FileIcon({file: LABEL_ICON})});
    return new Gtk.Image({icon_name: {kind: 'view-list-symbolic', account: 'avatar-default-symbolic',
        assignee: 'system-users-symbolic'}[type]});
}

/** The chip's kind of filter, before its name. */
function chipType(type) {
    return {kind: _('Kind'), account: _('Account'), label: _('Label'), assignee: _('Assignee')}[type];
}

export class FilterBar {
    /** `types` are the buttons, in order; `onChange` runs after the filters change; `trailing` is a widget after them. */
    constructor({types, onChange, trailing = null}) {
        this._types = types;
        this._onChange = onChange;
        // Active filters, in the order added: [{type, value, title}]. Until you change them,
        // they follow your accounts (the default: what's assigned to you).
        this.filters = [];
        this._touched = false;

        const buttons = new Gtk.Box({spacing: 6});
        this._menus = {};
        for (const type of types) {
            const count = new Gtk.Label({css_classes: ['sourceglance-filter-count'], valign: Gtk.Align.CENTER, visible: false});
            const content = new Gtk.Box({spacing: 6});
            content.append(new Gtk.Label({label: typeTitle(type)}));
            content.append(count);
            const menu = new Gtk.MenuButton({child: content, always_show_arrow: true, css_classes: ['flat'],
                tooltip_text: typeTooltip(type), popover: new Gtk.Popover()});
            this._menus[type] = {menu, count};
            buttons.append(menu);
        }
        // Chips at their own width, wrapping like words. A FlowBox (before libadwaita 1.7) lines
        // them up in columns, which stretches the short ones; there they at least stay compact.
        this._chipBox = Adw.WrapBox
            ? new Adw.WrapBox({child_spacing: 6, line_spacing: 6, hexpand: true, valign: Gtk.Align.CENTER})
            : new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 6,
                max_children_per_line: 30, hexpand: true});
        const clear = new Gtk.Button({label: _('Clear filters'), css_classes: ['flat', 'sourceglance-chip-clear'],
            valign: Gtk.Align.START});
        clear.connect('clicked', () => this._set([]));
        this._chipRow = new Gtk.Box({spacing: 6, visible: false});
        this._chipRow.append(this._chipBox);
        this._chipRow.append(clear);
        // From the left, like the list under it.
        const bar = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 12, margin_bottom: 6,
            margin_start: 12, margin_end: 12, css_classes: ['sourceglance-filter-bar']});
        // The trailing control sits at the row's end, after a spacer and a thin vertical line.
        if (trailing) {
            buttons.append(new Gtk.Box({hexpand: true}));
            buttons.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL, margin_top: 4, margin_bottom: 4}));
            buttons.append(trailing);
        }
        buttons.halign = trailing ? Gtk.Align.FILL : Gtk.Align.START;
        bar.append(buttons);
        bar.append(this._chipRow);
        this.widget = bar;
    }

    /**
     * Refreshes the check lists and chips for `tasks` (see allTasks() in model.js; items and
     * drafts wrapped the same way). Filters whose choice is gone (an account signed out, a
     * label no item has any more) are dropped.
     */
    update(tasks, sources) {
        if (!this._touched)
            this.filters = defaultTaskFilters(sources).filter(filter => this._types.includes(filter.type));
        const groups = taskFilterGroups(tasks, sources, this.filters);
        this.filters = this.filters.filter(filter => groups[filter.type]?.some(option => option.value === filter.value))
            .map(filter => {
                const option = groups[filter.type].find(other => other.value === filter.value);
                return {...filter, title: optionTitle(filter.type, filter.value, option.mine) ?? filter.title};
            });

        for (let child = this._chipBox.get_first_child(); child;) {
            const next = child.get_next_sibling();
            this._chipBox.remove(child);
            child = next;
        }
        for (const filter of this.filters) {
            const title = filter.title;
            const chip = new Gtk.Box({spacing: 4, css_classes: ['sourceglance-chip'], valign: Gtk.Align.CENTER,
                halign: Gtk.Align.START, tooltip_text: `${chipType(filter.type)}: ${title}`});
            const icon = chipIcon(filter.type);
            icon.add_css_class('sourceglance-chip-type');
            chip.append(icon);
            chip.append(new Gtk.Label({label: title, ellipsize: 3 /* END */, max_width_chars: 24, css_classes: ['sourceglance-chip-value']}));
            const remove = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Remove this filter'),
                css_classes: ['flat', 'sourceglance-chip-remove'], valign: Gtk.Align.CENTER});
            remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove the filter %s').format(title)]);
            remove.connect('clicked', () => this._set(this.filters.filter(other => other !== filter)));
            chip.append(remove);
            this._chipBox.append(chip);
        }
        this._chipRow.visible = this.filters.length > 0;

        for (const type of this._types) {
            const {menu, count} = this._menus[type];
            const options = groups[type];
            const checked = options.filter(option => option.active).length;
            count.label = String(checked);
            count.visible = checked > 0;
            menu.sensitive = options.length > 0;
            const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2,
                margin_top: 4, margin_bottom: 4, margin_start: 4, margin_end: 4});
            for (const option of options) {
                const title = optionTitle(type, option.value, option.mine) ?? option.title;
                const line = new Gtk.Box({spacing: 12});
                line.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */, max_width_chars: 32}));
                line.append(new Gtk.Label({label: String(option.count), css_classes: ['dim-label', 'numeric']}));
                const check = new Gtk.CheckButton({child: line, active: option.active});
                check.connect('toggled', () => {
                    // Rebuild after the signal; the popover stays open for more checks.
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._set(toggleTaskFilter(this.filters, {type, value: option.value, title}));
                        return GLib.SOURCE_REMOVE;
                    });
                });
                list.append(check);
            }
            menu.popover.child = options.length > 8
                // Keeps the list's own width (a scrolled window would shrink it to the names' ellipses).
                ? new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER,
                    propagate_natural_height: true, propagate_natural_width: true, min_content_width: 240,
                    max_content_height: 360})
                : list;
        }
    }

    /** Whether the filters are still the default (your accounts), not changed by you. */
    get isDefault() {
        return !this._touched;
    }

    _set(filters) {
        this._touched = true;
        this.filters = filters;
        this._onChange();
    }
}
