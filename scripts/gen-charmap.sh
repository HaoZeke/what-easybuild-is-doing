#!/usr/bin/env bash
# Export the easyblock name-encoding table from eb-stack into the static
# assets, so the browser applies the framework's own substitutions rather than
# a copy of them that can drift.
#
# Point EB_STACK at a binary if it is not on PATH, which is the normal case on
# a build host where the engine was compiled rather than installed.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
eb_stack="${EB_STACK:-eb-stack}"
out="$here/source/_static/eb-charmap.json"

if ! command -v "$eb_stack" >/dev/null 2>&1 && [ ! -x "$eb_stack" ]; then
    echo "gen-charmap: no eb-stack at '$eb_stack'." >&2
    echo "gen-charmap: set EB_STACK to the binary, or install it on PATH." >&2
    exit 1
fi

# Written to a temporary file first: a half-written JSON asset would reach a
# reader as a broken widget rather than as a build failure.
tmp="$(mktemp "${out}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

"$eb_stack" recipe easyblock --charmap >"$tmp"

python3 - "$tmp" <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    table = json.load(handle)

if not table.get("prefix"):
    raise SystemExit("gen-charmap: export carries no class-name prefix")

entries = table.get("charmap") or []
if len(entries) < 20:
    raise SystemExit(f"gen-charmap: only {len(entries)} substitutions, which cannot be right")

for entry in entries:
    if len(entry.get("from", "")) != 1 or not entry.get("to"):
        raise SystemExit(f"gen-charmap: malformed entry {entry!r}")
PY

mv "$tmp" "$out"
trap - EXIT
echo "gen-charmap: wrote $out"
