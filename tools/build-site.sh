#!/usr/bin/env bash
# Build the GitHub Pages home page (site/) into _site/, with download links for the newest
# published release (pre-releases included). Without a release, the links go to the
# Releases page.
#
#   tools/build-site.sh            # _site/
#   tools/build-site.sh out-dir
#
# Needs gh (signed in, or GH_TOKEN set) and jq.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_site}"
REPO="omer-gh/sourceglance"
RELEASES="https://github.com/$REPO/releases"

mkdir -p "$OUT/images"
cp "$ROOT/site/style.css" "$OUT/"
cp "$ROOT/src/icons/sourceglance-app.svg" "$OUT/icon.svg"
cp "$ROOT/site/demo.js" "$ROOT/site/playground.js" "$OUT/"
for name in sourceglance checklist issue issue-closed git-pull-request label exit; do
    cp "$ROOT/src/icons/$name-symbolic.svg" "$OUT/images/"
done
# The screenshots (made from invented data, see tools/screenshots/) for the gallery.
mkdir -p "$OUT/images/screens"
cp "$ROOT"/docs/images/*.png "$OUT/images/screens/"

release="$(gh api "repos/$REPO/releases?per_page=20" --jq '[.[] | select(.draft | not)][0] // {}')"
asset() { # asset <name pattern> → download URL, or the Releases page
    jq -r --arg re "$1" --arg fallback "$RELEASES" \
        '[.assets[]? | select(.name | test($re)) | .browser_download_url][0] // $fallback' <<<"$release"
}

tag="$(jq -r '.tag_name // empty' <<<"$release")"
if [ -n "$tag" ]; then
    version="$tag"
    date="$(jq -r '.published_at[0:10]' <<<"$release")"
    release_url="$(jq -r '.html_url' <<<"$release")"
else
    version="not released yet"
    date=""
    release_url="$RELEASES"
fi

sed -e "s|@VERSION@|$version|g" \
    -e "s|@DATE@|$date|g" \
    -e "s|@RELEASE_URL@|$release_url|g" \
    -e "s|@SETUP_X64@|$(asset '^sourceglance-Setup-.*-x86_64\.AppImage$')|g" \
    -e "s|@SETUP_ARM@|$(asset '^sourceglance-Setup-.*-aarch64\.AppImage$')|g" \
    -e "s|@ZIP@|$(asset '\.shell-extension\.zip$')|g" \
    -e "s|@SUMS@|$(asset '^SHA256SUMS$')|g" \
    "$ROOT/site/index.html" > "$OUT/index.html"

echo "Built $OUT (release: $version)"
