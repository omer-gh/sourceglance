# Naming conventions

One name for each thing, on screen and in the code. When you add a feature, reuse these
names; when you need a new one, add it here in the same PR ([Writing docs](writing-docs.md)).

## Principles

1. **One concept, one word.** The same word on screen, in code, in settings and in docs.
2. **Say what it is, not what it's built from.** "Project Boards", not "ProjectV2".
3. **Platform words stay on the platform.** GitHub's and GitLab's own terms (`projectsV2`,
   `merge_requests`) appear only in the code that talks to them (`lib/github.js`,
   `lib/gitlab.js`, `lib/gitlabModel.js`). Everywhere else we use our own words below.
4. **Sentence case on screen** ("Pull requests", "Project Boards"). Names of products are
   capitalized as their owners write them: GitHub, GitLab, GNOME Shell.
5. **Rename in one go.** A rename changes the screen text, the code, the docs and the changelog
   together, and a migration for anything saved ([Saved values](#saved-values)).

## Entities

| Name on screen | Code name | What it is | Not |
| ---------------- | ----------- | ------------ | ----- |
| Source Glance | `sourceglance` | The product. Written "Source Glance" on screen, `sourceglance` in code and settings | SourceGlance |
| Platform | `platform` | Where work lives: `github`, `gitlab` (more later) | provider, service |
| Account | `account` | One sign-in on one platform instance (github.com, a GitHub Enterprise Server, gitlab.com, a self-managed GitLab) | profile, login |
| Instance | `base` | The web address an account talks to | server, host |
| Organization | `organization` | Who a project belongs to: a GitHub organization, a GitLab top-level group, or your own user. Organizations with the same name (even on different platforms) are one | owner, namespace, workspace |
| Project | `project` | A friendly name with the repositories you put in it (Settings → Preferences → Projects tab). A repository with no project of its own is a project named after itself (`owner/name`). Platform projects (a GitHub Project board, and other platforms later) are projects too and stay even with no repository | repository (on screen) |
| Repository | `repo` | A GitHub repository or GitLab project, as `owner/name`. Shown as a chip inside a project. A submodule of another repository joins that one's project on its own | |
| Project Boards | `boards` | The page and list of board items. A board is a GitHub Project (v2) or a GitLab board | Projects, planner |
| Board | `board` | One board, with its items | project (on screen) |
| Draft | `draft` | A board item that isn't an issue or pull request yet | note, card |
| Issue | `issue` | An issue on any platform | ticket, task |
| Pull request | `pr` | A GitHub pull request or a GitLab merge request. Short form on screen: PRs | merge request (on screen), MR |
| Task | `task` | Any item in All Tasks: issue, pull request or draft | item (on screen) |
| Item | `item` | Code word for a row in a list of any kind | |
| Label | `label` | A label on an issue or pull request | tag |
| Assignee | `assignee` | Who an item is assigned to | owner, organization |
| Section | `section` | One account's part of a list. No list has sections now: the window's and the top bar's lists are flat, grouped by project, platform or organization across all accounts | group |
| Group | `group` | A heading with its items under it, by the chosen **Group by** | section |
| Group by | `group-by` | How lists are grouped: **Project**, **Platform** or **Organization** | sort, organize |
| Window | `window` | The Source Glance app window | app, preferences |
| Top bar | `indicator` | The panel button and its menu, in the GNOME top bar | tray (in code), panel |
| System Tray | `tray` | The Glance page that sets how the top bar looks | Topbar |
| Glance | `glance` | The sidebar group of Widgets and System Tray | |
| Widget | `widget` | A card on the desktop or in Glance → Widgets | tile (except the System Tray previews) |
| Custom widget | `custom-widget` | A widget you build from filters | |
| Page | `page` | One screen in the window, opened from the sidebar. Settings is one page; the entries under it (Accounts, Preferences, Startup, About), each a page of its own. Preferences has two big tabs, Organizations and Projects; About has the update check right under the version scroll to their heading | tab, view |
| Sidebar | `sidebar` | The window's list of pages | menu |
| Filter | `filter` | A way to narrow a list: search, label, assignee | |

### Terms that are easy to mix up

- **Project** on screen is a place where work lives (a repository on GitHub, a project on
  GitLab). A **board** is a different thing: a GitHub Project (v2) or a GitLab board. That is
  why the page is called **Project Boards**, not Projects.
- **Group** is a heading in a list. GitLab's own "group" is an **organization**.
- **Section** is only for an account's part of a list.
- **Tray**: in code `tray` is the System Tray page and its settings. The panel button and menu
  are the **indicator**.

## Pages and ids

Page ids are lowercase and never change once released, because the window remembers the
open page. If a page is renamed, only its title changes and the id stays, unless a
migration maps the old id to the new one.

| Title | Id | File |
| ------- | ---- | ------ |
| Widgets | `widgets` | `window/pages/widgets.js` |
| System Tray | `tray` | `window/pages/systemTray.js` |
| All Tasks | `tasks` | `window/pages/tasks.js` |
| Issues | `issues` | `window/pages/list.js` |
| Pull requests | `prs` | `window/pages/list.js` |
| Project Boards | `boards` | `window/pages/boards.js` |
| Accounts | `accounts` | `window/pages/accounts.js` |
| Settings | `start` (kept from an older page) | `window/pages/systemStart.js` |

## Code

| Thing | Style | Example |
| ------- | ------- | --------- |
| Files | `camelCase.js`, named for the main thing they hold | `accountStore.js`, `gitlabModel.js` |
| Classes | `PascalCase` | `GitHubClient`, `SectionToggle` |
| Functions, variables | `camelCase`, verb first for functions | `groupByProject()`, `isGroupCollapsed()` |
| Constants | `UPPER_SNAKE_CASE` for module-level numbers and strings | `ITEM_INDENT` |
| CSS classes | `sourceglance-` + kebab-case, one prefix for window and top bar | `sourceglance-group-toggle` |
| Pure modules | no `gi://` imports, so Node can test them ([ADR 0004](adr/0004-pure-core-for-testing.md)) | `model.js` |
| Tests | `tests/<module>.test.js` | `tests/model.test.js` |
| Booleans | start with `is`, `has` or `can` | `isMine()`, `hasError` |
| Handlers | `on` + event | `onToggle`, `onRefresh` |

Lists and their kinds use the same words everywhere: `issues`, `prs`, `boards`. Plurals name
collections (`groups`, `boards`); singular names one thing (`group`, `board`).

## Settings

GSettings keys are kebab-case and named for what they hold, not the page they show on
(`refresh-interval`, `collapsed-groups`, `group-by`). Group-by is one saved choice used by
the System Tray page and by every list's filter bar.

| Key | Holds |
| ----- | ------- |
| `layout` | How the top bar looks (System Tray) |
| `bar-enabled` | Whether the top bar, desktop widgets and refreshing are on (the Top bar switch) |
| `toolbar-buttons` | Which lists the top bar shows: `issues`, `prs`, `boards` |
| `group-by` | `project` (default), `platform` or `organization` |
| `project-repos` | Your projects, as plain text: the repository (lower case) to its project's name; no entry means a project named after itself |
| `project-boards` | Names of projects that came from a platform, kept even with no repository |
| `hidden-boards` | Project boards you chose to hide, each by its address, as plain text |
| `collapsed-groups` | Ids of collapsed groups, as `list:platform:name` |
| `organization-names` | The names you gave organizations, as plain text: login (lower case) to name. Kept only in Source Glance; never sent to a platform |
| `collapsed-sections` | Ids of collapsed account sections |
| `custom-widgets` | JSON, one object per custom widget; `kind` is `issues`, `prs` or `boards` |

## Saved values

Anything stored on a user's machine outlives a rename. A rename that changes a stored
value must:

1. read the old value and write the new one once, when the extension starts (in
   `extension.js`), so old installs keep their choices;
2. keep accepting the old value on read, for the one release the migration ships in;
3. say so in the changelog under **Changed**.

The rename of Projects to Project Boards is the first: the stored value `projects` becomes
`boards` (tray lists, collapsed-group ids that start with `projects:`, widgets, custom
widget `kind` and icon, and the remembered page).

## Showing names

- **People, organizations and groups** show the name the platform gives them, then the login in
  parentheses: **Acme Inc (@acme)**. With no name (or a name equal to the login), just **@acme**.
  Names are fetched once per account and shown as plain text (`lib/names.js`).
- **Your own names** for organizations (Accounts → Organizations) win over the platform's, are
  kept only in Source Glance and are never written to GitHub or GitLab. Organizations with the
  same name share a group when the lists are grouped by organization.
- **Accounts** read **GitHub · Jane Doe (@jane-doe)**: platform, host (if not the default),
  then the name.
- **List items** carry a small platform icon (GitHub or GitLab) after the item's own icon, in
  every list, so the platform is clear without opening the item.

## Writing about the product

- Name UI elements in **bold**, exactly as they appear on screen: **Project Boards**,
  **Group by**.
- Don't mention other products' names or looks when describing ours.
- Use the entity names above in issues, pull requests and the changelog too.
