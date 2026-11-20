#!/bin/sh
# Builds the Source Glance installer (.pkg) from a built app bundle, with Apple's pkgbuild and
# productbuild. Tauri doesn't make .pkg files itself.
#
#   desktop/tools/build-pkg.sh "path/to/Source Glance.app" path/to/output-dir
#
# Run from the repo root. The installer pages are in desktop/installer/. The version comes
# from the root package.json, like the app's.
set -eu

app=$1
out=$2
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/.." && pwd)
version=$(node -p "require('$root/package.json').version")
identifier=io.github.omer-gh.sourceglance.app

if [ ! -d "$app/Contents/MacOS" ]; then
    echo "build-pkg: $app is not an app bundle" >&2
    exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

# The payload: the app, in Applications. As the installer only allows the user's home, it
# ends up in ~/Applications.
mkdir -p "$work/root/Applications" "$work/resources"
ditto --norsrc --noextattr --noqtn "$app" "$work/root/Applications/Source Glance.app"
# No extended attributes in the payload: they'd turn into stray "._" files.
xattr -cr "$work/root"
export COPYFILE_DISABLE=1

# Install where we say, even if macOS knows another copy of the app (a build folder, or one
# dragged from the .dmg): a relocatable bundle would be "updated" in that other place.
pkgbuild --analyze --root "$work/root" "$work/component.plist" >/dev/null
plutil -replace 0.BundleIsRelocatable -bool NO "$work/component.plist"
plutil -replace 0.BundleHasStrictIdentifier -bool YES "$work/component.plist"

pkgbuild --root "$work/root" \
    --component-plist "$work/component.plist" \
    --identifier "$identifier" \
    --version "$version" \
    --install-location / \
    "$work/app.pkg" >/dev/null

# The pages: Introduction, License (the license and the notice) and Summary.
sed "s/@VERSION@/$version/g" "$here/installer/welcome.html" >"$work/resources/welcome.html"
cp "$here/installer/conclusion.html" "$work/resources/conclusion.html"
{
    cat "$root/LICENSE"
    printf '\n\n'
    cat "$root/NOTICE"
} >"$work/resources/license.txt"
sed "s/@VERSION@/$version/g" "$here/installer/distribution.xml" >"$work/distribution.xml"

mkdir -p "$out"
pkg="$out/Source-Glance-$version.pkg"
productbuild --distribution "$work/distribution.xml" \
    --resources "$work/resources" \
    --package-path "$work" \
    "$pkg" >/dev/null
echo "$pkg"
