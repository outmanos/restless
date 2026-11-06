#!/usr/bin/env bash
# Prints a self-contained PKGBUILD for a released version, with real checksums.
# Usage: release-pkgbuild.sh <version> <release tarball> <icon.svg>
# The release workflow attaches the result as PKGBUILD, so a fixed URL always gives the latest version.
set -euo pipefail

version="$1"
tarball_sum="$(sha256sum "$2" | cut -d' ' -f1)"
icon_sum="$(sha256sum "$3" | cut -d' ' -f1)"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

awk -v version="$version" -v tarball="$tarball_sum" -v icon="$icon_sum" '
  /^pkgver=/ { print "pkgver=" version; next }
  /^pkgrel=/ { print "pkgrel=1"; next }
  /^sha256sums=\(/ { print "sha256sums=(\047" tarball "\047\n            \047" icon "\047)"; skipping = 1 }
  skipping { if ($0 ~ /\)$/) skipping = 0; next }
  { print }
' "$source_dir/PKGBUILD"
