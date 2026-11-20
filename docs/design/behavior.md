# Behavior

The rules the window, the top bar and the widgets follow, and where each one lives (in brackets). The
pure parts have Node tests under `tests/`; the GTK parts are checked by loading them under gjs. Names
are in [Naming conventions](../naming.md); the decisions behind them are in
[ADR 0008](../adr/0008-flat-lists-and-settings-structure.md).

## Group by (`group-by`: project | platform | organization)

- **Project** (default): each repository is a project named after itself, unless you grouped it (see
  Projects). Groups merge across accounts by project name, ignoring case. [`lib/projects.js` groupByProject]
- **Platform:** one group per platform (GitHub, GitLab), items of all that platform's accounts together.
  [`lib/model.js` groupByPlatform]
- **Organization:** the top-level namespace of a repository (`group/sub/name` belongs to `group`). Groups merge
  across accounts and platforms by **name** (your name, else the platform's, else the login), ignoring case.
  [`groupByOrganization`, `organizationOf`]
- A stored `owner` value reads as `organization`. [`normalizeGroupBy`]

## Friendly names [`lib/names.js`, `lib/displayNames.js`]

- Priority: the name you set, then the platform's, else nothing. Shown "Name (@login)"; "@login" when there is
  no name or it only repeats the login.
- Yours are stored as plain text, lower-case login → name (`organization-names`), the same on every account
  and platform. Clearing the field or typing the login goes back to the platform's name.
- Platform names are read once per account and kept for the session: GitHub `GET /users/{login}` (users and
  organizations), GitLab `GET /groups/{path}` then `GET /users?username=`. Only valid logins and paths are
  requested; names are capped, stripped of control characters, shown as plain text.
- **Organizations listed** for an account: its own login, GitHub GraphQL `viewer.organizations` and
  `GET /user/orgs`, GitLab `GET /groups?min_access_level=10&top_level_only=true`, plus every organization seen
  on loaded items and the organizations of repositories on the watch list. One row per login across accounts.

## Projects [`lib/projects.js`, `lib/projectStore.js`]

- **Stored as text:** `project-repos` (repository, lower case → project name) and `project-boards` (names of
  projects that came from a platform). A repository alone in the project named after it has no entry.
- **Unique names** ignoring case; the first spelling wins; renaming onto an existing name merges.
- **Saving** drops a project made of repositories that has none left; platform projects stay. Every change
  saves at once.
- **Placement:** a project sits under the organization most of its repositories belong to (first by name on a
  tie); one with no repository yet stays where it was made.
- **Disband** (trash, asks first): each of its repositories becomes a project of its own. **Reset** clears
  every grouping, keeps the platform projects seen this session.
- **Submodules:** a repository that is a submodule of another joins that one's project unless you placed it.
  Found by reading each seen repository's `.gitmodules` (one read-only GET), only for sign-ins that already
  read repository files. The default GitHub App sign-in is skipped on purpose (see Security); the Projects
  list says so. Links are kept for the session, not saved; entries equal to the automatic one are dropped on
  save. Chains follow to the first non-submodule. [`withSubmodules`, `dropAutomatic`]

## Watch list (`repositories`, github.com only)

- **Empty means all.** From empty, switching one off lists all the others; listing everything goes back to
  empty; the last watched repository can't be switched off (an empty list would mean all). Repositories on the
  list that the account doesn't show (a public one) are kept. [`lib/repoAccess.js` setWatched, toggleWatched]
- **Adding** a repository keeps everything already watched. [`addWatched`]
- **Available repositories:** up to 3 pages of `GET /user/repos`, plus repositories seen on items and on the
  list, grouped by organization. An organization's master switch turns all its repositories off or on.
- **Find public repositories:** `GET /search/repositories?q=…&per_page=8`, from 2 characters, after 0.4 s idle;
  an older answer never replaces a newer one. A full `owner/name` plus Enter adds without searching.

## Hidden boards (`hidden-boards`)

- A board is remembered by its web address (its title if it has none). `boardOwner` reads the organization or
  user from the address. Hiding is applied in `sourceFrom`, so the window, the top bar and the widgets agree;
  the unfiltered list stays in `allBoards` for the picker. [`boardKey`, `setHiddenBoards`]

## Lists

- Issues and Pull requests: items from all loaded accounts are grouped as above, flat, in the window and in
  the top bar. Counts stay *yours*; the window also loads the team's open items for its Assignee filter.
- An account that is signed out, loading or erroring gets a note after the lists; each account's "closed but
  still assigned" line follows.
- Collapsed state is saved per view (`collapsed-groups`, id `list:view:name`).

## Top bar switch (`bar-enabled`)

- On starts the top bar, desktop widgets and refresh loop; off stops them without closing the window. Quit
  does the same and closes the window and turns the switch off. The app icon's start request turns it on.

## Layout rules that behave like logic

- **Right panel:** docked opens at half the window (at least 380 px); the list shrinks first to its measured
  minimum, then the window grows by at most half its width (not when maximized or fullscreen) and keeps the
  width. Overlay is never wider than the page it covers. Leaving the page, or pressing a different item,
  closes the panel. [`window/mainWindow.js`, `window/panelSize.js`]
- **Title width:** 40 characters of the bold font measured once = the floor; twice that = the cap.

## Migrations [`lib/migrations.js`]

- The `projects` list id became `boards`: top-bar lists, widgets, collapsed-group ids, per-widget sizes and
  positions, custom widgets (kind and icon) and the open page are rewritten once at start.

## Security rules applied

- Everything new is a read-only GET, to the account's own instance, with that account's token.
- **No new GitHub App permission or OAuth scope; never repository contents.** Features that would need it
  degrade (submodules) or are done by hand. ([secure development checklist](../security/secure-development.md))
- Names, projects and hidden boards never leave Source Glance's settings.
