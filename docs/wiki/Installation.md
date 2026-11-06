# Installation

Download restless from [GitHub Releases](https://github.com/outmanos/restless/releases/latest).

| Platform | File |
|---|---|
| Windows | `.exe` installer |
| macOS on Apple Silicon | `.dmg` |
| Any Linux | `.AppImage` or `.tar.gz` |
| Debian, Ubuntu, Mint | `.deb` |
| Fedora, RHEL, openSUSE | `.rpm` |
| Arch, CachyOS, Manjaro | `PKGBUILD`, see below |

Windows and macOS builds are not signed yet, so you may see a warning on first launch.

winget, Homebrew, Flathub and Snap are planned. See [Distribution](Distribution).

## Arch, CachyOS and Manjaro

Each release carries a ready-made `PKGBUILD`. This builds a package from the release and installs it, in one command:

```bash
cd "$(mktemp -d)" && curl -fsSLO https://github.com/outmanos/restless/releases/latest/download/PKGBUILD && makepkg -si
```

- restless will also be published to the AUR once account registrations reopen, so an AUR helper can install and update it. Until then, use the command above.
- Nothing is compiled. It downloads the release, packs it and asks for your password to install, which takes about a minute.
- The `PKGBUILD` is a short text file. Download it first and read it if you prefer: `curl -fsSLO <the same URL>`.
- It installs to `/opt/restless` as the package `restless-bin`. Remove it with `sudo pacman -R restless-bin`.
- To update, run the command again. A pacman repository, with normal `pacman -Syu` updates, is on the [Roadmap](Roadmap).
- The sandbox needs user namespaces, which Arch's kernels enable. On `linux-hardened`, enable them or start restless with `--no-sandbox`.

## Data folder

| Platform | Location |
|---|---|
| Linux | `~/.config/Restless` |
| macOS | `~/Library/Application Support/Restless` |
| Windows | `%APPDATA%\Restless` |

## Updating

Windows, macOS and the Linux AppImage can update themselves. Open `Preferences > About` to check by hand, or turn on **Automatic updates**. Then restless also checks when it starts (you can turn that off) and again every day, or every 6 hours or week if you prefer.

The deb, rpm, tar.gz and distro packages do not update themselves. Update those with your package manager or download a new release. `Preferences > About` says so when your build is one of them.
