// Glance → Widgets → Custom widget: make a widget of your own from filters over the lists, or
// change or delete one. Custom widgets live in the custom-widgets setting, so they stay
// through updates like the rest of your settings.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {accountTitle, parseAccounts} from '../../lib/accounts.js';
import {CUSTOM_WIDGET_KINDS, CUSTOM_WIDGET_RELATIONS, WIDGET_ICONS, cleanCustomWidget, newCustomWidgetId,
    parseCustomWidgets, splitFilterList} from '../../lib/model.js';

function saveCustomWidgets(settings, widgets) {
    settings.set_strv('custom-widgets', widgets.map(def => JSON.stringify(def)));
}

/**
 * Opens the dialog. `ctx` is {window, settings, icons, toast}; `def` is the widget to change,
 * or null for a new one. `onCreated(id)` puts a new widget in the widget area.
 */
export function openCustomWidgetDialog({window, settings, icons, toast}, def, onCreated) {
    const editing = Boolean(def);
    const dialog = new Adw.Dialog({title: editing ? _('Edit widget') : _('New widget'), content_width: 480,
        content_height: 640});
    const view = new Adw.ToolbarView();
    const header = new Adw.HeaderBar({show_start_title_buttons: false, show_end_title_buttons: false});
    const cancel = new Gtk.Button({label: _('Cancel')});
    cancel.connect('clicked', () => dialog.close());
    header.pack_start(cancel);
    const save = new Gtk.Button({label: editing ? _('Save') : _('Create'), css_classes: ['suggested-action']});
    header.pack_end(save);
    view.add_top_bar(header);
    const page = new Adw.PreferencesPage();
    view.content = page;
    dialog.child = view;

    const about = new Adw.PreferencesGroup();
    page.add(about);
    const name = new Adw.EntryRow({title: _('Name'), text: def?.name ?? ''});
    about.add(name);

    // The icon: one of Source Glance's own.
    const iconGroup = new Adw.PreferencesGroup({title: _('Icon')});
    page.add(iconGroup);
    const iconBox = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, max_children_per_line: 8,
        min_children_per_line: 8, column_spacing: 6, row_spacing: 6, homogeneous: true});
    iconGroup.add(iconBox);
    let icon = def?.icon ?? 'app';
    let first = null;
    for (const key of Object.keys(WIDGET_ICONS)) {
        const button = new Gtk.ToggleButton({child: new Gtk.Image({gicon: icons[`widget-${key}`], pixel_size: 18}),
            active: key === icon, group: first, css_classes: ['sourceglance-icon-choice']});
        first ??= button;
        button.connect('toggled', () => {
            if (button.active)
                icon = key;
        });
        iconBox.append(button);
    }

    const what = new Adw.PreferencesGroup({title: _('Shows')});
    page.add(what);
    const kind = new Adw.ComboRow({title: _('Kind'),
        model: Gtk.StringList.new([_('Issues'), _('Pull requests'), _('Project drafts')]),
        selected: Math.max(0, CUSTOM_WIDGET_KINDS.indexOf(def?.kind ?? 'issues'))});
    what.add(kind);
    const accounts = parseAccounts(settings.get_strv('accounts'));
    const accountIds = ['', ...accounts.map(account => account.id)];
    const account = new Adw.ComboRow({title: _('Account'),
        model: Gtk.StringList.new([_('All accounts'), ...accounts.map(accountTitle)]),
        selected: Math.max(0, accountIds.indexOf(def?.account ?? ''))});
    what.add(account);
    const relation = new Adw.ComboRow({title: _('Pull requests'),
        model: Gtk.StringList.new([_('Assigned to you or awaiting your review'), _('Assigned to you'),
            _('Awaiting your review')]),
        selected: Math.max(0, CUSTOM_WIDGET_RELATIONS.indexOf(def?.relation ?? 'any'))});
    what.add(relation);

    const filters = new Adw.PreferencesGroup({title: _('Filters'),
        description: _('Separate entries with commas or spaces. Leave a filter empty to match anything.')});
    page.add(filters);
    const repos = new Adw.EntryRow({title: _('Repositories, as owner/name'), text: (def?.repos ?? []).join(', ')});
    const labels = new Adw.EntryRow({title: _('Labels'), text: (def?.labels ?? []).join(', ')});
    const words = new Adw.EntryRow({title: _('Search words'), text: def?.words ?? ''});
    filters.add(repos);
    filters.add(labels);
    filters.add(words);

    // Pull requests can be filtered by why they're yours; drafts only by their words.
    const showFields = () => {
        const chosen = CUSTOM_WIDGET_KINDS[kind.selected];
        relation.visible = chosen === 'prs';
        repos.visible = chosen !== 'boards';
        labels.visible = chosen !== 'boards';
    };
    kind.connect('notify::selected', showFields);
    showFields();
    const checkName = () => {
        save.sensitive = name.text.trim() !== '';
    };
    name.connect('changed', checkName);
    checkName();

    save.connect('clicked', () => {
        const widgets = parseCustomWidgets(settings.get_strv('custom-widgets'));
        const chosen = CUSTOM_WIDGET_KINDS[kind.selected];
        const next = cleanCustomWidget({
            id: def?.id ?? newCustomWidgetId(widgets.map(other => other.id)),
            name: name.text,
            icon,
            kind: chosen,
            account: accountIds[account.selected] ?? '',
            relation: chosen === 'prs' ? CUSTOM_WIDGET_RELATIONS[relation.selected] : 'any',
            repos: chosen === 'boards' ? [] : splitFilterList(repos.text),
            labels: chosen === 'boards' ? [] : splitFilterList(labels.text),
            words: words.text,
        });
        if (!next)
            return;
        if (editing) {
            saveCustomWidgets(settings, widgets.map(other => (other.id === next.id ? next : other)));
        } else {
            saveCustomWidgets(settings, [...widgets, next]);
            onCreated(next.id);
        }
        toast(editing ? _('Widget saved') : _('Widget created'));
        dialog.close();
    });

    if (editing) {
        const danger = new Adw.PreferencesGroup();
        page.add(danger);
        const remove = new Gtk.Button({label: _('Delete widget'), css_classes: ['destructive-action', 'pill'],
            halign: Gtk.Align.CENTER});
        danger.add(remove);
        remove.connect('clicked', () => {
            const confirm = new Adw.AlertDialog({
                heading: _('Delete “%s”?').format(def.name),
                body: _('The widget and its filters are removed from the window and the desktop. Your issues and pull requests aren’t touched.'),
            });
            confirm.add_response('cancel', _('Cancel'));
            confirm.add_response('delete', _('Delete'));
            confirm.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
            confirm.default_response = 'cancel';
            confirm.close_response = 'cancel';
            confirm.connect('response', (_confirm, response) => {
                if (response !== 'delete')
                    return;
                const without = list => list.filter(id => id !== def.id);
                settings.set_strv('widgets', without(settings.get_strv('widgets')));
                settings.set_strv('widgets-off-desktop', without(settings.get_strv('widgets-off-desktop')));
                const opacities = settings.get_value('widget-opacities').deep_unpack();
                delete opacities[def.id];
                settings.set_value('widget-opacities', new GLib.Variant('a{si}', opacities));
                saveCustomWidgets(settings, parseCustomWidgets(settings.get_strv('custom-widgets'))
                    .filter(other => other.id !== def.id));
                toast(_('Widget deleted'));
                dialog.close();
            });
            confirm.present(dialog);
        });
    }

    dialog.present(window);
}
