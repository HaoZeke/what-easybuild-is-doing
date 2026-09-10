"""Dive-in details: transclusion instead of an appendix.

PreTeXt calls these knowls, and Beezer's description of why they exist is
the design brief for this extension: "a cross-reference can be implemented
with a knowl, which is a form of transclusion. So when a reader clicks on a
cross-reference to a definition, the page splits and a box opens containing
the text of the definition." And the rule that keeps them honest: "Every
knowl contains a traditional in-context link if the reader wishes to migrate
away to another location."

The reason a book about a build system needs them is that half of what a
reader wants is reference material with no narrative use. The eighteen steps
in order, the thirty-one options on ``PythonPackage``, what a term means.
Put that inline and it interrupts the argument. Put it in an appendix and
nobody reads it, because reaching it costs a page change and finding your
way back.

So each such block is *born* once, where it belongs, and any number of
places transclude it:

.. code-block:: rst

   .. eb-detail:: The eighteen steps
      :id: steps-order

      ...the table...

   ...prose that mentions :dive:`steps-order` in passing...

Three renderings, and the differences are deliberate.

``html`` and ``singlehtml``: the born block renders in place, and every
reference becomes a button that fetches the born block's own HTML and opens
it under the paragraph the reader is on. The fragment is the real translator
output, sliced out of the page it was born on rather than re-rendered, so a
detail cannot say one thing in place and another when transcluded.

``epub``: no fetch, no JavaScript. A reference is an ordinary cross-reference
link to where the block is born, which is what an e-reader can do and what a
printed book would have done.

Everything else (text, man, latex) gets the reference text and the link, so
nothing is silently lost in a rendering nobody looked at.

A dangling ``:dive:`` is a build warning, which under ``-W`` is a build
failure. That is the point of registering ids: a reference to a detail
somebody deleted should not become a dead button in a reader's browser.
"""

from __future__ import annotations

import json
import posixpath
from pathlib import Path

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util import logging
from sphinx.util.docutils import SphinxDirective, SphinxRole

__version__ = "0.1.0"

logger = logging.getLogger(__name__)

#: Substring identifying this extension's assets, for per-page stripping.
ASSET_MARKER = "eb-knowl"

#: What a detail is for. ``term`` is a glossary entry, ``reference`` is a
#: table or list somebody will come back to, ``aside`` is an argument that
#: would derail the paragraph it hangs off. The kind reaches the markup as a
#: class and the ask pack as a field, so a search can rank a definition above
#: a passing mention of the word.
KINDS = ("reference", "term", "aside")
DEFAULT_KIND = "reference"


class eb_detail(nodes.Element):
    """A block that is born once and transcluded anywhere."""


class eb_dive(nodes.Element):
    """A reference that opens its target in place."""


class EbDetail(SphinxDirective):
    """Content worth reading twice, filed where it belongs."""

    has_content = True
    required_arguments = 0
    optional_arguments = 1
    final_argument_whitespace = True
    option_spec = {
        "id": directives.unchanged_required,
        "kind": lambda arg: directives.choice(arg, KINDS),
        # A term's own name, when it differs from the title. "RPATH" is the
        # title and the name; "start_dir" is the name and the title is a
        # sentence about it.
        "name": directives.unchanged,
    }

    def run(self) -> list[nodes.Node]:
        detail_id = self.options["id"].strip()
        if not detail_id:
            raise self.error("eb-detail: :id: is empty")
        title = (self.arguments[0].strip() if self.arguments else "").strip()
        if not title:
            raise self.error("eb-detail: needs a title as its argument")

        registry = self.env.domaindata.setdefault("eb_details", {})
        prior = registry.get(detail_id)
        if prior is not None and prior["docname"] != self.env.docname:
            raise self.error(
                f"eb-detail: id {detail_id!r} is already born in "
                f"{prior['docname']}; a detail is born once and transcluded"
            )

        anchor = f"eb-detail-{detail_id}"
        node = eb_detail()
        node["eb_id"] = detail_id
        node["eb_title"] = title
        node["eb_kind"] = self.options.get("kind", DEFAULT_KIND)
        node["eb_name"] = self.options.get("name", "").strip() or title
        node["ids"] = [anchor]
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error(f"eb-detail: {detail_id!r} has no content")

        registry[detail_id] = {
            "docname": self.env.docname,
            "anchor": anchor,
            "title": title,
            "kind": node["eb_kind"],
            "name": node["eb_name"],
        }
        return [node]


class DiveRole(SphinxRole):
    """``:dive:`id``` or ``:dive:`text <id>```."""

    def run(self):
        text = self.text.strip()
        override = ""
        if text.endswith(">") and "<" in text:
            override, _, rest = text.partition("<")
            override = override.strip()
            text = rest[:-1].strip()
        node = eb_dive()
        node["eb_id"] = text
        node["eb_override"] = override
        node["eb_from"] = self.env.docname
        return [node], []


def _resolve_dives(app, doctree, docname):
    """Turn each reference into a real URI, or fail the build."""
    registry = app.env.domaindata.get("eb_details", {})
    for node in list(doctree.findall(eb_dive)):
        entry = registry.get(node["eb_id"])
        if entry is None:
            logger.warning(
                "dive to %r, which no eb-detail is born as",
                node["eb_id"],
                location=(docname, None),
                type="eb_knowl",
                subtype="dangling",
            )
            node.replace_self(nodes.Text(node["eb_override"] or node["eb_id"]))
            continue
        node["eb_title"] = entry["title"]
        node["eb_kind"] = entry["kind"]
        try:
            base = app.builder.get_relative_uri(docname, entry["docname"])
        except Exception:  # a builder with no notion of relative uris
            base = ""
        node["eb_uri"] = f"{base}#{entry['anchor']}"
        # Every page in this book sits at the output root, so one relative
        # path serves them all. A nested document would need a computed
        # prefix, and there is deliberately no such document.
        node["eb_fragment"] = posixpath.join(
            "_static", "knowls", f"{node['eb_id']}.html"
        )


# --- HTML: the born block, and the fragment it leaves behind ---------------


def _fragments(builder) -> dict:
    store = getattr(builder, "_eb_knowl_fragments", None)
    if store is None:
        store = {}
        builder._eb_knowl_fragments = store
    return store


def visit_eb_detail_html(self, node: eb_detail) -> None:
    kind = node["eb_kind"]
    self.body.append(
        self.starttag(
            node,
            "aside",
            CLASS=f"eb-detail eb-detail--{kind}",
            **{"data-eb-detail": node["eb_id"]},
        )
    )
    self.body.append(
        f'<p class="eb-detail__title"><span class="eb-detail__kind">{kind}</span>'
        f"{self.encode(node['eb_title'])}</p>\n"
    )
    self.body.append('<div class="eb-detail__body">')
    # Everything after this index is the block's own content, and that slice
    # is what a transclusion serves. Capturing the translator's output rather
    # than re-rendering is what makes the two copies the same copy.
    node["_eb_slice"] = len(self.body)


def depart_eb_detail_html(self, node: eb_detail) -> None:
    start = node.get("_eb_slice", len(self.body))
    fragment = "".join(self.body[start:])
    if not self.builder.name.startswith("epub"):
        _fragments(self.builder)[node["eb_id"]] = {
            "title": node["eb_title"],
            "kind": node["eb_kind"],
            "html": fragment,
        }
    self.body.append("</div>\n</aside>\n")


def visit_eb_dive_html(self, node: eb_dive) -> None:
    label = node.get("eb_override") or node.get("eb_title") or node["eb_id"]
    uri = node.get("eb_uri", "")
    if self.builder.name.startswith("epub"):
        # An e-reader gets a cross-reference, which is the thing it can do.
        self.body.append(f'<a class="eb-dive-link" href="{self.encode(uri)}">')
        self.body.append(self.encode(label))
        self.body.append("</a>")
        raise nodes.SkipNode
    # A real href, so a browser with no scripting, a fetch that fails and a
    # middle click all still take the reader to where the block is born.
    self.body.append(
        f'<a class="eb-knowl" href="{self.encode(uri)}"'
        f' data-eb-knowl="{self.encode(node["eb_id"])}"'
        f' data-eb-fragment="{self.encode(node.get("eb_fragment", ""))}"'
        f' data-eb-kind="{self.encode(node.get("eb_kind", DEFAULT_KIND))}"'
        f' aria-expanded="false">'
    )
    self.body.append(self.encode(label))
    self.body.append('<span class="eb-knowl__mark" aria-hidden="true"></span></a>')
    raise nodes.SkipNode


def visit_eb_detail_text(self, node: eb_detail) -> None:
    self.add_text(f"[{node['eb_title']}]")
    self.new_state(0)


def depart_eb_detail_text(self, node: eb_detail) -> None:
    self.end_state()


def visit_eb_dive_text(self, node: eb_dive) -> None:
    label = node.get("eb_override") or node.get("eb_title") or node["eb_id"]
    self.add_text(label)
    raise nodes.SkipNode


def _write_fragments(app, exc):
    """Write each born block's HTML where a transclusion can fetch it."""
    if exc is not None or app.builder.name.startswith("epub"):
        return
    store = _fragments(app.builder)
    if not store:
        return
    out = Path(app.builder.outdir) / "_static" / "knowls"
    out.mkdir(parents=True, exist_ok=True)
    registry = app.env.domaindata.get("eb_details", {})
    for detail_id, payload in store.items():
        entry = registry.get(detail_id, {})
        docname = entry.get("docname", "")
        anchor = entry.get("anchor", "")
        # Beezer's rule, made mechanical: the box carries the way out.
        back = ""
        if docname:
            # The fragment is injected into a page at the output root, so its
            # links resolve against that page rather than against the file
            # this writes. A path relative to the fragment would 404.
            back = (
                f'<p class="eb-knowl__back">'
                f'<a href="{docname}.html#{anchor}">read it where it lives</a>'
                f"</p>"
            )
        (out / f"{detail_id}.html").write_text(
            f'<div class="eb-knowl__inner" data-eb-kind="{payload["kind"]}">'
            f'<p class="eb-knowl__title">{payload["title"]}</p>'
            f"{payload['html']}{back}</div>",
            encoding="utf-8",
        )
    # A manifest, so the ask pack and the checks can enumerate details
    # without parsing the pages.
    manifest = {
        did: {
            "title": registry.get(did, {}).get("title", ""),
            "kind": registry.get(did, {}).get("kind", DEFAULT_KIND),
            "name": registry.get(did, {}).get("name", ""),
            "docname": registry.get(did, {}).get("docname", ""),
            "anchor": registry.get(did, {}).get("anchor", ""),
        }
        for did in sorted(store)
    }
    (Path(app.builder.outdir) / "_static" / "eb-knowls.json").write_text(
        json.dumps({"details": manifest}, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    logger.info("eb_knowl: wrote %d transcludable fragments", len(store))


def _register_assets(app):
    if app.builder.name.startswith("epub"):
        return
    app.add_css_file("eb-knowl.css")
    app.add_js_file("eb-knowl.js", loading_method="defer")


def _strip_assets_from_pages_without_knowls(
    app, pagename, templatename, context, doctree
):
    """Same islands rule the widgets follow: no knowls, no knowl code."""
    if doctree is not None and (
        doctree.next_node(eb_dive) is not None
        or doctree.next_node(eb_detail) is not None
    ):
        return
    for key in ("script_files", "css_files"):
        entries = context.get(key)
        if not entries:
            continue
        context[key] = [
            e
            for e in entries
            if ASSET_MARKER not in str(getattr(e, "filename", e) or "")
        ]


def _purge_doc(app, env, docname):
    registry = env.domaindata.get("eb_details")
    if not registry:
        return
    for did in [k for k, v in registry.items() if v["docname"] == docname]:
        del registry[did]


def _merge_info(app, env, docnames, other):
    registry = env.domaindata.setdefault("eb_details", {})
    registry.update(other.domaindata.get("eb_details", {}))


def setup(app):
    app.add_directive("eb-detail", EbDetail)
    app.add_role("dive", DiveRole())
    app.add_node(
        eb_detail,
        html=(visit_eb_detail_html, depart_eb_detail_html),
        text=(visit_eb_detail_text, depart_eb_detail_text),
    )
    app.add_node(
        eb_dive,
        html=(visit_eb_dive_html, None),
        text=(visit_eb_dive_text, None),
    )
    app.connect("builder-inited", _register_assets)
    app.connect("doctree-resolved", _resolve_dives)
    app.connect("html-page-context", _strip_assets_from_pages_without_knowls)
    app.connect("env-purge-doc", _purge_doc)
    app.connect("env-merge-info", _merge_info)
    app.connect("build-finished", _write_fragments)
    return {
        "version": __version__,
        "parallel_read_safe": True,
        # The fragments are collected on the builder while pages are written,
        # and a forked writer's copy does not come back.
        "parallel_write_safe": False,
    }
