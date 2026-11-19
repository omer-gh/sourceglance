# 0006. Build the Windows and macOS apps with Tauri 2, sharing the pure core

- **Status:** Accepted (2026-11-19, with the `desktop/` scaffold in #10)
- **Date:** 2026-11-16

## Context

sourceglance runs only on GNOME Shell ([ADR 0001](0001-gnome-shell-extension.md)). We want
Windows and macOS versions with the same experience: counts in a bar at the top of the
screen, flyouts in our own blue theme with the same actions, and desktop widgets. The plans
are in [#9](https://github.com/omer-gh/sourceglance/issues/9) (Windows: a Rainmeter-style
bar and widgets) and [#10](https://github.com/omer-gh/sourceglance/issues/10) (macOS: menu
bar, popovers and widgets).

Forces:

- **The UI must keep our theme.** Native tray menus can't be tinted, so the flyouts and
  widgets are our own frameless windows on both platforms. That favours a web UI.
- **Some native code is unavoidable on each platform:** the Win32 AppBar and desktop pinning
  on Windows, window levels and `collectionBehavior` on macOS, plus Credential Manager and
  Keychain.
- **The logic already exists.** `src/lib/model.js`, `gitlabModel.js`, `requests.js`,
  `loader.js`, `gitlabLoader.js` and `updates.js` have no GNOME imports and are tested with
  Node ([ADR 0004](0004-pure-core-for-testing.md)). Rewriting them per platform would split
  the behaviour.
- **sourceglance runs all day,** so memory use and install size matter.
- **One maintainer:** the fewer languages and toolchains, the better.

## Options considered

1. **Tauri 2** (Rust core + the system webview: WebView2 on Windows, WKWebView on macOS)
   - Pros: runs our JavaScript core unchanged; installers are around 10 MB and memory use is
     low. Rust has direct access to Win32 and AppKit (`windows`, `objc2`) for the native
     pieces. Built-in tray, updater (signed manifests), autostart and bundlers (NSIS/MSI,
     DMG with notarization), plus a capability allowlist that limits what the webview can
     call.
   - Cons: adds Rust to the project. The two webviews differ slightly in rendering. The
     tray APIs are younger than Electron's.
2. **Electron**
   - Pros: most mature tray and window APIs, one Chromium everywhere, all JavaScript.
   - Cons: installers around 100 MB and much more memory, for an app that idles in the
     background. Native pieces still need C++ Node add-ons, which is harder than Rust. Its
     `type: 'desktop'` windows don't receive clicks, so the macOS widgets need native code
     anyway.
3. **Fully native per platform** (C# / WinUI 3 on Windows, Swift / AppKit + SwiftUI on macOS)
   - Pros: best platform fit; WidgetKit and AppBar are first-class.
   - Cons: two more languages and two UIs to build and keep in sync. The pure core would be
     reimplemented twice or run through an embedded JavaScript engine.
4. **Cross-platform native UI** (Flutter, Avalonia, .NET MAUI)
   - Pros: one UI codebase.
   - Cons: a new language with no reuse of the core, a weak story for tray and desktop
     windows, and it still needs native interop for the hard parts.

## Decision

Option 1: one **Tauri 2** app for Windows and macOS, in a new `desktop/` folder. Linux stays
a GNOME Shell extension; this ADR doesn't change ADR 0001.

1. **Shared core, no copies.** The desktop UI imports the pure modules from `src/lib` through
   a bundler alias (Vite). `src/lib` remains their only home, so a fix lands on every
   platform and the existing Node tests cover all three. Pure modules must stay free of
   GNOME *and* Tauri imports; ESLint enforces both.
2. **Platform adapters behind the existing interfaces.** The UI talks to small adapters
   with the same shape as `GitHubClient`, `GitLabClient` and `TokenStore`. On GNOME they
   stay on Soup 3 and libsecret. In Tauri they call Rust commands.
3. **Network and secrets live in Rust, never in the webview.**
   - Requests go through `reqwest`, which also gets around GitHub's device-flow endpoints not
     allowing CORS.
   - Tokens go through the `keyring` crate (Windows Credential Manager / macOS Keychain),
     one entry per account id. Rust adds the `Authorization` header itself, and tokens are
     never returned to JavaScript.
   - Requests go only to `https://api.github.com`, `https://github.com`,
     `https://gitlab.com` and the self-hosted instances the user added. The user picks
     those, so a static Tauri capability list can't cover them: Rust checks every request
     against the account list, with the network rules of
     [ADR 0007](0007-multiple-accounts-and-self-hosted-instances.md) (no redirects on
     self-hosted instances, plain `http://` only to local-network addresses, re-checked and
     pinned on every request).
   - The same GitHub App and GitLab client IDs and scopes as on Linux (`src/lib/config.js`).
4. **Locked-down webview.**
   - It loads only bundled files, never remote content.
   - A strict CSP.
   - Only the Tauri plugins we use are enabled; the shell, fs and http plugins are not
     exposed to JavaScript.
   - Links open in the default browser through one Rust command that accepts only links
     on github.com, gitlab.com or a signed-in account's own instance, as on Linux.
5. **Native code is isolated per platform:** `desktop/src-tauri/src/windows/` (AppBar,
   desktop pinning) and `desktop/src-tauri/src/macos/` (status-item images, window levels,
   later the WidgetKit snapshot). Each one exposes a few commands and falls back cleanly if
   a technique stops working.
6. **One version, one release.** The desktop app shares the version number in
   `package.json`. `release.yml` builds the Linux AppImages, the Windows per-user NSIS
   installer and the signed, notarized universal macOS `.dmg` from the same tag, plus
   `SHA256SUMS`, provenance attestations and Tauri's signed update manifest.

## Consequences

- The Windows and macOS apps get our exact look, and the core logic is written and tested
  once.
- Rust and a Cargo toolchain join the project: CI needs `windows-latest` and `macos-latest`
  jobs, `cargo clippy` / `cargo test`, and Dependabot for Cargo.
- The GNOME extension keeps its own UI (St widgets). UI code (menus, cards, window) isn't
  shared, only logic. Feature work touches two UIs, and issues should say which ones.
- The webviews differ (Chromium-based WebView2 vs. WebKit), so the desktop UI sticks to
  widely supported CSS and is checked on both.
- New secrets to manage: the Tauri updater signing key, Apple Developer ID and notarization
  credentials, and a Windows signing identity if we add one (open questions in #9 and #10).
- The threat model gains entries for the Rust command surface, the webview, the update
  channel and the macOS App Group snapshot.
- Revisit this ADR if Tauri's tray or window APIs block the plans in #9 and #10, or if
  WidgetKit grows enough to justify moving the Mac version to native Swift (option 3).
