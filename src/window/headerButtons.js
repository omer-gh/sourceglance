// The title bar's Refresh and Accounts buttons. Refresh carries a small "!" on its corner when
// an account's lists didn't load; hovering it says what to do, with a link that does it.
// Accounts opens the Accounts page and, while no account is added, keeps a note pinned under
// it on how to get started.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from './i18n.js';

import {removeAccount} from '../lib/accountStore.js';
import {accountTitle, fetchProblem, hostLabel, isDefaultBase, platformName, problemFix} from '../lib/accounts.js';

// How long the pointer may be away from the "!" and its note before the note closes.
const HIDE_DELAY_MS = 300;

/**
 * A small note in a popover: a bold line, a hint under it, and a button. `closable` adds a ✕
 * at the top right. Returns {box, title, hint, action, close}.
 */
function note(width, {closable = false} = {}) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, width_request: width,
        margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
    const title = new Gtk.Label({xalign: 0, wrap: true, max_width_chars: 36, hexpand: true, css_classes: ['heading']});
    const hint = new Gtk.Label({xalign: 0, wrap: true, max_width_chars: 36});
    const action = new Gtk.Button({halign: Gtk.Align.START, margin_top: 4});
    const head = new Gtk.Box({spacing: 6});
    head.append(title);
    let close = null;
    if (closable) {
        close = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Dismiss'),
            css_classes: ['flat', 'circular', 'sourceglance-note-close'], valign: Gtk.Align.START});
        close.update_property([Gtk.AccessibleProperty.LABEL], [_('Dismiss')]);
        head.append(close);
    }
    box.append(head);
    box.append(hint);
    box.append(action);
    return {box, title, hint, action, close};
}

/** What to tell about a fetchProblem(): {title, hint}, the hint naming the account. */
function problemText({kind, title: account, retryAt}) {
    switch (kind) {
    case 'auth':
        return {title: _('Sign-in rejected'), hint: _('%s: sign in again to load its lists.').format(account)};
    case 'signed-out':
        return {title: _('Signed out'), hint: _('%s: sign in again to load its lists.').format(account)};
    case 'forbidden':
        return {title: _('No access to some lists'),
            hint: _('%s: check that this account can see the repositories you follow.').format(account)};
    case 'insecure':
        return {title: _('Insecure address'),
            hint: _('%s uses plain http:// away from your local network, so Source Glance won’t send your sign-in. Use its https:// address.')
                .format(account)};
    case 'not-found':
    case 'gone':
        return {title: _('Repositories not found'),
            hint: _('%s: check the repositories you follow, and that this account can still see them.').format(account)};
    case 'network':
        return {title: _('Couldn’t connect'), hint: _('Couldn’t reach %s. Check your connection, then try again.').format(account)};
    case 'rate-limit': {
        const at = retryAt ? GLib.DateTime.new_from_unix_local(Math.ceil(retryAt / 1000)).format('%H:%M') : null;
        return {title: _('Request limit reached'),
            hint: at ? _('%s: lists load again after %s.').format(account, at)
                : _('%s: lists load again in a few minutes.').format(account)};
    }
    default:
        return {title: _('Lists didn’t load'),
            hint: _('%s: Source Glance tries again soon, or you can try now.').format(account)};
    }
}

/** Refresh, with the "!" for a failed load. `openPage(id)` shows a page; `onRefresh` reloads. */
export class RefreshButton {
    constructor({openPage, onRefresh}) {
        this._openPage = openPage;
        this._onRefresh = onRefresh;
        this._fix = null;
        this._hideId = 0;
        this._button = new Gtk.Button({icon_name: 'view-refresh-symbolic', tooltip_text: _('Refresh')});
        this._button.connect('clicked', () => onRefresh());
        this._badge = new Gtk.Label({label: '!', visible: false, halign: Gtk.Align.END, valign: Gtk.Align.END,
            css_classes: ['sourceglance-problem-badge']});
        this.widget = new Gtk.Overlay({child: this._button, valign: Gtk.Align.CENTER});
        this.widget.add_overlay(this._badge);

        this._note = note(260);
        this._note.action.add_css_class('suggested-action');
        this._note.action.connect('clicked', () => {
            this._popover.popdown();
            if (this._fix === 'accounts')
                this._openPage('accounts');
            else
                this._onRefresh();
        });
        // Not a tooltip: it holds a button, so it stays while the pointer moves onto it.
        this._popover = new Gtk.Popover({child: this._note.box, autohide: false, position: Gtk.PositionType.BOTTOM});
        this._popover.set_parent(this._badge);
        for (const widget of [this._badge, this._popover]) {
            const motion = new Gtk.EventControllerMotion();
            motion.connect('enter', () => this._showNote());
            motion.connect('leave', () => this._hideNoteSoon());
            widget.add_controller(motion);
        }
        // A click on the "!" shows the note too (touch screens have no hover).
        const click = new Gtk.GestureClick();
        click.connect('released', () => this._showNote());
        this._badge.add_controller(click);
    }

    _showNote() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
        if (this._badge.visible)
            this._popover.popup();
    }

    _hideNoteSoon() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this._hideId = 0;
            this._popover.popdown();
            return GLib.SOURCE_REMOVE;
        });
    }

    update(state) {
        this._button.sensitive = !state.refreshing;
        const problem = fetchProblem(state.sources);
        this._badge.visible = Boolean(problem);
        if (!problem) {
            this._popover.popdown();
            return;
        }
        const {title, hint} = problemText(problem);
        this._fix = problemFix(problem.kind);
        this._note.title.label = title;
        this._note.hint.label = hint;
        this._note.action.label = this._fix === 'accounts' ? _('Open Accounts') : _('Try again');
        this._badge.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    }

    destroy() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
        this._popover.unparent();
    }
}

/** What an account's row says about its sign-in: {dot: 'ok' | 'warn' | 'none', text}. */
function accountStatus(source) {
    if (source.status === 'signed-out' || (source.status === 'error' && source.error?.kind === 'auth'))
        return {dot: 'warn', text: _('Sign in again')};
    if (source.status === 'error' && !source.updatedAt)
        return {dot: 'warn', text: _('Couldn’t load')};
    return source.updatedAt ? {dot: 'ok', text: ''} : {dot: 'none', text: ''};
}

/**
 * Accounts: with accounts added, a small card under the button lists them (avatar with the
 * platform's badge, name, login, a status dot) with Add another account, Manage accounts and
 * Sign out of all. With none, the button opens Settings → Accounts and a "get started" note
 * stays pinned under it.
 */
export class AccountsButton {
    constructor({openPage, openAdd, window, settings, toast, names, icons}) {
        this._openPage = openPage;
        this._openAdd = openAdd;
        this._window = window;
        this._settings = settings;
        this._toast = toast;
        this._names = names;
        this._icons = icons;
        this._sources = [];
        this._noAccounts = false;
        this._onAccounts = false;
        // ✕ hides the note until the window opens again.
        this._dismissed = false;
        this.widget = new Gtk.Button({child: new Adw.ButtonContent({icon_name: 'avatar-default-symbolic', label: _('Accounts')}),
            valign: Gtk.Align.CENTER, tooltip_text: _('Your GitHub and GitLab sign-ins')});
        this.widget.connect('clicked', () => {
            if (this._noAccounts) {
                openPage('accounts');
                return;
            }
            this._buildList();
            this._list.popup();
        });
        this._listBody = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, width_request: 320,
            margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
        this._list = new Gtk.Popover({child: this._listBody, position: Gtk.PositionType.BOTTOM,
            css_classes: ['sourceglance-accounts-popover']});
        this._list.set_parent(this.widget);

        const {box, title, hint, action, close} = note(280, {closable: true});
        close.connect('clicked', () => {
            this._dismissed = true;
            this._show();
        });
        title.label = _('Get started');
        hint.label = _('Sign in to GitHub or GitLab to bring in your issues, pull requests and project boards.');
        action.label = _('Sign in');
        action.add_css_class('suggested-action');
        action.connect('clicked', () => openPage('accounts'));
        // Pinned: clicks elsewhere don't close it; ✕, signing in or opening Accounts does.
        this._popover = new Gtk.Popover({child: box, autohide: false, position: Gtk.PositionType.BOTTOM});
        this._popover.set_parent(this.widget);
        // A popover can only open once its button is on screen: just after it's mapped.
        this.widget.connect('map', () => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._show();
            return GLib.SOURCE_REMOVE;
        }));
    }

    _show() {
        const pinned = this._noAccounts && !this._onAccounts && !this._dismissed;
        if (pinned && this.widget.get_mapped())
            this._popover.popup();
        else if (!pinned)
            this._popover.popdown();
    }

    update(state) {
        this._sources = state.sources;
        this._noAccounts = state.status === 'signed-out' && state.sources.length === 0;
        this._show();
        if (this._list.visible)
            this._buildList();
    }

    // One row per account, then the actions, rebuilt each time the card opens.
    _buildList() {
        for (let child = this._listBody.get_first_child(); child; child = this._listBody.get_first_child())
            this._listBody.remove(child);
        const close = action => () => {
            this._list.popdown();
            action();
        };
        this._listBody.append(new Gtk.Label({label: _('Your accounts'), xalign: 0, margin_start: 10, margin_top: 4,
            margin_bottom: 4, css_classes: ['dim-label', 'caption']}));
        for (const source of this._sources) {
            const {account, login} = source;
            const name = this._names.nameOf(account, login) || login || accountTitle(account);
            const status = accountStatus(source);
            const avatar = new Adw.Avatar({size: 36, text: name, show_initials: true});
            const badge = new Gtk.Image({gicon: this._icons[account.platform === 'gitlab' ? 'gitlab' : 'github'], pixel_size: 12,
                halign: Gtk.Align.END, valign: Gtk.Align.END, css_classes: ['sourceglance-account-badge']});
            const picture = new Gtk.Overlay({child: avatar, valign: Gtk.Align.CENTER});
            picture.add_overlay(badge);
            const texts = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER});
            texts.append(new Gtk.Label({label: name, xalign: 0, ellipsize: 3 /* END */, css_classes: ['heading']}));
            const where = [login ? `@${login}` : '', platformName(account.platform),
                isDefaultBase(account.platform, account.base) ? '' : hostLabel(account.base)].filter(Boolean).join(' · ');
            texts.append(new Gtk.Label({label: where, xalign: 0, ellipsize: 3 /* END */, css_classes: ['dim-label', 'caption']}));
            if (status.text)
                texts.append(new Gtk.Label({label: status.text, xalign: 0, css_classes: ['caption', 'sourceglance-account-warn']}));
            const dot = new Gtk.Box({valign: Gtk.Align.CENTER, css_classes: ['sourceglance-dot', status.dot]});
            const content = new Gtk.Box({spacing: 10});
            content.append(picture);
            content.append(texts);
            content.append(dot);
            const row = new Gtk.Button({child: content, css_classes: ['flat', 'sourceglance-account-row'],
                tooltip_text: _('Open this account in Settings')});
            row.update_property([Gtk.AccessibleProperty.LABEL], [`${name}, ${where}`]);
            row.connect('clicked', close(() => this._openPage('accounts')));
            this._listBody.append(row);
        }
        this._listBody.append(new Gtk.Separator({margin_top: 4, margin_bottom: 4}));
        const action = (iconName, label, onClick) => {
            const content = new Gtk.Box({spacing: 12});
            content.append(new Gtk.Image({icon_name: iconName, pixel_size: 16, margin_start: 10, margin_end: 4}));
            content.append(new Gtk.Label({label, xalign: 0}));
            const button = new Gtk.Button({child: content, css_classes: ['flat', 'sourceglance-account-row']});
            button.connect('clicked', close(onClick));
            this._listBody.append(button);
        };
        action('list-add-symbolic', _('Add another account'), () => this._openAdd());
        action('emblem-system-symbolic', _('Manage accounts'), () => this._openPage('accounts'));
        this._listBody.append(new Gtk.Separator({margin_top: 4, margin_bottom: 4}));
        const signOut = new Gtk.Button({label: _('Sign out of all'), halign: Gtk.Align.END, margin_end: 4, margin_bottom: 2,
            css_classes: ['flat', 'sourceglance-account-signout']});
        signOut.connect('clicked', close(() => this._confirmSignOutAll()));
        this._listBody.append(signOut);
    }

    _confirmSignOutAll() {
        const accounts = this._sources.map(source => source.account);
        if (accounts.length === 0)
            return;
        const dialog = new Adw.AlertDialog({
            heading: _('Sign out of all accounts?'),
            body: _('Source Glance forgets every account’s sign-in from the keyring and stops showing their items. A personal access token stays valid until you revoke it on its instance.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('remove', _('Sign out of all'));
        dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', async (_dialog, response) => {
            if (response !== 'remove')
                return;
            try {
                for (const account of accounts)
                    await removeAccount(this._settings, account);
                this._toast(_('Signed out of all accounts'));
            } catch (e) {
                this._toast(_('Couldn’t sign out: %s').format(e.message));
            }
        });
        dialog.present(this._window);
    }

    /** The page now shown: on Accounts itself, the note would only cover what it points to. */
    setPage(id) {
        this._onAccounts = id === 'accounts';
        this._show();
    }

    destroy() {
        this._popover.unparent();
        this._list.unparent();
    }
}
