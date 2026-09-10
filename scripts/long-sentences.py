"""Print the sentences a readability gate would flag, with their text.

proseguard reports a line number and a word count, which is enough to know
a sentence is too long and not enough to fix it. This prints the sentence.

Known limit: the split requires the next sentence to begin with a capital,
an = or a *, so a sentence starting with a lowercase identifier ("npm's
model is ...") is joined to the one before it and the pair is reported as
one long sentence. Read the text before splitting anything.

Run: python3 scripts/long-sentences.py orgmode/13-*.org
"""

from __future__ import annotations

import re
import sys

LIMIT = 25


def prose_lines(text: str) -> list[str]:
    out, skip = [], False
    for line in text.split("\n"):
        low = line.lower()
        if low.startswith("#+begin_"):
            skip = True
            continue
        if low.startswith("#+end_"):
            skip = False
            continue
        # An org heading is one or more asterisks then whitespace. Bold
        # markup also starts a line with an asterisk when the paragraph
        # happens to wrap there, and dropping those lines silently removes
        # prose from the count.
        if skip or line.startswith(("#+", "|", ":")) or re.match(r"^\*+\s", line):
            continue
        # An org link is one phrase to a reader; counting its target as
        # words would flag sentences that are not long.
        line = re.sub(r"\[\[[^]]*\]\[([^]]*)\]\]", r"\1", line)
        line = re.sub(r"\[\[([^]]*)\]\]", r"\1", line)
        out.append(line)
    return out


def main(paths: list[str]) -> int:
    flagged = 0
    for path in paths:
        text = open(path).read()
        # Join wrapped lines into paragraphs, then split on sentence ends.
        paras = re.split(r"\n\s*\n", "\n".join(prose_lines(text)))
        for para in paras:
            body = " ".join(para.split())
            if not body:
                continue
            for sentence in re.split(r"(?<=[.?!])\s+(?=[A-Z=*\"])", body):
                words = len(re.findall(r"\S+", sentence))
                if words > LIMIT:
                    flagged += 1
                    print(f"{path}  {words} words")
                    print(f"    {sentence}")
    print(f"\n{flagged} sentence(s) over {LIMIT} words")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
