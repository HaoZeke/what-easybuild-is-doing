#!/usr/bin/env python3
"""JSON.org-style railroads via Tabatkins railroad-diagrams (MIT, vendored).

Graphviz cannot draw a grammar. This is the tool that can.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
from railroad import Diagram, NonTerminal, Optional, Sequence, Terminal  # noqa: E402


def write(path: Path, diagram: Diagram) -> None:
    chunks: list[str] = []
    diagram.writeStandalone(chunks.append)
    path.write_text("".join(chunks), encoding="utf-8")
    print("rail", path.name)


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "source" / "_static" / "diagrams"
    write(
        out / "rail-module-name.svg",
        Diagram(
            NonTerminal("name"),
            Terminal("-"),
            NonTerminal("version"),
            Terminal("-"),
            NonTerminal("toolchain"),
            Terminal("-"),
            NonTerminal("tc-version"),
            Optional(NonTerminal("versionsuffix")),
        ),
    )
    write(
        out / "rail-dep-tuple.svg",
        Diagram(
            NonTerminal("name"),
            NonTerminal("version"),
            Optional(NonTerminal("versionsuffix")),
            Optional(NonTerminal("toolchain")),
        ),
    )
    write(
        out / "rail-pin.svg",
        Diagram(NonTerminal("name"), Terminal("exactly"), NonTerminal("version")),
    )
    write(
        out / "rail-not-range.svg",
        Diagram(
            NonTerminal("name"),
            Terminal(">="),
            NonTerminal("version"),
            Terminal("<"),
            NonTerminal("next"),
        ),
    )
    write(
        out / "00-tutorial-read-an-easyconfig-2.svg",
        Diagram(
            NonTerminal("name"),
            NonTerminal("version"),
            NonTerminal("toolchain"),
            NonTerminal("sources"),
        ),
    )
    write(
        out / "recipe-read-four.svg",
        Diagram(
            NonTerminal("name"),
            NonTerminal("version"),
            NonTerminal("toolchain"),
            NonTerminal("deps"),
        ),
    )
    write(
        out / "08-generation-pairs.svg",
        Diagram(
            NonTerminal("toolchain"),
            Terminal("+"),
            NonTerminal("arch"),
            Terminal("->"),
            NonTerminal("install prefix"),
        ),
    )
    write(
        out / "21-min-fields.svg",
        Diagram(
            NonTerminal("name"),
            NonTerminal("version"),
            NonTerminal("toolchain"),
            NonTerminal("sources"),
            NonTerminal("sanity"),
        ),
    )


if __name__ == "__main__":
    main()
