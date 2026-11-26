#!/bin/sh
# Compare source trees without checking out or writing to the evaluated tree.
# Usage: sh docs/evals/artifacts/run-ranked.sh /path/to/tree /path/to/new-output
set -eu
tree=$(cd "$1" && pwd)
mkdir -p "$2"
out=$(cd "$2" && pwd)
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/packages/shared/tests"
cp -R "$tree/packages/shared/src" "$temp/packages/shared/"
cp "$tree/packages/shared/package.json" "$temp/packages/shared/"
cp "$root/packages/shared/tests/ranked-seats.test.ts" "$temp/packages/shared/tests/"
ln -s "$root/node_modules" "$temp/node_modules"
cd "$temp/packages/shared"
status=0
"$root/node_modules/.bin/vitest" run tests/ranked-seats.test.ts --reporter=verbose > "$out/ranked.txt" 2>&1 || status=1
"$root/node_modules/.bin/tsx" "$here/replay-ranked.mts" "$temp" > "$out/replay.json" || status=1
exit "$status"
