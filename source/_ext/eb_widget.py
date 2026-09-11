"""The ``eb`` directive: an island of interactivity in a page of prose.

This is the islands model, ported rather than adopted. Astro's islands
architecture is the right shape for a book, which is mostly static text
with a few live components, but adopting Astro would have cost org
source, EPUB and a single-page rendering. The three properties that
matter port to a few dozen lines here:

*Zero JavaScript on pages without islands.* Sphinx's ``add_js_file``
reaches every page in the build. A chapter with no widgets should ship
no widget code, so the assets are stripped per page in
``html-page-context`` based on whether that page's doctree actually
contains an island.

*Per-island hydration.* Each island declares when it wakes up:
``load``, ``idle`` or ``visible``. The default is ``visible``, because a
widget below the fold that the reader never reaches should cost nothing,
and in a book most of them are.

*A shared, lazily loaded engine.* Hydration loads the table-backed
page engine once, shared across every island. A reader who never
scrolls to a widget never downloads it. The page applies exported
tables. It is not eb-stack and not EasyBuild.

One directive, three renderings, and the differences are the point.
``html`` and ``singlehtml`` emit the island with its source inside it as
a ``<pre>``; that fallback is what a reader sees before hydration, if
the engine fails to load, and if scripting is off. ``epub`` emits a
plain literal block, and that choice is made in the visitor rather than
the directive, for the reason documented there.
"""

from __future__ import annotations

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective

__version__ = "0.2.0"

#: Widgets the engine knows how to mount. An explicit set so a typo in a
#: chapter fails the build instead of rendering an inert box.
KNOWN_WIDGETS = frozenset(
    {
        "parse",  # easyconfig source -> canonical model
        "template",  # resolve %(version)s and friends
        "easyblock",  # name -> the easyblock class EasyBuild picks
        "hierarchy",  # toolchain -> its hierarchy members
        "solve",  # dependency closure over a canned universe
        "emit",  # model -> canonical recipe text
        "lint",  # style findings a reviewer would write down
        "modname",  # EasyBuildMNS module name and .eb filename
    }
)

#: When an island wakes up. ``visible`` is the default for the reason in
#: the module docstring.
HYDRATION_STRATEGIES = ("load", "idle", "visible")
DEFAULT_HYDRATION = "visible"

#: Substring identifying this extension's own assets, for per-page stripping.
ASSET_MARKER = "eb-widget"


class eb_widget(nodes.Element):
    """An island mount point.

    Its own node type rather than a ``container`` with a class, so
    overriding the HTML output cannot disturb any other extension's
    containers, and so a page can be asked whether it holds one.
    """


class EbWidget(SphinxDirective):
    """A seeded easyconfig sample, live where the format allows it."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0
    final_argument_whitespace = False
    option_spec = {
        "widget": directives.unchanged_required,
        "universe": directives.unchanged,
        "label": directives.unchanged,
        "hydrate": lambda arg: directives.choice(arg, HYDRATION_STRATEGIES),
        # A sample that is meant to fail, marked in the design system rather
        # than in the prose around it. Every teaching site that shows broken
        # input eventually needs this: a reader who scrolls past the sentence
        # and copies the block should still be told.
        "fails": directives.unchanged,
    }

    def run(self) -> list[nodes.Node]:
        widget = self.options.get("widget", "parse").strip()
        if widget not in KNOWN_WIDGETS:
            known = ", ".join(sorted(KNOWN_WIDGETS))
            raise self.error(
                f"eb: unknown widget {widget!r}; known widgets are {known}"
            )

        source = "\n".join(self.content)
        if not source.strip():
            raise self.error("eb: the block has no content to seed the widget")

        # An easyconfig *is* Python, which is why the Python lexer is right
        # here, and why this book needed no bespoke highlighter.
        literal = nodes.literal_block(source, source)
        literal["language"] = "python"

        # No builder check here, deliberately. A directive runs at *read*
        # time, and the three builders share one doctree cache, so whichever
        # runs first decides what the others see. Anything builder-dependent
        # therefore belongs in the visitor, which runs per builder at write
        # time. Getting this wrong is silent: the epub simply keeps the
        # markup the html build put in the cache.
        node = eb_widget()
        node["eb_widget"] = widget
        node["eb_universe"] = self.options.get("universe", "").strip()
        node["eb_label"] = self.options.get("label", "").strip()
        node["eb_hydrate"] = self.options.get("hydrate", DEFAULT_HYDRATION)
        node["eb_fails"] = self.options.get("fails", "").strip()
        node += literal
        return [node]


def visit_eb_widget_html(self, node: eb_widget) -> None:
    # The epub builder uses an HTML translator, so it arrives here too. It
    # gets the children alone: no mount point, because nothing can mount it.
    if self.builder.name.startswith("epub"):
        return
    attrs = {
        "data-eb-widget": node["eb_widget"],
        "data-eb-hydrate": node["eb_hydrate"],
    }
    if node.get("eb_fails"):
        attrs["data-eb-fails"] = node["eb_fails"]
    if node["eb_universe"]:
        attrs["data-eb-universe"] = node["eb_universe"]
    if node["eb_label"]:
        attrs["data-eb-label"] = node["eb_label"]
    classes = "eb-widget"
    if node.get("eb_fails"):
        classes += " eb-widget--fails"
    self.body.append(self.starttag(node, "div", CLASS=classes, **attrs))
    if node.get("eb_fails"):
        # In the markup rather than only in CSS, so it survives reader
        # stylesheets, a screen reader, and the print stylesheet.
        self.body.append(
            '<p class="eb-widget-fails"><span class="eb-widget-fails__tag">'
            "this sample fails</span> %s</p>\n" % self.encode(node["eb_fails"])
        )


def depart_eb_widget_html(self, node: eb_widget) -> None:
    if self.builder.name.startswith("epub"):
        return
    self.body.append("</div>\n")


def visit_eb_widget_passthrough(self, node: eb_widget) -> None:
    """Any other builder renders the children and nothing else."""


def depart_eb_widget_passthrough(self, node: eb_widget) -> None:
    pass


def _register_assets(app):
    """Attach the widget stylesheet and mount script, html builders only.

    ``add_*_file`` at setup time reaches every builder that emits HTML, and
    the epub builder is one of them. An EPUB that links a stylesheet and a
    mount script for widgets it cannot run is shipping dead weight and a
    promise it does not keep, so the assets are registered once the builder
    is known. Which *pages* get them is decided later, in
    :func:`_strip_assets_from_islandless_pages`.
    """
    if app.builder.name.startswith("epub"):
        return
    app.add_css_file("eb-widget.css")
    app.add_js_file("eb-widget.js", loading_method="defer")
    # The engine ships under the same prefix on purpose: _asset_is_ours
    # matches on it, so a chapter with no island loses the engine too.
    app.add_js_file("eb-widget-engine.js", loading_method="defer")


def _asset_is_ours(entry) -> bool:
    """Whether a script or stylesheet entry in the page context is ours.

    Sphinx models these as small objects that stringify to their filename,
    and the exact class has moved between versions. Reading ``filename``
    when it is there and falling back to ``str`` keeps this working across
    both, rather than importing a private name.
    """
    return ASSET_MARKER in str(getattr(entry, "filename", entry) or "")


def _strip_assets_from_islandless_pages(
    app, pagename, templatename, context, doctree
):
    """Remove the widget assets from any page that holds no island.

    This is the "zero JavaScript by default" half of the islands model.
    Sphinx has no per-page asset registration, so the assets are added for
    the whole build and taken away again here.

    ``doctree`` is ``None`` for generated pages such as search and
    genindex. Those still get the assets: Escape opens the page-level
    playground on every page, including ones that hold no inline island.
    """
    if doctree is not None and doctree.next_node(eb_widget) is not None:
        return
    # Keep the engine and mount script. The playground is an island that
    # exists on every page, even when the chapter has no sample of its own.


def setup(app):
    app.add_directive("eb", EbWidget)
    app.add_node(
        eb_widget,
        html=(visit_eb_widget_html, depart_eb_widget_html),
        latex=(visit_eb_widget_passthrough, depart_eb_widget_passthrough),
        text=(visit_eb_widget_passthrough, depart_eb_widget_passthrough),
        man=(visit_eb_widget_passthrough, depart_eb_widget_passthrough),
        texinfo=(visit_eb_widget_passthrough, depart_eb_widget_passthrough),
    )
    app.connect("builder-inited", _register_assets)
    app.connect("html-page-context", _strip_assets_from_islandless_pages)
    return {
        "version": __version__,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
