# 0008. Build lists flat, grouped by one setting, and put each setting where its owner is

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Lists were nested three deep: an account section, then a collapsing repository heading, then the
items, with a label filter on top. With several accounts that meant many headers and little to
read ([ADR 0007](0007-multiple-accounts-and-self-hosted-instances.md) introduced the account
sections). People also work across platforms: the same project or organization can live on GitHub
and GitLab. At the same time, Settings had grown into one long scroll, and each new feature (names,
projects, repository and board limits) needed a home.

We needed rules for how lists are grouped and how settings are laid out, so that the window, the
top bar menu and the desktop widgets agree, and so that later screens follow the same rules.

## Options considered

1. **Keep account sections and the label filter, only tidy the indent.** Familiar, but it keeps three
   levels and makes cross-platform work awkward.
2. **Flat lists grouped by one saved setting, the same in the window and the top bar (chosen).**
   One level of plain headings; the user chooses **Project**, **Platform** or **Organization**.
   Cross-account merging comes for free, and the repository moves onto the row when the heading
   isn't the repository.
3. **Tabs per account.** Clear ownership, but it hides the combined view that people open the app for.

## Decision

Lists are one level deep, grouped by the **Group by** setting (project, platform or organization),
across all accounts, in the window and in the top bar. There is no label filter and no account
section. Settings is a set of pages, with peers (Organizations, Projects) as tabs on one page.

The 22 rules below, D1 to D22, apply to any screen. The ones enforced as layout rules are also in
[UI conventions](../ui-conventions.md); the visual choices are in [Theme](../design/theme.md) and
the behavior in [Behavior](../design/behavior.md).

### Structure

- **D1** **Flat beats nested.** One level of headings, never account sections inside repository groups. Grouping is a
   user choice (Group by), not a hierarchy. Context that the heading drops goes on the row (the repository
   under the title).
- **D2** **One page per part, tabs for siblings.** Settings has a sidebar page each for Accounts, Preferences,
   Startup and About. Peers that share a purpose (Organizations, Projects) are big tabs on one page.
- **D3** **Put a thing where its owner is.** The name dropdown belongs to its organization, so it sits in that
   organization's row. The limit-access controls belong to an account, so they hang off the account row.
- **D4** **Rare or destructive actions go in a ⋯ menu** (Reset projects), and always ask first.
- **D5** **Right panel, two modes.** Docked for reading beside a list (the task preview); overlay for a setting
   that covers a page (Limit repositories & boards). One panel moves between the two places.
- **D6** **Opening a panel costs the list first.** The list shrinks to its floor (a title at 40 characters); only
   then does the window grow, by at most half its width, and it never shrinks back.

### Interaction

- **D7** **No edit mode.** Change in place: a pencil beside the title, Enter or leaving the box saves, Escape
   restores. Drag and drop is always on. Every change saves at once.
- **D8** **Confirm with a small popover, not a dialog,** for per-row actions (Disband project). Reserve dialogs for
   account-wide actions (Sign out, Reset).
- **D9** **Typing never removes what exists.** Adding a repository keeps everything already watched; "empty" means
   all, and the last ones can't be switched off.
- **D10** **A master switch per group** turns all of a group's members off or on; the group stays listed.
- **D11** **Searching finds things to add; it does not filter your own list.**
- **D12** **Names are yours.** Friendly names, projects and hidden boards are stored as plain text, only in Source
    Glance. Nothing is written to a platform. Say so in the section's description.
- **D13** **Keep text short.** A section description is one or two sentences; detail goes in tooltips.

### Layout

- **D14** **Chevron first.** Disclosure arrows lead; counts end the row.
- **D15** **Headers are grids.** Chevron, flexible title, fixed name column, fixed count column. Columns never
    carry `hexpand` (an expanding child shares spare width and drifts between rows).
- **D16** **Controls that repeat are one width** (fixed width, held by a clamp), so left edges line up.
- **D17** **A label over a control starts at the control's left edge.**
- **D18** **A row is one hover area**: arrow, icons, text and buttons light together.
- **D19** **Item titles are 40 to 80 characters wide,** measured once from the real font, not recomputed.
- **D20** **Cap rows to what they need.** A wide window gets empty margins, not stretched bars.

### Process

- **D21** **Mock the design first** and agree before building. Several rounds were saved this way; the ones skipped
    (hover-only pencil, expanding name column) needed rework.
- **D22** **Verify with what you can read:** render icons to a PNG before shipping, load every module under gjs,
    read the journal after a reload. Ask before taking a screenshot of the live app.

## Consequences

- **Easier:** one list to read across accounts; the same grouping in the window, the top bar and
  the widgets; new settings have an obvious home (a page, or a tab beside its peers).
- **Harder:** the label filter is gone, so narrowing by label now happens through search and the
  Assignee filter only. Collapsing is per group, and its state is saved per view.
- **Account sections** in [ADR 0007](0007-multiple-accounts-and-self-hosted-instances.md) no longer
  apply to the lists. Accounts are still separate sign-ins, and an account that didn't load gets a
  note after the lists.
- **To revisit:** a saved filter for labels if people miss it; a per-view Group by if one global
  choice turns out too coarse.
