# Threat model

Reviewed for every minor release and whenever a PR touches authentication, networking,
storage, or anything rendered from GitHub or GitLab data. Last reviewed: **2026-11-20
(Unreleased: the macOS app, a new platform with its own process, storage and network code:
see T34–T42; v0.14.0: an optional sync server: sign-in (device flow), sync of personal-access-token accounts and a fixed list of settings, and the AI instructions, see T30 to T33; v0.13.0: read-only lookups of organization and group names and of the organizations an account belongs to (GraphQL `viewer.organizations`, `/user/orgs`, GitLab `/groups`) and, only for sign-ins that already have repository access (a personal access token or full access, never the default GitHub App), each repository's `.gitmodules`; all with the same tokens and scopes, only to the account's own instance; no new permission or scope is requested and the default GitHub App still cannot read code; the names you choose for organizations and projects are plain text in GSettings, checked before use, and never sent to a platform; v0.12.1: development tooling only (make reload); no change to the extension; v0.12.0: custom fields in the window's ⋮ menu write GitHub issue fields, project board fields and GitLab custom fields through GraphQL mutations, from a menu action only, with every value passed as a GraphQL variable; the window's lists also read everything open in your repositories and organizations (GitLab: your 10 most active projects), with the same tokens and scopes; custom widgets are kept in settings as JSON and checked field by field (cleanCustomWidget) before use; no new network hosts or token scopes; v0.11.0: license change only (Apache License 2.0); no new data, settings or network access; v0.10.0: the window's new layout; comment avatars show initials from logins and the failed-load note shows account names, both as plain text, see T6; no new data, settings or network access; v0.9.0: the window's preview renders Markdown from GitHub and GitLab through lib/markdown.js, see T6; Quit uses a new internal setting; v0.8.0: fixed top-bar menu width, no change to the model; v0.7.0: the window's preview shows descriptions, comments and reactions, and label colours
reach CSS: see T6 and T28; v0.6.0: the Tasks list, no change to the model: it opens links through the same checks;
v0.5.0: several accounts and self-hosted instances,
[ADR 0007](../adr/0007-multiple-accounts-and-self-hosted-instances.md); update notice at
login; recommended wallpaper)**.

## What we protect

| Asset | Why it matters |
| ------- | ---------------- |
| **Tokens** (GitHub, GitLab, one per account, on github.com, gitlab.com or self-hosted instances) | Grant access to the user's repositories; leaking one is the worst outcome. Personal access tokens stay valid until the user revokes them. |
| **The user's desktop session** | The extension runs inside GNOME Shell with the user's full privileges. A crash freezes the desktop; malicious code could do anything the user can. |
| **Private repository data** | Issue titles and repo names from private repos must not leave the machine except to the instance they came from. |

## Trust boundaries

```
 user ──▶ Settings (gjs process) ──▶ GNOME keyring (libsecret)
                     │                       ▲
                     ▼                       │
 GNOME Shell process (extension) ────────────┘
          │  HTTPS (Soup 3, system CA store); each account's client talks only to its instance
          ▼
   api.github.com, gitlab.com, and instances the user added
   (https://, or http:// only to LAN addresses checked per connection)
          │
          ▼
   issue data rendered in the panel menu and the window
```

API responses are **untrusted input**: issue titles and URLs are written by other people. A
self-hosted instance is trusted only as much as the user trusts its operator: it receives
that account's token and nothing else.

## Threats and mitigations

| # | Threat | Mitigation | Status |
| --- | -------- | ------------ | -------- |
| T1 | Token read from disk or backups | Stored only in the GNOME keyring ([ADR 0002](../adr/0002-token-in-gnome-keyring.md)); never in GSettings/dconf or files | ✅ v0.1 |
| T2 | Token leaked in logs, errors, issues or screenshots | Errors carry only kind + HTTP status; token never logged; Settings clears the field after saving; issue templates remind users to scrub logs | ✅ v0.1 |
| T3 | Token sent to the wrong host / intercepted | Requests go only to `api.github.com`, `gitlab.com` and instances the user added; each account's token goes only to its own instance; Soup verifies TLS with the system CA store | ✅ v0.1, extended by ADR 0007 |
| T4 | Over-privileged token | Docs and Settings recommend a fine-grained, read-only token (Issues + Metadata) | ✅ v0.1 |
| T5 | Search-query injection via the repository filter | Repo names validated against `owner/name` before building `repo:` qualifiers | ✅ v0.1 |
| T6 | Markup injection from issue titles | Titles rendered as plain text (`St.Label` without markup); in the window, titles, descriptions, comments, label names and logins are plain `Gtk.Label`s and tooltips, never Pango markup; the preview renders descriptions and comments as Markdown through `lib/markdown.js`, which escapes every bit of source text before adding its own tags, drops HTML, keeps only http(s) links (opened through the same safe-link check) and falls back to plain text if Pango rejects the result | ✅ v0.1, extended v0.7, v0.9 |
| T7 | Malicious link opened from an issue | Only links on `https://github.com/`, `https://gitlab.com/` or a signed-in account's own instance are opened (`isSafeLink`, `isSafeAccountUrl`) | ✅ v0.1, extended by ADR 0007 |
| T8 | Desktop freeze from blocking I/O or leaks | All I/O async and cancellable; everything released in `disable()`; smoke test enables/disables 10× | ✅ v0.1 |
| T9 | Rate-limit abuse / hammering GitHub | Minimum 1-minute interval, debounced settings changes, honours rate-limit reset | ✅ v0.1 |
| T10 | Supply-chain compromise | No runtime dependencies beyond GNOME libraries; dev-only npm deps; Dependabot, dependency review and CodeQL in CI; GitHub Actions pinned to commit SHAs | ✅ v0.1 |
| T11 | Compromised release artifact | Releases built by CI from a tag on `main`; only maintainers can tag | ✅ v0.1 |
| T12 | Secrets committed to the repo | GitHub secret scanning with push protection | ✅ v0.1 |
| T13 | Locked or unavailable keyring | Treated as signed out; no fallback to insecure storage | ✅ v0.1 |
| T14 | Tampered or corrupted setup file | Served over HTTPS from GitHub Releases; `SHA256SUMS` and build provenance attestation published; the wizard checks its embedded payload hash (catches corruption — tampering is caught by the checksum/attestation step the README describes) | 📋 planned (installer) |
| T15 | Setup run as root writes root-owned files or changes the system | Refuses to run as root; installs only under the user's home | 📋 planned (installer) |
| T16 | Command injection or unsafe temp files in the wizard | External tools run via `Gio.Subprocess` with argument arrays (never a shell string); private temp directory created with mode 0700 and cleaned up; ESLint in CI | 📋 planned (installer) |
| T17 | Setup changes more than it says | Ready page lists every change; touches only the extension directory and enabled-extensions; Remove extras are opt-in; failed installs roll back | 📋 planned (installer) |
| T18 | Users learn to allow and run unverified programs | README shows verify-then-run and to allow only files from this repo's Releases; `--appimage-extract` / `--extract` let users inspect contents | 📋 planned (installer) |
| T19 | Compromised AppImage build tools | `appimagetool` and the AppImage runtime pinned to exact versions and verified by SHA-256 in the release workflow | 📋 planned (installer) |
| T20 | Token sent to a host the user didn't mean | Self-hosted addresses come only from the user, are normalized (`parseInstanceUrl`: no credentials, query or path tricks) and must answer as the chosen platform before sign-in; data never adds hosts | ✅ ADR 0007 |
| T21 | Token crosses the network in clear text | HTTPS required, except for instances on the local network: an IP address must be loopback, private or link-local (`isLanAddress`); the wizard warns that the token crosses the LAN unencrypted | ✅ ADR 0007 |
| T22 | DNS rebinding: an http:// name later resolving to a public address | Before every request, the name is resolved and **all** addresses must be LAN addresses; the connection is pinned to the checked address (Soup `remote-connectable`), so a changed answer can't redirect it | ✅ ADR 0007 |
| T23 | A redirect carries the token to another host | Requests to self-hosted instances don't follow redirects | ✅ ADR 0007 |
| T24 | A lookalike or hostile instance | Only receives the token for the account added there; its links can only open on its own address; its data is rendered as plain text like any other | ✅ ADR 0007 |
| T25 | Tokens with more reach than needed, or left valid after sign-out | Each sign-in method states what it reaches; token pages pre-fill the scopes needed; signing out says a personal access token stays valid until revoked | ✅ ADR 0007 |
| T26 | Release notes from GitHub shown in the update notification | Fetched anonymously from this repo's releases API only; cut to short plain-text first sentences (`releaseNotesSummary`) and shown without markup; Install runs the existing download-and-verify flow (T14), never a URL from the notes | ✅ v0.5 |
| T27 | Source Glance changing the desktop wallpaper | Only on Apply or Reset in Settings; only the six `org.gnome.desktop.background` keys, set to fixed values (Adwaita from the system's gnome-backgrounds) or the user's own saved values; the saved copy is dropped as soon as the wallpaper changes any other way | ✅ v0.5 |
| T28 | CSS injection from a label colour | Label colours reach the window's CSS only as six hex digits (`parseLabels`, `parseGitLabLabels`, `labelTextColor`); anything else gets the neutral chip | ✅ v0.7 |
| T29 | Text from an issue steering the AI assistant | The assistant is opt-out (Settings → AI assistant, None turns it off) and only starts a command-line agent the user installed, with an argument array (never a shell string). A working session gets the item's title and link plus a cut-down description and latest comments (read with the user's own sign-in), tells the agent to treat them as information, and runs where the user watches it (the agent's own terminal or app) under the agent's own permission prompts. A comment suggestion runs once with no tools (`--tools ""` / read-only sandbox), in the temp folder, is stopped after two minutes, and only fills the comment box: nothing is posted until the user presses Comment. The repository folders are plain text in GSettings, used only as a working directory | ✅ v0.14.0 |
| T30 | A sync server (or someone pretending to be one) misusing what the app sends or sending bad data | Nothing is sent until you sign in; the address must be https:// (http:// only for localhost, 127.0.0.1 and ::1); redirects are never followed; the sign-in page must stay on the server's own address and its link carries no code (you paste the app's code there yourself, which also shows the page is for the app in front of you); every answer is parsed field by field (`lib/sync.js`) before use and shown as plain text; only personal-access-token accounts and a fixed list of settings are sent | ✅ v0.14.0 |
| T31 | The sync sign-in token leaking | Kept only in the GNOME keyring, never in settings or logs; the server stores only its SHA-256, shows each device on the web and revokes any at once; signing out revokes it | ✅ v0.14.0 |
| T32 | Sync deleting an account because its token can't be read | An account whose token can't be read (locked or cleared keyring) counts as still present: it is never removed on the server or sent; an account removed on the server is kept here and not sent again | ✅ v0.14.0 |
| T33 | A fork changing what an agent is told, unseen | The instructions come from the sync server and are shown in Settings → AI assistant; the AI buttons are off without them. A client check can't stop a determined fork (anyone can edit their own copy), so the protection is that official builds fetch signed-in instructions you can read, not that forks can't | ✅ v0.14.0 |
| T34 | macOS: token read by the app's web page (script injection, a bad dependency) | Tokens live only in the Rust process and the login Keychain (service `io.github.omer-gh.sourceglance`); JavaScript gets references (`account:<id>`, `pending:<n>`) and Rust adds the `Authorization` header; OAuth answers have the token swapped for a reference and the refresh token removed; webview headers can't set `Authorization`, `Cookie`, `Host` or `Proxy-*` | ✅ macOS (ADR 0006) |
| T35 | macOS: the web page sends a saved token to another host | A saved sign-in only goes to the instance named in its account id, not the editable account list; list entries whose instance differs from their id are dropped; a pending sign-in only goes to the instance it came from (`secrets.rs`, `settings.rs`) | ✅ macOS (ADR 0006) |
| T36 | macOS: the web page reaches arbitrary hosts | Rust sends requests only to github.com, gitlab.com and the accounts' instances, and keeps each on its instance; an address typed into the sign-in form is reachable for 10 minutes, read-only except the OAuth sign-in endpoints, four at most; read-only lookups of organization and group names go to the account's own instance with its sign-in, the same as on Ubuntu (GitHub `GET /users/{login}`, GraphQL `viewer.organizations`, `GET /user/orgs`; GitLab `GET /groups?min_access_level=10&top_level_only=true`, `GET /groups/{path}`, `GET /users?username=`), the watch list's `GET /user/repos` (3 pages at most) and `GET /search/repositories?q=…&per_page=8`, and `.gitmodules` reads (GitHub `GET /repos/{owner}/{name}/contents/.gitmodules`, GitLab `GET /projects/{path}/repository/files/.gitmodules?ref=HEAD`) that are never sent for the default GitHub App sign-in, which can't read repository contents on purpose; the names, projects, watch list and hidden boards you set stay in the settings file as short plain text | ✅ macOS (ADR 0006) |
| T37 | macOS: plain-http, DNS rebinding and redirect rules (T21–T23) | Same rules in `net.rs` as `transport.js`: all resolved addresses must be LAN, the connection is pinned with reqwest `resolve`, environment proxies are ignored, self-hosted requests don't follow redirects; responses over 8 MB are refused while reading | ✅ macOS (ADR 0006) |
| T38 | macOS: malicious link or clipboard content | `open_link` only opens links on github.com, gitlab.com or an account's instance (T7); `copy_device_code` only copies text shaped like a device code | ✅ macOS (ADR 0006) |
| T39 | macOS: script injection in the app's windows | Strict CSP (no inline or remote scripts); API text is set with `textContent`, never `innerHTML` (ESLint rule); the windows get only the event permissions and dragging the window by its header, not the rest of the core window API, or the menu, shell or file APIs | ✅ macOS (ADR 0006) |
| T40 | macOS: users learn to open unsigned apps | Unsigned builds come only from this repo's CI; the install guide explains "Open Anyway" for this app only; signing and notarisation are planned | 📋 planned (signing) |
| T41 | macOS: the installer changes more than it says, or asks for admin rights | The `.pkg` only allows the current user's home (`enable_currentUserHome`, no system or other volumes), so it never asks for a password; its payload is only `Applications/Source Glance.app`; it has no install scripts; the bundle isn't relocatable, so it can't update a copy elsewhere; CI checks all of this with `desktop/tools/check-pkg.sh` and publishes `SHA256SUMS` | ✅ macOS (ADR 0006) |
| T42 | macOS: Uninstall deletes the wrong files | It refuses unless the app runs from an Applications folder; it moves the app to the Trash (recoverable) rather than deleting it; with "also remove" it clears only this app's Keychain items and folders named after its identifier (`io.github.omer-gh.sourceglance`); it asks first, in the window | ✅ macOS (ADR 0006) |

## Out of scope

- A compromised user account or desktop session (an attacker with the user's privileges can
  already read the keyring).
- Compromise of GitHub or GitLab itself, or of a self-hosted instance the user added (it
  holds that account's data anyway).

## When to update this document

Update the table in the same PR when you add a network call, a new place data is stored, a
new kind of data shown to the user, a new platform, or a new dependency.
