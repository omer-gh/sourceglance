# Changelog

All notable changes to sourceglance are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Source Glance for macOS** (Phase 0 and 1 of [ADR 0006](docs/adr/0006-cross-platform-desktop-app-with-tauri.md),
  [#10](https://github.com/omer-gh/sourceglance/issues/10)): a menu-bar app built with Tauri
  from the same `src/shared` code as the extension. Sign in to github.com, gitlab.com or a
  self-hosted instance (browser sign-in or a personal access token); sign-ins are kept in
  the login Keychain. The menu bar shows your Issues, Pull requests and Projects, each with
  its count in a blue pill, as separate items (the default, like Ubuntu) or as one item with
  a tab per list, which suits MacBooks with a notch. The popovers look and work like the Ubuntu
  top-bar menus: one flat list across all accounts grouped by Group by, each item's actions in
  a menu beside the list, and Glance, Tasks, Settings and About in the Source Glance menu.
  **Show Source Glance in the menu bar** (Settings) works like Ubuntu's Top bar switch: off
  takes it out of the menu bar and stops checking in the background while the window keeps
  working; opening Source Glance again turns it back on. **Group by** and **Organizations**
  (Settings) work as on Ubuntu: name each organization (the same name on GitHub and GitLab
  makes one group), with the platform's own name when you haven't set one. **Projects**
  group repositories by name: rename one in place, drag a repository onto another project,
  disband or reset them, and submodules join their parent's project when the sign-in can read
  repository files (the GitHub App sign-in never asks). **Limit repositories & boards**, on
  each GitHub account, links to GitHub to change what the sign-in can reach, picks which
  github.com repositories the lists show (and adds public ones), and hides the project boards
  you don't follow from the popovers, the window and the menu-bar counts. The window is laid
  out like Ubuntu's: Glance (Widgets, System Tray), Tasks (All Tasks, Issues, Pull requests,
  Project Boards, with search), Settings (Accounts, Preferences, Startup, About) and Exit,
  with the Accounts card in the header. Optional Dock icon and start at login.
  Reaching a server on your local network asks for macOS's Local Network permission, and
  says how to turn it on if it's off.
- **A Setup wizard for macOS:** `Source-Glance-X.Y.Z.pkg` opens Apple's Installer and installs
  Source Glance for you only, in `~/Applications`, with no administrator password and no
  scripts. **Settings → Uninstall Source Glance** removes it again, and can also remove your
  sign-ins and settings. A `.dmg` is still built for anyone who'd rather drag the app in.
  Both are unsigned for now: see [Installing on macOS](docs/installing-macos.md).

### Changed

- The account list logic (`accountRegistry.js`), the list loaders (`loader.js`,
  `gitlabLoader.js`) and the cancellation check (`cancellation.js`) moved into `src/shared`
  so the macOS app can share them, with the usual re-exports left in `src/lib`. No change for
  the extension.

## [0.18.0] - 2026-11-22

### Changed

- **Source Glance no longer tracks whether your AI assistant is signed in.** The Sign in row in Settings → AI assistant and
  its status check are gone. When the agent can't be used (not installed, not signed in, or it failed), a message says so,
  in the agent's own words, with buttons to sign in, download it, check its docs or report the problem.

### Fixed

- **Codex works with the desktop app's package.** When there is no `codex` on the PATH but the app's `chatgpt` command is,
  the AI buttons use the Codex CLI that ships inside that package.

## [0.17.0] - 2026-11-21

### Added

- **Accounts remember which computer provides them.** On a sync server, the accounts other computers provide always come down
  and show as "Provided by" the computer's name, with no sign-out here: only that computer can sign them out, and they leave when it
  signs them out or stops providing them. Connecting to a server that already holds accounts turns the backup on by itself.

### Changed

- **Turning the backup off takes only this computer's accounts off the server.** The accounts other computers provide stay and
  keep coming down. The switch now decides whether this computer sends its own accounts, not whether it receives.

## [0.16.0] - 2026-11-21

### Added

- **Browser sign-ins sync with the server.** With the encrypted backup of account tokens on (Settings → Sync server), an
  account you signed in to with the browser now travels like a token: the server keeps it, renews it, and hands this
  computer the renewed token each sync, so the two never renew it against each other. The list of these accounts is sent
  even with the backup off, so the web app can tell you to turn it on.

### Changed

- If you turn the backup off later, a browser sign-in the server has taken over can't be renewed here: sign in to that
  account again when its token runs out.

## [0.15.0] - 2026-11-21

### Added

- **Browser sign-ins show up on the sync server.** An account you signed in to with the browser can't travel (its token is
  renewed by this computer), but the app now tells the server which accounts they are, never their tokens. The web app lists
  them under Accounts and offers to sign in to the same accounts there, with its own sign-in. Only sent while token backup is on.

## [0.14.1] - 2026-11-21

### Fixed

- **AI assistant with Codex.** Choosing Codex now opens the Codex desktop app in the repository's folder when it is
  installed, and falls back to the command-line agent in a terminal when it isn't (as Claude Code already did).

## [0.14.0] - 2026-11-21

### Added

- **AI assistant.** Choose a command-line AI agent from the drop-down (or None) under Settings → AI assistant. Each issue and
  pull request then has a button, next to Comment, that opens the agent in a terminal in the repository's folder with
  the item as its first message; the first time, it asks where the repository is on this computer, and
  the page lists and forgets those folders. The comment box (in the list and in the preview panel) has a **Suggest**
  button: the agent drafts a comment, using what you typed as what you want to say. The draft only fills the box; you
  edit it and press Comment. The agent runs on this computer with your own sign-in to it, with no tools for a
  suggestion.
  The launch message carries the description and latest comments and asks the agent to gather the rest itself
  (the thread, the repository's documentation, its own tools), to tell you what it is doing and to ask before it
  changes anything. If it can't reach GitHub or GitLab it checks sign-in, permissions and connectors with you.
  Settings → AI assistant shows these instructions (read only) and has a box for your own additions to them. The
  instructions come from your sync server (below): the AI buttons stay off, with the reason as their tooltip, until
  you are signed in to one.
- **Sync server** (Settings → Sync server). Sign in to Source Glance Cloud, or enter the address of another server (`https://`;
  plain `http://` only for this computer). Signing in is a code the app shows and copies for you: you sign in on the
  server's page in your browser and paste it there. The sign-in token is kept in the GNOME keyring, and nothing is sent
  until you sign in.
  When you connect it asks what to turn on: **Launch in AI button** (on), **Encrypted cloud backup of account tokens**
  (off) and **Save settings** (always on); the same switches stay on the page. With token backup off no account token is
  sent to or from the server. With the AI button off the instructions aren't fetched, and the AI buttons show a padlock
  whose popover says why and has a button to Settings → Sync server.
  Once signed in, accounts signed in with a personal access token follow you between computers (the token is encrypted on
  the server; browser sign-ins stay on the computer that made them), and so do the settings that follow you (group by,
  organization and project names, hidden boards, watched repositories, your AI additions). An account removed on one
  computer is removed on the server; one removed on the server is kept on a computer that still has it. Signing out keeps
  every account already on this computer. Plans: Individual is free; Startup is free for 6 months, then $5 a month, for up to 5 accounts, requiring
  company email (e.g. @your-company.com); Enterprise is $0.99 per user a month for 6 or more. Limits are shown now; payment comes later.

## [0.13.0] - 2026-11-20

### Added

- **Group by.** Group the Issues and Pull requests lists by **Project** (the default), **Platform** or
  **Organization**, in the window, the top bar menus and the widgets. Choose it in each list's filter bar or
  under Glance → System Tray; it's remembered.
- **Friendly names.** Organizations and accounts read "Name (@login)" with the name the platform gives them;
  with no name, just "@login". Each item also has a small GitHub or GitLab icon, and a row shows its repository
  under the title when the heading isn't the repository.
- **Organizations** (Settings → Preferences): every organization or group found for your accounts, each with an
  editable dropdown to type or pick the name your lists group it by. Organizations with the same name share a
  group, even across platforms. Names stay in Source Glance; nothing changes on GitHub or GitLab.
- **Projects** (Settings → Preferences): your repositories as projects. Press the pencil beside a project's
  title to rename it (Enter or leaving the box saves), drag repository chips between projects, and disband a
  group with its trash button (it asks first). Reset (in a ⋯ menu, it asks first) goes back to the defaults.
  A repository you watch shows up too, and so does its organization. A repository that is a git submodule of
  another joins that one's project on its own (read from its `.gitmodules`, only where your sign-in can
  already read repository files; the default GitHub sign-in can't, so move those by hand).
- **Limit repositories & boards.** Each GitHub account has a button that opens a panel over the page: a link
  to widen or limit what the sign-in can reach on GitHub; **Watch repositories** (a search for public
  repositories to add, and the repositories the account can see, one accordion per organization with a switch
  for all of its repositories); and the account's project boards (one accordion per owner, with a switch for
  all of them).
- **Accounts card.** The Accounts button opens a small card with each account's avatar, platform badge, name,
  login and a status dot, plus Add another account, Manage accounts and Sign out of all (which asks first).
- **Top bar switch** beside Group by in Glance → System Tray. Off takes down the top bar, the desktop widgets
  and the refreshing without closing the window; on brings them back.
- Accordions and the task panel slide open and closed, and the chevrons turn with them. Task titles stay between
  40 and 80 characters wide, and rows stay no wider than they need.

### Changed

- **Settings has a page for each part**: Accounts (and adding one), Preferences (big tabs for Organizations and
  Projects), Startup and About. The update check now sits right under the version in About.
- **Lists are flat.** There are no account sections and no collapsing repository headings: one list across all
  your accounts, grouped by **Group by**, each group a plain heading with its count. The top bar lists are built
  the same way, from Glance → System Tray.
- **The Source Glance menu** lists Glance, Tasks, Settings (Sign in… when signed out) and About, each opening its
  page in the window.
- **Project Boards.** The Projects list is now called Project Boards, so it can't be mistaken for a repository.
  Your saved choices (top-bar lists, widgets, collapsed groups) carry over.
- The task preview panel shrinks the list first and grows the window only if it must; the window keeps its new
  width. Accordion headers and item rows are one hover area, with a larger arrow.

### Removed

- The label filter and the collapsing account and repository sections in the top bar menus.
- The Start now button under Startup, the GitHub repositories panel in Settings, the copyright bar at the foot
  of Settings, and the profile links and Refresh in the Source Glance menu.
- The About slide-in panel: About is a page of its own.

### Fixed

- The Labels filter dropdown showed only "…" for each name when it had more than eight entries.
- Clicking a Settings entry in the sidebar could scroll to the wrong section.
- A desktop widget could keep logging an error after a drag that never released.
- A watched public repository did not show in your projects until an item of it had loaded.

## [0.12.1] - 2026-11-19

### Fixed

- For contributors: `make reload` now loads your latest code into a session that runs Source
  Glance installed with Setup, without logging out. Before, it only took effect after the
  next login. No change to the extension itself. ([7a59b0b](https://github.com/omer-gh/sourceglance/commit/7a59b0bbe6b5e44eb2a0b8b5f5743f55e871608e))

## [0.12.0] - 2026-11-19

### Added

- **The whole team in the window**: the window's lists now also load everything open in your
  repositories and your organizations' (on GitLab, your 10 most active projects), whoever
  it's assigned to. **Assignee** starts as your accounts, so you still see only your own
  work. Check **Unassigned** or a teammate to see theirs, or **Clear filters** to see everyone's.
  Useful for product managers, project coordinators and owners who follow a whole project.
  The top bar, the widgets and every count still show only your own items. ([c4601f7](https://github.com/omer-gh/sourceglance/commit/c4601f771cc79dbe53343dd6647fea87de9801e4))
- **Custom widgets**: make a widget of your own from filters over your lists (issues, pull
  requests or project drafts, by account, repository, label, review or search words), with
  a name and one of Source Glance's icons. They're kept in your settings, so they stay
  through updates. ([8b63251](https://github.com/omer-gh/sourceglance/commit/8b6325151eb0ed5455193378eaa6d5208e6d282c))
- **Widget sizes**: Small, Medium or Large. Each card's size button, before its trash button,
  sets its own size, and **All widgets** sets one size for every card. Medium is sized from
  your screen, as before. ([8b63251](https://github.com/omer-gh/sourceglance/commit/8b6325151eb0ed5455193378eaa6d5208e6d282c))

### Changed

- **Glance → Widgets** (was Desktop Widgets) draws the cards in the window, on your
  wallpaper and at their real size. Drag a card by its header to rearrange them. Each card
  has **On desktop** and its own opacity slider, and a trash button that moves it under
  **Add widget**, with a + to bring it back. ([8b63251](https://github.com/omer-gh/sourceglance/commit/8b6325151eb0ed5455193378eaa6d5208e6d282c))
- **All widgets**, a gear under the cards: every card on or off the desktop at once, one
  opacity and size for all, where cards go on the desktop (a grid at the top right, a column at the
  right or left, or a row along the top or bottom), Tidy up, Reset desktop positions, the
  wallpaper behind the cards, and the Adwaita wallpaper. ([8b63251](https://github.com/omer-gh/sourceglance/commit/8b6325151eb0ed5455193378eaa6d5208e6d282c))
- On the desktop, cards you haven't moved follow the window's order, in the arrangement
  chosen in All widgets (a grid at the top right by default) instead of a column on the right. ([8b63251](https://github.com/omer-gh/sourceglance/commit/8b6325151eb0ed5455193378eaa6d5208e6d282c))
- **Glance → System Tray** previews both layouts as tiles: click one to use it, and click a
  list's icon or tab on the preview to show or hide it. The refresh interval sits beside the
  heading. ([8b63251](https://github.com/omer-gh/sourceglance/commit/8b6325151eb0ed5455193378eaa6d5208e6d282c))
- **Filter chips** are smaller and tidier: compact pills at their own width that wrap like
  words, with an icon for the kind of filter (point at a chip to see it) instead of the word. ([c4601f7](https://github.com/omer-gh/sourceglance/commit/c4601f771cc79dbe53343dd6647fea87de9801e4))
- **Custom fields** in each item's ⋮ menu in the window, under their own **Custom fields**
  label: an issue's GitHub issue fields, the fields of every project board an issue, pull
  request or draft is on, and a GitLab issue's custom fields. Text, number, date, single and
  multiple choice, and iteration fields each get a matching control in the menu, and a change
  is saved at once.
  ([#16](https://github.com/omer-gh/sourceglance/issues/16), [c4601f7](https://github.com/omer-gh/sourceglance/commit/c4601f771cc79dbe53343dd6647fea87de9801e4))

## [0.11.0] - 2026-11-19

### Changed

- **License:** sourceglance is now licensed under the Apache License 2.0 instead of MIT.
  Releases up to and including 0.10.0 stay available under MIT. The extension zip and the
  setup wizard now ship the `LICENSE` and `NOTICE` files.

## [0.10.0] - 2026-11-19

### Added

- **Glance**: Desktop Widgets and System Tray on one page, each under its own heading. It's
  the first thing in the sidebar and opens when the window starts. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- **Accounts** in the window's title bar, after Refresh. With no account yet, a note pinned
  under it shows how to get started; its **×** dismisses it. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- A red **!** on Refresh when an account's lists didn't load. Point at it to see why (sign-in
  rejected, no connection, request limit…) and a button that fixes it: **Open Accounts** or
  **Try again**. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- The preview's header shows what you're looking at: an issue, pull or merge request, or
  draft, as a coloured icon and in its subtitle. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- Settings has an **About** section: **About Source Glance** slides About in from the right,
  over the settings. A status bar at the foot shows the copyright notice. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))

### Changed

- **A new sidebar**: a slim column of icons, each with its name under it, and the open
  group's menu docked right beside it with full names and counts. **Glance** holds Desktop
  Widgets and System Tray; **Tasks** holds All Tasks, Issues, Pull requests and Projects;
  **Settings** and **Exit** sit at the foot. The slim column is the default; ☰ shows full
  names instead. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- **System Start** is now **Settings**. Accounts moved to the title bar and About into
  Settings. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- **Quit** in the window is now **Exit**, with an exit-door icon, lined up with Settings. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- List counts show from the start, 0 until the lists load. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- The preview reads like a web page: the description flat under its heading, comments as a
  feed with each author's avatar, and code, quotes and tables framed. Its **Edit** button and
  the comment box match the window's style. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))
- The preview and About panels open at half the window or more. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))

### Fixed

- The editor toolbar's **Inline code** icon showed as two triangles; it's a clear `</>`
  again. ([7e02680](https://github.com/omer-gh/sourceglance/commit/7e026805a0661b64fe9f423339bd8d91a096d281))

## [0.9.0] - 2026-11-19

### Added

- **Comment from the list**: an item's Comment button opens a comment box right under it,
  instead of a dialog. It closes on Cancel and once the comment is posted. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- A **⋮ menu** at the end of each item: Labels…, Assignees…, Copy reference and Copy link
  (drafts: Copy title and Copy board link). ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- The window's sidebar can show **icons only**: ☰ at its top right switches between that (with
  each list's count on its icon) and icons with names and counts. The choice is remembered. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- A **Quit** button at the foot of the sidebar. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- **Open All Tasks** at the top of the Source Glance top-bar menu. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))

### Changed

- The preview **renders Markdown** in descriptions and comments (headings, emphasis, code,
  lists, task lists, quotes, tables and web links) instead of showing it raw. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- Clicking an item's title opens its preview. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- Items' icons are coloured by kind: issues green, pull requests blue, drafts amber, done purple. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- The arrow that shows labels and assignees leads the item and points right (closed) or down
  (open). The action buttons are smaller and closer together, leaving more room for the title. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- Lists and their filters start from the left and use the window's width. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- The preview panel opens at half the window, grows with it, and its comment box is shorter. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- **Quit**, in the top bar or the window, now stops everything: the top-bar buttons, the
  desktop widgets and the window. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- **Settings** in the top-bar menu (and **Sign in…**) opens the window on Accounts, the first
  settings page. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))
- The sidebar groups Desktop Widgets and System Tray under **Glance Tools**; **Settings** now
  heads Accounts, System Start and About. ([ed6e00c](https://github.com/omer-gh/sourceglance/commit/ed6e00cd98cc672010a97a3dfebaf76b00475a2b))

## [0.8.0] - 2026-11-18

### Changed

- The **top-bar menus keep one width**: about a quarter of your screen (28 %), at least 360
  and at most 560 pixels at 100 % scaling, so they no longer grow or shrink as lists load,
  refresh or switch tabs. The width changes only when you change the screen resolution or
  display scaling. ([7bdc4df](https://github.com/omer-gh/sourceglance/commit/7bdc4df85525f6459a36a551cf969940ee9e4bbc))

## [0.7.0] - 2026-11-18

### Added

- **Preview** an issue, pull or merge request, or project draft from its row in the window,
  in a panel on the right beside the list: the description, which you can edit, then its
  comments and reactions (read only) and a box to add a comment. Drag the panel's edge to
  resize it. Project drafts show their description only.
- A small **Markdown editor** for comments and descriptions, with a toolbar for bold, italic,
  strikethrough, inline code, bulleted and numbered lists, quotes and code blocks, plus
  Ctrl+B, Ctrl+I and Ctrl+Enter to post.
- **Labels and assignees as chips** under an item's title, labels in their own colour: **×**
  removes one, **+** lists what you can add. An arrow at the end of the row shows or hides
  them; rows start collapsed.
- The **Comment** button shows how many comments an item has, on its corner.
- **Project drafts can be assigned** (to you, or whoever is already on them).
- **Filters**: on **All Tasks**, **Kind**, **Accounts**, **Labels** and **Assignee** are
  separate buttons, each a check list with counts; what you pick shows as chips on the row
  below them. Issues and Pull requests have the same bar with **Labels** and **Assignee**,
  and Projects with **Assignee**.

### Changed

- Rows in the window's lists no longer expand into a row of buttons: their actions are icons
  on the title line (hover one for its name), and Open uses the external-link arrow. Tasks
  rows have the same actions as the lists, rather than only opening in the browser.
- Filter chips are rounded rectangles, like the rest of the window.
- **Tasks** is now **All Tasks**, and Issues, Pull requests and Projects are back at the top
  level of the sidebar, right after it.
- In the window, the **Label** dropdown on Issues and Pull requests is replaced by the
  filter bar. The top-bar menus keep their label filter.
- The preview's comment box stays at the bottom of the panel while the comments scroll.

## [0.6.0] - 2026-11-18

### Added

- **Tasks**: one list at the top of the window with everything assigned to you, from every
  account: issues, pull or merge requests and project drafts, newest first. Icons tell them
  apart. Filter it like a tag search: **+ Filter** adds a kind (Issues, Pull requests,
  Projects) or an assignee (one of your accounts), each filter shows as a chip with **×**, and
  **Clear filters** removes them all. Click a task to open it in your browser. Issues, Pull
  requests and Projects now sit under Tasks in the sidebar, collapsed until you open them.

### Removed

- The outdated screenshots on the home page, in the README and in the install guide. New ones
  will follow once the window settles.

## [0.5.0] - 2026-11-18

### Added

- When you log in and a newer version is out, a notification says so with short release
  notes. **Install** opens the window and starts the update, as **Update available** does.
  Turn it off with **Check for updates** in Settings → System Start.
- Repository headings in the lists collapse: click one to hide or show its issues or pull
  requests, in the window and in the top-bar menus alike. Project boards in the window's
  Projects list collapse the same way. The heading keeps its count, Source Glance remembers
  what you collapsed, and a search shows matches in collapsed repositories too.
- A **Wallpaper** section in Settings → Desktop Widgets recommends Adwaita, GNOME's default
  wallpaper (from GNOME Backgrounds), to go with the cards, with a preview. **Apply** sets it
  and keeps yours; **Reset** puts yours back. If you change the wallpaper any other way, Reset
  isn't offered any more, only Apply.
- **Several accounts.** Add more than one GitHub or GitLab account under Settings → Accounts,
  for example a personal and a work account. Each account gets its own collapsible section in
  the lists and the top-bar menus, and comments, closing, labels and assignees run as the
  account the item came from. Your existing GitHub and GitLab sign-ins carry over without
  signing in again.
- **Self-hosted instances.** **Connect a self-hosted instance** adds GitLab self-managed or
  GitHub Enterprise Server. Source Glance checks the address really is that platform, then
  signs in in the browser (with an app you register on the instance; GitLab 17.1 or later)
  or with a personal access token. It uses `https://`, or plain `http://` only for an
  instance on your local network, checked every time it connects.
- **Personal access tokens** for every platform, next to signing in in the browser. Each
  sign-in option says which repositories it reaches: only yours and your organizations', or
  everything you can view.

### Changed

- The app is now called **Source Glance** everywhere you see its name: the top bar, the window,
  the app grid, Setup and the home page.

### Fixed

- The window now shows as Source Glance in the dock and in Alt+Tab, with its own icon, instead
  of as GNOME's Extensions app. It opens in Source Glance's own app; opening it again brings the
  open window forward.

## [0.4.2] - 2026-11-17

### Fixed

- An item's actions in the top-bar lists (Open, Comment, Close, Assignees, Labels, status) no
  longer get clipped to a sliver when the list is taller than the screen. Clicking an issue,
  pull request or draft now opens its actions in a menu beside the list, and long lists
  scroll ([ac52b0b](https://github.com/omer-gh/sourceglance/commit/ac52b0b218bc5b55e81aee21e03e178edd730d56)).

## [0.4.1] - 2026-11-16

### Fixed

- Setup no longer tries to restart sourceglance when a development build (`make reload`) was
  installed: GNOME Shell may still be running that build's loader, so the restart left
  sourceglance in an error state until the next login. Setup now asks you to log out instead.

## [0.4.0] - 2026-11-16

### Changed

- The search box sits on the right of the window's title bar and is always shown, on every
  page. Searching from a settings page opens the first list; clearing the search restores
  every list's results and counts and keeps the list you're on (or opens the first list).

## [0.3.0] - 2026-11-16

### Added

- **Update available** in the window's title bar when a newer version is out. Clicking it
  downloads the new Setup for your PC, checks it against the release's `SHA256SUMS`, and
  opens it only if it matches; when Setup finishes, the window reopens on the new version.
  Turn the check off in Settings → System Start → **Check for updates**.
- **Updates without logging out**: Setup installs each version in its own folder behind a
  small loader, and restarts sourceglance after updating, so the new version runs straight
  away. Coming from v0.2.0 or earlier, log out once after this first update.
- An **Update, repair or remove** section on the home page.
- **Search** in the window's title bar: filter Issues, Pull requests and Projects by title,
  repository, number, label, person or board status. The sidebar counts and the title bar
  show the matches; clear the box, press Esc or click **Clear search** to see everything
  again. Start typing on a list, or press Ctrl+F, to search.

### Changed

- **Accounts** is one page under Settings, with **GitHub** and **GitLab** as its sections,
  instead of two sidebar entries.
- When GitHub refuses a change (comment, close, labels, assignees, status), sourceglance now
  says why: the sourceglance app isn't installed on that repository, or you don't have
  permission, and you can make the change on GitHub instead. Public repositories you don't
  own show up without the app; changing them needs the owner to install it.

## [0.2.0] - 2026-11-16

### Added

- **About sourceglance** in the sourceglance menu, and an **About** page in the window:
  the version, the author (Mohammad Omer, [@omer-gh](https://github.com/omer-gh)), and links
  to **Report an issue**, **Fork and contribute**, the contributing guide, the home page,
  source code, release notes and license.
- The README and home page invite you to report issues and to contribute by forking the
  repository and opening a pull request.
- Screenshots of the desktop widgets, top-bar menu and main window in the README and on the
  home page.

## [0.1.0] - 2026-11-16

### Added

- **Sign in with GitHub** in Settings, using the device flow: sourceglance copies a code
  and opens GitHub, you approve, done. It uses a GitHub App limited to issues, pull
  requests and project boards, on the repositories you choose: no code or settings access.
- **Pull requests** in the menu: open PRs assigned to you or awaiting your review.
- **Top-bar buttons** for Issues, Projects, Pull requests and sourceglance, each with its own
  count, as separate icons or as tabs in one menu (Settings → Top bar), where you also choose
  which lists to show.
- **Projects list**: draft items on your personal and organization project boards, grouped
  by status, with **Move to status…**.
- The Issues and Pull requests lists always end with how many closed items are still
  assigned to you, linking to them on GitHub.
- **Start automatically** and **Quit** at the bottom of the sourceglance menu. Quit hides
  sourceglance and stops refreshing until you choose **Start now** in Settings.
- **sourceglance window** (the app icon, or Settings): a sidebar with your Issues, Pull
  requests and Projects, with counts and the same actions as the menus, and the settings
  pages (Desktop Widgets, System Tray, Accounts, System Start), in the top-bar blue.
- **GitLab (gitlab.com)**: sign in from the window (Settings → Accounts → GitLab, device
  flow). Your GitLab issues and merge requests appear in their own collapsible section of
  each list, menu and widget, with the same actions; counts add up across both.
- **Desktop widgets**: Summary, Issues, Pull requests and Projects cards on the desktop,
  below your windows and above desktop icons. Drag them by their header; choose cards and
  opacity in Settings → Desktop Widgets.
- **Splash window** when sourceglance starts from its app icon, with its version and the
  start-up steps.
- **App icon** in the app grid and dock: starts sourceglance (also after Quit) and opens its
  Settings. Turn it off with Settings → Top bar → Show in app grid.
- **Filter by label**: a dropdown on the Issues and Pull requests headings shows only items
  with the chosen label. The menu stays open while you pick.
- **Actions from the top bar** on every issue and PR: comment, close (with confirmation)
  and reopen from **Recently closed**, edit assignees and labels, and move it between
  statuses on its project boards.
- The sign-in is validated and stored in the GNOME keyring. Sign out removes it.
- When nothing is found, the menu hints that sourceglance only sees the repositories it was
  given.
- The top-bar menu lists your open assigned issues, grouped by repository, newest first,
  with a "View all on GitHub" link. Click an issue to open it in your browser.
- The top-bar icon shows how many open issues are assigned to you.
- Optional list of repositories to watch.
- Auto-refresh on a configurable interval, plus a manual **Refresh** item. Waits for
  GitHub's rate-limit reset when needed.
- Clear menu messages when signed out, loading, empty, or when GitHub can't be reached.
- **sourceglance Setup**: a double-clickable installer (AppImage) with an MSI-style wizard —
  license agreement, system check, progress with automatic rollback, and Repair / Remove
  when run again. Also scriptable from the command line. See
  [Installing sourceglance with Setup](docs/installing.md).
- `tools/preview.sh` to preview locally in a nested GNOME Shell or your own session,
  with one-time setup, a risk warning and MIT License agreement.
- Project docs: contributing guide, issue and PR templates, release process.

### Security

- Only `https://github.com/` links from GitHub data can be opened from the menu.
- Writes only happen from a menu action. Repository names, numbers, logins, label names
  and project IDs are validated before they reach a request.
- The token lives only in the GNOME keyring and is never logged.

[Unreleased]: https://github.com/omer-gh/sourceglance/compare/v0.18.0...HEAD
[0.18.0]: https://github.com/omer-gh/sourceglance/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/omer-gh/sourceglance/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/omer-gh/sourceglance/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/omer-gh/sourceglance/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/omer-gh/sourceglance/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/omer-gh/sourceglance/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/omer-gh/sourceglance/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/omer-gh/sourceglance/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/omer-gh/sourceglance/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/omer-gh/sourceglance/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/omer-gh/sourceglance/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/omer-gh/sourceglance/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/omer-gh/sourceglance/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/omer-gh/sourceglance/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/omer-gh/sourceglance/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/omer-gh/sourceglance/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/omer-gh/sourceglance/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/omer-gh/sourceglance/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/omer-gh/sourceglance/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/omer-gh/sourceglance/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/omer-gh/sourceglance/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/omer-gh/sourceglance/releases/tag/v0.1.0
