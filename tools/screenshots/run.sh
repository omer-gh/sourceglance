#!/usr/bin/env bash
# Renders the window's pages from made-up data into docs/images (see capture.js).
#   tools/screenshots/run.sh [OUT_DIR]
# Nothing real can be reached: an isolated settings file, no session bus (so no keyring) and no network.
# The window runs in its own network namespace, so even a mistake cannot call out to an account.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$ROOT/docs/images}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

node "$ROOT/tools/screenshots/make-fixture.js"
mkdir -p "$TMP/schemas" "$TMP/config/glib-2.0/settings"
cp "$ROOT"/src/schemas/*.gschema.xml "$TMP/schemas/"
glib-compile-schemas "$TMP/schemas"
cp "$ROOT/tests/fixtures/screenshots/settings.ini" "$TMP/config/glib-2.0/settings/keyfile"

export SG_SCHEMA_DIR="$TMP/schemas"
export XDG_CONFIG_HOME="$TMP/config"
export GSETTINGS_BACKEND=keyfile
export SOURCEGLANCE_FAKE_LISTS="$ROOT/tests/fixtures/screenshots/lists.json"
cd "$ROOT"
env -u DBUS_SESSION_BUS_ADDRESS unshare -rn gjs -m tools/screenshots/capture.js "$OUT" \
    "lists-by-project=issues:project" \
    "lists-by-platform=issues:platform" \
    "lists-by-organization=issues:organization" \
    "all-tasks=tasks" \
    "project-boards=boards" \
    "preferences=settings-preferences"
