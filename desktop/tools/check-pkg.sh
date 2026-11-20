#!/bin/sh
# Checks a Source Glance installer: it installs only "Applications/Source Glance.app" (into
# ~/Applications), for the current user, and has no install scripts.
#
#   desktop/tools/check-pkg.sh path/to/Source-Glance-X.Y.Z.pkg
set -eu

pkg=$1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pkgutil --expand "$pkg" "$work/expanded"

# "._name" entries are macOS metadata for "name" (extended attributes), not files of their own.
extra=$(lsbom -s "$work/expanded/app.pkg/Bom" | sed 's#/\._#/#' |
    grep -v -e '^\./Applications/Source Glance\.app$' -e '^\./Applications/Source Glance\.app/' |
    grep -v -x -e '\.' -e '\./Applications' || true)
if [ -n "$extra" ]; then
    echo "check-pkg: unexpected files in the payload:" >&2
    echo "$extra" >&2
    exit 1
fi
if find "$work/expanded" -name Scripts | grep -q .; then
    echo "check-pkg: the package has install scripts" >&2
    exit 1
fi
if ! grep -q 'enable_currentUserHome="true"' "$work/expanded/Distribution" ||
    grep -q -e 'enable_localSystem="true"' -e 'enable_anywhere="true"' "$work/expanded/Distribution"; then
    echo "check-pkg: the package must install for the current user only" >&2
    exit 1
fi
echo "check-pkg: $pkg is fine"
