#!/usr/bin/env bash
# Pull the rendered book off the build host and serve it locally.
#
# Pull a already-rendered tree from a build host and serve it locally.
# Nothing here builds. GUIDE_HOST must be set (ssh Host). If the remote
# tree is stale, run scripts/build.sbatch there first.
set -euo pipefail

if [[ -z "${GUIDE_HOST:-}" ]]; then
    echo "serve: set GUIDE_HOST to the ssh Host that has the rendered book" >&2
    exit 2
fi
host="$GUIDE_HOST"
remote="${GUIDE_REMOTE:-Git/tmp/what-easybuild-is-doing/build}"
port="${GUIDE_PORT:-8173}"
here="$(cd "$(dirname "$0")/.." && pwd)"
local_dir="$here/build"

if ! ssh -o BatchMode=yes "$host" "test -f $remote/html/index.html" 2>/dev/null; then
    echo "serve: no rendered book at $host:$remote/html" >&2
    echo "serve: submit scripts/build.sbatch on $host first." >&2
    exit 1
fi

mkdir -p "$local_dir"
# singlehtml and the epub come too: one command, every format the book has.
rsync -az --delete \
    "$host:$remote/html/" "$local_dir/html/"
rsync -az --delete \
    "$host:$remote/singlehtml/" "$local_dir/singlehtml/"
rsync -az \
    "$host:$remote/epub/"*.epub "$local_dir/" 2>/dev/null || true

cat <<MSG

  the book        http://localhost:$port/html/
  one long page   http://localhost:$port/singlehtml/
  epub            $(ls "$local_dir"/*.epub 2>/dev/null | head -1 || echo "none pulled")

  Ctrl-C to stop.

MSG

# Serve the build root rather than html/, so the singlehtml rendering is
# reachable from the same server instead of needing a second one.
exec python3 -m http.server "$port" --directory "$local_dir"
