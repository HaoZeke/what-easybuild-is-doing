#!/usr/bin/env python3
"""Build the external Ask chunks from EasyBuild, EESSI and eb-stack.

Roots are the Git remotes in ``source/ask-sources.toml``. This script
fetches each ref into the directory named by the gitignored pointer
``.ask-cache`` (one path; default ``.ask-cache-store`` under the book),
chunks what it got, and writes ``source/_static/eb-ask-external.json``.

The book itself is still indexed from the Sphinx doctree. A remote that
fails to fetch is skipped; the pack still builds from the rest.
``--offline`` reuses the cache and does not talk to the network.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tomllib
from datetime import date
from fnmatch import fnmatch
from pathlib import Path

HEADING_RE = re.compile(
    r"^(?:"
    r"(#{1,6})\s+(.+?)\s*$"  # md / rst-ish
    r"|(?:(\*+)|(?:#{1,6}))\s+(.+?)\s*$"  # org, if the first arm missed
    r")",
    re.M,
)
ORG_HEADING_RE = re.compile(r"^(\*+)\s+(.+?)\s*$", re.M)
MD_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
RST_HEADING_RE = re.compile(
    r"^(?P<title>\S[^\n]{2,})\n(?P<u>[=\-~`:'^\"*+#]{3,})\s*$",
    re.M,
)
CODE_SPLIT_RE = re.compile(
    r"^(?:"
    r"(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|impl|trait|mod|type)\b"
    r"|class\s+\w+"
    r"|(?:async\s+)?def\s+\w+"
    r")",
    re.M,
)
MIN_CHARS = 40
MAX_CHARS = 1400


POINTER_NAME = ".ask-cache"


def expand(path: str) -> Path:
    return Path(path).expanduser().resolve()


def default_cache_root() -> Path:
    stamp = date.today().strftime("%Y-%m")
    return expand(f"~/var/scratch/{stamp}/eb-ask-cache")


def read_pointer(book: Path) -> Path | None:
    pointer = book / POINTER_NAME
    if not pointer.is_file():
        return None
    for line in pointer.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return expand(line)
    return None


def write_pointer(book: Path, cache: Path) -> None:
    pointer = book / POINTER_NAME
    pointer.write_text(
        f"# gitignored. ingest_ask_sources.py fetches remotes here.\n{cache}\n",
        encoding="utf-8",
    )


def resolve_cache(book: Path, override: str | None) -> Path:
    if override:
        cache = expand(override)
    elif os.environ.get("ASK_CACHE"):
        cache = expand(os.environ["ASK_CACHE"])
    else:
        cache = read_pointer(book) or default_cache_root()
    cache.mkdir(parents=True, exist_ok=True)
    if read_pointer(book) != cache:
        write_pointer(book, cache)
    return cache


def git(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
    )


def git_ok(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )


def rev_parse(root: Path) -> str:
    got = git_ok(["rev-parse", "--short", "HEAD"], cwd=root)
    return got.stdout.strip() if got.returncode == 0 else ""


def cache_name(spec: dict) -> str:
    if spec.get("cache"):
        return str(spec["cache"])
    url = str(spec.get("git") or spec["id"]).rstrip("/").removesuffix(".git")
    name = url.rsplit("/", 1)[-1]
    ref = str(spec.get("ref") or "HEAD").replace("/", "-")
    return f"{name}@{ref}"


def fetch_remote(spec: dict, cache: Path, offline: bool) -> tuple[Path | None, str]:
    url = spec.get("git")
    ident = spec["id"]
    if not url:
        return None, f"missing {ident} (no git remote)"
    ref = spec.get("ref") or "HEAD"
    dest = cache / cache_name(spec)
    if offline:
        if (dest / ".git").is_dir():
            return dest, f"{ident}: offline {rev_parse(dest)} at {dest}"
        return None, f"missing {ident} (offline, no cache)"
    try:
        if (dest / ".git").is_dir():
            git(["remote", "set-url", "origin", url], cwd=dest)
            fetch = git_ok(["fetch", "--depth", "1", "origin", ref], cwd=dest)
            if fetch.returncode != 0:
                return dest, f"{ident}: fetch failed ({fetch.stderr.strip() or fetch.stdout.strip()})"
            git(["checkout", "--force", "--detach", "FETCH_HEAD"], cwd=dest)
            git(["clean", "-fdq"], cwd=dest)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists() and not (dest / ".git").is_dir():
                return None, f"missing {ident} ({dest} exists and is not a git clone)"
            git(
                ["clone", "--depth", "1", "--branch", ref, url, str(dest)],
            )
        sha = rev_parse(dest)
        return dest, f"{ident}: {sha} {ref} from {url}"
    except subprocess.CalledProcessError as err:
        err_text = (err.stderr or err.stdout or str(err)).strip()
        return None, f"missing {ident} ({err_text})"


def matches(rel: str, patterns: list[str]) -> bool:
    return any(fnmatch(rel, pat) or fnmatch(Path(rel).name, pat) for pat in patterns)


def iter_files(root: Path, include: list[str], exclude: list[str]) -> list[Path]:
    out: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if include and not matches(rel, include):
            continue
        if exclude and matches(rel, exclude):
            continue
        if "/.git/" in f"/{rel}/":
            continue
        out.append(path)
    return sorted(out)


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:80] or "section"


def split_docs(text: str, suffix: str) -> list[tuple[str, str]]:
    """Heading + body pairs. Untitled lead-in is kept as the file itself."""
    if suffix == ".org":
        matches_ = list(ORG_HEADING_RE.finditer(text))
        getter = lambda m: m.group(2)
    elif suffix in {".md", ".markdown"}:
        matches_ = list(MD_HEADING_RE.finditer(text))
        getter = lambda m: m.group(2)
    elif suffix == ".rst":
        matches_ = list(RST_HEADING_RE.finditer(text))
        getter = lambda m: m.group("title")
    else:
        matches_ = list(MD_HEADING_RE.finditer(text)) or list(ORG_HEADING_RE.finditer(text))
        getter = lambda m: m.group(2)

    if not matches_:
        body = text.strip()
        return [("", body)] if len(body) >= MIN_CHARS else []

    chunks: list[tuple[str, str]] = []
    lead = text[: matches_[0].start()].strip()
    if len(lead) >= MIN_CHARS:
        chunks.append(("", lead))
    for i, match in enumerate(matches_):
        start = match.end()
        end = matches_[i + 1].start() if i + 1 < len(matches_) else len(text)
        body = text[start:end].strip()
        title = getter(match).strip()
        if len(body) >= MIN_CHARS or len(title) >= 3:
            chunks.append((title, body or title))
    return chunks


def split_code(text: str) -> list[tuple[str, str]]:
    matches_ = list(CODE_SPLIT_RE.finditer(text))
    if not matches_:
        body = text.strip()
        return [("", body)] if len(body) >= MIN_CHARS else []
    chunks: list[tuple[str, str]] = []
    lead = text[: matches_[0].start()].strip()
    if len(lead) >= MIN_CHARS:
        chunks.append(("module", lead))
    for i, match in enumerate(matches_):
        start = match.start()
        end = matches_[i + 1].start() if i + 1 < len(matches_) else len(text)
        body = text[start:end].strip()
        first = body.splitlines()[0] if body else ""
        title = re.sub(r"\s+", " ", first)[:120]
        if len(body) >= MIN_CHARS:
            chunks.append((title, body))
    return chunks


def public_url(spec: dict, rel: str, title: str) -> str:
    prefix = spec.get("url_prefix", "").rstrip("/") + "/"
    strip = spec.get("url_strip", "")
    path = rel
    if strip and path.startswith(strip):
        path = path[len(strip) :]
    if spec.get("kind") == "docs" and spec.get("id") == "easybuild-docs":
        # docs.easybuild.io drops the suffix.
        path = re.sub(r"\.(rst|md)$", ".html", path)
        return prefix + path
    if spec.get("kind") == "docs" and spec.get("id") == "eessi-docs":
        path = re.sub(r"\.(md)$", "/", path)
        if path.endswith("index/"):
            path = path[: -len("index/")]
        return prefix + path
    url = prefix + rel
    if title:
        url += "#" + slug(title)
    return url


def chunk_source(spec: dict, root: Path) -> list[dict]:
    files = iter_files(root, spec.get("include") or ["**/*"], spec.get("exclude") or [])
    chunks: list[dict] = []
    kind = spec["kind"]
    origin = spec["origin"]
    sha = rev_parse(root)
    for path in files:
        rel = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parts = (
            split_code(text)
            if kind == "code"
            else split_docs(text, path.suffix.lower())
        )
        for title, body in parts:
            body = body[:MAX_CHARS]
            if len(body.strip()) < MIN_CHARS:
                continue
            heading = title or path.stem
            chunks.append(
                {
                    "doc": f"{spec['id']}:{rel}",
                    "anchor": slug(heading),
                    "title": heading,
                    "crumb": f"{origin} · {rel}",
                    "kind": kind,
                    "origin": origin,
                    "source": spec["id"],
                    "rev": sha,
                    "name": heading if kind == "code" else "",
                    "text": body,
                    "url": public_url(spec, rel, title),
                }
            )
    return chunks


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=here / "source" / "ask-sources.toml",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=here / "source" / "_static" / "eb-ask-external.json",
    )
    parser.add_argument(
        "--cache",
        help="shallow-clone root; written to .ask-cache if omitted",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="do not fetch; use whatever the cache already holds",
    )
    args = parser.parse_args(argv)
    cache = resolve_cache(here, args.cache)
    spec = tomllib.loads(args.manifest.read_text(encoding="utf-8"))
    all_chunks: list[dict] = []
    reports: list[str] = []
    revs: dict[str, str] = {}
    seen: dict[str, Path] = {}
    for source in spec.get("source", []):
        key = cache_name(source)
        if key in seen:
            root, fetch_report = seen[key], f"{source['id']}: reuse {key}"
        else:
            root, fetch_report = fetch_remote(source, cache, args.offline)
            if root is not None:
                seen[key] = root
        print(fetch_report, file=sys.stderr)
        reports.append(fetch_report)
        if root is None:
            continue
        chunks = chunk_source(source, root)
        all_chunks.extend(chunks)
        sha = rev_parse(root)
        revs[source["id"]] = sha
        print(
            f"{source['id']}: {len(chunks)} chunks @ {sha}",
            file=sys.stderr,
        )
    payload = {
        "version": 1,
        "n": len(all_chunks),
        "cache": str(cache),
        "revs": revs,
        "chunks": all_chunks,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"wrote {len(all_chunks)} chunks ({args.out.stat().st_size / 1024:.0f} kB) cache={cache}",
        file=sys.stderr,
    )
    missing = [r for r in reports if r.startswith("missing ")]
    return 1 if missing and not all_chunks else 0


if __name__ == "__main__":
    raise SystemExit(main())
