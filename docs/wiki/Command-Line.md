# Command Line

The `rl` command runs collections and tests from a terminal or CI.

## Install

Download the `rl` archive for your system from the [latest release](https://github.com/outmanos/restless/releases/latest). It is one file and needs no Node.

| System | Archive |
|---|---|
| Windows | `rl-windows-<version>.zip` |
| macOS, Apple Silicon | `rl-macos-<version>.zip` |
| Linux, x64 | `rl-linux-x64-<version>.tar.xz` |

Unpack it and put `rl` on your PATH.

- **Linux and macOS:** move it to a folder on your PATH, such as `~/.local/bin`.
- **Windows:** put `rl.exe` in a folder such as `C:\tools\rl`, then add that folder to your user PATH in **Environment Variables**. Avoid `setx PATH`, which can cut it off at 1024 characters.
- **macOS:** the file isn't notarized, so if it's blocked, run `xattr -d com.apple.quarantine rl`.

The restless installer doesn't include `rl`, and there is no npm package yet.

## Commands

| Command | Purpose |
|---|---|
| `rl run collection [id]` | Run a collection |
| `rl run test [id]` | Run unit test suites |
| `rl lint spec [id]` | Lint an API spec |
| `rl export spec [id]` | Export an API spec |
| `rl script <name>` | Run a script from `.insorc` |

## Choosing the data source

By default, `rl` reads the restless data folder. Use `-w` to read something else:

```bash
rl run collection -w ./collection.yaml
```

`-w` accepts a Git repository, an export file or a data folder.

## Common options

| Option | Purpose |
|---|---|
| `-e, --env <id>` | Environment to use |
| `-g, --globals <id>` | Global environment |
| `--env-var <key=value>` | Override a variable |
| `-n, --iteration-count <n>` | Number of runs |
| `-d, --iteration-data <path>` | JSON or CSV data file or URL |
| `-t, --requestNamePattern <regex>` | Filter requests |
| `-r, --reporter <name>` | Output format |
| `--requestTimeout <ms>` | Request timeout |
| `--ci` | Disable prompts |

Run `rl --help` for everything.

## CI example

```bash
rl run collection -w ./api.yaml --ci -e staging
```
