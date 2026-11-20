# Development setup

## Prerequisites

```bash
sudo apt install gnome-shell-extension-prefs zip make nodejs npm
```

Then install the lint tooling once:

```bash
npm install
```

## Project layout

```
src/
├── extension.js      # Lifecycle and refresh loop: created in enable(), destroyed in disable()
├── prefs.js          # The window, when GNOME's Extensions app opens it (window/app.js)
├── launcher.js       # Source Glance's own app (gjs): start it, open the window (window/app.js)
├── lib/
│   ├── config.js     # Build-time config: GitHub App and OAuth App client IDs
│   ├── indicator.js  # A top-bar button: icon, count and menu (pure view: render(state))
│   ├── views.js      # What each list shows: issues, projects, PRs, sourceglance
│   ├── tabs.js       # The tab row for the "tabs in one menu" layout
│   ├── appLauncher.js # Writes/removes the app icon's .desktop file
│   ├── widgets.js    # Desktop widget cards (desktop layer, drag, positions)
│   ├── actions.js    # Menu actions: dialog → requests → notification
│   ├── dialogs.js    # Comment, close and picker dialogs (ModalDialog)
│   ├── github.js     # GitHub REST/GraphQL client (github.com or Enterprise Server) and sign-in (Soup 3)
│   ├── gitlab.js     # GitLab client (gitlab.com or self-managed): device flow, token refresh, lists, writes
│   ├── accounts.js   # Pure account list logic: ids, migration, instance checks (unit-tested)
│   ├── accountStore.js # Account list in GSettings, secrets in the keyring, per-account clients
│   ├── transport.js  # Requests to one instance; http:// only to checked LAN addresses
│   ├── updateNotice.js # The update notification at login
│   ├── updates.js    # Pure update check and release-notes summary (unit-tested)
│   ├── updater.js    # Downloads, verifies and runs the new Setup
│   ├── wallpaper.js  # The recommended wallpaper: Apply, Reset, forget the saved copy
│   ├── gitlabModel.js # Pure GitLab parsing and request builders (unit-tested)
│   ├── markdown.js   # Pure Markdown formatting for the comment editor's toolbar (unit-tested)
│   ├── requests.js   # Write and preview requests for either platform
│   ├── tokenStore.js # Token in the GNOME keyring (libsecret)
│   └── model.js      # Pure logic, no GNOME imports, unit-tested with Node
├── window/           # The window: app.js builds it, mainWindow.js (sidebar: primary column and
│                     # docked submenu), actions.js (dialogs, preview, chips), headerButtons.js
│                     # (Refresh with its problem note, Accounts), i18n.js, pages/ (Glance, All
│                     # Tasks, lists, Settings with About, accounts wizard; rows in common.js,
│                     # the filter bar in filterBar.js)
├── metadata.json     # UUID, name, supported GNOME Shell versions
├── stylesheet.css    # Styles for the panel menu
├── icons/            # Symbolic icons: sourceglance, checklist (projects), pull request
└── schemas/          # GSettings schema (non-secret settings only)
tests/                # Node unit tests for lib/model.js
tools/shell-smoke.sh  # Headless GNOME Shell enable/disable smoke test
```

See [architecture.md](architecture.md) for how the pieces fit together.

## Tests

```bash
make test        # unit tests for src/lib/model.js (Node 20+)
```

```bash
make smoke       # enable/disable 10× in an isolated headless GNOME Shell
```

`make smoke` runs its own D-Bus session with in-memory settings, so it doesn't touch your
desktop. It checks the extension loads and unloads cleanly in the signed-out state; test
the signed-in flow by hand in a nested session (below) with your own token.

## Preview script (recommended)

`tools/preview.sh` handles the one-time setup and starts a preview:

```bash
./tools/preview.sh
```

```bash
./tools/preview.sh --session
```

| Mode | What it does | Use it for |
| ------ | -------------- | ------------ |
| default (`--nested`) | Starts a second GNOME Shell in a window and enables sourceglance there. Its settings live in `~/.cache/sourceglance-preview`, so your real session isn't changed. | Checking the menu, states and settings UI safely |
| `--session` | Installs and enables sourceglance in your real desktop session | Testing sign-in (the nested session can't reach your keyring) |

Before doing anything, the script explains the risks, shows the Apache License 2.0 and its
no-warranty terms, and asks you to type **I agree**. It installs missing packages
(`mutter-dev-bin` on GNOME 49+) with `sudo apt install` only after asking. Run
`./tools/preview.sh --help` for all options.

## Screenshots

The images in `docs/images/` (used by the README and the home page) are made from invented data, never from
a real account:

```bash
tools/screenshots/run.sh
```

It generates the made-up lists and settings (`tests/fixtures/screenshots/`), then draws the window's pages to
PNG files. It runs the window with an isolated settings file, no session bus (so no keyring) and in its own
network namespace, so nothing real can be read or sent. Look at every image before you commit it, keep each
under 300 KB, and add alt text where you use it ([writing docs](writing-docs.md)). To change what appears,
edit `tools/screenshots/make-fixture.js`.

## Setup wizard (installer)

The MSI-style installer lives in `tools/installer/` (design:
[installer.md](design/installer.md); user guide: [installing.md](installing.md)).

| Command | What it does |
| --------- | -------------- |
| `make setup-run` | Stage the payload and open the wizard from source. **It really installs** into your account; pass `ARGS=--check` to only run the checks. |
| `make setup-test` | Command-line install / upgrade / repair / remove test in an isolated home |
| `make setup` | Build `dist/sourceglance-Setup-<version>-{x86_64,aarch64}.AppImage` (needs `squashfs-tools`; downloads the pinned AppImage runtime and verifies its SHA-256) |

Decision logic is in `tools/installer/lib/plan.js` (no GNOME imports, tested by
`tests/setup-plan.test.js`). `tests/setup-screenshots.js` renders every page to PNG when
run inside a headless GNOME Shell with isolated `HOME`/`XDG_*` directories, for when the docs
need screenshots of it. Keep the wizard to GTK 4.14 / libadwaita 1.5 APIs so it
runs on GNOME 46.

## GitHub apps for sign-in

Both sign-in buttons use the OAuth device flow, which needs a registered app's client ID
in `src/lib/config.js`. Client IDs are public by design. Never generate a client secret
for these apps: device flow doesn't need one, and sourceglance can't keep one secret.

### GitHub App: "Sign in with GitHub" (default, issues, PRs and projects only)

1. Go to [github.com/settings/apps](https://github.com/settings/apps) → **New GitHub App**.
2. Name it (for example `sourceglance`). Use `https://github.com/omer-gh/sourceglance` for the
   homepage and callback URL. Device flow doesn't use the callback.
3. Uncheck **Expire user authorization tokens**: refreshing a token needs the client
   secret.
4. Check **Enable Device Flow**. Under **Webhook**, uncheck **Active**.
5. Permissions, and leave everything else at **No access**:
   - Repository: **Issues** and **Pull requests**: **Read and write**.
   - Repository: **Metadata**: **Read-only** (GitHub requires it: repository names and
     basic info).
   - Organization: **Projects**: **Read and write**, for organization project boards.

   This lets sourceglance comment on, close, label and assign issues and PRs and move
   project items. It can't touch code, so it can't merge PRs: merging needs **Contents:
   Read and write**, which also allows pushing code.
6. **Where can this GitHub App be installed?** Choose **Any account**, so owners of other
   repositories can install it for their collaborators.
7. Create it. Put the **Client ID** in `GITHUB_APP_CLIENT_ID` and the URL name from
   `https://github.com/apps/<slug>` in `GITHUB_APP_SLUG`.
8. Install it on your account and pick the repositories it may read. Settings links to
   this page as **Choose repositories**.

The app's token can never do more than these permissions, and only on repositories where
the app is installed. A collaborator's private repository needs its owner to install the
app.

### OAuth App: "Sign in with full access" (hidden)

This option and the personal access token are hidden in Settings: the GitHub App is the
only sign-in. Set `SHOW_OTHER_SIGN_IN_OPTIONS` in `src/lib/config.js` to `true` to show
them under **More sign-in options**, for example to compare during evaluation.

1. Go to [github.com/settings/developers](https://github.com/settings/developers) →
   **OAuth Apps** → **New OAuth App**.
2. Name it `sourceglance`. Use `https://github.com/omer-gh/sourceglance` for both the homepage
   and the callback URL.
3. Register it, then check **Enable Device Flow** and save.
4. Put the **Client ID** in `OAUTH_CLIENT_ID`.

It asks for the `repo` and `project` scopes, because OAuth Apps have no narrower scope for
issues in private repositories, and project boards need `project`. That reaches every
repository you can, including others' private ones, but allows writing to all of them.
sourceglance itself only writes to issues, PRs and project items, when you pick an action.

## Reload without logging out

On Wayland, GNOME Shell keeps an extension's code until you log out. To try changes in your
real session, with your real sign-in, use:

```bash
make reload
```

It copies `src/` into a new folder inside the installed extension and switches the
extension off and on, which takes about a second. A small loader (`tools/dev-loader/`)
imports each build from its new folder, so GNOME Shell runs the new code. To set up:

1. Run `make reload` once. The first time, your session is still running the code it
   loaded at login, so **log out and back in once more**. From then on, every
   `make reload` loads your latest code.
2. Changes to `metadata.json` still need a login.
3. `make install` puts the normal extension back. Old builds stay in the extension's `dev/`
   folder; delete it when you like.
4. Installed with Setup? Each build also goes into the extension's `versions/` folder (as
   X.Y.900001, X.Y.900002, …), so it runs right away even while your session still has
   Setup's loader from login, without logging out. Running Setup again puts a release back.

Each GObject class gets a type name that includes a hash of its module's URL
(`gtypeName()` in `model.js`), because a type name can't be registered twice in one
session.

## Run it locally by hand

```bash
make install     # compiles schemas and copies src/ to ~/.local/share/gnome-shell/extensions/
```

On **Wayland** (the Ubuntu default) you can't restart GNOME Shell in place. Test in a
nested session instead, so a crash doesn't take down your desktop:

```bash
# GNOME Shell 49+
dbus-run-session gnome-shell --devkit
# GNOME Shell 46–48
dbus-run-session -- gnome-shell --nested --wayland
```

Inside the nested session, open a terminal and run:

```bash
gnome-extensions enable sourceglance@omer-gh.github.io
```

On **X11**, press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, and press Enter to reload.

## Debugging

- Extension logs: `journalctl -f -o cat /usr/bin/gnome-shell`
- Preferences logs: `journalctl -f -o cat /usr/bin/gjs`
- Open the window: `gjs -m ~/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io/launcher.js --open`
  (for a Setup install, `versions/<version>/launcher.js`)
- Looking Glass inspector: <kbd>Alt</kbd>+<kbd>F2</kbd>, then `lg`

## Before opening a PR

```bash
make lint
```

```bash
make test
```

```bash
make smoke
```

```bash
make pack        # builds dist/sourceglance@omer-gh.github.io.shell-extension.zip
```

Then check that enabling and disabling the extension several times leaves no errors in the
log and no leftover icons in the panel.
