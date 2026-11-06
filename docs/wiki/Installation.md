# Installation

Download restless from [GitHub Releases](https://github.com/outmanos/restless/releases/latest).

| Platform | File |
|---|---|
| Windows | `.exe` installer |
| macOS on Apple Silicon | `.dmg` |
| Any Linux | `.AppImage` or `.tar.gz` |
| Debian, Ubuntu, Mint | `.deb` |
| Fedora, RHEL, openSUSE | `.rpm` |

Windows and macOS builds are not signed yet, so you may see a warning on first launch.

The AUR, winget, Homebrew, Flathub and Snap are planned. See [Distribution](Distribution).

## Data folder

| Platform | Location |
|---|---|
| Linux | `~/.config/Restless` |
| macOS | `~/Library/Application Support/Restless` |
| Windows | `%APPDATA%\Restless` |

## Updating

Windows, macOS and the Linux AppImage can update themselves. Open `Preferences > About` to check by hand, or turn on **Automatic updates**. Then restless also checks when it starts (you can turn that off) and again every day, or every 6 hours or week if you prefer.

The deb, rpm, tar.gz and distro packages do not update themselves. Update those with your package manager or download a new release. `Preferences > About` says so when your build is one of them.
