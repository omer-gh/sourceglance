# Secure development

Security is part of every change, not a separate phase. This page lists what happens
automatically and what reviewers check by hand.

## Automated checks

| Check | When | What it catches |
| ------- | ------ | ----------------- |
| **CodeQL** (`codeql.yml`) | Every PR, push to `main`, weekly | Code-level vulnerabilities in JavaScript and in our GitHub Actions workflows |
| **Dependency review** (`dependency-review.yml`) | Every PR | New dependencies with known vulnerabilities or incompatible licenses |
| **Dependabot** (`dependabot.yml`) | Weekly | Outdated npm dev dependencies and GitHub Actions versions; security alerts |
| **Secret scanning + push protection** | Every push | Tokens and keys committed by mistake (pushes are blocked) |
| **ESLint security rules** | Every PR (`make lint`) | `eval`, `new Function`, string timers |
| **Pinned actions** | Always | Workflows reference third-party actions by commit SHA, so a moved tag can't inject code |
| **Least-privilege workflows** | Always | Each workflow declares only the `permissions:` it needs |

## Reviewer checklist

The PR template asks authors to confirm these; reviewers check them for any PR touching
auth, networking, storage or rendering:

- [ ] No token or other secret in code, logs, error messages, test fixtures or screenshots
- [ ] No new GitHub App permission or OAuth scope. In particular, never ask to read repository
      contents (code): features that would need it degrade gracefully or are done by hand instead
- [ ] New network calls go only to `api.github.com`, `gitlab.com` or the account's own instance
      (through `lib/transport.js`), and are cancellable
- [ ] Each request uses the token of the account the data came from
- [ ] Data from GitHub and GitLab is treated as untrusted: rendered as plain text, or as Markdown
      through `lib/markdown.js` (which escapes it and keeps only http(s) links), URLs checked
      against the account's instance before opening
- [ ] Nothing secret stored in GSettings or files
- [ ] No new runtime dependency (GNOME libraries only)
- [ ] [Threat model](threat-model.md) updated if the change adds a data flow, storage,
      network call or dependency

## Security reviews

- **Per PR:** the checklist above.
- **Per minor release:** a security review of the diff since the last release, recorded as a
  `security`-labelled issue in the milestone, and the threat model's "Last reviewed" date
  updated.

## Reporting

Vulnerabilities are reported privately — see [SECURITY.md](../../SECURITY.md).
