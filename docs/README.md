# sourceglance documentation

## For users

- [Installation and usage](../README.md#installation)
- [Installing on macOS](installing-macos.md): the Tauri app in development (#10), and opening an unsigned app
- [Handling tokens safely](../SECURITY.md#handling-tokens-safely)

## Product and design

- [Product vision](product/vision.md): problem, personas, principles, non-goals
- [Roadmap](product/roadmap.md): milestones and acceptance criteria
- [UI design — v0.1.0](design/v0.1-ui.md): indicator, menu states, settings window
- [Installer wizard](design/installer.md): MSI-style setup wizard: pages, maintenance mode, command line
- [Theme](design/theme.md): colors, shapes, icons, type and motion, with the reasons
- [Behavior](design/behavior.md): Group by, friendly names, projects, watch list, hidden boards, the top bar switch
- [Sync server and AI assistant](design/sync-and-ai.md): signing in, what follows you, the AI buttons, the requests a server answers

## Architecture

- [Architecture overview](architecture.md): processes, modules, state, refresh flow
- [Architecture decision records](adr/): why things are built the way they are

## Security

- [Security policy and reporting](../SECURITY.md)
- [Threat model](security/threat-model.md): assets, risks and mitigations
- [Secure development](security/secure-development.md): automated checks and the review checklist

## For contributors

- [Development setup](development.md): run, debug and test the extension locally
- [Naming conventions](naming.md): one name for each entity, on screen and in the code
- [UI conventions](ui-conventions.md): alignment, spacing, size and motion rules
- [Writing docs](writing-docs.md): where docs live and how to write them
- [Contributing guide](../CONTRIBUTING.md): issues, pull requests, commit style
- [Releasing](../RELEASING.md): versioning and the release checklist
