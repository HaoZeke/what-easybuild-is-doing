"""Validate an exported toolchain-hierarchy table before it becomes an asset.

The framework's order is the content: most minimal subtoolchain first, the
named toolchain last. A table that lost that order is worse than no table,
because a reader would take the order for meaning.
"""

import json
import sys


def main(path: str) -> None:
    with open(path) as handle:
        table = json.load(handle)

    gens = table.get("generations") or []
    if not gens:
        raise SystemExit("no toolchain generations exported")

    for gen in gens:
        parent = gen.get("parent") or {}
        members = gen.get("members") or []
        label = f"{parent.get('name')}-{parent.get('version')}"
        if len(members) < 2:
            raise SystemExit(f"{label}: no chain, only {len(members)} member(s)")
        if members[0]["name"] != "system":
            raise SystemExit(f"{label}: starts at {members[0]['name']}, not system")
        if members[-1]["name"] != parent.get("name"):
            raise SystemExit(f"{label}: ends at {members[-1]['name']}, not its parent")

    print(f"check-hierarchy: {len(gens)} generations")


if __name__ == "__main__":
    main(sys.argv[1])
