#!/usr/bin/env bash
#SBATCH --job-name=guide-build
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=8
#SBATCH --time=00:40:00
#SBATCH --output=guide-build-%j.out

# Acceptance test: one org source, three renderings, and the widget
# present in the html and absent from the epub.
# Nothing here compiles, but pixi fetches Emacs and Sphinx, so it runs on a
# compute node rather than the login shell.
# Site-specific: a disk-backed scratch rather than a RAM-backed /tmp.
export TMPDIR=${TMPDIR:-/var/lib/builds/tmp}
# pixi is installed per-user and is not on a non-interactive PATH, and
# neither is the eb-stack binary the charmap export needs.
export PATH="$HOME/.pixi/bin:$HOME/.local/bin:$PATH"
set -euo pipefail

SRC=${GUIDE_SRC:-$PWD}
LOG=${GUIDE_LOGDIR:-$HOME/logs}/${SLURM_JOB_NAME}-${SLURM_JOB_ID}.log

mkdir -p "$(dirname "$LOG")"
cd "$SRC"

{
    echo "=== host: $(hostname), job ${SLURM_JOB_ID}, $(date -Is) ==="
    pixi --version
    echo
    # An interrupted build leaves artifacts the epub builder cannot classify,
    # and -W makes the next build fail on them. Clear them rather than
    # carrying a previous run's wreckage into this one.
    find build -name '*.bak' -type f -delete 2>/dev/null || true

    echo "=== pixi run -e docs all ==="
    pixi run -e docs all
    echo
    echo "=== what came out ==="
    for target in html singlehtml epub; do
        if [ -d "build/$target" ]; then
            printf '%-12s %s files, %s\n' "$target" \
                "$(find "build/$target" -type f | wc -l)" \
                "$(du -sh "build/$target" | cut -f1)"
        else
            echo "$target MISSING"
        fi
    done
    echo
    echo "=== the epub, and whether it is a real one ==="
    ls -l build/epub/*.epub 2>/dev/null || echo "no .epub produced"
    echo
    echo "=== widget survived org -> rst -> html? ==="
    grep -c 'eb-widget' build/html/01-an-easyconfig-is-python.html \
        || echo "NO eb-widget div in the html"
    echo "=== and is absent from the epub, as designed? ==="
    # Match the markup, not the string: build/epub/_static legitimately
    # contains files *named* eb-widget.*, so grepping the whole tree tests
    # nothing. What must be absent is the mount div and any reference to the
    # assets from the pages.
    if grep -rq 'class="eb-widget"' --include='*.xhtml' --include='*.html' \
        build/epub/ 2>/dev/null; then
        echo "FAIL: mount div present in epub"
    else
        echo "ok: no mount div in epub"
    fi
    if grep -rq 'eb-widget\.\(css\|js\)' --include='*.xhtml' --include='*.html' \
        build/epub/ 2>/dev/null; then
        echo "FAIL: epub pages still link the widget assets"
    else
        echo "ok: epub pages link no widget assets"
    fi
    echo "=== and the epub still carries the code itself? ==="
    grep -c 'code-server' build/epub/01-an-easyconfig-is-python.xhtml

    echo "=== islands: the epub archive carries no widget assets ==="
    # The .epub archive is the artifact, not build/epub/. Sphinx stages
    # html_static_path there regardless and epub_exclude_files acts on what
    # gets packed, so asserting on the staging directory tests the wrong
    # thing and fails on files that never ship.
    python3 - <<'EOF'
import zipfile

# What must be absent is the island machinery: the runtime, the engine, the
# widget stylesheet, and the charmap it fetches. eb-transcript.css is a
# different thing and belongs here, because transcripts do render in the epub
# and epub_exclude_files deliberately keeps it. Asserting on the "eb-" prefix
# catches that file too and fails a build that is correct.
WIDGET = ("eb-widget", "eb-charmap", "eb-templates", "eb-hierarchy")
z = zipfile.ZipFile("build/epub/WhatEasyBuildIsDoing.epub")
names = z.namelist()
stowaways = [n for n in names if any(part in n for part in WIDGET)]
if stowaways:
    print("FAIL: widget assets packed into the epub:", stowaways)
else:
    print("ok: no widget assets in the epub archive")

# And the transcript stylesheet has to be there, or the exclusion list has
# over-reached and the transcripts render unstyled on an e-reader.
if any("eb-transcript.css" in n for n in names):
    print("ok: the epub archive carries eb-transcript.css")
else:
    print("FAIL: eb-transcript.css missing from the epub archive")
EOF

    echo "=== every chapter reached all three builders ==="
    for ch in orgmode/[0-9]*.org; do
        stem=$(basename "$ch" .org)
        for target in html/$stem.html singlehtml/index.html epub/$stem.xhtml; do
            [ -f "build/$target" ] || { echo "FAIL: build/$target missing"; }
        done
    done
    echo "ok: checked $(ls orgmode/[0-9]*.org | wc -l) chapters"

    echo "=== transcripts: rendered, with provenance, in all three ==="
    # Every chapter holding an ebtranscript block, not a hand-written list:
    # a new transcript in a new chapter has to be checked too, and naming
    # chapter 1 by hand meant it was not.
    for ch in $(grep -l 'begin_src ebtranscript' orgmode/[0-9]*.org \
                | xargs -n1 basename | sed 's/\.org$//'); do
        for f in "build/html/$ch.html" \
                 "build/singlehtml/index.html" \
                 "build/epub/$ch.xhtml"; do
            printf '%-46s ' "$ch -> $(basename $(dirname "$f"))"
            if grep -q 'eb-transcript' "$f" && grep -q 'Recorded:' "$f"; then
                echo "ok"
            else
                echo "FAIL: transcript or its provenance missing in $f"
            fi
        done
    done

    echo "=== engine: every exported table reached the html assets ==="
    python3 - <<'EOF'
import json

table = json.load(open("build/html/_static/eb-charmap.json"))
print("ok: charmap prefix", table["prefix"], "entries", len(table["charmap"]))

spec = json.load(open("build/html/_static/eb-templates.json"))
print("ok: templates", len(spec["constants"]), "constants,",
      len(spec["derived"]), "derived rules")

hier = json.load(open("build/html/_static/eb-hierarchy.json"))
gens = [g["parent"]["name"] + "-" + g["parent"]["version"] for g in hier["generations"]]
print("ok: hierarchies", ", ".join(gens))
EOF

    echo "=== engine: the browser copy agrees with the binary ==="
    # Two implementations of one rule, so compare them rather than trust them.
    # Skipped rather than failed when node is absent: the check runs on the
    # operator's machine too, and a missing interpreter is not a book defect.
    if command -v node >/dev/null 2>&1 && command -v "${EB_STACK:-eb-stack}" >/dev/null 2>&1; then
        node scripts/crosscheck.js || echo "FAIL: engine disagrees with eb-stack"
        # Rules agreeing is not the same as the functions a page calls
        # working, so exercise those against the chapters' own samples.
        node scripts/smoke-widgets.js || echo "FAIL: a widget entry point is broken"
        # The tutorial says "you should see X" at every step. Those are
        # promises to a reader who will conclude the page is broken when one
        # does not hold, so they are checked rather than trusted.
        node scripts/check-tutorial.js || echo "FAIL: the tutorial promises something the engine does not do"
        # And the only check that sees what a reader sees. Skips itself when
        # there is no browser or nothing served, which is the case on this
        # host; the operator runs it against scripts/serve.sh.
        node scripts/browser-check.js || echo "FAIL: the page is not live in a browser"
        # The reader's own three mechanisms, in a real browser for the same
        # reason: a knowl that does not fetch, a search that ranks nothing and
        # a note that does not come back all look fine to a node stub.
        node scripts/browser-check-reader.js || echo "FAIL: a reader mechanism is broken"
    else
        echo "skipped: node or eb-stack absent on this host"
    fi

    echo "=== islands: a chapter with widgets loads the runtime ==="
    if grep -q 'eb-widget\.js' build/html/01-an-easyconfig-is-python.html; then
        echo "ok: ch1 (3 widgets) links the runtime"
    else
        echo "FAIL: ch1 has widgets but no runtime"
    fi

    echo "=== islands: a chapter without widgets loads nothing ==="
    # The afterword is prose only. Under the islands model it must ship no
    # widget JavaScript and no widget CSS at all; that is the property
    # Sphinx does not give a page and the extension has to take away.
    if grep -qE 'eb-widget\.(js|css)' \
        build/html/afterword-when-easybuild-is-the-wrong-tool.html; then
        echo "FAIL: afterword has no widgets but still links the runtime"
    else
        echo "ok: afterword (no widgets) links neither js nor css"
    fi

    echo "=== voice: impersonal monograph, not memoir I ==="
    python3 scripts/check-voice.py \
        || echo "FAIL: book voice is not impersonal"

    echo "=== lesson: every chapter has the devices it claims ==="
    python3 scripts/check-lesson.py \
        || echo "FAIL: a lesson device is missing or malformed"

    echo "=== islands: hydration strategy reaches the markup ==="
    grep -o 'data-eb-hydrate="[a-z]*"' build/html/01-an-easyconfig-is-python.html \
        | sort | uniq -c || echo "FAIL: no hydration attribute emitted"
} 2>&1 | tee "$LOG"

echo "wrote $LOG"
