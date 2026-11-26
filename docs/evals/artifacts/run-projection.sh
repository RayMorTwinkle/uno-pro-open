#!/bin/sh
# Run with an installed checkout as the sole argument. The test is copied to a
# throwaway package so this script can evaluate older source trees unchanged.
set -eu
root=$(cd "$1" && pwd)
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/packages/shared/tests"
cp -R "$root/packages/shared/src" "$temp/packages/shared/"
cp "$root/packages/shared/package.json" "$temp/packages/shared/"
cp "$here/../../../packages/shared/tests/projection.test.ts" "$temp/packages/shared/tests/"
ln -s "$root/node_modules" "$temp/node_modules"
cd "$temp/packages/shared"
"$root/node_modules/.bin/vitest" run tests/projection.test.ts --reporter=verbose
