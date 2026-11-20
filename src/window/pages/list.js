// Lists → Issues / Pull requests: one section per account, items grouped by repository, the
// Labels and Assignee filters (Assignee starts as you; it offers the team and Unassigned),
// actions per item, and the closed-but-assigned count. Text from GitHub and GitLab is always
// shown as plain text.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from '../i18n.js';

import {
    asTask,
    filterGroupsBy,
    groupByOrganization,
    groupByPlatform,
    groupCollapseId,
    isGroupCollapsed,
    itemKey,
    normalizeGroupBy,
    organizationOf,
    searchGroups,
    toggleId,
} from '../../lib/model.js';
import {groupByProject} from '../../lib/projects.js';
import {accountTitle} from '../../lib/accounts.js';
import {closedPageUrl} from '../../lib/requests.js';
import {ListBody, collapsibleGroup, groupByControl, issueRow, noMatchesGroup, statusText} from './common.js';
import {FilterBar} from './filterBar.js';

// Built on use: gettext only works once the window has set up translations, not at import.
function copyFor(key) {
    return {
        issues: {
            title: _('Issues'),
            empty: _('No open issues assigned to you'),
            emptyGitLab: _('No open GitLab issues assigned to you'),
            closedGitLab: n => ngettext('%d closed GitLab issue still assigned to you',
                '%d closed GitLab issues still assigned to you', n).format(n),
            closedIcon: 'issueClosed',
            closed: n => ngettext('%d closed issue still assigned to you', '%d closed issues still assigned to you', n).format(n),
        },
        prs: {
            title: _('Pull requests'),
            empty: _('No open pull requests for you'),
            emptyGitLab: _('No open merge requests for you'),
            closedGitLab: n => ngettext('%d merged or closed merge request still assigned to you',
                '%d merged or closed merge requests still assigned to you', n).format(n),
            closedIcon: 'prMerged',
            closed: n => ngettext('%d merged or closed pull request still assigned to you',
                '%d merged or closed pull requests still assigned to you', n).format(n),
        },
    }[key];
}

export class ListPage {
    /**
     * `key` is 'issues' or 'prs'; `icons` has issue, pr, label, boards (Gio.Icon);
     * `names` (DisplayNames) gives organizations and accounts their friendly names; `onClearSearch`
     * empties the window's search box.
     */
    constructor({key, icons, actions, repos, settings, names, projects, onClearSearch}) {
        this._names = names;
        this._projects = projects;
        this._key = key;
        this._icons = icons;
        this._actions = actions;
        this._repos = repos;
        this._settings = settings;
        this._state = null;
        this._groups = [];
        this._onClearSearch = onClearSearch;
        // The window's search: the box's text and its words (searchTerms); [] shows everything.
        this._query = '';
        this._terms = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new ListBody();
        // Accounts and kinds are already this page's sections and the page itself.
        this._bar = new FilterBar({types: ['label', 'assignee'], onChange: () => this._state && this.update(this._state),
            trailing: groupByControl(settings)});
        // Group by is one setting for every list and Glance → System Tray.
        settings.connect('changed::group-by', () => this._state && this.update(this._state));
        // A name was loaded or you changed one: headings and merged groups follow.
        names.connectChanged(() => this._state && this.update(this._state));
        projects.connectChanged(() => this._state && this.update(this._state));
        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        list.append(this._bar.widget);
        list.append(this._page.widget);
        this.widget = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this.widget.add_named(this._statusPage, 'status');
        this.widget.add_named(list, 'list');
    }

    /** Shows only the items matching `terms`; [] shows the full list again. */
    setSearch(query, terms) {
        this._query = query;
        this._terms = terms;
        if (this._state)
            this.update(this._state);
    }

    update(state) {
        this._state = state;
        const sources = state.sources;
        // With one account, the page is its alone: its status replaces the list.
        const status = sources.length > 1 ? null : statusText(state);
        if (status) {
            this._statusPage.set({icon_name: status.icon, title: status.title, description: status.description});
            this.widget.visible_child_name = 'status';
            return;
        }
        this.widget.visible_child_name = 'list';
        for (const group of this._groups)
            this._page.remove(group);
        this._groups = [];
        const add = group => {
            this._page.add(group);
            this._groups.push(group);
        };

        const copy = copyFor(this._key);
        const items = sources.flatMap(src => (this._key === 'issues' ? src.groups : src.prGroups) ?? [])
            .flatMap(group => group.issues);
        this._bar.update(items.map(asTask), sources);
        this._loadNames(sources);
        const mode = normalizeGroupBy(this._settings.get_string('group-by'));
        this._renderMerged(mode, sources, copy, state, add);
        this._renderNotes(sources, copy, add);
    }

    /** Asks for the names the page shows: each account's own, and the organizations when grouped by them. */
    _loadNames(sources) {
        const wanted = [];
        const organizations = normalizeGroupBy(this._settings.get_string('group-by')) === 'organization';
        for (const src of sources) {
            if (src.login)
                wanted.push({account: src.account, login: src.login});
            const seen = [...new Set((src.groups ?? []).concat(src.prGroups ?? []).map(group => organizationOf(group.repo)))];
            // Every organization the items come from is listed under Accounts → Organizations.
            this._names.noteSeen(src.account, seen);
            const repos = [...new Set((src.groups ?? []).concat(src.prGroups ?? []).map(group => group.repo))];
            this._projects.noteRepos(repos);
            this._projects.discoverSubmodules(src.account, repos);
            if (organizations) {
                for (const group of this._groupsOf(src) ?? [])
                    wanted.push({account: src.account, login: organizationOf(group.repo)});
            }
        }
        this._names.load(wanted);
    }

    /** `src`'s items as loaded: groups by project. */
    _groupsOf(src) {
        return this._key === 'issues' ? src.groups : src.prGroups;
    }

    /**
     * Group by platform or organization: one group per platform, or per organization name (the
     * same name on several accounts is one group), with the items filtered and searched.
     */
    _renderMerged(mode, sources, copy, state, add) {
        const loaded = sources.filter(src => src.status !== 'signed-out' && src.updatedAt);
        const entries = mode === 'project'
            ? groupByProject(loaded, src => this._groupsOf(src), this._projects.repoMap())
            : mode === 'platform'
                ? groupByPlatform(loaded, src => this._groupsOf(src))
                : groupByOrganization(loaded, src => this._groupsOf(src), (account, login) =>
                    ({key: this._names.keyOf(account, login), title: this._names.label(account, login)}));
        const collapsedGroups = this._settings.get_strv('collapsed-groups');
        let shownAny = false;
        for (const {id: entryId, title, issues} of entries) {
            const shown = filterGroupsBy(searchGroups([{repo: title, issues}], this._terms), this._bar.filters);
            if (shown.length === 0 || shown[0].issues.length === 0)
                continue;
            shownAny = true;
            const id = groupCollapseId(this._key, mode, entryId);
            const collapsed = isGroupCollapsed(collapsedGroups, id, this._terms);
            const group = collapsibleGroup({
                title, count: shown[0].issues.length, collapsed, toggleable: this._terms.length === 0,
                onToggle: () => {
                    this._settings.set_strv('collapsed-groups', toggleId(this._settings.get_strv('collapsed-groups'), id));
                },
            });
            for (const item of shown[0].issues)
                group.add(this._itemRow(item, state.busy.includes(itemKey(item)), item.repo === title ? '' : item.repo));
            add(group);
        }
        if (!shownAny) {
            if (this._terms.length) {
                add(noMatchesGroup(this._query, () => this._onClearSearch()));
                return;
            }
            const empty = new Adw.PreferencesGroup();
            const title = !this._bar.isDefault ? _('Nothing matches these filters')
                : loaded.length === 0 ? _('Loading…') : copy.empty;
            empty.add(new Adw.ActionRow({title, use_markup: false, css_classes: ['dim-label']}));
            add(empty);
        }
    }

    /** Under the groups: what an account that didn't load says, and each account's closed-but-assigned count. */
    _renderNotes(sources, copy, add) {
        for (const src of sources) {
            if (src.status === 'signed-out' || !src.updatedAt) {
                const note = new Adw.PreferencesGroup();
                note.add(new Adw.ActionRow({
                    title: `${accountTitle(src.account)}: ${src.status === 'signed-out'
                        ? _('Not signed in. Sign in again under Accounts, at the top right.')
                        : src.error?.kind === 'insecure'
                            ? _('This instance uses plain http:// and isn’t on your local network now.')
                            : src.status === 'error' ? _('Couldn’t load. Retrying soon.') : _('Loading…')}`,
                    use_markup: false, css_classes: ['dim-label'],
                }));
                add(note);
                continue;
            }
            const closedCount = src.closedCounts?.[this._key];
            if (closedCount === null || closedCount === undefined)
                continue;
            const gitlab = src.platform === 'gitlab';
            const footer = new Adw.PreferencesGroup();
            const row = new Adw.ActionRow({title: (gitlab ? copy.closedGitLab : copy.closed)(closedCount),
                activatable: true, use_markup: false});
            row.add_prefix(new Gtk.Image({gicon: this._icons[copy.closedIcon]}));
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            const url = closedPageUrl(src.account, this._key === 'issues' ? 'issue' : 'pr', this._repos());
            row.connect('activated', () => this._actions.open(url));
            footer.add(row);
            add(footer);
        }
    }

    /** `context` leads the subtitle: the repository, where the heading isn't the repository. */
    _itemRow(item, busy, context = '') {
        return issueRow({item, busy, icons: this._icons, actions: this._actions, context});
    }
}
