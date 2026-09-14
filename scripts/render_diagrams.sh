#!/usr/bin/env bash
# Render every figure from its text source.
#   rails  → scripts/render_rails.py  (Tabatkins railroad-diagrams)
#   *.d2   → d2                       (product maps, hierarchies)
#   *.dot  → graphviz                 (SBOM and the rest)
#   *.mmd  → mmdc                     (if present)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/source/_static/diagrams"
cd "$root"

python3 "$root/scripts/render_rails.py"

sbom="$HOME/Git/Github/Tools/eb-stack/fixtures/gromacs_2025_to_next/expected_prefer_newer.cdx.json"
conv="$HOME/Git/Github/Tools/eb-stack/scripts/sbom_to_dot.py"
if [[ -f "$sbom" && -f "$conv" ]]; then
  python3 "$conv" "$sbom" -o "$dir/sbom-gromacs.dot"
fi

shopt -s nullglob
if command -v d2 >/dev/null; then
  for f in "$dir"/*.d2; do
    stem="$(basename "$f" .d2)"
    case "$stem" in
      rail-*|00-tutorial-read-an-easyconfig-2|recipe-read-four|21-min-fields) continue ;;
    esac
    d2 --pad 20 --theme 0 --dark-theme 200 "$f" "${f%.d2}.svg"
  done
else
  echo "render_diagrams: d2 not on PATH; *.d2 skipped" >&2
fi

for f in "$dir"/*.dot; do
  stem="$(basename "$f" .dot)"
  # D2 owns these maps when d2 ran.
  if [[ -f "$dir/$stem.d2" ]] && command -v d2 >/dev/null; then
    continue
  fi
  # Rails are owned by render_rails.py
  case "$stem" in
    rail-*|00-tutorial-read-an-easyconfig-2|recipe-read-four|21-min-fields) continue ;;
  esac
  dot -Tsvg "$f" -o "${f%.dot}.svg"
done

if command -v mmdc >/dev/null; then
  for f in "$dir"/*.mmd; do
    mmdc -i "$f" -o "${f%.mmd}.svg" -b transparent
  done
fi

python3 - <<'PY'
from pathlib import Path
import re, sys
root = Path.cwd()
dia = root / "source/_static/diagrams"
org = root / "orgmode"
rails = {
    "rail-module-name", "rail-dep-tuple", "rail-pin", "rail-not-range",
    "00-tutorial-read-an-easyconfig-2", "recipe-read-four", "21-min-fields",
}
refs = set()
for p in org.glob("*.org"):
    refs.update(re.findall(r"_static/diagrams/([A-Za-z0-9_.-]+)\.svg", p.read_text()))
missing = []
for stem in sorted(refs):
    has = (
        (dia / f"{stem}.dot").is_file()
        or (dia / f"{stem}.d2").is_file()
        or (dia / f"{stem}.mmd").is_file()
        or stem in rails
    )
    if not has:
        missing.append(stem)
if missing:
    print("svg without source:", *missing, sep="\n  ", file=sys.stderr)
    sys.exit(1)
print(f"ok {len(refs)} referenced diagrams have .dot, .d2, .mmd, or a rail source")
PY
