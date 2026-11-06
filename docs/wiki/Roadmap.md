# Roadmap

Goal: every Insomnia and Bruno feature in one app, local-first, with no account, telemetry or vendor service. The rules are in [Principles](Principles).

There are no dates. Milestones ship in order, once their P0 tasks are done.

| Priority | Meaning |
|---|---|
| **P0** | Blocks the milestone |
| **P1** | Should ship in it, can slip to the next one |
| **P2** | Nice to have |

| Size | Rough effort |
|---|---|
| S | Up to a day |
| M | Days |
| L | Weeks |

## Milestones

| Version | Theme | Done when |
|---|---|---|
| [0.1.0](#010-first-release) | First release | Builds publish on all platforms and the app updates itself |
| [0.2.0](#020-migration) | Migration | Insomnia and Bruno users move over in one click |
| [0.3.0](#030-files-first) | Files first | Collections live as readable files in your folder |
| [0.4.0](#040-daily-workflow) | Daily workflow | Editing and navigating feel fast |
| [0.5.0](#050-testing) | Testing | No-code testing, and CI reports from `rl` |
| [0.6.0](#060-protocols-and-auth) | Protocols and auth | No auth or protocol gaps against Bruno |
| [0.7.0](#070-api-lifecycle) | API lifecycle | Specs, collections and mocks stay in sync |
| [0.8.0](#080-developer-tools-and-ai) | Developer tools and AI | Terminal, devtools and optional AI assist |
| [1.0.0](#100-polish-and-reach) | Polish and reach | Signed builds, in the main package managers |

## 0.1.0: First release

| | Pri | Size | Task |
|---|---|---|---|
| [x] | P0 | M | Publish builds and a GitHub Release on merge to `main` |
| [x] | P0 | L | Remove accounts, telemetry, Kong services and branding |
| [x] | P0 | M | Rewrite project docs, add `NOTICE` |
| [x] | P0 | S | Move to the `restless://` scheme, keep `insomnia://` plugin, theme and import links |
| [x] | P0 | M | Restore browser OAuth, GitHub and GitLab sign-in, gRPC reflection |
| [x] | P0 | M | Bring-your-own-key AI, off by default |
| [x] | P0 | M | Secret managers: HashiCorp Vault, AWS, GCP |
| [x] | P0 | M | Local Git with `File > Open Folder…` |
| [x] | P1 | M | Custom title bar and themed menus on Windows and Linux |
| [ ] | P0 | S | Confirm the Windows and macOS builds pass in CI |
| [ ] | P0 | S | Test the updater against a real release |
| [ ] | P1 | S | Check title bar, menus and shortcuts on Windows and macOS |
| [ ] | P1 | S | Fix the remaining audit findings |
| [ ] | P1 | S | Enable the AUR job once registration reopens |

## 0.2.0: Migration

The top feature priority. Moving must be easy, or nobody moves.

| | Pri | Size | Task |
|---|---|---|---|
| [x] | P0 | M | Detect an Insomnia data folder and list what it holds |
| [x] | P0 | L | Import projects, collections, environments, cookies and certificates in one click |
| [x] | P0 | M | Show a report of what moved and what didn't |
| [x] | P0 | M | Import Bruno collections, `.bru` and YAML |
| [x] | P0 | S | Never change the source install |
| [x] | P1 | M | Offer migration on first launch when an install is found |
| [x] | P1 | S | Reinstall plugins found in the old install |
| [x] | P1 | M | Translate Bruno and Postman scripts, reporting what didn't convert |
| [x] | P1 | M | Bulk import of many collections |
| [x] | P2 | M | Import from a Postman workspace dump (through the import window) |

## 0.3.0: Files first

The largest change. Later features build on this storage model, so it goes early.

| | Pri | Size | Task |
|---|---|---|---|
| [x] | P0 | M | Keep Git collections as YAML in a chosen folder |
| [x] | P0 | S | GitHub and GitLab sign-in off by default |
| [x] | P0 | S | Decide the native format (see [Decisions](Decisions)) |
| [ ] | P0 | L | Store collections as readable files, one YAML file per collection |
| [ ] | P0 | M | Watch the folder and reload on external edits |
| [ ] | P0 | M | Open any folder as a collection |
| [ ] | P0 | M | Settings as a plain JSON file, with export and import. Preferences, themes and shortcuts included |
| [ ] | P0 | L | Migrate from NeDB, with a backup |
| [ ] | P1 | L | Read and write `.bru` and Bruno's YAML, using `bruno-lang` and `bruno-filestore` |
| [ ] | P1 | M | Workspaces that group collections and environments on disk |
| [ ] | P1 | M | `.env` file support and editor |
| [ ] | P1 | S | Audit every format restless writes. Use an open spec where one exists, and publish the schema for any that remains |
| [ ] | P2 | S | Single-file YAML and ZIP export |

## 0.4.0: Daily workflow

| | Pri | Size | Task |
|---|---|---|---|
| [ ] | P0 | M | Global search across collections, requests and URLs |
| [ ] | P0 | M | Inherited auth and settings at collection and folder level |
| [ ] | P0 | M | Restore open tabs and sidebar state per collection |
| [ ] | P0 | M | Large response protection |
| [ ] | P0 | L | Every core action reachable with the keyboard alone, with visible focus and a logical tab order |
| [ ] | P1 | M | Transient requests, savable later |
| [ ] | P1 | M | Preview tabs and pinned tabs |
| [ ] | P1 | M | Drag a request from the sidebar into the tab bar to open it, and drag tabs to reorder them, as in a browser |
| [ ] | P1 | M | Select several tabs at once (Ctrl and Shift click) to close, pin or move them together, and reopen closed tabs |
| [ ] | P1 | S | Double click a request to open it as a tab, while one click only previews it. Only clicking a project opens that project, not clicking a request inside it |
| [ ] | P1 | S | Remember the collection picked for new requests on the home screen, with a setting to pick a fixed one instead of the first in the list |
| [ ] | P1 | S | Autosave setting |
| [ ] | P1 | S | Set a variable from a response value in one click |
| [ ] | P1 | S | Unresolved variable warnings |
| [ ] | P1 | M | Saved response examples, usable in docs and mocks |
| [ ] | P1 | M | Collection and folder docs as Markdown |
| [ ] | P1 | M | In-app help links open the matching wiki page, not the README. About 27 links. Write the pages that are missing: scripting, template tags, keyboard shortcuts, design documents |
| [ ] | P1 | L | Overhaul the hotkey system: one registry, remappable keys, conflict warnings, and every shortcut listed in the command palette |
| [ ] | P1 | L | Reorganize Settings into Appearance, Editor, Keyboard, Requests, Privacy and Security, Data, Plugins and About, with every setting where you would look for it |
| [ ] | P1 | M | Searchable settings: a search box that jumps to the setting |
| [ ] | P1 | M | Ctrl+Shift+P command mode, as in VS Code: search settings, actions and admin tasks, while Ctrl+P stays for requests, collections and documents. It needs a new shortcut for toggle pin, which uses Ctrl+Shift+P today |
| [ ] | P1 | M | In-app About tab with version and system details, update settings and release notes, replacing the native About box |
| [ ] | P1 | M | Clearer Data tab: import, export, backups with restore, data folder location and size |
| [ ] | P2 | S | Bulk edit for form fields |
| [ ] | P2 | S | Request presets per collection |
| [ ] | P2 | S | Prompted variables |
| [ ] | P2 | S | Environment color on request tabs |
| [ ] | P2 | S | Response layout toggle |
| [ ] | P2 | M | Visual diff for request changes |
| [ ] | P2 | S | A themed SVG icon for each settings tab |

## 0.5.0: Testing

| | Pri | Size | Task |
|---|---|---|---|
| [ ] | P0 | M | No-code assertions on requests |
| [ ] | P0 | M | No-code pre and post request variables |
| [ ] | P0 | M | Tags on requests, with include and exclude in the runner and CLI |
| [ ] | P0 | M | `rl`: JUnit and HTML reports, env files, tag filters |
| [ ] | P1 | M | Keep runner results between sessions |
| [ ] | P1 | S | `rl`: per-field report redaction |
| [ ] | P1 | L | Node VM and QuickJS sandbox choice, shared by app and CLI |
| [ ] | P2 | L | Performance and load testing |

## 0.6.0: Protocols and auth

| | Pri | Size | Task |
|---|---|---|---|
| [ ] | P0 | M | WSSE and Akamai EdgeGrid auth |
| [ ] | P0 | S | Azure Key Vault and AWS SSO credentials |
| [ ] | P0 | M | Test each secret manager and AI provider against real accounts |
| [ ] | P1 | M | Protobuf import paths per collection |
| [ ] | P1 | M | gRPC scripts |
| [ ] | P1 | M | WebSocket scripts and per-connection settings |
| [ ] | P1 | M | Keep Hawk, Netrc, ASAP and template tags working in the Bruno format |
| [ ] | P2 | L | GraphQL query builder |
| [ ] | P2 | S | Register project GitHub and GitLab OAuth apps and ship their IDs as defaults |

## 0.7.0: API lifecycle

| | Pri | Size | Task |
|---|---|---|---|
| [ ] | P0 | L | Connect a collection to an OpenAPI spec and sync changes both ways |
| [ ] | P0 | M | Spec panel inside a collection |
| [ ] | P1 | M | Mock server dashboard: create, clone, search, serve from saved examples |
| [ ] | P1 | M | Export to Postman, OpenAPI and Bruno |

## 0.8.0: Developer tools and AI

AI stays off by default.

| | Pri | Size | Task |
|---|---|---|---|
| [ ] | P0 | M | Devtools panel: console, network, performance |
| [ ] | P1 | M | Built-in terminal with a titlebar icon, running `rl help` on first open |
| [ ] | P1 | L | AI chat sidebar, inline assist and autocomplete |
| [ ] | P1 | M | AI generation for tests and scripts |
| [ ] | P2 | L | Local model support inside the app |
| [ ] | P2 | L | Runnable collection apps |

## 1.0.0: Polish and reach

| | Pri | Size | Task |
|---|---|---|---|
| [ ] | P0 | M | Windows code signing and macOS notarization |
| [ ] | P0 | M | Accessibility pass |
| [ ] | P0 | M | Reduce startup work: 186 scripts load on launch |
| [ ] | P0 | S | winget and own Homebrew tap |
| [ ] | P0 | M | Flathub and Snap Store |
| [ ] | P0 | S | npm: `restless-cli` |
| [ ] | P1 | L | Replace leftover legacy components |
| [ ] | P1 | M | Restyle the collection sidebar, response pane and empty states |
| [ ] | P1 | M | Command palette covers every action |
| [ ] | P1 | S | Sidebar density and keyboard navigation |
| [ ] | P1 | M | Light theme matching the dark palette |
| [ ] | P1 | M | Arch and CachyOS: a pacman repository, so `pacman -Syu` updates restless. Each release ships a `PKGBUILD` until then |
| [ ] | P2 | M | Nixpkgs, apt and dnf repositories, Scoop, Chocolatey |
| [ ] | P2 | S | Move to `homebrew-cask` once eligible |
| [ ] | P2 | S | README: a download badge for each platform or channel once its first build has passed, linking to the latest release |
| [ ] | P2 | M | Publish a software bill of materials with each release. `npm sbom` needs the dependency tree fixed first |

## Ideas, not scheduled

- **Split collections.** A collection file that references its requests with `$ref`, each request in its own file next to it. Small diffs, and loose request files that can be opened alone and added to a collection later. It needs a document type that older clients refuse, in a namespace restless owns. See [the design](https://github.com/outmanos/restless/blob/main/docs/design/0.3.0-files-first.md).

## Baseline

Bruno refs are from `usebruno/bruno` at `72f2e3043`.

Both have: REST, GraphQL, gRPC, WebSocket, SSE, collection runner, Git, local mock server, Postman, OpenAPI, Insomnia and WSDL import, code generation, themes, keybindings, CLI, client certs, proxy, cookies, OAuth 1 and 2, Digest, NTLM, AWS, Bearer, Basic, API key.

Only here: Socket.IO, MCP client, OpenAPI design editor with Spectral lint, unit test suites, Nunjucks template tags, plugins, full Git UI, Hawk, Netrc, ASAP.

Only Bruno: see phases 2 to 6.
