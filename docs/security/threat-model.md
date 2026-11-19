# Threat model

Reviewed for every minor release and whenever a PR touches authentication, networking,
storage, or anything rendered from GitHub or GitLab data. Last reviewed: **2026-11-19
(Unreleased: the macOS app, a new platform with its own process, storage and network code:
see T29–T35; v0.12.1: development tooling only (make reload); no change to the extension; v0.12.0: custom fields in the window's ⋮ menu write GitHub issue fields, project board fields and GitLab custom fields through GraphQL mutations, from a menu action only, with every value passed as a GraphQL variable; the window's lists also read everything open in your repositories and organizations (GitLab: your 10 most active projects), with the same tokens and scopes; custom widgets are kept in settings as JSON and checked field by field (cleanCustomWidget) before use; no new network hosts or token scopes; v0.11.0: license change only (Apache License 2.0); no new data, settings or network access; v0.10.0: the window's new layout; comment avatars show initials from logins and the failed-load note shows account names, both as plain text, see T6; no new data, settings or network access; v0.9.0: the window's preview renders Markdown from GitHub and GitLab through lib/markdown.js, see T6; Quit uses a new internal setting; v0.8.0: fixed top-bar menu width, no change to the model; v0.7.0: the window's preview shows descriptions, comments and reactions, and label colours
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
| T29 | macOS: token read by the app's web page (script injection, a bad dependency) | Tokens live only in the Rust process and the login Keychain (service `io.github.omer-gh.sourceglance`); JavaScript gets references (`account:<id>`, `pending:<n>`) and Rust adds the `Authorization` header; OAuth answers have the token swapped for a reference and the refresh token removed; webview headers can't set `Authorization`, `Cookie`, `Host` or `Proxy-*` | ✅ macOS (ADR 0006) |
| T30 | macOS: the web page sends a saved token to another host | A saved sign-in only goes to the instance named in its account id, not the editable account list; list entries whose instance differs from their id are dropped; a pending sign-in only goes to the instance it came from (`secrets.rs`, `settings.rs`) | ✅ macOS (ADR 0006) |
| T31 | macOS: the web page reaches arbitrary hosts | Rust sends requests only to github.com, gitlab.com and the accounts' instances, and keeps each on its instance; an address typed into the sign-in form is reachable for 10 minutes, read-only except the OAuth sign-in endpoints, four at most | ✅ macOS (ADR 0006) |
| T32 | macOS: plain-http, DNS rebinding and redirect rules (T21–T23) | Same rules in `net.rs` as `transport.js`: all resolved addresses must be LAN, the connection is pinned with reqwest `resolve`, environment proxies are ignored, self-hosted requests don't follow redirects; responses over 8 MB are refused while reading | ✅ macOS (ADR 0006) |
| T33 | macOS: malicious link or clipboard content | `open_link` only opens links on github.com, gitlab.com or an account's instance (T7); `copy_device_code` only copies text shaped like a device code | ✅ macOS (ADR 0006) |
| T34 | macOS: script injection in the app's windows | Strict CSP (no inline or remote scripts); API text is set with `textContent`, never `innerHTML` (ESLint rule); the windows get only the event permissions, not the core window, menu, shell or file APIs | ✅ macOS (ADR 0006) |
| T35 | macOS: users learn to open unsigned apps | Unsigned builds come only from this repo's CI; the install guide explains "Open Anyway" for this app only; signing and notarisation are planned | 📋 planned (signing) |

## Out of scope

- A compromised user account or desktop session (an attacker with the user's privileges can
  already read the keyring).
- Compromise of GitHub or GitLab itself, or of a self-hosted instance the user added (it
  holds that account's data anyway).

## When to update this document

Update the table in the same PR when you add a network call, a new place data is stored, a
new kind of data shown to the user, a new platform, or a new dependency.
