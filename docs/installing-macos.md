# Installing Source Glance on macOS

> **Status: in development** ([#10](https://github.com/omer-gh/sourceglance/issues/10)). The
> macOS app is built by CI on every change to `desktop/`, but there's no macOS release yet.

**Requirements:** macOS 13 Ventura or newer, on an Apple silicon or Intel Mac (one universal
download covers both).

## 1. Download

For now, download `sourceglance-macos-unsigned` from the latest successful
[Desktop (macOS) workflow run](https://github.com/omer-gh/sourceglance/actions/workflows/desktop.yml)
and unzip it to get the `.dmg`. Releases will put it on the
[home page](https://omer-gh.github.io/sourceglance/) and the Releases page.

## 2. Install

Open the `.dmg` and drag **Source Glance** into **Applications**.

## 3. Open it the first time (unsigned app)

Until the project has an Apple Developer ID, the app isn't signed or notarized, so macOS
blocks it the first time, like Windows SmartScreen does. To allow it once:

**macOS 15 Sequoia and later:**

1. Open **Source Glance** from Applications. macOS says it can't check it for malicious
   software. Click **Done** (not Move to Trash).
2. Open **System Settings → Privacy & Security**.
3. Scroll to **Security**. Next to "Source Glance was blocked to protect your Mac", click
   **Open Anyway**, and confirm with your password or Touch ID.
4. Click **Open Anyway** once more in the dialog that follows.

**macOS 13 Ventura and 14 Sonoma:** Control-click (or right-click) **Source Glance** in
Applications, choose **Open**, then click **Open** in the dialog.

macOS remembers your choice; after that, Source Glance opens like any other app.

## 4. Sign in

Click **Accounts**, then add GitHub or GitLab:

- **github.com / gitlab.com:** choose **Browser sign-in**. Source Glance copies a code and
  opens the sign-in page; paste the code and approve.
- **Your own instance** (GitHub Enterprise Server or GitLab self-managed): type its address,
  choose **Personal access token**, and paste a token.

Sign-ins are stored only in your login Keychain (as `io.github.omer-gh.sourceglance`), one
item per account, and never shown to the app's window.

## Removing it

Quit Source Glance and move it from Applications to the Trash. To also remove your sign-ins,
open **Keychain Access** and delete the items named `io.github.omer-gh.sourceglance`; the
settings are in `~/Library/Application Support/io.github.omer-gh.sourceglance/`.
