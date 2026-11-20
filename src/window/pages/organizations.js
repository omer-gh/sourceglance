// Settings → Organizations: every organization (or group, or your own user) found for each account,
// each with the name the lists group it by: one editable dropdown to type a name or pick one from
// every account's organizations. Organizations with the same name share a group when the lists are
// grouped by organization. Names are kept only in Source Glance's settings: nothing is sent to
// GitHub or GitLab. (Projects have their own section, projects.js's buildProjectsGroup.)
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {accountTitle} from '../../lib/accounts.js';

// The dropdown's width, in pixels, the same in every row.
const NAME_WIDTH = 220;

/** `ctx` is {names (DisplayNames)}. Returns {group, refresh(accounts)}. */
export function buildOrganizationsGroup({names}) {
    const group = new Adw.PreferencesGroup({
        title: _('Organizations'),
        description: _('Name each organization. Organizations with the same name share a group in your lists. This stays in Source Glance; nothing changes on GitHub or GitLab.'),
    });
    let rows = [];
    let accounts = [];
    let generation = 0;

    const clear = () => {
        for (const row of rows)
            group.remove(row);
        rows = [];
    };

    // One editable dropdown per organization: type a name, or pick one of the organizations of all
    // your accounts (a real organization can exist on several platforms, so they share one name).
    const organizationRow = (account, {login}, platforms, choices) => {
        const row = new Adw.ActionRow({title: `@${login}`, subtitle: platforms.join(' · '), use_markup: false});
        const combo = Gtk.ComboBoxText.new_with_entry();
        const entry = combo.get_child();
        for (const choice of choices)
            combo.append_text(choice);
        entry.text = names.nameOf(account, login) || login;
        entry.width_chars = 14;
        entry.max_width_chars = 14;
        combo.valign = Gtk.Align.CENTER;
        entry.update_property([Gtk.AccessibleProperty.LABEL], [_('Name for %s').format(login)]);
        row._dirty = false;
        let saved = entry.text;
        const save = text => {
            const name = text.trim();
            row._dirty = false;
            if (name === saved)
                return;
            saved = name;
            // The login alone is no name: it goes back to what the platform says.
            names.setOverride(account, login, name.toLowerCase() === login.toLowerCase() ? '' : name);
        };
        // Typing waits for Enter or leaving the field; picking from the list saves at once.
        entry.connect('changed', () => {
            row._dirty = entry.text.trim() !== saved;
        });
        entry.connect('activate', () => save(entry.text));
        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', () => save(entry.text));
        entry.add_controller(focus);
        combo.connect('changed', () => {
            if (combo.active >= 0)
                save(combo.get_active_text());
        });
        // Held to exactly NAME_WIDTH: a longer name never widens it, so the dropdowns line up.
        row.add_suffix(new Adw.Clamp({child: combo, maximum_size: NAME_WIDTH, tightening_threshold: NAME_WIDTH,
            width_request: NAME_WIDTH, hexpand: false, valign: Gtk.Align.CENTER}));
        return row;
    };

    // Lists each account's organizations (asking the platform once), then their names.
    const refresh = async newAccounts => {
        if (newAccounts)
            accounts = newAccounts;
        const mine = ++generation;
        const found = await Promise.all(accounts.map(async account => ({account, orgs: await names.discover(account)})));
        if (mine !== generation || rows.some(row => row._dirty))
            return;
        clear();
        // One row per organization login, whichever accounts and platforms have it.
        const unique = new Map();
        for (const {account, orgs} of found) {
            for (const org of orgs) {
                const key = org.login.toLowerCase();
                if (!unique.has(key))
                    unique.set(key, {account, org, platforms: []});
                const where = accountTitle({...account, login: ''});
                if (!unique.get(key).platforms.includes(where))
                    unique.get(key).platforms.push(where);
            }
        }
        // What the dropdowns offer: every organization of every account, by its name (or login).
        // No duplicates, whatever the capitalization.
        const choices = [];
        for (const {account, org} of unique.values()) {
            const choice = names.nameOf(account, org.login) || org.login;
            if (!choices.some(known => known.toLowerCase() === choice.toLowerCase()))
                choices.push(choice);
        }
        const entries = [...unique.values()].sort((a, b) => a.org.login.localeCompare(b.org.login));
        for (const {account, org, platforms} of entries) {
            const row = organizationRow(account, org, platforms, choices);
            rows.push(row);
            group.add(row);
        }
        names.load(found.flatMap(({account, orgs}) => orgs.map(({login}) => ({account, login}))));
    };

    // A name loaded or changed, or a repository was added to the watch list: show it, unless you're
    // in the middle of typing a name.
    names.connectChanged(() => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        refresh(null);
        return GLib.SOURCE_REMOVE;
    }));
    return {group, refresh};
}
