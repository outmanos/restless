# Decisions

Why things are the way they are.

| Decision | Why |
|---|---|
| Forked Insomnia, not the old Insomnium | The old fork was years behind, and Insomnia is Apache-2.0 |
| Named restless | Not close to Kong's Insomnia mark, and it contains "REST" |
| The name is always lowercase | It's the wordmark. App and file names such as `Restless-0.1.0.AppImage` keep their capital |
| CLI command is `rl` | Short. The npm package is `restless-cli` |
| Internal folders stay `insomnia` | A rename would conflict with every merge from Insomnia |
| Keep `collection.insomnia.rest/5.0` | It's a format ID, and changing it breaks compatibility |
| Accept `insomnia://` links for plugins, themes and imports only | Keeps the plugin ecosystem working, without exposing other link actions |
| Loopback OAuth redirect | No relay server sees your authorization code |
| GitHub device flow | Needs no client secret |
| Keep Electron 45 | Staying current matters more than the square Chromium window buttons, which Electron 43 drew on KDE |
| Native window controls on Linux | They match the desktop. The app sets the theme early and dims them with dialogs |
| Bundled fonts | Nothing downloads at runtime |
| Native file format is YAML. `.bru` is read and written for Bruno collections | YAML is what Git sync already stores, and `.bru` keeps Bruno collections portable |
| The native YAML schema is Insomnia's `collection.insomnia.rest/5.0` | It's what Git sync already writes, and it keeps existing Insomnia repositories working. OpenCollection was considered and rejected |
| A split collection, if built, uses a document type in a namespace restless owns | Kong could define the next `collection.insomnia.rest` number differently, and older clients must refuse a file they would otherwise open with items missing |
| Files keep the plain `.yaml` extension | A custom extension would be an invented file type, and `.rl` already belongs to Ragel. A file is recognized by its `type` field, as an OpenAPI file is by `openapi` |
| Keep Nunjucks for templates | Template tags, plugins and existing collections depend on it, and it has filters and logic. Bruno's `{{var}}` becomes `{{ _.var }}` on import, and should convert back on `.bru` export |

## Open questions

- Store history, cookies and tokens in the app, or on disk too. If on disk, use HAR for history and a standard cookie format, and keep tokens in the OS keychain.
