"""Hold the lesson structure to the numbers it was designed against.

The Carpentries lesson-development training gives figures rather than
opinions: two to four objectives per episode, an exercise every fifteen to
twenty minutes, and a fifth objective means the unit is doing two jobs.
Those are checkable, so they are checked, because a structure nobody
enforces drifts back into prose within a few edits.

Run: python3 scripts/check-lesson.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORG = ROOT / "orgmode"

# Two exemptions, for opposite reasons, named here so each is a decision
# rather than an oversight.
#
# Chapter 13 is the closing argument rather than a lesson: it teaches no
# mechanism and assesses nothing, so an exercise would be furniture.
#
# The tutorial is the other way round. Every step of it is an instruction
# followed by what the reader should see, which is assessment throughout, so
# a block labelled "exercise" inside it would single out one step as the
# assessed one.
NO_EXERCISE = {
    "13-when-easybuild-is-the-wrong-tool",
    "00-tutorial-read-an-easyconfig",
}
NO_OBJECTIVES = {"13-when-easybuild-is-the-wrong-tool"}

BLOCK = re.compile(
    r"^#\+begin_(objectives|exercise|solution)\s*$(.*?)^#\+end_\1\s*$",
    re.S | re.M,
)
ATTR = re.compile(r"^#\+ATTR_EB:\s*(.*)$", re.M)


def numbered_items(body: str) -> int:
    return len(re.findall(r"^\s*\d+\.\s", body, re.M))


def main() -> int:
    problems: list[str] = []
    seen_ids: dict[str, str] = {}
    total_exercises = 0

    chapters = sorted(p for p in ORG.glob("[0-9]*.org"))
    if not chapters:
        print("FAIL: no chapters found")
        return 1

    for path in chapters:
        stem = path.stem
        text = path.read_text()
        words = len(re.findall(r"\S+", text))

        blocks = [(m.group(1), m.group(2)) for m in BLOCK.finditer(text)]
        kinds = [k for k, _ in blocks]

        # A solution is nested inside its exercise, so the exercise's own
        # body has already swallowed it and it is counted directly.
        n_solutions = text.count("#+begin_solution")

        if stem in NO_OBJECTIVES:
            if kinds or n_solutions:
                problems.append(
                    f"{stem}: is exempt from lesson blocks but carries {kinds}"
                )
            continue

        # Objectives: exactly one block, two to four items.
        if kinds.count("objectives") != 1:
            problems.append(
                f"{stem}: has {kinds.count('objectives')} objectives blocks, wants 1"
            )
        else:
            body = next(b for k, b in blocks if k == "objectives")
            n = numbered_items(body)
            if not 2 <= n <= 5:
                problems.append(
                    f"{stem}: {n} objectives; two to four is the range, and a "
                    f"fifth usually means the chapter is doing two jobs"
                )

        # Exercises: at least one, and one per ~1500 words of chapter.
        n_ex = kinds.count("exercise")
        total_exercises += n_ex
        if stem not in NO_EXERCISE:
            if n_ex == 0:
                problems.append(f"{stem}: no exercise, and it is not exempt")
            wanted = max(1, round(words / 1500))
            if n_ex < wanted:
                problems.append(
                    f"{stem}: {words} words with {n_ex} exercise(s); about "
                    f"{wanted} would keep the assessment interval"
                )

            # Every exercise carries a solution.
            if n_solutions != n_ex:
                problems.append(
                    f"{stem}: {n_ex} exercise(s) but {n_solutions} "
                    f"solution(s); a reader working alone has nobody to ask"
                )
        for attrs in ATTR.findall(text):
            m = re.search(r":id\s+(\S+)", attrs)
            if not m:
                problems.append(f"{stem}: an ATTR_EB line carries no :id")
                continue
            ident = m.group(1)
            if ident in seen_ids:
                problems.append(
                    f"{ident}: used in both {seen_ids[ident]} and {stem}; "
                    f"an id is how a reader refers to one exercise"
                )
            seen_ids[ident] = stem

    index = ORG / "exercises.org"
    if not index.exists():
        problems.append("no exercises.org, so the exercise index has no home")
    elif "exercise-index" not in index.read_text():
        problems.append("exercises.org does not invoke the exercise index")

    if problems:
        for p in problems:
            print("FAIL " + p)
        return 1

    print(
        f"lesson: {len(chapters) - len(NO_OBJECTIVES)} chapters with "
        f"objectives, {total_exercises} exercises, every one with an id and "
        f"a solution"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
