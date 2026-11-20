# 0007. Support several accounts per platform and self-hosted instances

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

Source Glance had one GitHub sign-in (keyring entry `{account: "github.com"}`) and one
gitlab.com sign-in (`{account: "gitlab.com"}`). Every request went to `api.github.com` or
`gitlab.com`, and only links on those hosts could be opened (threat model T3 and T7).

People asked for three things:

- several accounts per platform, such as a personal and a work account;
- GitLab self-managed and GitHub Enterprise Server;
- Gitea and Forgejo, which are tracked in
  [#11](https://github.com/omer-gh/sourceglance/issues/11) and not part of this decision.

Self-hosted instances change the security model. The user now chooses hosts that receive a
token. Some of those hosts sit on a home or office network without HTTPS.

## Options considered

### Where the account list lives

1. **Keyring only.** List the accounts by searching the keyring. This needs no new setting,
   but it fails while the keyring is locked, and labels aren't meant to hold data.
2. **A GSettings list plus one keyring entry per account (chosen).** The list holds only
   non-secret fields: platform, instance, login, sign-in method and OAuth client ID. Each
   token stays in the keyring under the account's id, as [ADR 0002](0002-token-in-gnome-keyring.md)
   requires.

**How the lists show several accounts.** The user chose between these:

1. **One collapsible section per account (chosen; superseded in part by
   [ADR 0008](0008-flat-lists-and-settings-structure.md): lists no longer have account
   sections).** For example "GitHub · @alice",
   "GitLab · git.example.com · @bob".
2. One section per platform, with the accounts merged and the account shown on each row.

**Sign-in methods on each platform.** The user chose to offer every method a platform has, and
to say under each one which repositories it reaches:

1. Browser sign-in (OAuth device flow) only. That leaves out instances without an app
   registered for it.
2. **Both browser sign-in and a personal access token, wherever the platform offers each
   (chosen).**

**Plain http://.** The user asked for HTTPS everywhere, except instances on the local network.

1. HTTPS only.
2. http:// anywhere, after a warning.
3. **http:// only to the local network, checked on every connection (chosen).**

## Decision

### Accounts

- **The list.** The `accounts` GSettings key holds one JSON object per account:
  `{id, platform, base, login, method, clientId}`.
  - `base` is the instance, normalized by `parseInstanceUrl()` in `lib/accounts.js`, for example
    `https://github.com` or `https://git.example.com/gitlab`.
  - `method` is `device` or `pat`.
  - `clientId` is the OAuth app registered on a self-hosted instance. It is public by design and
    needed to renew GitLab tokens.
- **Tokens.** Each account's token lives in the keyring under `{account: id}`.
- **Ids of new accounts** look like `github:github.com:alice`. Signing in again as someone
  already listed replaces their sign-in and keeps their id.
- **Migration.**
  - The existing entries keep their ids, `github.com` and `gitlab.com`. When either is found in
    the keyring and isn't listed yet, it's added to the list (`migrateAccounts()`). Nothing is
    re-keyed or deleted, so nobody signs in again.
  - The collapse ids `issues:github` and `issues:gitlab` stay the same for these two accounts.
    Other accounts use their id.
  - The `repositories` filter keeps applying to github.com accounts.
- **Lists.** The state holds one *source* per account (`sourceFrom()`).
  - With a single account, the lists look as they did before, with no section header.
  - With several accounts, each has a collapsible section with its own count, label filter and
    closed-items footer.
  - Project boards are GitHub's, and each GitHub account's boards follow its name.
- **Acting as the right account.**
  - Each item and board carries its `accountId`, and actions use that account's client and token.
  - `itemKey()` puts the account id in front of the key for accounts added later, since two
    accounts can list the same item.
  - Items of the first two accounts keep their old keys.

**Platforms and sign-in.** github.com and gitlab.com keep Source Glance's own apps. Self-hosted
browser sign-in needs an app that the user registers on their instance; the wizard links to
the page where they register it. Source Glance doesn't support Gitea or Forgejo yet (#11).

What each method reaches, from each platform's documentation:

| Platform | Method | Reaches |
| --- | --- | --- |
| github.com | Sign in with GitHub (the Source Glance GitHub App) | Repositories where the app is installed (yours, and organizations that install it); other public repositories read-only |
| github.com, GHES | Fine-grained personal access token | Only the repositories of one owner, you or one organization (which may need to approve it) |
| github.com, GHES | Classic personal access token, `repo` scope | Every repository you can view |
| GHES | Browser sign-in, OAuth app you register (Device Flow enabled), `repo project` scope | Every repository you can view, unless an organization restricts OAuth apps |
| GHES | Browser sign-in, GitHub App you register | Only repositories where that app is installed |
| gitlab.com, self-managed | Browser sign-in, `api` scope (device grant: GitLab 17.1 and later) | Every project you can view |
| gitlab.com, self-managed | Personal access token, `api` (or `read_api`) | Every project you can view; group and project access tokens reach only their own group or project |

**The self-hosted wizard** (Settings → Accounts → Connect a self-hosted instance) goes through
these steps:

1. Pick the platform: GitLab self-managed or GitHub Enterprise Server.
2. Enter the address.
3. Source Glance checks that the instance is that platform, without signing in:
   - GitHub Enterprise Server: `GET /api/v3/meta` must report an `installed_version`.
   - GitLab: `GET /.well-known/openid-configuration` must have the instance as `issuer` and list
     the `read_api` scope. Its `grant_types_supported` says whether browser sign-in is offered.
4. Choose a sign-in method. Each method shows the note from the table above.
5. Sign in.

**Network rules** (`lib/transport.js`):

- **Hosts.** Requests go only to `api.github.com`, `github.com` and `gitlab.com`, plus the
  instances the user added. Each account's client only talks to its own instance.
- **TLS.** HTTPS is verified against the system CA store, as before.
- **Redirects.** Requests to a self-hosted instance don't follow redirects, so a redirect can't
  carry the token to another host.
- **Plain http://, decided when the address is entered.** An IP address must be loopback,
  private IPv4 (10/8, 172.16/12, 192.168/16), link-local, or IPv6 unique-local or link-local.
- **Plain http://, checked on every request.** For a name, Source Glance resolves it and every
  address it gets must be one of those. A single public address means the request is refused.
  The connection is then pinned to the checked address (Soup's `remote-connectable`). A DNS
  answer that changes between the check and the connection (DNS rebinding) therefore can't send
  the token elsewhere.
- **Names aren't trusted.** Names ending in `.local` or `.lan` get the same check.
- **Links.** Source Glance opens only links on github.com, gitlab.com or a signed-in account's
  own instance.

## Consequences

- People can see several accounts at once. Existing users keep their sign-ins and collapsed
  sections.
- The allow-list now includes hosts the user chose. The threat model covers the new risks:
  - T20: the wrong host gets a token;
  - T21: a token crosses the network in clear text;
  - T22: DNS rebinding;
  - T23: redirects;
  - T24: a lookalike instance;
  - T25: tokens with too much reach.
- Personal access tokens don't expire on Source Glance's schedule, and removing an account
  doesn't revoke one. The sign-out dialog says so.
- Self-hosted browser sign-in needs the user to register an app on the instance. The wizard
  explains how, and offers a token as the other way.
- Revisit:
  - Tailscale and other CGNAT ranges (100.64/10) count as public, so plain http:// isn't
    allowed there.
  - An instance whose certificate the system doesn't trust can't be added; there is no
    certificate pinning.
  - Gitea and Forgejo are in #11.
