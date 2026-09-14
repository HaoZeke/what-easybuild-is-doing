"""Ask: retrieval over the book, built at build time and run in the browser.

Ask ranks this book's pages plus ingested EasyBuild, EESSI, and eb-stack trees.
There, retrieval is local and a model writes the answer; the split is stated
out loud in its own documentation: "Retrieval is local and needs nothing. The
answer needs a model, and you choose which."

This book has no server, so the split is the whole feature. What ships is the
retrieval half: a pack of the book's own chunks plus the EasyBuild, EESSI
and eb-stack docs and code that ``scripts/ingest_ask_sources.py`` walked,
with the term statistics precomputed, ranked in the reader's browser,
answering a question with the passages that answer it, opened in place. If the reader has a model endpoint
of their own they can point the panel at it and get prose with citations; if
they do not, they get the passages and a sentence saying nothing wrote an
answer. Neither case fabricates one.

What the pack contains, and why each part:

``chunks``
    One per section, plus one per dive-in detail and one per exercise. The
    finer grain matters for a reference book: a reader asking what
    ``start_dir`` is should land on the definition, not on the chapter that
    mentions it eleven times.

``df`` and ``idf``
    Document frequency, and its logarithm computed here. The logarithm is in
    the pack rather than in the browser because that is the one operation two
    maths libraries are allowed to disagree about in the last bit, and a
    scoring difference in the last bit swaps exact neighbours in a ranking
    that a check then reports as a disagreement.

``avgdl``, ``k1``, ``b``
    BM25's parameters, in the pack so the reference ranker in
    ``scripts/ask-rank.py`` and the browser's cannot drift apart by editing
    one of them.

The tokenizer is duplicated in three places (here, ``eb-ask.js``,
``scripts/ask-rank.py``) and ``scripts/check-ask.js`` fails the build when
the three stop agreeing on a ranking.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

from docutils import nodes
from sphinx.util import logging

__version__ = "0.1.0"

logger = logging.getLogger(__name__)

#: BM25, at its usual settings. In the pack, not just here.
K1 = 1.2
B = 0.75

#: A token is two or more of letter, digit or underscore. Underscores are
#: kept because ``start_dir`` and ``sanity_check_paths`` are the vocabulary
#: of this book, and a tokenizer that splits them indexes neither.
TOKEN_RE = re.compile(r"[a-z0-9_]{2,}")

#: Words a question is asked with rather than answered from.
STOP = frozenset(
    """
    the and for that this with what how why when where which are was were
    does did doing have has had been being from into out not but can could
    should would will you your our its their them they it is be of in on to
    at by as or if do about over under than then there here all any some
    """.split()
)


def tokenize(text: str) -> list[str]:
    """Lowercase, split, and split again on underscores.

    A token with an underscore is indexed whole *and* in parts, so a reader
    who types "start dir" and a reader who types "start_dir" reach the same
    chunk. The three implementations of this function have to agree
    character for character; ``scripts/check-ask.js`` is what says they do.
    """
    out: list[str] = []
    for raw in TOKEN_RE.findall(text.lower()):
        out.append(raw)
        if "_" in raw:
            out.extend(part for part in raw.split("_") if len(part) >= 2)
    return out


def query_tokens(text: str) -> list[str]:
    return [t for t in tokenize(text) if t not in STOP]


def _section_title(section: nodes.Element) -> str:
    for child in section.children:
        if isinstance(child, nodes.title):
            return child.astext()
    return ""


def _own_text(section: nodes.Element) -> str:
    """A section's own text, excluding the sections nested inside it."""
    parts = []
    for child in section.children:
        if isinstance(child, nodes.section):
            continue
        if isinstance(child, nodes.title):
            continue
        parts.append(child.astext())
    return "\n".join(parts)


def _anchor(node: nodes.Element) -> str:
    ids = node.get("ids") or []
    return ids[0] if ids else ""


def _enclosing_anchor(node: nodes.Element) -> str:
    """The nearest anchor a link can actually reach.

    Transcripts and lesson blocks do not all carry ids of their own, and a
    result that cannot be linked to is a result a reader cannot open. So the
    nearest ancestor with an id decides where the reader lands.
    """
    cur = node
    while cur is not None:
        anchor = _anchor(cur)
        if anchor:
            return anchor
        cur = cur.parent
    return ""


def _is_transcript(node) -> bool:
    return isinstance(node, nodes.container) and "eb-transcript" in (
        node.get("classes") or []
    )


def _external_chunks(app) -> list[dict]:
    """Chunks from EasyBuild / EESSI / eb-stack, written by ingest_ask_sources.

    The file is optional. A book built without the trees still ranks its own
    pages; a book built after ingest ranks those pages too.
    """
    src = Path(app.srcdir) / "_static" / "eb-ask-external.json"
    if not src.is_file():
        return []
    try:
        data = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        logger.warning("ask: could not read %s (%s)", src, err)
        return []
    raw = data.get("chunks") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        logger.warning("ask: %s is not a chunk list", src)
        return []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "")
        if len(text.strip()) < 40:
            continue
        out.append(
            {
                "doc": str(item.get("doc") or item.get("source") or "external"),
                "anchor": str(item.get("anchor") or ""),
                "title": str(item.get("title") or ""),
                "crumb": str(item.get("crumb") or item.get("origin") or ""),
                "kind": str(item.get("kind") or "docs"),
                "origin": str(item.get("origin") or ""),
                "source": str(item.get("source") or ""),
                "name": str(item.get("name") or ""),
                "text": text,
                "url": str(item.get("url") or ""),
            }
        )
    logger.info("eb_ask: %d external chunks from %s", len(out), src.name)
    return out


def _chunks_for_doc(env, docname: str, doctree: nodes.document) -> list[dict]:
    chunks: list[dict] = []
    doc_title = env.titles.get(docname)
    crumb = doc_title.astext() if doc_title is not None else docname

    for section in doctree.findall(nodes.section):
        text = _own_text(section)
        if len(text.strip()) >= 40:
            chunks.append(
                {
                    "doc": docname,
                    "anchor": _anchor(section),
                    "title": _section_title(section) or crumb,
                    "crumb": crumb,
                    "kind": "prose",
                    "origin": "this book",
                    "source": "book",
                    "text": text,
                }
            )

    # The finer grain. A definition, an exercise and an error message are
    # things a reader asks for by name, and folding them into whichever
    # section is longest makes them unreachable: BM25 divides by length, so
    # a two-line definition inside a long chapter loses to the chapter.
    for node in doctree.findall():
        tag = node.__class__.__name__
        if tag == "eb_detail":
            chunks.append(
                {
                    "doc": docname,
                    "anchor": _anchor(node) or _enclosing_anchor(node),
                    "title": node.get("eb_title", ""),
                    "crumb": crumb,
                    "kind": node.get("eb_kind", "reference"),
                    "origin": "this book",
                    "source": "book",
                    "name": node.get("eb_name", ""),
                    "text": node.astext(),
                }
            )
        elif tag == "exercise_node":
            chunks.append(
                {
                    "doc": docname,
                    "anchor": node.get("target_id", "")
                    or _enclosing_anchor(node),
                    "title": node.get("title", "") or "exercise",
                    "crumb": crumb,
                    "kind": "exercise",
                    "origin": "this book",
                    "source": "book",
                    "name": node.get("ident", ""),
                    "text": node.astext(),
                }
            )
        elif _is_transcript(node):
            caption = ""
            for child in node.children:
                if isinstance(child, nodes.paragraph) and "eb-transcript-caption" in (
                    child.get("classes") or []
                ):
                    caption = child.astext()
                    break
            chunks.append(
                {
                    "doc": docname,
                    "anchor": _enclosing_anchor(node),
                    "title": caption or "a recording",
                    "crumb": crumb,
                    "kind": "transcript",
                    "origin": "this book",
                    "source": "book",
                    "text": node.astext(),
                }
            )
    return chunks


def _build_pack(app) -> dict:
    env = app.env
    raw: list[dict] = []
    for docname in sorted(env.all_docs):
        try:
            doctree = env.get_doctree(docname)
        except Exception as err:  # a document Sphinx could not give us
            logger.warning("ask: no doctree for %s (%s)", docname, err)
            continue
        raw.extend(_chunks_for_doc(env, docname, doctree))
    raw.extend(_external_chunks(app))

    chunks = []
    df: Counter = Counter()
    for i, c in enumerate(raw):
        # The title counts as content, twice. A section called "The strip
        # level" should win the question "what is a strip level" against a
        # chapter that uses the phrase in passing, and a separate title
        # ranker would need its own fusion weight to say the same thing.
        body = tokenize(c["text"])
        title = tokenize(c["title"]) + tokenize(c.get("name", ""))
        toks = body + title + title
        tf = Counter(toks)
        for term in tf:
            df[term] += 1
        # The link is computed here rather than in the browser, because the
        # html and singlehtml builders disagree about what a document's uri
        # is and only the builder knows which one is running. External
        # chunks already carry a public URL; do not rewrite those.
        if c.get("url"):
            url = c["url"]
        else:
            try:
                page = app.builder.get_target_uri(c["doc"]).split("#")[0]
            except Exception:
                page = c["doc"]
            url = f"{page}#{c['anchor']}" if c["anchor"] else page
        chunks.append(
            {
                "id": f"c{i}",
                "doc": c["doc"],
                "url": url,
                "anchor": c["anchor"],
                "title": c["title"],
                "crumb": c["crumb"],
                "kind": c["kind"],
                "origin": c.get("origin", ""),
                "source": c.get("source", ""),
                "name": c.get("name", ""),
                # Enough to show a passage and to mark the query terms in it.
                # The whole chapter is a click away and the pack is a
                # download, so this is where the trade sits.
                "text": c["text"][:1400],
                "dl": len(toks),
                "tf": dict(sorted(tf.items())),
            }
        )

    n = len(chunks) or 1
    avgdl = sum(c["dl"] for c in chunks) / n
    # BM25's idf, with the +1 that keeps a term in every chunk from scoring
    # negative. Computed here so the browser never calls a logarithm.
    idf = {
        term: math.log(1.0 + (n - freq + 0.5) / (freq + 0.5))
        for term, freq in sorted(df.items())
    }
    return {
        "version": __version__,
        "k1": K1,
        "b": B,
        "n": n,
        "avgdl": avgdl,
        "idf": idf,
        "chunks": chunks,
    }


def _write_pack(app, exc):
    if exc is not None or app.builder.name.startswith("epub"):
        return
    if not app.builder.name.startswith(("html", "dirhtml", "singlehtml")):
        return
    pack = _build_pack(app)
    out = Path(app.builder.outdir) / "_static" / "eb-ask-pack.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pack, sort_keys=False) + "\n", encoding="utf-8")
    kinds = Counter(c["kind"] for c in pack["chunks"])
    logger.info(
        "eb_ask: %d chunks (%s), %d terms, pack %.0f kB",
        len(pack["chunks"]),
        ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())),
        len(pack["idf"]),
        out.stat().st_size / 1024.0,
    )


def _register_assets(app):
    if app.builder.name.startswith("epub"):
        return
    app.add_css_file("eb-ask.css")
    app.add_js_file("eb-ask.js", loading_method="defer")


def setup(app):
    app.connect("builder-inited", _register_assets)
    app.connect("build-finished", _write_pack)
    return {
        "version": __version__,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
