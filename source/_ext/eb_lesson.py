"""Lesson structure: what a chapter is for, and whether the reader got it.

The devices here are the Carpentries lesson template's, which is the most
researched answer to this problem, reached through ``sphinx-lesson``'s
Sphinx spelling of it. Three of them, and no more, because every block a
book defines is a block a reader has to learn to read.

``objectives``
    What a reader will be able to do at the end. Two to four of them; a
    fifth means the chapter is doing two jobs and should be split. It goes
    at the top, because a reader deciding whether to read a chapter is
    asking exactly this and should not have to infer it from the prose.

``exercise``
    Formative assessment, carrying a stable id. The id matters more than it
    looks: it lets a reader search for one, lets a helper name one in a
    shared document during a workshop, and lets the index below link to it.
    Ids are stable across edits because they are written by hand rather than
    generated from position.

``solution``
    Nested inside an exercise, collapsed. Collapsed rather than absent
    because a reader working alone has nobody to ask, and collapsed rather
    than open because the answer is worth less than the attempt. A solution
    is a diagnostic walkthrough rather than an answer: EasyBuild's own
    tutorial does this well and it is the habit worth keeping.

``exercise-index``
    Every exercise in the book, on one page. The Aalto scientific-computing
    courses do this, and it is what makes one set of material serve both a
    taught course and a reader working alone: a session covers a subset,
    and nobody has to maintain a second copy of the list.
"""

from __future__ import annotations

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective

__version__ = "0.1.0"


class objectives_node(nodes.General, nodes.Element):
    """What the reader will be able to do."""


class exercise_node(nodes.General, nodes.Element):
    """One piece of formative assessment."""


class solution_node(nodes.General, nodes.Element):
    """The answer, collapsed."""


class exerciselist_node(nodes.General, nodes.Element):
    """Placeholder, filled once every document has been read."""


class Objectives(SphinxDirective):
    """What a reader will be able to do at the end of this chapter."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0

    def run(self):
        node = objectives_node()
        node["title"] = "What you will be able to do"
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("objectives: the block is empty")
        return [node]


class Exercise(SphinxDirective):
    """A task, with an id a reader and a helper can both refer to."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0
    final_argument_whitespace = True
    option_spec = {
        "id": directives.unchanged_required,
        "title": directives.unchanged,
    }

    def run(self):
        ident = self.options.get("id", "").strip()
        if not ident:
            raise self.error(
                "exercise: :id: is required, and is what a reader searches "
                "for and a helper names out loud; a positional number is "
                "not stable across an edit"
            )

        target_id = "exercise-%s" % nodes.make_id(ident)
        target = nodes.target("", "", ids=[target_id])

        node = exercise_node()
        node["ident"] = ident
        node["title"] = self.options.get("title", "").strip()
        node["docname"] = self.env.docname
        node["target_id"] = target_id
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("exercise %s: the block is empty" % ident)

        # Collected here rather than at render time, because the index page
        # may be written before the chapter that defines the exercise.
        store = getattr(self.env, "eb_exercises", None)
        if store is None:
            store = self.env.eb_exercises = []
        if any(e["ident"] == ident for e in store):
            raise self.error(
                "exercise id %s is already used; ids are how a reader "
                "refers to one, so two cannot share" % ident
            )
        store.append(
            {
                "docname": self.env.docname,
                "ident": ident,
                "title": node["title"],
                "target_id": target_id,
            }
        )

        return [target, node]


class Solution(SphinxDirective):
    """The answer, and preferably how you would have found it."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0

    def run(self):
        node = solution_node()
        node["title"] = "Solution"
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("solution: the block is empty")
        return [node]


class ExerciseIndex(SphinxDirective):
    """Every exercise in the book, in reading order."""

    has_content = False

    def run(self):
        return [exerciselist_node("")]


def purge_exercises(app, env, docname):
    """Drop a document's exercises before it is read again."""
    store = getattr(env, "eb_exercises", None)
    if store is None:
        return
    env.eb_exercises = [e for e in store if e["docname"] != docname]


def merge_exercises(app, env, docnames, other):
    """Combine the collections of two parallel readers."""
    store = getattr(env, "eb_exercises", [])
    store.extend(getattr(other, "eb_exercises", []))
    env.eb_exercises = store


def resolve_exercise_index(app, doctree, fromdocname):
    """Fill the placeholder, now that every chapter has been read."""
    store = getattr(app.builder.env, "eb_exercises", [])
    titles = app.builder.env.titles

    for placeholder in doctree.findall(exerciselist_node):
        if not store:
            placeholder.replace_self(
                nodes.paragraph(text="No exercises are defined yet.")
            )
            continue

        # Reading order, which is the order of the files, so the index
        # matches the book rather than the order the build happened to
        # read them in.
        ordered = sorted(store, key=lambda e: (e["docname"], e["ident"]))

        container = nodes.container(classes=["eb-exercise-index"])
        current = None
        item_list = None
        for entry in ordered:
            if entry["docname"] != current:
                current = entry["docname"]
                heading = nodes.paragraph(classes=["eb-exercise-index-chapter"])
                title = titles.get(current)
                ref = nodes.reference("", "")
                ref["refdocname"] = current
                ref["refuri"] = app.builder.get_relative_uri(fromdocname, current)
                ref += nodes.Text(title.astext() if title else current)
                heading += ref
                container += heading
                item_list = nodes.bullet_list()
                container += item_list

            item = nodes.list_item()
            para = nodes.paragraph()
            ref = nodes.reference("", "")
            ref["refdocname"] = entry["docname"]
            ref["refuri"] = (
                app.builder.get_relative_uri(fromdocname, entry["docname"])
                + "#"
                + entry["target_id"]
            )
            label = entry["ident"]
            if entry["title"]:
                label = "%s: %s" % (entry["ident"], entry["title"])
            ref += nodes.Text(label)
            para += ref
            item += para
            item_list += item

        placeholder.replace_self(container)


def _open_block(self, node, css_class, label):
    self.body.append(
        '<div class="%s"><p class="%s-label">%s</p>' % (css_class, css_class, label)
    )


def visit_objectives_html(self, node):
    _open_block(self, node, "eb-objectives", node["title"])


def depart_block_html(self, node):
    self.body.append("</div>")


def visit_exercise_html(self, node):
    label = node["ident"]
    if node["title"]:
        label = "%s &mdash; %s" % (node["ident"], node["title"])
    self.body.append(
        '<div class="eb-exercise"><p class="eb-exercise-label">%s</p>' % label
    )


def visit_solution_html(self, node):
    # A real <details>, so it works with no JavaScript, is searchable by the
    # browser's own find, and prints open under the print stylesheet.
    self.body.append(
        '<details class="eb-solution">'
        '<summary class="eb-solution-summary">Solution</summary>'
        '<div class="eb-solution-body">'
    )


def depart_solution_html(self, node):
    self.body.append("</div></details>")


def visit_block_text(self, node):
    """Plain-text builders get the label as a line and the body as prose."""
    label = node.get("title") or node.get("ident") or ""
    self.add_text("%s: " % label if label else "")


def depart_block_text(self, node):
    self.add_text("\n")


def skip_node(self, node):
    raise nodes.SkipNode


def setup(app):
    app.add_node(
        objectives_node,
        html=(visit_objectives_html, depart_block_html),
        latex=(visit_block_text, depart_block_text),
        text=(visit_block_text, depart_block_text),
        man=(visit_block_text, depart_block_text),
    )
    app.add_node(
        exercise_node,
        html=(visit_exercise_html, depart_block_html),
        latex=(visit_block_text, depart_block_text),
        text=(visit_block_text, depart_block_text),
        man=(visit_block_text, depart_block_text),
    )
    app.add_node(
        solution_node,
        html=(visit_solution_html, depart_solution_html),
        latex=(visit_block_text, depart_block_text),
        text=(visit_block_text, depart_block_text),
        man=(visit_block_text, depart_block_text),
    )
    app.add_node(exerciselist_node)

    app.add_directive("objectives", Objectives)
    app.add_directive("exercise", Exercise)
    app.add_directive("solution", Solution)
    app.add_directive("exercise-index", ExerciseIndex)

    app.connect("env-purge-doc", purge_exercises)
    app.connect("env-merge-info", merge_exercises)
    app.connect("doctree-resolved", resolve_exercise_index)

    app.add_css_file("eb-lesson.css")

    return {
        "version": __version__,
        "env_version": 1,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
