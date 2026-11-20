# Installing Source Glance on macOS

> **Status: in development** ([#10](https://github.com/omer-gh/sourceglance/issues/10)). The
> macOS app is built by CI on every change to `desktop/`, but there's no macOS release yet.

**Requirements:** macOS 13 Ventura or newer, on an Apple silicon or Intel Mac (one universal
download covers both).

## 1. Download

For now, download `sourceglance-macos-unsigned` from the latest successful
[Desktop (macOS) workflow run](https://github.com/omer-gh/sourceglance/actions/workflows/desktop.yml)
and unzip it. It has:

- `Source-Glance-X.Y.Z.pkg`: the installer (recommended);
- `Source Glance_X.Y.Z_universal.dmg`: the app on its own, if you'd rather drag it into
  Applications yourself;
- `SHA256SUMS`: check your download with `shasum -a 256 -c SHA256SUMS`.

Releases will put them on the [home page](https://omer-gh.github.io/sourceglance/) and the
Releases page.

## 2. Open the installer the first time (unsigned)

Until the project has an Apple Developer ID, the installer and the app aren't signed or
notarized, so macOS blocks the installer the first time, like Windows SmartScreen does. To
allow it once:

**macOS 15 Sequoia and later:**

1. Double-click the `.pkg`. macOS says it can't check it for malicious software. Click
   **Done** (not Move to Trash).
2. Open **System Settings → Privacy & Security**.
3. Scroll to **Security**. Next to "Source-Glance-X.Y.Z.pkg was blocked to protect your
   Mac", click **Open Anyway**, and confirm with your password or Touch ID.
4. Click **Open Anyway** once more in the dialog that follows. The installer opens.

**macOS 13 Ventura and 14 Sonoma:** Control-click (or right-click) the `.pkg`, choose
**Open**, then click **Open** in the dialog.

If you used the `.dmg`, do the same for **Source Glance** in Applications the first time you
open it. macOS remembers your choice.

The first time Source Glance reads your sign-in, macOS may ask whether it can use its
Keychain item. Click **Always Allow**. Because the app isn't signed yet, it asks again after
each update.

## 3. Install

The `.pkg` opens in Apple's **Installer**, which walks you through it like a Setup wizard on
Windows:

1. **Introduction:** what's about to happen.
2. **License:** the Apache License 2.0 and the `NOTICE`. Click **Agree**.
3. **Installation Type:** it installs **for you only**, into the **Applications** folder in
   your home folder (`~/Applications`), so no administrator password is needed.
4. **Install**, then **Summary**, which tells you how to open it.

The installer puts the app there and nothing else: no scripts, nothing outside your home
folder. Running a newer installer later updates it.

Using the `.dmg` instead: open it and drag **Source Glance** into **Applications**.

## 4. Sign in

Click **Accounts**, then add GitHub or GitLab:

- **github.com / gitlab.com:** choose **Browser sign-in**. Source Glance copies a code and
  opens the sign-in page; paste the code and approve.
- **Your own instance** (GitHub Enterprise Server or GitLab self-managed): type its address,
  choose **Personal access token**, and paste a token.

Sign-ins are stored only in your login Keychain (as `io.github.omer-gh.sourceglance`), one
item per account, and never shown to the app's window.

## Can't see it in the menu bar?

By default Source Glance adds four items to the menu bar, like the Ubuntu top bar: Source
Glance, Issues, Pull requests and Projects, each with its count in a blue pill. On a
MacBook with a notch, or with lots of menu-bar apps, macOS hides the items that don't fit,
and newer items go first.

- **Use one item instead:** open Source Glance from Spotlight (⌘ Space), click
  **Settings**, and set **Layout** to **Grouped**. You get one item with all the counts,
  and its popover has a tab per list. You can also untick lists you don't need under
  **Lists**.
- **Show hidden items (macOS 26 Tahoe):** open **System Settings → Menu Bar** and turn on
  the Source Glance items you want to keep.
- **Rearrange items:** hold ⌘ and drag a menu-bar item to move it, so the ones you use most
  sit closer to the right.

## Removing it

Open Source Glance, click **Settings**, then **Uninstall Source Glance…**. It turns off
starting at login, moves the app to the Trash and quits. Tick **Also remove my sign-ins from
the Keychain, and my settings** to remove those too; otherwise they stay for when you
reinstall. Your GitHub and GitLab accounts aren't touched either way: a personal access
token stays valid until you revoke it on the website.

To do it by hand instead: quit Source Glance and move it from Applications to the Trash. To
also remove your sign-ins, open **Keychain Access** and delete the items named
`io.github.omer-gh.sourceglance`; the settings are in
`~/Library/Application Support/io.github.omer-gh.sourceglance/`.
