// Small pieces shared by the window's list pages.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {gettext as _} from '../i18n.js';

import {GROUP_BY, draftTarget, isDoneStatus, itemKey, itemRef, labelTextColor, normalizeGroupBy} from '../../lib/model.js';

/**
 * A flat button with an icon (theme name or Gio.Icon) and a label. `badge` is an optional
 * count shown after the label (e.g. comments); 0 shows none.
 */
export function actionButton({iconName = null, gicon = null, label, badge = 0, onClick}) {
    const box = new Gtk.Box({spacing: 6});
    box.append(gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName}));
    box.append(new Gtk.Label({label, ellipsize: 3 /* END */, max_width_chars: 28}));
    if (badge > 0)
        box.append(new Gtk.Label({label: String(badge), css_classes: ['sourceglance-count-pill'], valign: Gtk.Align.CENTER}));
    const button = new Gtk.Button({child: box, css_classes: ['sourceglance-action'], valign: Gtk.Align.CENTER});
    button.connect('clicked', onClick);
    return button;
}

/**
 * A flat icon-only button for an item's title line; `tooltip` names it. `badge` is an optional
 * count (e.g. comments) on its top-right corner; 0 shows none. `toggle` makes it a toggle button
 * (`active` its state); `onClick` gets the button. Returns {widget, button}.
 */
function iconButtonParts({iconName = null, gicon = null, tooltip, badge = 0, toggle = false, active = false, onClick}) {
    const image = gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName});
    const Button = toggle ? Gtk.ToggleButton : Gtk.Button;
    const button = new Button({child: image, tooltip_text: tooltip, valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'sourceglance-icon-action'], ...toggle ? {active} : {}});
    button.update_property([Gtk.AccessibleProperty.LABEL], [badge > 0 ? `${tooltip} (${badge})` : tooltip]);
    button.connect(toggle ? 'toggled' : 'clicked', () => onClick(button));
    if (badge <= 0)
        return {widget: button, button};
    // The badge sits over the button's corner; clicks on it go to the button.
    const overlay = new Gtk.Overlay({child: button, valign: Gtk.Align.CENTER});
    overlay.add_overlay(new Gtk.Label({label: badge > 99 ? '99+' : String(badge), css_classes: ['sourceglance-badge'],
        halign: Gtk.Align.END, valign: Gtk.Align.START, can_target: false}));
    return {widget: overlay, button};
}

/** An icon-only button for an item's title line (see iconButtonParts()). */
export function iconButton(params) {
    return iconButtonParts(params).widget;
}

/**
 * The (⋮) button at the end of an item's title line: a menu of `items`, each
 * {label, iconName or gicon, onClick}. `extra()`, if given, builds a widget for the end of the
 * menu each time it opens (the item's custom fields, loaded then).
 */
export function moreButton(items, extra = null) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
    const popover = new Gtk.Popover({child: box, css_classes: ['menu']});
    for (const item of items) {
        const content = new Gtk.Box({spacing: 10});
        content.append(item.gicon ? new Gtk.Image({gicon: item.gicon}) : new Gtk.Image({icon_name: item.iconName}));
        content.append(new Gtk.Label({label: item.label, xalign: 0, hexpand: true}));
        const button = new Gtk.Button({child: content, css_classes: ['flat', 'sourceglance-menu-item']});
        button.connect('clicked', () => {
            popover.popdown();
            item.onClick();
        });
        box.append(button);
    }
    if (extra) {
        let section = null;
        popover.connect('show', () => {
            if (section)
                box.remove(section);
            section = extra();
            box.append(section);
        });
    }
    const menu = new Gtk.MenuButton({icon_name: 'view-more-symbolic', tooltip_text: _('More actions'), popover,
        valign: Gtk.Align.CENTER, css_classes: ['flat', 'sourceglance-icon-action'], sensitive: items.length > 0 || Boolean(extra)});
    menu.update_property([Gtk.AccessibleProperty.LABEL], [_('More actions')]);
    return menu;
}

/**
 * "Group by" with a dropdown (Project, Platform, Organization), kept in the `group-by` setting. Every
 * copy of it (the lists' filter bars, Glance → System Tray) follows the setting.
 */
export function groupByControl(settings) {
    const box = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER, tooltip_text: _('Group the lists by')});
    box.append(new Gtk.Label({label: _('Group by'), css_classes: ['dim-label']}));
    const dropdown = new Gtk.DropDown({model: Gtk.StringList.new([_('Project'), _('Platform'), _('Organization')]),
        valign: Gtk.Align.CENTER});
    dropdown.update_property([Gtk.AccessibleProperty.LABEL], [_('Group by')]);
    const sync = () => {
        dropdown.selected = GROUP_BY.indexOf(normalizeGroupBy(settings.get_string('group-by')));
    };
    sync();
    dropdown.connect('notify::selected', () => {
        const value = GROUP_BY[dropdown.selected];
        if (value && value !== settings.get_string('group-by'))
            settings.set_string('group-by', value);
    });
    const handler = settings.connect('changed::group-by', sync);
    box.connect('unrealize', () => settings.disconnect(handler));
    box.append(dropdown);
    return box;
}

/**
 * The scrolling body of a list page: its groups stacked from the left, full width. Has add()
 * and remove() like Adw.PreferencesPage, which would centre them.
 */
export class ListBody {
    constructor() {
        this._box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24,
            margin_top: 6, margin_bottom: 24, margin_start: PAGE_SIDE, margin_end: PAGE_SIDE});
        // No wider than an item row can usefully be (measured from the first row), so a wide window
        // doesn't stretch the bars into empty space.
        this._clamp = new Adw.Clamp({child: this._box, maximum_size: UNMEASURED, tightening_threshold: UNMEASURED});
        this.widget = new Gtk.ScrolledWindow({child: this._clamp, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true});
        const fit = () => {
            if (rowWidth > 0)
                this._clamp.maximum_size = this._clamp.tightening_threshold = rowWidth + 2 * PAGE_SIDE + ACCORDION_INDENT;
        };
        rowWidthListeners.add(fit);
        this.widget.connect('destroy', () => rowWidthListeners.delete(fit));
        fit();
    }

    add(group) {
        this._box.append(group);
    }

    remove(group) {
        this._box.remove(group);
    }
}

/**
 * What to show instead of a list: {icon, title, description}, or null when the list can
 * show (loaded, possibly with a stale error).
 */
export function statusText(state) {
    if (state.status === 'signed-out') {
        return {icon: 'avatar-default-symbolic', title: _('Not signed in'),
            description: _('Sign in under Accounts, at the top right.')};
    }
    if (state.updatedAt === null && state.status !== 'error')
        return {icon: 'content-loading-symbolic', title: _('Loading…'), description: ''};
    if (state.updatedAt === null && state.status === 'error') {
        return {icon: 'network-error-symbolic', title: _('Couldn’t load your lists'),
            description: state.error?.kind === 'network'
                ? _('Couldn’t reach GitHub. Check your connection.')
                : _('GitHub returned an error. Source Glance will try again soon.')};
    }
    return null;
}

/** "Nothing matches" for a search, with a button that clears it to show the full list again. */
export function noMatchesGroup(query, onClear) {
    const group = new Adw.PreferencesGroup();
    const row = new Adw.ActionRow({title: _('Nothing matches “%s”').format(query), use_markup: false});
    row.add_prefix(new Gtk.Image({icon_name: 'edit-find-symbolic'}));
    const clear = new Gtk.Button({label: _('Clear search'), valign: Gtk.Align.CENTER});
    clear.connect('clicked', onClear);
    row.add_suffix(clear);
    group.add(row);
    return group;
}

/**
 * A group whose heading (disclosure arrow, title, item count) collapses or expands it, sliding. The
 * caller adds all the rows, even when `collapsed`. `toggleable` is false while a search expands
 * every group; `suffix` is an optional widget after the heading (e.g. Open board); `countAtEnd` puts the count after it. `onToggle`
 * remembers the choice when the heading is clicked; the page isn't rebuilt.
 */
export function collapsibleGroup({title, count, collapsed, toggleable = true, suffix = null, countAtEnd = false, onToggle}) {
    // A plain accordion: a full-width header, then its rows indented under it with a guide line.
    // Opening and closing slides the rows and turns the chevron, without rebuilding the page.
    const group = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['sourceglance-accordion']});
    const heading = new Gtk.Box({spacing: 10, hexpand: true, halign: Gtk.Align.FILL});
    const arrow = new Gtk.Image({icon_name: 'pan-down-symbolic', css_classes: ['sourceglance-group-arrow']});
    if (collapsed)
        arrow.add_css_class('collapsed');
    heading.append(arrow);
    heading.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */,
        css_classes: ['heading']}));
    // A small round badge; it ends the header, so the badges line up from one accordion to the next.
    const countLabel = new Gtk.Label({label: String(count), css_classes: ['sourceglance-group-count', 'numeric'],
        valign: Gtk.Align.CENTER, halign: Gtk.Align.END});
    // The count ends the header's toggle, or (countAtEnd) comes after the suffix.
    if (!countAtEnd)
        heading.append(countLabel);
    const toggle = new Gtk.Button({child: heading, hexpand: true, halign: Gtk.Align.FILL, sensitive: toggleable,
        css_classes: ['flat', 'sourceglance-group-toggle']});
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    const body = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['sourceglance-accordion-body']});
    const revealer = new Gtk.Revealer({child: body, reveal_child: !collapsed, transition_duration: 200,
        transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
    const show = open => {
        arrow.remove_css_class('collapsed');
        if (!open)
            arrow.add_css_class('collapsed');
        toggle.tooltip_text = !toggleable ? _('Clear the search to collapse') : open ? _('Hide') : _('Show');
        // GJS passes this state as an int, not a boolean.
        toggle.update_state([Gtk.AccessibleState.EXPANDED], [open ? 1 : 0]);
    };
    show(!collapsed);
    toggle.connect('clicked', () => {
        revealer.reveal_child = !revealer.reveal_child;
        show(revealer.reveal_child);
        // Only remembers the choice: the page isn't rebuilt, so the slide isn't cut short.
        onToggle(!revealer.reveal_child);
    });
    const header = new Gtk.Box({spacing: 6, css_classes: ['sourceglance-accordion-header']});
    header.append(toggle);
    if (suffix)
        header.append(suffix);
    if (countAtEnd) {
        // A column of its own, so the badges end at the same edge whatever their width.
        const column = new Gtk.Box({width_request: 52, halign: Gtk.Align.END, valign: Gtk.Align.CENTER, margin_end: 6});
        countLabel.hexpand = true;
        column.append(countLabel);
        header.append(column);
    }
    group.append(header);
    group.append(revealer);
    group.add = row => body.append(row);
    // Opens or closes it from code (a search opening the matches), without calling onToggle.
    group.setOpen = open => {
        revealer.reveal_child = open;
        show(open);
    };
    group.setCount = text => {
        countLabel.label = String(text);
    };
    return group;
}

// Label colours come from the API, so each one gets a generated class. Colours are checked
// ("rrggbb") before they reach the CSS.
const labelProvider = new Gtk.CssProvider();
const labelColors = new Set();
let labelProviderAdded = false;

/** The CSS class that paints a label of colour `color` ("rrggbb"), or null for none. */
export function labelClass(color) {
    const text = labelTextColor(color);
    if (!text)
        return null;
    const name = `sourceglance-label-${color}`;
    if (!labelColors.has(color)) {
        labelColors.add(color);
        const css = [...labelColors].map(c =>
            `.sourceglance-window .sourceglance-label-${c} { background-color: #${c}; color: ${labelTextColor(c)}; }`).join('\n');
        if (labelProvider.load_from_string)
            labelProvider.load_from_string(css);
        else
            labelProvider.load_from_data(css, -1);
        if (!labelProviderAdded) {
            Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), labelProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            labelProviderAdded = true;
        }
    }
    return name;
}

/**
 * A chip: a label (in its colour) or a person, with an (x) that runs `onRemove`. A null
 * `color` gets the neutral chip.
 */
export function chip({text, color = null, removeTooltip, onRemove}) {
    const box = new Gtk.Box({spacing: 2, css_classes: ['sourceglance-item-chip'], valign: Gtk.Align.CENTER});
    const colorClass = color ? labelClass(color) : null;
    if (colorClass)
        box.add_css_class(colorClass);
    box.append(new Gtk.Label({label: text, ellipsize: 3 /* END */, max_width_chars: 30}));
    const remove = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: removeTooltip,
        css_classes: ['flat', 'sourceglance-item-chip-remove'], valign: Gtk.Align.CENTER});
    remove.update_property([Gtk.AccessibleProperty.LABEL], [removeTooltip]);
    remove.connect('clicked', onRemove);
    box.append(remove);
    return box;
}

/** The (+) chip at the end of a chip line. `onClick` gets the button, to anchor a popover. */
export function addChip({label, tooltip, onClick}) {
    const box = new Gtk.Box({spacing: 4});
    box.append(new Gtk.Image({icon_name: 'list-add-symbolic'}));
    box.append(new Gtk.Label({label}));
    const button = new Gtk.Button({child: box, tooltip_text: tooltip, css_classes: ['flat', 'sourceglance-item-chip-add'],
        valign: Gtk.Align.CENTER});
    button.connect('clicked', () => onClick(button));
    return button;
}

/** A wrapping line of chips with a leading icon (Gio.Icon or theme name) and its accessible name. */
export function chipLine({gicon = null, iconName = null, name, chips}) {
    const line = new Gtk.Box({spacing: 8});
    const icon = gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName});
    icon.add_css_class('dim-label');
    icon.valign = Gtk.Align.START;
    icon.margin_top = 5;
    icon.tooltip_text = name;
    line.append(icon);
    const flow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 4,
        max_children_per_line: 20, hexpand: true, homogeneous: false});
    flow.update_property([Gtk.AccessibleProperty.LABEL], [name]);
    for (const child of chips)
        flow.append(child);
    line.append(flow);
    return line;
}

// The arrow's width (.sourceglance-item-arrow in theme.css), and where chips and footers start:
// past the arrow, the icon and the spacing between them.
const EXPANDER_WIDTH = 32;
const ITEM_INDENT = 60;
// The platform icon beside the item icon: its 14px and the 6px spacing.
const PLATFORM_ICON_INDENT = 20;
const PLATFORMS = {github: 'GitHub', gitlab: 'GitLab'};

// An item's title is never narrower than 40 characters, and never wider than 80, in pixels measured
// once (with the bold title font) from the first title: the window stops shrinking before a title
// would go under 40, and a wide window doesn't stretch it past 80.
const TITLE_MIN_CHARS = 40;
const TITLE_MAX_CHARS = 80;
let titleWidths = null;
// Item titles (and the subtitle under them) share one width, so the buttons after them line up in a column.
const titleColumns = new Gtk.SizeGroup({mode: Gtk.SizeGroupMode.HORIZONTAL});
// The widest an item row needs to be, in pixels: its parts around the title plus a title at its widest.
const PAGE_SIDE = 12;
const ACCORDION_INDENT = 12;
const UNMEASURED = 1000000;
let rowWidth = 0;
const rowWidthListeners = new Set();

function measureTitleWidths(label) {
    if (titleWidths)
        return titleWidths;
    const layout = label.create_pango_layout('0'.repeat(TITLE_MIN_CHARS));
    const bold = new Pango.AttrList();
    bold.insert(Pango.attr_weight_new(Pango.Weight.BOLD));
    layout.set_attributes(bold);
    const [width] = layout.get_pixel_size();
    titleWidths = {min: width, max: Math.round(width * TITLE_MAX_CHARS / TITLE_MIN_CHARS)};
    return titleWidths;
}
const platformOf = item => (item.platform === 'gitlab' ? 'gitlab' : 'github');

/**
 * A list row: an arrow, icon, title, `buttons` and a (⋮) menu of `menu` items (then `menuExtra()`,
 * see moreButton()) on the first line,
 * then `lines` (chip lines) under the title, shown or hidden by the arrow. `expanded` is whether
 * they show; `onExpand(bool)` keeps it. `footer` (e.g. a comment box) goes last. Clicking the
 * title runs `onTitleClick`. `busy` dims the controls and says so.
 */
export function itemRow({prefix, platformIcon = null, platformName = '', title, subtitle = '', buttons, menu = [], menuExtra = null, lines = [], footer = null, busy,
    expanded = false, onExpand = null, onTitleClick = null}) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
        margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
    const top = new Gtk.Box({spacing: 6});
    box.append(top);
    prefix.valign = Gtk.Align.CENTER;
    const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER});
    const titleLabel = new Gtk.Label({label: title, xalign: 0, ellipsize: 3 /* END */, css_classes: ['heading'],
        tooltip_text: title});
    if (onTitleClick) {
        titleLabel.add_css_class('sourceglance-item-title');
        titleLabel.set_cursor_from_name('pointer');
        const click = new Gtk.GestureClick();
        click.connect('released', () => onTitleClick());
        titleLabel.add_controller(click);
    }
    // Held between the two widths measured above: the clamp caps it, the label's own width keeps the floor.
    const widths = measureTitleWidths(titleLabel);
    titleLabel.width_request = widths.min;
    text.append(titleLabel);
    if (busy || subtitle) {
        text.append(new Gtk.Label({label: busy ? _('Working…') : subtitle, xalign: 0, ellipsize: 3 /* END */,
            css_classes: ['dim-label', 'caption']}));
    }
    const actions = new Gtk.Box({spacing: 0, sensitive: !busy, valign: Gtk.Align.CENTER});
    for (const button of buttons)
        actions.append(button);
    actions.append(moreButton(menu, menuExtra));

    // The arrow leads the row; without chips, a gap of its size keeps the icons in line.
    const arrow = new Gtk.Button({valign: Gtk.Align.CENTER, css_classes: ['flat', 'sourceglance-item-arrow']});
    const lead = lines.length > 0 ? arrow : new Gtk.Box({width_request: EXPANDER_WIDTH});
    const beside = [lead, prefix];
    if (platformIcon) {
        beside.push(new Gtk.Image({gicon: platformIcon, pixel_size: 14, valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'], tooltip_text: platformName}));
    }
    for (const part of beside)
        top.append(part);
    const column = new Adw.Clamp({child: text, maximum_size: widths.max, tightening_threshold: widths.max,
        halign: Gtk.Align.START});
    titleColumns.add_widget(column);
    top.append(column);
    top.append(actions);
    // The row never needs more than its parts and a title at its widest: tell the lists, once per widening.
    const parts = [...beside, actions];
    const needed = parts.reduce((sum, part) => sum + part.measure(Gtk.Orientation.HORIZONTAL, -1)[1], 0)
        + widths.max + 6 * parts.length + 12;
    if (needed > rowWidth) {
        rowWidth = needed;
        for (const fit of rowWidthListeners)
            fit();
    }
    // Chips and footers start under the title: past the arrow, the icon(s) and their spacing.
    const indent = ITEM_INDENT + (platformIcon ? PLATFORM_ICON_INDENT : 0);
    const row = new Adw.PreferencesRow({child: box, activatable: false, title, css_classes: ['sourceglance-item-row']});
    if (lines.length > 0) {
        const chips = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 2});
        for (const line of lines) {
            // Chips start under the title, past the arrow and the icon.
            line.margin_start = indent;
            line.sensitive = !busy;
            chips.append(line);
        }
        const revealer = new Gtk.Revealer({child: chips, reveal_child: expanded,
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
        box.append(revealer);
        const show = open => {
            arrow.icon_name = open ? 'pan-down-symbolic' : 'pan-end-symbolic';
            arrow.tooltip_text = open ? _('Hide labels and assignees') : _('Show labels and assignees');
            arrow.update_property([Gtk.AccessibleProperty.LABEL], [arrow.tooltip_text]);
            // GJS passes this state as an int, not a boolean.
            arrow.update_state([Gtk.AccessibleState.EXPANDED], [open ? 1 : 0]);
        };
        show(expanded);
        arrow.connect('clicked', () => {
            revealer.reveal_child = !revealer.reveal_child;
            show(revealer.reveal_child);
            onExpand?.(revealer.reveal_child);
        });
    }
    if (footer) {
        footer.margin_start = indent;
        box.append(footer);
    }
    return row;
}

/** Copies `text` to the clipboard and says so. */
function copy(actions, text, done) {
    Gdk.Display.get_default().get_clipboard().set_content(Gdk.ContentProvider.new_for_value(text));
    actions.notify(done);
}

/**
 * Working with an item (any press on its row) closes the right panel if it shows another item;
 * opening this item's own preview just swaps what the panel shows.
 */
function interactive(actions, item, row) {
    const press = new Gtk.GestureClick({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    press.connect('pressed', () => actions.leavePreview(item));
    row.add_controller(press);
    return row;
}

/**
 * An issue or pull request: Preview, Comment (with its count), Close, a button per board it's
 * on, Open in the browser and a (⋮) menu (with its custom fields) on the title line, then its labels and assignees as
 * chips. Comment shows a comment box under the item, which goes again on Cancel or once posted.
 * `context` leads the subtitle, e.g. the repository where the list doesn't group by it.
 */
export function issueRow({item, busy, icons, actions, context = ''}) {
    const parts = context ? [context] : [];
    if (item.kind === 'pr' && item.reason === 'review')
        parts.push(_('review requested'));
    for (const board of item.boards ?? [])
        parts.push(`${board.title}: ${board.status ?? _('No status')}`);

    const composer = new Gtk.Revealer({transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
        reveal_child: actions.isCommenting(item)});
    const comment = iconButtonParts({iconName: 'chat-message-new-symbolic', tooltip: _('Comment'),
        badge: item.comments ?? 0, toggle: true, active: actions.isCommenting(item),
        onClick: button => {
            actions.setCommenting(item, button.active);
            box ??= actions.commentBox(item, () => (button.active = false));
            composer.child = box.widget;
            composer.reveal_child = button.active;
            if (button.active)
                box.focus();
        }});
    // The box comes back after a refresh rebuilds the row, with what was typed in it.
    let box = null;
    if (actions.isCommenting(item)) {
        box = actions.commentBox(item, () => (comment.button.active = false));
        composer.child = box.widget;
    }

    const buttons = [
        iconButton({iconName: 'view-reveal-symbolic', tooltip: _('Preview'), onClick: () => actions.preview(item)}),
        comment.widget,
        iconButton({gicon: item.kind === 'pr' ? icons.prClosed : icons.issueClosed, tooltip: _('Close'),
            onClick: () => actions.close(item)}),
        ...(item.boards ?? []).map(board => iconButton({gicon: icons.boards,
            tooltip: _('Move on %s (now %s)').format(board.title, board.status ?? _('No status')),
            onClick: () => actions.status(item, board)})),
    ];
    if (item.url) {
        buttons.push(iconButton({iconName: 'adw-external-link-symbolic', tooltip: actions.openLabel(item),
            onClick: () => actions.open(item.url)}));
    }
    const menu = [
        {label: _('Labels…'), gicon: icons.label, onClick: () => actions.labels(item)},
        {label: _('Assignees…'), iconName: 'system-users-symbolic', onClick: () => actions.assignees(item)},
        {label: _('Copy reference'), iconName: 'edit-copy-symbolic',
            onClick: () => copy(actions, `${item.repo}${itemRef(item)}`, _('Reference copied'))},
    ];
    if (item.url) {
        menu.push({label: _('Copy link'), iconName: 'edit-copy-symbolic',
            onClick: () => copy(actions, item.url, _('Link copied'))});
    }
    return interactive(actions, item, itemRow({
        platformIcon: icons[platformOf(item)], platformName: PLATFORMS[platformOf(item)],
        prefix: new Gtk.Image({gicon: item.kind === 'pr' ? icons.pr : icons.issue,
            css_classes: [item.kind === 'pr' ? 'sourceglance-kind-pr' : 'sourceglance-kind-issue']}),
        title: `${itemRef(item)}  ${item.title}`,
        subtitle: parts.join('  ·  '),
        buttons,
        menu,
        menuExtra: () => actions.fieldsSection(item),
        lines: [actions.labelLine(item), actions.assigneeLine(item)],
        footer: composer,
        busy,
        expanded: actions.isExpanded(item),
        onExpand: open => actions.setExpanded(item, open),
        onTitleClick: () => actions.preview(item),
    }));
}

/**
 * A project draft: Preview, Move to status, Open board and a (⋮) menu on the title line, then its
 * assignees as chips. GitHub drafts have no labels, comments or close. `busyKeys` is the state's
 * busy list.
 */
export function draftRow({board, draft, busyKeys, icons, actions, context = ''}) {
    const {item, board: target} = draftTarget(board, draft);
    const move = iconButton({gicon: icons.boards, tooltip: _('Move to status'), onClick: () => actions.status(item, target)});
    move.sensitive = Boolean(board.fieldId) && board.options.length > 0;
    const buttons = [move];
    if (item.draftId)
        buttons.unshift(iconButton({iconName: 'view-reveal-symbolic', tooltip: _('Preview'), onClick: () => actions.preview(item)}));
    if (board.url) {
        buttons.push(iconButton({iconName: 'adw-external-link-symbolic', tooltip: _('Open board'),
            onClick: () => actions.open(board.url)}));
    }
    const menu = [{label: _('Copy title'), iconName: 'edit-copy-symbolic',
        onClick: () => copy(actions, draft.title ?? '', _('Title copied'))}];
    if (board.url) {
        menu.push({label: _('Copy board link'), iconName: 'edit-copy-symbolic',
            onClick: () => copy(actions, board.url, _('Link copied'))});
    }
    const status = draft.status ?? _('No status');
    const done = isDoneStatus(draft.status);
    // Boards are GitHub's.
    return interactive(actions, item, itemRow({
        platformIcon: icons.github, platformName: PLATFORMS.github,
        prefix: done
            ? new Gtk.Image({gicon: icons.issueClosed, css_classes: ['sourceglance-kind-done']})
            : new Gtk.Image({icon_name: 'edit-symbolic', css_classes: ['sourceglance-kind-draft']}),
        title: draft.title || _('Untitled draft'),
        subtitle: context ? `${context}  ·  ${status}` : status,
        buttons,
        menu,
        menuExtra: () => actions.fieldsSection(item),
        lines: item.draftId ? [actions.assigneeLine(item)] : [],
        busy: busyKeys.includes(itemKey(item)),
        expanded: actions.isExpanded(item),
        onExpand: open => actions.setExpanded(item, open),
        onTitleClick: item.draftId ? () => actions.preview(item) : null,
    }));
}
