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
# pixi is installed per-user and is not on a non-interactive PATH.
export PATH="$HOME/.pixi/bin:$PATH"
set -euo pipefail

SRC=${GUIDE_SRC:-$HOME/Git/tmp/what-easybuild-is-doing}
LOG=${GUIDE_LOGDIR:-$HOME/logs}/${SLURM_JOB_NAME}-${SLURM_JOB_ID}.log

mkdir -p "$(dirname "$LOG")"
cd "$SRC"

{
    echo "=== host: $(hostname), job ${SLURM_JOB_ID}, $(date -Is) ==="
    pixi --version
    echo
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
z = zipfile.ZipFile("build/epub/WhatEasyBuildIsDoing.epub")
stowaways = [n for n in z.namelist() if "eb-" in n]
if stowaways:
    print("FAIL: widget assets packed into the epub:", stowaways)
else:
    print("ok: no widget assets in the epub archive")
EOF

    echo "=== transcripts: rendered, with provenance, in all three ==="
    for f in build/html/01-an-easyconfig-is-python.html \
             build/singlehtml/index.html \
             build/epub/01-an-easyconfig-is-python.xhtml; do
        printf '%-46s ' "$(basename $(dirname $f))/$(basename $f)"
        if grep -q 'eb-transcript' "$f" && grep -q 'Recorded:' "$f"; then
            echo "ok"
        else
            echo "FAIL: transcript or its provenance missing"
        fi
    done

    echo "=== engine: the charmap was exported and is well formed ==="
    python3 -c "import json;d=json.load(open('build/html/_static/eb-charmap.json'));print('ok: prefix',d['prefix'],'entries',len(d['charmap']))"

    echo "=== islands: a chapter with widgets loads the runtime ==="
    if grep -q 'eb-widget\.js' build/html/01-an-easyconfig-is-python.html; then
        echo "ok: ch1 (3 widgets) links the runtime"
    else
        echo "FAIL: ch1 has widgets but no runtime"
    fi

    echo "=== islands: a chapter without widgets loads nothing ==="
    # Chapter 4 is prose only. Under the islands model it must ship no widget
    # JavaScript and no widget CSS at all; that is the property Sphinx does
    # not give you and the extension has to take away per page.
    if grep -qE 'eb-widget\.(js|css)' build/html/04-the-robot.html; then
        echo "FAIL: ch4 has no widgets but still links the runtime"
    else
        echo "ok: ch4 (no widgets) links neither js nor css"
    fi

    echo "=== islands: hydration strategy reaches the markup ==="
    grep -o 'data-eb-hydrate="[a-z]*"' build/html/01-an-easyconfig-is-python.html \
        | sort | uniq -c || echo "FAIL: no hydration attribute emitted"
} 2>&1 | tee "$LOG"

echo "wrote $LOG"
