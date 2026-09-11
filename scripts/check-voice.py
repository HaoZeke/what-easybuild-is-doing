"""Gate book prose to impersonal technical monograph voice.

The book is Higham/K&R, not a memoir and not pop-sci. Mechanism is the
grammatical subject. Authorial I/we are banned. Software that wants,
refuses, sits, or cheerfully offers is banned. you is allowed only in a
tutorial step (the 00-tutorial chapter, and exercise bodies).
Headings are scanned: they are exposition.

Quoted operator speech, begin_quote blocks, and operator checklist
tables may keep I.

Run: python3 scripts/check-voice.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORG = ROOT / "orgmode"

SKIP_BEGIN = re.compile(
    r"^#\+begin_(src|example|quote|export|transcript)\b", re.I
)
SKIP_END = re.compile(r"^#\+end_(src|example|quote|export|transcript)\b", re.I)
EX_BEGIN = re.compile(r"^#\+begin_(exercise|solution)\b", re.I)
EX_END = re.compile(r"^#\+end_(exercise|solution)\b", re.I)

# Authorial first person, not a lone capital i in a path.
I_RE = re.compile(r"(?<![A-Za-z/])\bI\b(?!/)")
WE_RE = re.compile(r"\b[Ww]e\b")
YOU_RE = re.compile(r"\b[Yy]ou\b")
ANTHRO_RE = re.compile(
    r"\b(wants?|refuses?|sits?|sitting|cheerfully)\b", re.I
)

# A person sitting down is not software sitting.
PERSON_SIT = re.compile(r"\bsit down\b", re.I)

# "you want" is a you-rule hit, not software-wants, when you is allowed.
YOU_WANT = re.compile(r"\byou want\b", re.I)

# A person or site wanting something is not software wanting it.
PERSON_WANT = re.compile(
    r"\b(everyone|almost everyone|colleague|somebody|someone|"
    r"nobody|reader who|they|site|what they)\s+wants?\b",
    re.I,
)

# Org links are [[target]] or [[target][description]], and a wrap may
# split one across a line. The filename 09-a-hook-changes-a-file-you-...
# is not authorial you.
LINK_RE = re.compile(r"\[\[[^\]]*(?:\]\[[^\]]*)?\]\]")


def is_tutorial(path: pathlib.Path) -> bool:
    return path.name.startswith("00-tutorial")


def quoted_spans(line: str, in_quote: bool) -> tuple[list[tuple[int, int]], bool]:
    spans: list[tuple[int, int]] = []
    start = 0 if in_quote else None
    for i, ch in enumerate(line):
        if ch != '"':
            continue
        if start is None:
            start = i
        else:
            spans.append((start, i + 1))
            start = None
    if start is not None:
        spans.append((start, len(line)))
        return spans, True
    return spans, False


def in_spans(idx: int, spans: list[tuple[int, int]]) -> bool:
    return any(a <= idx < b for a, b in spans)


def prose_rows(text: str):
    skip = False
    exercise = False
    in_quote = False
    for n, line in enumerate(text.splitlines(), 1):
        if SKIP_BEGIN.match(line):
            skip = True
            continue
        if SKIP_END.match(line):
            skip = False
            continue
        if EX_BEGIN.match(line):
            exercise = True
            continue
        if EX_END.match(line):
            exercise = False
            in_quote = False
            continue
        if skip:
            continue
        if line.startswith(("#+", ":")):
            continue
        yield n, line, exercise, in_quote
        _, in_quote = quoted_spans(line, in_quote)


def main() -> int:
    problems: list[str] = []
    chapters = sorted(ORG.glob("*.org"))
    if not chapters:
        print("FAIL: no orgmode files")
        return 1

    for path in chapters:
        tutorial = is_tutorial(path)
        text = path.read_text()
        for n, line, exercise, was_quote in prose_rows(text):
            # Operator checklists keep I.
            if line.lstrip().startswith("|"):
                continue
            quotes, _ = quoted_spans(line, was_quote)
            for m in I_RE.finditer(line):
                if in_spans(m.start(), quotes):
                    continue
                problems.append(f"{path.relative_to(ROOT)}:{n}: authorial I")
            for m in WE_RE.finditer(line):
                if in_spans(m.start(), quotes):
                    continue
                problems.append(f"{path.relative_to(ROOT)}:{n}: authorial we")
            link_spans = [m.span() for m in LINK_RE.finditer(line)]
            last = line.rfind("[[")
            if last != -1 and line[last:].count("]]") == 0:
                link_spans.append((last, len(line)))
            if not (tutorial or exercise):
                for m in YOU_RE.finditer(line):
                    if in_spans(m.start(), quotes) or in_spans(m.start(), link_spans):
                        continue
                    problems.append(
                        f"{path.relative_to(ROOT)}:{n}: you outside a tutorial step"
                    )
            for m in ANTHRO_RE.finditer(line):
                if in_spans(m.start(), quotes):
                    continue
                word = m.group(0).lower()
                if word in {"sit", "sits", "sitting"} and PERSON_SIT.search(line):
                    continue
                if word in {"want", "wants"} and YOU_WANT.search(line) and (
                    tutorial or exercise
                ):
                    continue
                if word in {"want", "wants"} and PERSON_WANT.search(line):
                    continue
                if word in {"refuse", "refuses"} and re.search(
                    r"\b(you will refuse|reader refuse)\b", line, re.I
                ):
                    # operator speech / expected-output grammar; rewrite the
                    # tutorial line separately rather than treat as software.
                    if "reader refuse" in line:
                        problems.append(
                            f"{path.relative_to(ROOT)}:{n}: expected-output grammar"
                        )
                    continue
                problems.append(
                    f"{path.relative_to(ROOT)}:{n}: software {word}"
                )

    if problems:
        print(f"FAIL: {len(problems)} voice hit(s)")
        for p in problems:
            print(p)
        return 1
    print("ok: book voice is impersonal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
