# Bugs

Known problems, most urgent first. Priorities match the [Roadmap](Roadmap).

| Priority | Bug | Effect | Status |
|---|---|---|---|
| **P1** | Environment table can lose a value | Saves can land out of order, so a value typed quickly is dropped. Seen as `manage environment` failing in full smoke runs | Cause not confirmed |
| **P1** | Requests send `User-Agent: insomnia/0.1.0` | Every server sees the old name | Needs a decision |
| **P1** | Partial releases block later ones | `release.yml` publishes whatever built and creates the tag, so a missing platform can't be released without a new version | Open |
| **P1** | Linux builds need glibc 2.38 | CI builds on a recent Ubuntu, so older distros such as Ubuntu 22.04 and Debian 12 likely can't load `node-libcurl` | Open |
| **P2** | `icon.svg` keeps old metadata | Its label still says Insomnium, and it carries an embedded manifest | Open |
| **P2** | Flaky smoke test | `pre-request-script-features.test.ts:487` matches two elements with `Pre-request Scripts` | Open |
| **P2** | Workflow actions use Node 20 | GitHub warns these actions are deprecated | Open |

## Not verified yet

| Check | Why it matters |
|---|---|
| Run the Windows installer | The update checkbox compiles, but nobody has used it |
| Inspect the macOS `node-libcurl` binary | The Linux build is confirmed static, macOS isn't |
| Test the updater against a real release | Needs a second release |
| Measure first launch on packaged builds | Only a local Linux build showed no network requests |
