# UI conventions

How things line up in the window and the top bar. When a screen looks off, the fix is to apply
these rules, not to nudge one widget. Names are in [naming.md](naming.md); the reasons are in
[ADR 0008](adr/0008-flat-lists-and-settings-structure.md) and the visual choices in
[Theme](design/theme.md).

## Alignment

1. **Text starts at the left** (`xalign: 0`), in lists, rows and headers alike.
2. **Controls sit at the right end of their row.** A switch, button or dropdown is a row's
   suffix, aligned to the end, vertically centered.
3. **Controls in one list are one width.** Dropdowns, entries and buttons that repeat down a
   list have the same fixed width (or share a `Gtk.SizeGroup`), so their left edges line up. An
   accordion header is a grid: chevron, flexible title, a fixed name column, a fixed count column
   (a header grid is for an accordion; Organizations and Projects are plain rows).
4. **A group's buttons sit on its title's line**, at the group's right edge, never beside its
   description (Settings → Preferences → Projects tab: a ⋯ menu holding Reset projects). A rare or destructive
   action goes in the ⋯ menu.
   There are no Edit and Save buttons: a name changes in place. A pencil always sits beside its
   title; Enter or leaving the box saves, and Escape puts the old name back.
   A column in a header (the name column) never has `hexpand` set: an expanding child shares
   the header's spare width and drifts from one header to the next.
5. **Disclosure chevrons come first** (left): accordions, collapsible lists, sidebar parents. The
   count or a button goes at the far end.
6. **Counts are small round badges** that end the header, so they sit at the same right edge in
   every header.
7. **A label over a control starts where the control starts.**
8. **A row's children are indented once**, under its title: the arrow and icon width, not a
   guess. Shared values live in one place (`ITEM_INDENT`, `EXPANDER_WIDTH` in `pages/common.js`).

## Item titles

A task's title is never narrower than 40 characters and never wider than 80. The two widths are
measured once, in pixels, from the bold title font (`measureTitleWidths` in `pages/common.js`),
not recomputed as the window resizes: the window stops shrinking before a title would go under
40 characters, and a wide window doesn't stretch a title past 80. Longer titles end in an ellipsis.
All titles in the window share one column width, so the buttons after them line up. The lists are
no wider than an item row needs (its parts plus a title at 80 characters), so a wide window leaves
empty margins beside the list instead of stretching the bars.

## Spacing

Use 6, 12 and 24 px: 6 inside a control or between icon and text, 12 between related rows and
at a page's sides, 24 between groups. Pages keep 12 px side margins.

## Size and color

- Icons are 16 px inline and 18 px for chevrons; small text uses `caption`.
- Hover and selection tints are neutral (`alpha(currentColor, 0.05)`); color is for status only
  (green signed in, amber needs attention, red errors).
- A row, header or card is one hover area: its icon, text and buttons light together.

## Motion

Things that open or close slide in 200–250 ms (`PANEL_SLIDE_MS` in `panelSize.js`); chevrons
turn with them. GTK's reduce-animations setting is respected.
