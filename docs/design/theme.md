# Theme

The visual choices behind Source Glance's window and top bar, and why. They follow the layout
rules in [UI conventions](../ui-conventions.md) and the decisions in
[ADR 0008](../adr/0008-flat-lists-and-settings-structure.md). The CSS lives in `src/window/theme.css`
(window) and `src/stylesheet.css` (top bar menu).

## Color

- **Neutral by default; color only means status.** Green (`@success_color`) signed in, amber
  (`@warning_color`) needs attention, red for errors and destructive buttons.
- **Tints are neutral washes of the text color:** hover and selection use `alpha(currentColor, 0.05)`;
  count badges use `alpha(currentColor, 0.10)`. No blue fills for chrome.
- **Lines are hairlines:** headers `1px alpha(currentColor, 0.12)`; row dividers `0.08`; guide lines `0.12`.
- **No focus box.** Where a custom control hides the default focus ring, keyboard focus shows as an
  underlined title (accordion headers).

## Shape and size

- **Count badges are small round pills:** fully rounded, 18px minimum, `font-size: smaller`, neutral tint.
  They end the header and share one right edge.
- **Micro label** (`.sourceglance-micro-label`): `x-small`, dimmed, for a label above a control.
- **Main tabs** (`.sourceglance-main-tabs`): 44px tall, 150px wide at least, bold, one size up, with a
  20px icon, centered under a thin line.
- **Spacing scale: 6, 12, 24 px.** 6 inside a control or icon-to-text; 12 between related rows and at a
  page's sides; 24 between groups.
- **Icons:** 16px inline, 18px chevrons and the item arrow (in a 32px hit area), 14px platform icon.
- **Accordion body** is indented about one chevron width with a 1px guide line; rows have no rounded card
  edges.
- **Overlay panel:** left edge `1px alpha(currentColor, 0.15)` plus `-6px 0 18px alpha(black, 0.12)` shadow.

## Icons

- **Theme icons only.** Check `Gtk.IconTheme.has_icon()` against the active theme (Yaru) and render
  candidates before choosing. A hand-drawn icon rendered as specks and was dropped.
- Chosen: `edit-symbolic` (plain diagonal pencil, always visible), `user-trash-symbolic` (disband),
  `window-close-symbolic`, `view-more-symbolic` (⋯ menu), `list-add-symbolic`.
- The only custom icons are the two platform logos in `src/icons/` (GitHub, GitLab).

## Type

- Headings use the `heading` class; small text `caption`; muted text `dim-label`.
- Sentence case everywhere on screen ("Pull requests", "Project Boards").

## Motion

- Slides last **200 ms** (accordions, sidebar children) or **250 ms** (right panels, `PANEL_SLIDE_MS`).
  Chevrons turn with the slide (`-gtk-icon-transform`). GTK's reduce-animations setting is respected.
