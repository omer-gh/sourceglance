# Shared code

The modules here have **no GNOME imports**: no `gi://`, no `imports.gi`, nothing that needs GNOME Shell, GTK or the keyring.
They are plain JavaScript that runs in GJS and in Node, so the same code can serve apps on other platforms too, such as
Windows and macOS, instead of being written again for each. The desktop app and the top-bar extension use them through the
one-line re-exports left in `src/lib/` (so their imports didn't change), and the tests load them directly in Node.

What lives here: the request builders and parsers for GitHub and GitLab (`model.js`, `gitlabModel.js`, `requests.js`),
accounts (`accounts.js`), grouping, filters, counts and search (`model.js`), projects (`projects.js`), organization names
(`names.js`), repository access (`repoAccess.js`), Markdown (`markdown.js`), the sync client's requests and parsers (`sync.js`), the AI
agents and prompt templates (`aiAgents.js`), and the account list and per-account loading (`accountRegistry.js`, `loader.js`,
`gitlabLoader.js`, with `cancellation.js` for telling a cancelled request from a failed one).

## Rules

- A file here imports only other files in this folder. `tests/shared.test.js` checks that and the "no GNOME" rule.
- Anything that touches GNOME (HTTP through Soup, the keyring, GSettings, GTK) stays in `src/lib/` or `src/window/`.
