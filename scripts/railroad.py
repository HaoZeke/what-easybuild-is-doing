#!/usr/bin/env python3
"""Railroad diagrams for EasyBuild names, pins, and suffixes.

The same shape as a JSON.org / RFC grammar diagram: a rail, boxes on
the rail, an optional loop above it. Output is SVG.
"""

from __future__ import annotations

from pathlib import Path


def box(x: float, y: float, text: str, kind: str = "term") -> tuple[str, float]:
    pad = 10
    w = max(48, 8 * len(text) + 2 * pad)
    h = 28
    if kind == "lit":
        fill, stroke = "#1a1917", "#1a1917"
        tfill = "#f7f6f3"
    else:
        fill, stroke = "#f7f6f3", "#1a1917"
        tfill = "#1a1917"
    svg = (
        f'<rect x="{x:.1f}" y="{y - h / 2:.1f}" width="{w:.1f}" height="{h:.1f}" '
        f'rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>'
        f'<text x="{x + w / 2:.1f}" y="{y + 4.5:.1f}" text-anchor="middle" '
        f'font-family="Inter,Helvetica,sans-serif" font-size="12" fill="{tfill}">{text}</text>'
    )
    return svg, w


def railroad(items: list[tuple[str, str]], optional: list[tuple[str, str]] | None = None) -> str:
    """items are (kind, text) on the main rail. optional rides a loop after the last box."""
    x = 24.0
    y = 36.0 if optional else 24.0
    parts = []
    # start stub
    parts.append(f'<path d="M8 {y:.1f} H{x:.1f}" fill="none" stroke="#1a1917" stroke-width="1.6"/>')
    last_right = x
    for i, (kind, text) in enumerate(items):
        svg, w = box(x, y, text, kind)
        parts.append(svg)
        right = x + w
        # connector to next
        nx = right + 16
        parts.append(
            f'<path d="M{right:.1f} {y:.1f} H{nx:.1f}" fill="none" stroke="#1a1917" stroke-width="1.6"/>'
        )
        x = nx
        last_right = nx
    end_x = last_right + 8
    parts.append(
        f'<path d="M{last_right:.1f} {y:.1f} H{end_x:.1f}" fill="none" stroke="#1a1917" stroke-width="1.6"/>'
    )
    width = end_x + 16
    height = 48 if not optional else 88
    if optional:
        # loop above the last connector
        loop_y = 16.0
        ox = last_right - 16
        parts.append(
            f'<path d="M{ox:.1f} {y:.1f} C{ox:.1f} {loop_y:.1f} {ox:.1f} {loop_y:.1f} {ox + 12:.1f} {loop_y:.1f}" '
            f'fill="none" stroke="#1a1917" stroke-width="1.6"/>'
        )
        lx = ox + 12
        for kind, text in optional:
            svg, w = box(lx, loop_y, text, kind)
            parts.append(svg)
            lx += w + 12
        parts.append(
            f'<path d="M{lx - 12:.1f} {loop_y:.1f} C{end_x - 8:.1f} {loop_y:.1f} {end_x - 8:.1f} {y:.1f} {end_x:.1f} {y:.1f}" '
            f'fill="none" stroke="#1a1917" stroke-width="1.6"/>'
        )
        width = max(width, lx + 16)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'role="img">\n'
        + "\n".join(parts)
        + "\n</svg>\n"
    )


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "source" / "_static" / "diagrams"
    out.mkdir(parents=True, exist_ok=True)
    (out / "rail-module-name.svg").write_text(
        railroad(
            [
                ("term", "name"),
                ("lit", "-"),
                ("term", "version"),
                ("lit", "-"),
                ("term", "toolchain"),
                ("lit", "-"),
                ("term", "tc-version"),
            ],
            optional=[("term", "versionsuffix")],
        ),
        encoding="utf-8",
    )
    (out / "rail-dep-tuple.svg").write_text(
        railroad(
            [("term", "name"), ("term", "version")],
            optional=[("term", "versionsuffix"), ("term", "toolchain")],
        ),
        encoding="utf-8",
    )
    (out / "rail-pin.svg").write_text(
        railroad([("term", "name"), ("lit", "exactly"), ("term", "version")]),
        encoding="utf-8",
    )
    (out / "rail-not-range.svg").write_text(
        railroad(
            [
                ("term", "name"),
                ("lit", ">="),
                ("term", "version"),
                ("lit", "<"),
                ("term", "next"),
            ]
        ),
        encoding="utf-8",
    )
    print("wrote", out)


if __name__ == "__main__":
    main()
