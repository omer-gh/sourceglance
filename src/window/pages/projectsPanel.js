// The projects behind Settings → Projects: your projects, each a friendly name with its
// repositories as chips, shown under the organization they mostly belong to. A repository with no
// project of its own is a project named after itself. There is no edit mode: press the pencil by a
// project's title and rename it in place (Enter or leaving the box saves it), and drag a
// repository chip onto any project to move it. Every change is saved at once; a project made from
// repositories that has none left goes with its last one, and projects from a platform (a GitHub
// Project board) stay. A project made of repositories has a trash button at its end that disbands it, after asking. Reset (in a ⋯ menu) builds them again from the defaults, after asking. Kept
// only in Source Glance's settings.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {cleanProjectName, dominantOrganization, projectKey, repoKey} from '../../lib/projects.js';

/**
 * `ctx` is {projects (ProjectStore), toast, window}; `onChange()` runs when what's shown changes.
 * Returns {header, isEditing(), byOrganization(), rowsFor(key)}: `header` holds the ⋯ menu for the
 * organizations group, `isEditing()` is true while a title is being edited, `byOrganization()` gives
 * the projects by organization key ({login, projects}) and `rowsFor(key)` that organization's rows.
 */
export function createProjectsEditor({projects: store, toast, window}, onChange) {
    // New projects with no repository yet: shown, but saved only once a repository is dropped in.
    let pending = [];
    // The project whose title is open for editing, by name key.
    let titleEditing = '';

    const more = new Gtk.MenuButton({icon_name: 'view-more-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
        tooltip_text: _('More')});
    more.update_property([Gtk.AccessibleProperty.LABEL], [_('More')]);
    // Reset is rare and destructive: it lives in this menu, not beside the title.
    const reset = new Gtk.Button({label: _('Reset projects…'), css_classes: ['flat'], halign: Gtk.Align.FILL});
    more.popover = new Gtk.Popover({child: reset});
    // On the title's line, at the group's right edge (docs/ui-conventions.md).
    const header = new Gtk.Box({valign: Gtk.Align.START, halign: Gtk.Align.END});
    header.append(more);

    const changed = () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        onChange();
        return GLib.SOURCE_REMOVE;
    });

    // The saved projects with the pending ones, as copies to change and save.
    const working = () => [...store.projects(), ...pending].map(project => ({...project, repos: [...project.repos]}));

    // Saves a list; what was only pending and now has a repository is saved too, the rest stays pending.
    const commit = list => {
        const keep = new Set(list.filter(project => project.repos.length === 0 && project.kind !== 'board')
            .map(project => projectKey(project.name)));
        pending = list.filter(project => keep.has(projectKey(project.name)) && pending.some(p => projectKey(p.name) === projectKey(project.name)));
        const removed = store.save(list);
        const lost = removed.filter(name => !pending.some(project => projectKey(project.name) === projectKey(name)));
        if (lost.length)
            toast(_('Removed projects with no repository: %s').format(lost.join(', ')));
        changed();
    };

    const move = (repo, target) => {
        const list = working();
        for (const project of list)
            project.repos = project.repos.filter(other => other !== repo);
        const into = list.find(project => projectKey(project.name) === projectKey(target.name));
        if (!into)
            return;
        into.repos.push(repo);
        into.repos.sort((a, b) => a.localeCompare(b));
        commit(list);
    };

    // Takes a project apart: its repositories go back to being projects of their own.
    const disband = project => {
        const list = working().filter(other => projectKey(other.name) !== projectKey(project.name));
        for (const repo of project.repos)
            list.push({name: repo, kind: 'repo', repos: [repo]});
        pending = pending.filter(other => projectKey(other.name) !== projectKey(project.name));
        commit(list);
    };

    const rename = (project, text) => {
        const name = cleanProjectName(text);
        titleEditing = '';
        if (!name || projectKey(name) === projectKey(project.name)) {
            // Nothing to change (an unnamed new project is dropped).
            if (!name)
                pending = pending.filter(other => projectKey(other.name) !== projectKey(project.name));
            changed();
            return;
        }
        const list = working();
        const found = list.find(other => projectKey(other.name) === projectKey(project.name));
        if (found)
            found.name = name;
        // Pending projects keep their organization, and the new name (a repeated name joins that project).
        pending = pending.map(other => (projectKey(other.name) === projectKey(project.name) ? {...other, name} : other));
        commit(list);
    };

    const chip = repo => {
        const box = new Gtk.Box({spacing: 4, css_classes: ['sourceglance-item-chip'], valign: Gtk.Align.CENTER,
            tooltip_text: _('Drag to another project')});
        const parent = store.parentOf(repo);
        if (parent)
            box.tooltip_text = _('Submodule of %s. Drag to another project').format(parent);
        box.append(new Gtk.Label({label: repo, ellipsize: 3 /* END */, max_width_chars: 36}));
        const source = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        source.connect('prepare', () => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            value.set_string(repo);
            return Gdk.ContentProvider.new_for_value(value);
        });
        box.add_controller(source);
        box.set_cursor_from_name('grab');
        return box;
    };

    // The title, with a pencil always beside it; the pencil swaps the title for a text box.
    const titleLine = project => {
        const stack = new Gtk.Stack({hexpand: true, hhomogeneous: false, vhomogeneous: false});
        const view = new Gtk.Box({spacing: 6, css_classes: ['sourceglance-project-title']});
        view.append(new Gtk.Label({label: project.name, xalign: 0, ellipsize: 3 /* END */, css_classes: ['heading']}));
        const pencil = new Gtk.Button({icon_name: 'edit-symbolic', valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular', 'sourceglance-pencil'], tooltip_text: _('Rename this project')});
        pencil.update_property([Gtk.AccessibleProperty.LABEL], [_('Rename %s').format(project.name)]);
        view.append(pencil);
        if (project.kind === 'board')
            view.append(new Gtk.Label({label: _('From a platform'), css_classes: ['dim-label', 'caption']}));
        const entry = new Gtk.Entry({text: project.name, hexpand: true, max_length: 60});
        entry.update_property([Gtk.AccessibleProperty.LABEL], [_('Project name')]);
        stack.add_named(view, 'view');
        stack.add_named(entry, 'edit');

        // Enter or leaving the box saves; Escape puts the old name back.
        let done = false;
        const finish = text => {
            if (done)
                return;
            done = true;
            rename(project, text);
        };
        const open = () => {
            titleEditing = projectKey(project.name);
            stack.visible_child_name = 'edit';
            entry.grab_focus();
            entry.select_region(0, -1);
        };
        pencil.connect('clicked', open);
        entry.connect('activate', () => finish(entry.text));
        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', () => finish(entry.text));
        entry.add_controller(focus);
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval) => {
            if (keyval !== Gdk.KEY_Escape)
                return false;
            finish(project.name);
            return true;
        });
        entry.add_controller(keys);
        // A project that was just made opens its title right away.
        if (titleEditing === projectKey(project.name))
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                open();
                return GLib.SOURCE_REMOVE;
            });
        return stack;
    };

    const projectRow = project => {
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true});
        content.append(titleLine(project));
        const chips = Adw.WrapBox
            ? new Adw.WrapBox({child_spacing: 6, line_spacing: 6})
            : new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 6,
                max_children_per_line: 30});
        for (const repo of project.repos)
            chips.append(chip(repo));
        if (project.repos.length === 0)
            chips.append(new Gtk.Label({label: _('Drop repositories here'), css_classes: ['dim-label', 'caption'], xalign: 0}));
        content.append(chips);

        // At the row's end, a close button for a project made of repositories: it takes the project apart.
        // The column keeps its width in every row, so the rows end at the same edge.
        // A repository alone in the project named after it isn't a group: nothing to take apart.
        const grouped = project.kind === 'repo'
            && !(project.repos.length === 1 && projectKey(project.name) === repoKey(project.repos[0]));
        const end = new Gtk.Box({valign: Gtk.Align.START, width_request: 34});
        if (grouped) {
            // The theme's trash icon. Pressing it asks first, in a small popover under the button.
            const confirm = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 10, margin_bottom: 10,
                margin_start: 12, margin_end: 12});
            confirm.append(new Gtk.Label({label: _('Disband “%s”?').format(project.name), xalign: 0, css_classes: ['heading']}));
            confirm.append(new Gtk.Label({label: _('Its repositories become projects of their own again. Nothing is deleted.'),
                xalign: 0, wrap: true, max_width_chars: 32}));
            const buttons = new Gtk.Box({spacing: 6, halign: Gtk.Align.END, margin_top: 4});
            const cancel = new Gtk.Button({label: _('Cancel')});
            const confirmButton = new Gtk.Button({label: _('Disband'), css_classes: ['destructive-action']});
            buttons.append(cancel);
            buttons.append(confirmButton);
            confirm.append(buttons);
            const popover = new Gtk.Popover({child: confirm});
            const disbandButton = new Gtk.MenuButton({icon_name: 'user-trash-symbolic', valign: Gtk.Align.START,
                css_classes: ['flat', 'circular'], tooltip_text: _('Disband project'), popover});
            disbandButton.update_property([Gtk.AccessibleProperty.LABEL], [_('Disband %s').format(project.name)]);
            cancel.connect('clicked', () => popover.popdown());
            confirmButton.connect('clicked', () => {
                popover.popdown();
                disband(project);
            });
            end.append(disbandButton);
        }
        const body = new Gtk.Box({spacing: 4, margin_top: 6, margin_bottom: 6, margin_start: 12, margin_end: 6});
        body.append(content);
        body.append(end);
        const row = new Adw.PreferencesRow({child: body, activatable: false, title: project.name});
        const target = new Gtk.DropTarget({actions: Gdk.DragAction.MOVE});
        target.set_gtypes([GObject.TYPE_STRING]);
        target.connect('drop', (_target, value) => {
            if (typeof value === 'string')
                move(value, project);
            return true;
        });
        row.add_controller(target);
        return row;
    };

    // Each project sits under the organization most of its repositories belong to; a new one (no
    // repository yet) stays under the organization it was made in.
    const byOrganization = () => {
        const groups = new Map();
        for (const project of [...store.projects(), ...pending]) {
            const login = project.organization ?? dominantOrganization(project);
            const key = login.toLowerCase();
            if (!groups.has(key))
                groups.set(key, {login, projects: []});
            groups.get(key).projects.push(project);
        }
        return groups;
    };

    // Every project's row, then a New project row (a new project has no organization until it has a repository).
    const allRows = () => {
        const rows = [...store.projects(), ...pending].map(projectRow);
        rows.push(newProjectRow(''));
        return rows;
    };

    const newProjectRow = key => {
        // ButtonRow needs libadwaita 1.6; before that, an activatable row does the same.
        const add = Adw.ButtonRow
            ? new Adw.ButtonRow({title: _('New project'), start_icon_name: 'list-add-symbolic'})
            : new Adw.ActionRow({title: _('New project'), activatable: true});
        add.connect('activated', () => {
            const all = [...store.projects(), ...pending];
            let name = _('New project');
            for (let n = 2; all.some(project => projectKey(project.name) === projectKey(name)); n++)
                name = `${_('New project')} ${n}`;
            pending.push({name, kind: 'repo', repos: [], organization: byOrganization().get(key)?.login ?? key});
            titleEditing = projectKey(name);
            changed();
        });
        return add;
    };

    const rowsFor = key => [...(byOrganization().get(key)?.projects ?? []).map(projectRow), newProjectRow(key)];

    reset.connect('clicked', () => {
        more.popover.popdown();
        const dialog = new Adw.AlertDialog({
            heading: _('Reset projects?'),
            body: _('This removes every project you made or renamed and puts moved repositories back. Each repository becomes a project of its own again, submodules rejoin their parent’s project, and projects from a platform stay. Organization names aren’t affected. You can’t undo this.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset projects'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'reset')
                return;
            pending = [];
            store.reset();
            toast(_('Projects reset to the defaults'));
        });
        dialog.present(window);
    });
    // New repositories seen, or a project changed elsewhere: show them, unless a title is open.
    store.connectChanged(() => {
        if (!titleEditing)
            changed();
    });
    return {header, isEditing: () => titleEditing !== '', byOrganization, rowsFor, allRows};
}

/** The Projects section of Settings. `ctx` is {projects (ProjectStore), toast, window}. Returns {group}. */
export function buildProjectsGroup(ctx) {
    const group = new Adw.PreferencesGroup({
        title: _('Projects'),
        description: _('Repositories are projects of their own until you group them: rename a project, or drag a repository onto another.'),
    });
    let rows = [];
    const render = () => {
        if (editor.isEditing())
            return;
        for (const row of rows)
            group.remove(row);
        rows = editor.allRows();
        for (const row of rows)
            group.add(row);
        if (ctx.projects.submoduleDenied().length) {
            const note = new Gtk.Box({spacing: 8, margin_top: 12, margin_start: 4});
            note.append(new Gtk.Image({icon_name: 'dialog-information-symbolic', valign: Gtk.Align.START, css_classes: ['dim-label']}));
            note.append(new Gtk.Label({label: _('Some accounts can’t read repository files, so submodules aren’t found. Drag them into a project, or sign in with a fine-grained token.'),
                xalign: 0, wrap: true, hexpand: true, css_classes: ['dim-label', 'caption']}));
            rows.push(note);
            group.add(note);
        }
    };
    const editor = createProjectsEditor(ctx, render);
    group.set_header_suffix(editor.header);
    render();
    return {group};
}
