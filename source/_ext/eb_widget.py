"""The ``eb`` directive: a seeded, runnable easyconfig sample.

One directive, three renderings, and the differences are the point.

``html`` and ``singlehtml`` emit a container the browser engine binds to,
with the sample's source inside it as a ``<pre>``. That fallback is not a
courtesy: it is what a reader sees before the WASM engine loads, if the
engine fails to load, and if scripting is off.

``epub`` emits a plain literal block. A reader on an e-reader gets the
code and no promise of interactivity. Keeping the prose sensible under
that constraint is an editorial discipline rather than a limitation: a
chapter that only makes sense with a live widget is a chapter that
depends on the reader doing homework.
"""

from __future__ import annotations

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective

__version__ = "0.1.0"

#: Widgets the engine knows how to mount. An explicit set so a typo in a
#: chapter fails the build instead of rendering an inert box.
KNOWN_WIDGETS = frozenset(
    {
        "parse",  # easyconfig source -> canonical model
        "template",  # resolve %(version)s and friends
        "easyblock",  # name -> the easyblock class EasyBuild picks
        "hierarchy",  # toolchain -> its hierarchy members
        "solve",  # dependency closure over a chapter universe
        "emit",  # model -> canonical recipe text
        "lint",  # style findings
    }
)


class eb_widget(nodes.Element):
    """A widget mount point.

    Its own node type rather than a ``container`` with a class, so
    overriding the HTML output cannot disturb any other extension's
    containers.
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

        if self.env.app.builder.name == "epub":
            return [literal]

        node = eb_widget()
        node["eb_widget"] = widget
        node["eb_universe"] = self.options.get("universe", "").strip()
        node["eb_label"] = self.options.get("label", "").strip()
        node += literal
        return [node]


def visit_eb_widget_html(self, node: eb_widget) -> None:
    attrs = {"data-eb-widget": node["eb_widget"]}
    if node["eb_universe"]:
        attrs["data-eb-universe"] = node["eb_universe"]
    if node["eb_label"]:
        attrs["data-eb-label"] = node["eb_label"]
    self.body.append(self.starttag(node, "div", CLASS="eb-widget", **attrs))


def depart_eb_widget_html(self, node: eb_widget) -> None:
    self.body.append("</div>\n")


def visit_eb_widget_passthrough(self, node: eb_widget) -> None:
    """Any other builder renders the children and nothing else."""


def depart_eb_widget_passthrough(self, node: eb_widget) -> None:
    pass


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
    app.add_css_file("eb-widget.css")
    app.add_js_file("eb-widget.js", loading_method="defer")
    return {
        "version": __version__,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
