// The sourceglance window: a sidebar of lists and settings, and the selected page.
// Built by window/app.js, in Source Glance's own app or GNOME's Extensions app.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from './i18n.js';
import {PANEL_MIN_WIDTH, PANEL_SLIDE_MS, defaultPanelWidth} from './panelSize.js';

let themeLoaded = false;

/**
 * Loads theme.css once per process. Its rules are scoped to .sourceglance-window, so other
 * extensions' Settings windows (same process) aren't affected.
 */
export function loadTheme(window, dir) {
    window.add_css_class('sourceglance-window');
    if (themeLoaded)
        return;
    const provider = new Gtk.CssProvider();
    provider.load_from_path(dir.get_child('window').get_child('theme.css').get_path());
    Gtk.StyleContext.add_provider_for_display(window.get_display(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    themeLoaded = true;
}

// The primary column's width with icons and short names under them. With full names, it and the
// submenu beside it fit their names and counts, with this much to spare.
const NARROW_WIDTH = 84;
const FIT_SPARE = 8;

// A heading, or a line in its place while the sidebar shows icons only.
function headingRow(text, styleClass) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    const label = new Gtk.Label({label: text, xalign: 0, css_classes: [styleClass]});
    const line = new Gtk.Separator({visible: false, margin_top: 8, margin_bottom: 8});
    box.append(label);
    box.append(line);
    const row = new Gtk.ListBoxRow({selectable: false, activatable: false, child: box});
    row._setNarrow = narrow => {
        label.visible = !narrow;
        line.visible = narrow;
    };
    return row;
}

function entryRow(entry) {
    const box = new Gtk.Box({spacing: 12});
    const image = entry.gicon ? new Gtk.Image({gicon: entry.gicon}) : new Gtk.Image({icon_name: entry.iconName});
    // Icons only: the count sits over the icon's top-right corner.
    const icon = new Gtk.Overlay({child: image});
    const badge = new Gtk.Label({css_classes: ['sourceglance-sidebar-badge'], visible: false, can_target: false,
        halign: Gtk.Align.END, valign: Gtk.Align.START});
    icon.add_overlay(badge);
    box.append(icon);
    const title = new Gtk.Label({label: entry.title, xalign: 0, hexpand: true, ellipsize: 3 /* END */});
    box.append(title);
    const count = new Gtk.Label({css_classes: ['sourceglance-count-pill'], visible: false, valign: Gtk.Align.CENTER});
    box.append(count);
    const row = new Gtk.ListBoxRow({child: box});
    if (entry.indent || entry.parent)
        row.add_css_class('sourceglance-indent');
    if (entry.group)
        row.add_css_class('sourceglance-sidebar-group');
    if (entry.expandable) {
        // Shows or hides the entries under this one (entry.parent); clicking the row itself
        // still opens its page.
        row._expander = new Gtk.Button({css_classes: ['flat', 'sourceglance-expander'], valign: Gtk.Align.CENTER});
        box.append(row._expander);
    }
    row._entry = entry;
    let narrow = false;
    // A list's count shows from the start: 0 until its first load.
    let text = entry.count ? '0' : '';
    const show = () => {
        // Icons only: a short name under the icon, small.
        box.orientation = narrow ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        box.spacing = narrow ? 2 : 12;
        title.label = narrow ? entry.shortTitle ?? entry.title : entry.title;
        title.xalign = narrow ? 0.5 : 0;
        title[narrow ? 'add_css_class' : 'remove_css_class']('sourceglance-sidebar-mini-label');
        icon.halign = narrow ? Gtk.Align.CENTER : Gtk.Align.FILL;
        count.visible = !narrow && text !== '';
        badge.visible = narrow && text !== '';
        if (row._expander)
            row._expander.visible = !narrow;
        box.halign = narrow ? Gtk.Align.CENTER : Gtk.Align.FILL;
        icon[narrow ? 'add_css_class' : 'remove_css_class']('sourceglance-sidebar-icon');
        row.tooltip_text = narrow ? entry.title : null;
    };
    row._setCount = value => {
        text = value || (entry.count ? '0' : '');
        count.label = text;
        badge.label = text;
        show();
    };
    row._setNarrow = value => {
        narrow = value;
        if (entry.indent || entry.parent)
            row[narrow ? 'remove_css_class' : 'add_css_class']('sourceglance-indent');
        show();
    };
    count.label = text;
    badge.label = text;
    show();
    return row;
}

/**
 * Replaces the window's content with the sidebar layout.
 *
 * @param {Adw.Window} window
 * @param {object} params
 * @param {Gio.Icon} params.appIcon
 * @param {Gio.Icon} params.exitIcon Exit's, at the sidebar's foot
 * @param {Adw.ToastOverlay} params.overlay the window's toast overlay (pages use it)
 * @param {Array} params.entries [{heading, sub}] or [{id, title, iconName|gicon, page, indent}]. An
 *   entry with `expandable` (and `expanded`, `onExpandedChanged(expanded)`) shows or hides the
 *   entries whose `parent` is its id. `bottom` puts an entry at the sidebar's foot, above Exit;
 *   `hidden` gives it no row at all (select() still shows its page). A `group` entry (no page)
 *   heads the entries whose `parent` is its id: clicking it opens them in a submenu docked to
 *   the sidebar's right, always with names and counts, on the one last opened there. Entries can share a page: `pageId` names it, `pageTitle` titles it, and `onShow()`
 *   runs each time the entry opens it (e.g. to scroll to its part). `shortTitle` is the name
 *   under the icon while the sidebar shows icons only. `count` shows a count from the start (0
 *   until setCount() gives one).
 * @param {Gtk.Widget} [params.headerStart] shown at the start of the content header bar
 * @param {Gtk.Widget} [params.headerEnd] shown at the end of the content header bar
 * @param {Function} [params.onPageChanged] called with the selected entry's id
 * @param {boolean} [params.narrow] start with the sidebar showing icons only
 * @param {Function} [params.onNarrowChanged] called with whether it shows icons only
 * @param {Function} [params.onQuit] Exit, at the sidebar's foot
 * @returns {{setCount(id: string, text: string): void, setSubtitle(text: string): void,
 *   select(id: string): void, current(): string|null, showPanel(params: object): void,
 *   hidePanel(): void, isPanelFor(owner: string): boolean}}
 */
export function buildMainWindow(window, {appIcon, exitIcon, overlay, entries, headerStart = null, headerEnd = null,
    onPageChanged = null, narrow = false, onNarrowChanged = null, onQuit = null}) {
    const list = new Gtk.ListBox({css_classes: ['navigation-sidebar', 'sourceglance-sidebar']});
    // Entries with `bottom` sit at the sidebar's foot, above Exit.
    const bottomList = new Gtk.ListBox({css_classes: ['navigation-sidebar', 'sourceglance-sidebar']});
    const stack = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
    const rows = new Map();
    const pages = new Map();
    const headings = [];
    // A group's entries list in the submenu docked right of the sidebar, one list per group.
    const submenus = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
    const subLists = new Map();
    const groupIds = new Set(entries.filter(entry => entry.group).map(entry => entry.id));

    for (const entry of entries) {
        if (entry.heading) {
            const row = headingRow(entry.heading, entry.sub ? 'sourceglance-sidebar-subheading' : 'sourceglance-sidebar-heading');
            headings.push(row);
            list.append(row);
            continue;
        }
        if (!entry.group) {
            const pageId = entry.pageId ?? entry.id;
            if (!stack.get_child_by_name(pageId))
                stack.add_named(entry.page, pageId);
            pages.set(entry.id, entry);
        }
        // A `hidden` entry has no row: other buttons open it (e.g. Accounts in the title bar).
        if (entry.hidden)
            continue;
        const row = entryRow(entry);
        rows.set(entry.id, row);
        if (groupIds.has(entry.parent)) {
            // In the submenu: always with names and counts, never indented.
            row.remove_css_class('sourceglance-indent');
            row._submenu = true;
            subLists.get(entry.parent).append(row);
            continue;
        }
        (entry.bottom ? bottomList : list).append(row);
        if (entry.group) {
            const subList = new Gtk.ListBox({css_classes: ['navigation-sidebar', 'sourceglance-submenu-list']});
            subLists.set(entry.id, subList);
            submenus.add_named(new Gtk.ScrolledWindow({child: subList, hscrollbar_policy: Gtk.PolicyType.NEVER,
                propagate_natural_width: true, vexpand: true}), entry.id);
        }
    }

    const title = new Gtk.Box({spacing: 8, halign: Gtk.Align.CENTER});
    title.append(new Gtk.Image({gicon: appIcon, pixel_size: 24}));
    title.append(new Gtk.Label({label: 'Source Glance', css_classes: ['heading']}));
    const sidebarHeader = new Adw.HeaderBar({title_widget: title, show_end_title_buttons: false,
        css_classes: ['sourceglance-sidebar-header']});
    // ☰ switches the sidebar between icons only and icons with names and counts.
    const hamburger = new Gtk.Button({icon_name: 'open-menu-symbolic', css_classes: ['flat']});
    sidebarHeader.pack_end(hamburger);
    // Icons only: the name doesn't fit beside ☰, so just the app icon.
    const narrowTitle = new Gtk.Image({gicon: appIcon, pixel_size: 24});
    const sidebarView = new Adw.ToolbarView({
        content: new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER,
            propagate_natural_width: true, vexpand: true}),
    });
    sidebarView.add_top_bar(sidebarHeader);
    // The bottom entries, then Exit, at the foot of the sidebar. Exit is a row like them (it
    // runs onQuit rather than opening a page), so it lines up with them.
    const footer = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['sourceglance-sidebar-footer']});
    footer.append(bottomList);
    const exitRow = entryRow({id: 'exit', title: _('Exit'), gicon: exitIcon});
    exitRow.selectable = false;
    exitRow._onActivate = () => (onQuit ? onQuit() : window.close());
    bottomList.append(exitRow);
    sidebarView.add_bottom_bar(footer);
    // The submenu, docked right of the primary entries: the selected group's name over its entries.
    const submenuTitle = new Adw.WindowTitle();
    const submenuHeader = new Adw.HeaderBar({title_widget: submenuTitle, show_start_title_buttons: false,
        show_end_title_buttons: false, css_classes: ['sourceglance-sidebar-header']});
    const submenuView = new Adw.ToolbarView({content: submenus, hexpand: true,
        visible: false, css_classes: ['sourceglance-submenu']});
    submenuView.add_top_bar(submenuHeader);
    // No line between them: the selected primary entry runs into the submenu.
    const sidebarBox = new Gtk.Box();
    sidebarBox.append(sidebarView);
    sidebarBox.append(submenuView);
    const sidebarPage = new Adw.NavigationPage({title: 'Source Glance', child: sidebarBox});

    // A panel docked on the right of the page (e.g. an item's preview): beside the list, not
    // over it, shown and hidden at once. Drag the divider to resize it.
    const panelTitle = new Adw.WindowTitle({hexpand: true});
    // What's shown (e.g. an issue or a pull request), as an icon in its colour before the title.
    const panelIcon = new Adw.Bin({valign: Gtk.Align.CENTER, margin_start: 6});
    const panelClose = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Close'),
        css_classes: ['flat'], valign: Gtk.Align.CENTER});
    const panelHead = new Gtk.CenterBox({start_widget: panelIcon, center_widget: panelTitle, end_widget: panelClose,
        css_classes: ['sourceglance-panel-head']});
    const panelBody = new Adw.Bin({vexpand: true});
    const panel = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, width_request: PANEL_MIN_WIDTH,
        css_classes: ['sourceglance-panel']});
    panel.append(panelHead);
    panel.append(new Gtk.Separator());
    panel.append(panelBody);
    // The panel slides in from the right and out again. Docked, it sits beside the page and shrinks
    // it (the task preview); as an overlay it floats over the page's right side and covers it
    // (an account's Limit repositories & boards). The one panel moves between the two places.
    const panelReveal = new Gtk.Revealer({child: panel, visible: false, transition_duration: PANEL_SLIDE_MS,
        transition_type: Gtk.RevealerTransitionType.SLIDE_LEFT});
    const overlayReveal = new Gtk.Revealer({visible: false, halign: Gtk.Align.END, transition_duration: PANEL_SLIDE_MS,
        transition_type: Gtk.RevealerTransitionType.SLIDE_LEFT});
    const stackHost = new Gtk.Overlay({child: stack});
    stackHost.add_overlay(overlayReveal);
    const paned = new Gtk.Paned({start_child: stackHost, end_child: panelReveal, resize_start_child: true,
        resize_end_child: true, shrink_start_child: false, shrink_end_child: false, wide_handle: false});
    let panelOwner = null;
    const revealers = [panelReveal, overlayReveal];
    const panelOpen = () => revealers.some(revealer => revealer.reveal_child);
    const hidePanel = () => {
        for (const revealer of revealers)
            revealer.reveal_child = false;
        panelOwner = null;
    };
    // Gone for good, and emptied, only once it has slid out.
    for (const revealer of revealers) {
        revealer.connect('notify::child-revealed', () => {
            if (revealer.child_revealed || revealer.reveal_child)
                return;
            revealer.visible = false;
            if (!panelOpen() && panel.get_parent() === revealer)
                panelBody.child = null;
        });
    }
    // Moves the panel to the docked or the overlay place, hiding the other at once.
    const placePanel = overlay => {
        const [to, from] = overlay ? [overlayReveal, panelReveal] : [panelReveal, overlayReveal];
        if (panel.get_parent() === to)
            return to;
        from.reveal_child = false;
        from.visible = false;
        from.set_child(null);
        to.set_child(panel);
        panel[overlay ? 'add_css_class' : 'remove_css_class']('sourceglance-overlay-panel');
        return to;
    };
    panelClose.connect('clicked', hidePanel);

    const contentView = new Adw.ToolbarView({content: paned});
    // The page's name, with a subtitle such as the number of search results.
    const windowTitle = new Adw.WindowTitle();
    const contentHeader = new Adw.HeaderBar({title_widget: windowTitle});
    if (headerStart)
        contentHeader.pack_start(headerStart);
    if (headerEnd)
        contentHeader.pack_end(headerEnd);
    contentView.add_top_bar(contentHeader);
    const contentPage = new Adw.NavigationPage({title: '', child: contentView});

    const split = new Adw.NavigationSplitView({
        sidebar: sidebarPage,
        content: contentPage,
    });
    overlay.child = split;

    // The sidebar's width: the primary entries, plus the submenu while a group is open, each just
    // wide enough for what it shows. Measured once styled (in the window), and again when counts change.
    const naturalWidth = widget => {
        widget.width_request = -1;
        const width = widget.measure(Gtk.Orientation.HORIZONTAL, -1)[1] + FIT_SPARE;
        widget.width_request = width;
        return width;
    };
    const fitWidth = () => {
        let primary = NARROW_WIDTH;
        if (narrow)
            sidebarView.width_request = NARROW_WIDTH;
        else
            primary = naturalWidth(sidebarView);
        const width = primary + (submenuView.visible ? naturalWidth(submenuView) : 0);
        split.min_sidebar_width = width;
        split.max_sidebar_width = width;
    };
    let fitId = 0;
    const fitSoon = () => {
        if (fitId)
            return;
        fitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            fitId = 0;
            fitWidth();
            return GLib.SOURCE_REMOVE;
        });
    };
    window.connect('map', fitSoon);

    const setNarrow = value => {
        narrow = value;
        fitWidth();
        fitSoon();
        sidebarHeader.title_widget = narrow ? narrowTitle : title;
        for (const box of [list, bottomList])
            box[narrow ? 'add_css_class' : 'remove_css_class']('sourceglance-sidebar-narrow');
        for (const row of [...headings, ...rows.values()]) {
            if (!row._submenu)
                row._setNarrow(narrow);
        }
        exitRow._setNarrow(narrow);
        hamburger.tooltip_text = narrow ? _('Show names') : _('Show icons only');
        hamburger.update_property([Gtk.AccessibleProperty.LABEL], [hamburger.tooltip_text]);
    };
    setNarrow(narrow);
    const toggleNarrow = () => {
        setNarrow(!narrow);
        onNarrowChanged?.(narrow);
    };
    hamburger.connect('clicked', toggleNarrow);
    // GNOME's Extensions app checks that its window got a page (visible_page); add one,
    // then show our own layout instead of the default page view.
    if (window instanceof Adw.PreferencesWindow)
        window.add(new Adw.PreferencesPage());
    window.set_content(overlay);

    // A child row slides in and out (its content sits in a Revealer, made the first time it moves);
    // it is hidden for good only once the slide is done.
    const slideRow = (row, show) => {
        if (!row._revealer) {
            const content = row.get_child();
            row.set_child(null);
            row._revealer = new Gtk.Revealer({child: content, reveal_child: row.visible, transition_duration: 200,
                transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
            row._revealer.connect('notify::child-revealed', () => {
                if (!row._revealer.child_revealed && !row._revealer.reveal_child)
                    row.visible = false;
            });
            row.set_child(row._revealer);
        }
        if (show)
            row.visible = true;
        row._revealer.reveal_child = show;
    };

    // Expandable entries: their children show only while they're expanded.
    const setExpanded = (parentRow, expanded, animate = true) => {
        parentRow._expanded = expanded;
        parentRow._expander.icon_name = expanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
        parentRow._expander.tooltip_text = expanded ? _('Hide the lists under this one') : _('Show the lists under this one');
        for (const row of rows.values()) {
            if (row._entry.parent !== parentRow._entry.id)
                continue;
            if (animate)
                slideRow(row, expanded);
            else
                row.visible = expanded;
        }
        // A hidden page can't stay selected: its parent takes over.
        if (!expanded && list.get_selected_row()?._entry?.parent === parentRow._entry.id)
            list.select_row(parentRow);
    };
    for (const row of rows.values()) {
        if (!row._expander)
            continue;
        setExpanded(row, Boolean(row._entry.expanded), false);
        row._expander.connect('clicked', () => {
            setExpanded(row, !row._expanded);
            row._entry.onExpandedChanged?.(row._expanded);
        });
    }

    let currentId = null;
    const show = entry => {
        currentId = entry.id;
        // Going to another page closes the right panel, which belongs to the page it was opened on.
        if (stack.visible_child_name !== (entry.pageId ?? entry.id))
            hidePanel();
        stack.visible_child_name = entry.pageId ?? entry.id;
        contentPage.title = entry.pageTitle ?? entry.title;
        windowTitle.title = entry.pageTitle ?? entry.title;
        split.show_content = true;
        entry.onShow?.();
        onPageChanged?.(entry.id);
    };
    // A group's row opens its submenu, on the entry last opened there (its first at first).
    const lastOpened = new Map();
    let wantedChild = null;
    const setSubmenu = group => {
        submenuView.visible = Boolean(group);
        if (group) {
            submenus.visible_child_name = group.id;
            submenuTitle.title = group.title;
        }
        fitWidth();
        fitSoon();
    };
    const openGroup = group => {
        setSubmenu(group);
        const subList = subLists.get(group.id);
        const row = rows.get(wantedChild ?? lastOpened.get(group.id)) ?? subList.get_row_at_index(0);
        wantedChild = null;
        if (!row)
            return;
        if (row.is_selected())
            show(row._entry);
        else
            subList.select_row(row);
    };
    // One selection across the primary entries (top and bottom lists).
    for (const box of [list, bottomList]) {
        box.connect('row-selected', (_list, row) => {
            if (!row?._entry)
                return;
            (box === list ? bottomList : list).unselect_all();
            if (row._entry.group) {
                openGroup(row._entry);
                return;
            }
            setSubmenu(null);
            show(row._entry);
        });
    }
    for (const [groupId, subList] of subLists) {
        subList.connect('row-selected', (_list, row) => {
            if (!row?._entry)
                return;
            lastOpened.set(groupId, row._entry.id);
            show(row._entry);
        });
    }
    // Clicking an entry that's already selected still runs its onShow() (e.g. scrolls back to its part).
    for (const box of [list, bottomList, ...subLists.values()]) {
        box.connect('row-activated', (_list, row) => {
            if (row?._onActivate)
                row._onActivate();
            else if (row?._entry && !row._entry.group && row.is_selected())
                row._entry.onShow?.();
        });
    }

    const select = id => {
        const row = rows.get(id);
        if (!row) {
            if (pages.has(id)) {
                list.unselect_all();
                bottomList.unselect_all();
                setSubmenu(null);
                show(pages.get(id));
            }
            return;
        }
        // An entry in a submenu: open its group on it.
        if (row._submenu) {
            const groupRow = rows.get(row._entry.parent);
            wantedChild = id;
            if (groupRow.is_selected())
                openGroup(groupRow._entry);
            else
                groupRow.get_parent().select_row(groupRow);
            return;
        }
        // Opening a list under a collapsed one (e.g. from the top bar) shows it first.
        const parent = rows.get(row._entry.parent);
        if (parent?._expander && !parent._expanded) {
            setExpanded(parent, true);
            parent._entry.onExpandedChanged?.(true);
        }
        row.get_parent().select_row(row);
    };
    // SOURCEGLANCE_PAGE (development) opens on a given page, e.g. for screenshots.
    select(GLib.getenv('SOURCEGLANCE_PAGE') ?? entries.find(entry => entry.id && !entry.group && !entry.hidden)?.id);

    return {
        current: () => currentId,
        setCount(id, text) {
            const row = rows.get(id);
            row?._setCount(text);
            fitSoon();
        },
        setSubtitle(text) {
            windowTitle.subtitle = text;
        },
        select,
        /**
         * Shows `child` in the right panel under `title` (and `subtitle`), with `icon` (a widget)
         * before the title. `owner` tells who has it now, e.g. an item's key; isPanelFor() checks it.
         * `overlay` floats it over the page instead of docking it beside the page.
         */
        showPanel({title, subtitle = '', icon = null, child, owner = null, overlay = false}) {
            panelTitle.title = title;
            panelTitle.subtitle = subtitle;
            panelIcon.child = icon;
            panelBody.child = child;
            panelOwner = owner;
            const target = placePanel(overlay);
            if (target.reveal_child)
                return;
            target.visible = true;
            target.reveal_child = true;
            const windowWidth = window.get_width();
            if (overlay) {
                // Over the page, never wider than the page it covers.
                panel.width_request = Math.min(stackHost.get_width() || Infinity, defaultPanelWidth(windowWidth));
                return;
            }
            panel.width_request = PANEL_MIN_WIDTH;
            const room = paned.get_width();
            // The task list gives way first, down to its narrowest (a title at 40 characters).
            const listMin = (stack.get_visible_child() ?? stack).measure(Gtk.Orientation.HORIZONTAL, -1)[0];
            // The panel opens at half the window (at least 380px)...
            const panelWidth = defaultPanelWidth(windowWidth);
            // ...and if the list can't shrink enough, the window grows, by at most half its width.
            const deficit = listMin + panelWidth - room;
            if (deficit > 0 && !window.is_maximized() && !window.is_fullscreen()) {
                const grow = Math.min(deficit, Math.floor(windowWidth / 2));
                // The window keeps its new width when the panel closes: no resizing back and forth.
                window.set_default_size(windowWidth + grow, window.get_height());
            }
            if (room > 0)
                paned.position = Math.max(listMin, room - panelWidth);
        },
        hidePanel,
        isPanelFor: owner => panelOpen() && panelOwner === owner,
        isPanelOpen: panelOpen,
    };
}
