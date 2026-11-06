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
| Keep Nunjucks for templates | Template tags, plugins and existing collections depend on it, and it has filters and logic. Bruno's `{{var}}` becomes `{{ _.var }}` on import, and should convert back on `.bru` export |

## Open questions

- Which YAML schema is native: Insomnia's `collection.insomnia.rest/5.0`, or [OpenCollection](https://spec.opencollection.com). OpenCollection is a vendor-neutral spec with a JSON Schema, a place for extensions and one file per request, but Bruno maintains it, it's at v1.0.0, and its repository has no license file yet. Insomnia's format is documented only by its code, and it keeps a collection in one file.
- Store history, cookies and tokens in the app, or on disk too. If on disk, use HAR for history and a standard cookie format, and keep tokens in the OS keychain.
