#!/usr/bin/env bash
# Every figure in the book is Graphviz. This is the only render step.
#   scripts/render_diagrams.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/source/_static/diagrams"
# Planned SBOM graph from the eb-stack fixture when that tree is present.
sbom="$HOME/Git/Github/Tools/eb-stack/fixtures/gromacs_2025_to_next/expected_prefer_newer.cdx.json"
conv="$HOME/Git/Github/Tools/eb-stack/scripts/sbom_to_dot.py"
if [[ -f "$sbom" && -f "$conv" ]]; then
  python3 "$conv" "$sbom" -o "$dir/sbom-gromacs.dot"
fi
shopt -s nullglob
for f in "$dir"/*.dot; do
  out="${f%.dot}.svg"
  dot -Tsvg "$f" -o "$out"
done
# Fail if a referenced SVG has no .dot
python3 - <<'PY'
from pathlib import Path
import re, sys
root = Path(__file__).resolve().parents[1] if False else Path.cwd()
# cwd is book root when we cd
root = Path.cwd()
dia = root / "source/_static/diagrams"
org = root / "orgmode"
refs = set()
for p in org.glob("*.org"):
    refs.update(re.findall(r"_static/diagrams/([A-Za-z0-9_.-]+)\.svg", p.read_text()))
missing = []
for stem in sorted(refs):
    if not (dia / f"{stem}.dot").is_file():
        missing.append(stem)
if missing:
    print("svg without .dot:", *missing, sep="\n  ", file=sys.stderr)
    sys.exit(1)
print(f"ok {len(refs)} referenced diagrams, all have .dot")
PY
