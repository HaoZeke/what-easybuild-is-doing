"""The ``ebtranscript`` directive: a recording of a real run.

Some of what this book is about cannot happen in a browser. Configuring,
compiling, linking, verifying a checksum against a two-hundred-megabyte
archive, running a binary that needs a GPU and a licence: none of it is
available to a page, and pretending otherwise would be the one thing a
book like this cannot afford.

So those steps are recordings. Not screenshots, and not prose describing
what an error looks like, but the output of a run that actually happened,
with where and when it happened printed beside it. A reader who has read
a real failure recognises the next one; a reader who has read a paraphrase
of a failure has learned the paraphrase.

The directive is deliberately static. It renders the same in every
builder, needs no JavaScript, and survives into the EPUB intact, because
the thing being taught here is reading, and reading works on paper.

``:source:`` is required and is the provenance: the run, the host, the
date. A transcript with no provenance is a paraphrase with extra steps,
so the directive refuses one rather than letting it pass as evidence.
"""

from __future__ import annotations

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective

__version__ = "0.1.0"


class EbTranscript(SphinxDirective):
    """Captured output of a real run, with its provenance."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0
    option_spec = {
        "source": directives.unchanged_required,
        "caption": directives.unchanged,
    }

    def run(self) -> list[nodes.Node]:
        source = self.options.get("source", "").strip()
        if not source:
            raise self.error(
                "ebtranscript: :source: is required, and names where the "
                "output came from; a transcript without provenance is not "
                "evidence"
            )

        text = "\n".join(self.content)
        if not text.strip():
            raise self.error("ebtranscript: the block is empty")

        container = nodes.container(classes=["eb-transcript"])

        caption = self.options.get("caption", "").strip()
        if caption:
            para = nodes.paragraph(classes=["eb-transcript-caption"])
            para += nodes.Text(caption)
            container += para

        # No lexer. This is terminal output, not source, and Pygments
        # guessing at it produces confident nonsense on log lines.
        literal = nodes.literal_block(text, text)
        literal["language"] = "none"
        container += literal

        attribution = nodes.paragraph(classes=["eb-transcript-source"])
        attribution += nodes.emphasis(text=f"Recorded: {source}")
        container += attribution

        return [container]


def setup(app):
    app.add_directive("ebtranscript", EbTranscript)
    app.add_css_file("eb-transcript.css")
    return {
        "version": __version__,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
