"""Validate an exported template spec before it becomes a page asset.

The rule vocabulary is closed on the Rust side. Asserting it here as well means
a new rule head cannot reach the browser before the browser knows how to apply
it: the export fails the build instead of the page silently dropping a key.
"""

import json
import sys

# Every head the engine in source/_static/eb-widget-engine.js implements.
HEADS = {
    "field",
    "lower",
    "first_char",
    "first_char_lower",
    "part",
    "join",
    "host_arch",
    "only_if_name",
}


def main(path: str) -> None:
    with open(path) as handle:
        spec = json.load(handle)

    constants = spec.get("constants") or []
    derived = spec.get("derived") or []

    if len(constants) < 70:
        raise SystemExit(f"only {len(constants)} template constants, which cannot be right")
    if len(derived) < 15:
        raise SystemExit(f"only {len(derived)} derived rules, which cannot be right")

    for entry in constants:
        if not entry.get("name") or entry.get("value") is None:
            raise SystemExit(f"malformed constant {entry!r}")

    for entry in derived:
        if not entry.get("key") or not entry.get("rule"):
            raise SystemExit(f"malformed derived entry {entry!r}")
        for clause in entry["rule"].split(";"):
            head = clause.split(":")[0]
            if head not in HEADS:
                raise SystemExit(f"{entry['key']}: unknown rule head {head!r}")

    print(f"check-templates: {len(constants)} constants, {len(derived)} rules")


if __name__ == "__main__":
    main(sys.argv[1])
