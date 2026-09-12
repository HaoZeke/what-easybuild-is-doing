#!/usr/bin/env bash
# Export the tables the browser engine needs from eb-stack into the static
# assets, so a page applies the framework's own data rather than a copy of it
# that can drift.
#
# Three tables, three widgets: the easyblock name encoding, the template
# constants plus their derived-key rules, and the known toolchain hierarchies.
# What stays in JavaScript is the mechanical application, and the cross-check
# in the acceptance test is what keeps the two implementations honest.
#
# Point EB_STACK at a binary if it is not on PATH, which is the normal case on
# a build host where the engine was compiled rather than installed.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
eb_stack="${EB_STACK:-eb-stack}"
out="$here/source/_static/eb-charmap.json"
out_templates="$here/source/_static/eb-templates.json"
out_hierarchy="$here/source/_static/eb-hierarchy.json"

if ! command -v "$eb_stack" >/dev/null 2>&1 && [ ! -x "$eb_stack" ]; then
    if [[ -f "$out" && -f "$out_templates" && -f "$out_hierarchy" ]]; then
        echo "gen-engine-data: no eb-stack; using committed tables." >&2
        exit 0
    fi
    echo "gen-engine-data: no eb-stack at '$eb_stack'." >&2
    echo "gen-engine-data: set EB_STACK to the binary, or install it on PATH." >&2
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
    raise SystemExit("gen-engine-data: export carries no class-name prefix")

entries = table.get("charmap") or []
if len(entries) < 20:
    raise SystemExit(f"gen-engine-data: only {len(entries)} substitutions, which cannot be right")

for entry in entries:
    if len(entry.get("from", "")) != 1 or not entry.get("to"):
        raise SystemExit(f"gen-engine-data: malformed entry {entry!r}")
PY

mv "$tmp" "$out"
trap - EXIT
echo "gen-engine-data: wrote $out"

# --- template constants and derived-key rules ---------------------------------

tmp="$(mktemp "${out_templates}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
"$eb_stack" recipe templates --export >"$tmp"
python3 "$here/scripts/check-templates.py" "$tmp"
mv "$tmp" "$out_templates"
trap - EXIT
echo "gen-engine-data: wrote $out_templates"

# --- known toolchain hierarchies ----------------------------------------------

tmp="$(mktemp "${out_hierarchy}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
"$eb_stack" recipe hierarchy --export >"$tmp"
python3 "$here/scripts/check-hierarchy.py" "$tmp"
mv "$tmp" "$out_hierarchy"
trap - EXIT
echo "gen-engine-data: wrote $out_hierarchy"
