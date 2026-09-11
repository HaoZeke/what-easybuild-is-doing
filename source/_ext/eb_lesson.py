"""Lesson structure: what a chapter is for, and whether the reader got it.

The devices here are the Carpentries lesson template's, which is the most
researched answer to this problem, reached through ``sphinx-lesson``'s
Sphinx spelling of it. Three of them, and no more, because every block a
book defines is a block a reader has to learn to read.

``questions``
    What the chapter is going to answer, as questions, before the
    objectives. The Carpentries Workbench episode header carries both:
    questions name the confusion, objectives name the observable act.
    A self-study book needs the questions more than a workshop does,
    because there is no instructor to pose them.

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

``keypoints``
    What a reader should still know a week later, at the end of a chapter.
    The Carpentries template pairs it with objectives and the pairing is the
    point: objectives are a promise and keypoints are the receipt, so a
    chapter whose keypoints do not answer its objectives is a chapter that
    changed subject halfway through.

``prerequisites``
    What has to be true before this chapter is worth reading, from
    ``sphinx-lesson``'s directive set. Named rather than implied, because a
    reader who cannot meet them should find that out in the first screen.

``predict`` and ``reveal``
    Predict-then-reveal, which is Nicky Case's "Place Your Bets": the reader
    commits to an answer before the answer appears, on the argument that
    "by forcing you to put down your expectations, the real answer comes as a
    bigger shock". In a book about a build system this is the cheapest
    device available, because most chapters already contain a recording of
    something surprising; all that was missing was asking the reader first.

``keypoints-index``
    Every chapter's keypoints on one page, which the Carpentries call a
    digest. Same argument as the exercise index: one list, generated, so it
    cannot drift from the chapters.
"""

from __future__ import annotations

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective

__version__ = "0.1.0"


class questions_node(nodes.General, nodes.Element):
    """What the chapter is going to answer."""


class objectives_node(nodes.General, nodes.Element):
    """What the reader will be able to do."""


class exercise_node(nodes.General, nodes.Element):
    """One piece of formative assessment."""


class solution_node(nodes.General, nodes.Element):
    """The answer, collapsed."""


class exerciselist_node(nodes.General, nodes.Element):
    """Placeholder, filled once every document has been read."""


class Questions(SphinxDirective):
    """The questions this chapter answers, before the objectives."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0

    def run(self):
        node = questions_node()
        node["title"] = "Questions"
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("questions: the block is empty")
        return [node]


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


class keypoints_node(nodes.General, nodes.Element):
    """What should survive the week."""


class prerequisites_node(nodes.General, nodes.Element):
    """What has to be true first."""


class predict_node(nodes.General, nodes.Element):
    """A question the reader answers before the book does."""


class reveal_node(nodes.General, nodes.Element):
    """The answer to a prediction, collapsed until asked for."""


class keypointslist_node(nodes.General, nodes.Element):
    """Placeholder for the digest of every chapter's keypoints."""


class Keypoints(SphinxDirective):
    """What a reader should still know a week later."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0

    def run(self):
        node = keypoints_node()
        node["title"] = "What to remember"
        node["docname"] = self.env.docname
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("keypoints: the block is empty")

        # Collected for the digest page, in the same way exercises are, and
        # for the same reason: the page that lists them may be written first.
        store = getattr(self.env, "eb_keypoints", None)
        if store is None:
            store = self.env.eb_keypoints = []
        store.append(
            {
                "docname": self.env.docname,
                "points": [
                    child.astext()
                    for item in node.findall(nodes.list_item)
                    for child in item.children[:1]
                ],
            }
        )
        return [node]


class Prerequisites(SphinxDirective):
    """What has to be true before this chapter is worth reading."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0

    def run(self):
        node = prerequisites_node()
        node["title"] = "Before this chapter"
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("prerequisites: the block is empty")
        return [node]


class Predict(SphinxDirective):
    """Ask for a commitment before the answer appears."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0
    option_spec = {"title": directives.unchanged}

    def run(self):
        node = predict_node()
        node["title"] = self.options.get("title", "").strip() or "Predict"
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("predict: the block is empty")
        if node.next_node(reveal_node) is None:
            raise self.error(
                "predict: needs a nested reveal block; a prediction with no "
                "answer is a rhetorical question"
            )
        return [node]


class Reveal(SphinxDirective):
    """The answer, collapsed, inside a prediction."""

    has_content = True
    required_arguments = 0
    optional_arguments = 0
    option_spec = {"title": directives.unchanged}

    def run(self):
        node = reveal_node()
        node["title"] = self.options.get("title", "").strip() or "What happens"
        self.state.nested_parse(self.content, self.content_offset, node)
        if not node.children:
            raise self.error("reveal: the block is empty")
        return [node]


class KeypointsIndex(SphinxDirective):
    """Every chapter's keypoints, in reading order."""

    has_content = False

    def run(self):
        return [keypointslist_node("")]


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


def purge_keypoints(app, env, docname):
    store = getattr(env, "eb_keypoints", None)
    if store is None:
        return
    env.eb_keypoints = [k for k in store if k["docname"] != docname]


def merge_keypoints(app, env, docnames, other):
    store = getattr(env, "eb_keypoints", [])
    store.extend(getattr(other, "eb_keypoints", []))
    env.eb_keypoints = store


def resolve_keypoints_index(app, doctree, fromdocname):
    """Fill the digest placeholder once every chapter has been read."""
    store = getattr(app.builder.env, "eb_keypoints", [])
    titles = app.builder.env.titles

    for placeholder in doctree.findall(keypointslist_node):
        if not store:
            placeholder.replace_self(
                nodes.paragraph(text="No keypoints are defined yet.")
            )
            continue
        container = nodes.container(classes=["eb-keypoints-index"])
        for entry in sorted(store, key=lambda k: k["docname"]):
            heading = nodes.paragraph(classes=["eb-keypoints-index-chapter"])
            ref = nodes.reference("", "")
            ref["refdocname"] = entry["docname"]
            ref["refuri"] = app.builder.get_relative_uri(
                fromdocname, entry["docname"]
            )
            title = titles.get(entry["docname"])
            ref += nodes.Text(title.astext() if title else entry["docname"])
            heading += ref
            container += heading
            bullets = nodes.bullet_list()
            for point in entry["points"]:
                item = nodes.list_item()
                para = nodes.paragraph()
                para += nodes.Text(point)
                item += para
                bullets += item
            container += bullets
        placeholder.replace_self(container)


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


def visit_questions_html(self, node):
    _open_block(self, node, "eb-questions", node["title"])


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


def visit_keypoints_html(self, node):
    _open_block(self, node, "eb-keypoints", node["title"])


def visit_prerequisites_html(self, node):
    _open_block(self, node, "eb-prerequisites", node["title"])


def visit_predict_html(self, node):
    self.body.append(
        '<div class="eb-predict"><p class="eb-predict-label">%s</p>'
        % self.encode(node["title"])
    )


def visit_reveal_html(self, node):
    # A real <details> for the same three reasons the solution block uses one:
    # no JavaScript, findable by the browser's own search, open in print.
    self.body.append(
        '<details class="eb-reveal">'
        '<summary class="eb-reveal-summary">%s</summary>'
        '<div class="eb-reveal-body">' % self.encode(node["title"])
    )


def depart_reveal_html(self, node):
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
        questions_node,
        html=(visit_questions_html, depart_block_html),
        latex=(visit_block_text, depart_block_text),
        text=(visit_block_text, depart_block_text),
        man=(visit_block_text, depart_block_text),
    )
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
    app.add_node(keypointslist_node)
    for node_class, visitor in (
        (keypoints_node, visit_keypoints_html),
        (prerequisites_node, visit_prerequisites_html),
        (predict_node, visit_predict_html),
    ):
        app.add_node(
            node_class,
            html=(visitor, depart_block_html),
            latex=(visit_block_text, depart_block_text),
            text=(visit_block_text, depart_block_text),
            man=(visit_block_text, depart_block_text),
        )
    app.add_node(
        reveal_node,
        html=(visit_reveal_html, depart_reveal_html),
        latex=(visit_block_text, depart_block_text),
        text=(visit_block_text, depart_block_text),
        man=(visit_block_text, depart_block_text),
    )

    app.add_directive("questions", Questions)
    app.add_directive("objectives", Objectives)
    app.add_directive("exercise", Exercise)
    app.add_directive("solution", Solution)
    app.add_directive("exercise-index", ExerciseIndex)
    app.add_directive("keypoints", Keypoints)
    app.add_directive("prerequisites", Prerequisites)
    app.add_directive("predict", Predict)
    app.add_directive("reveal", Reveal)
    app.add_directive("keypoints-index", KeypointsIndex)

    app.connect("env-purge-doc", purge_exercises)
    app.connect("env-merge-info", merge_exercises)
    app.connect("doctree-resolved", resolve_exercise_index)
    app.connect("env-purge-doc", purge_keypoints)
    app.connect("env-merge-info", merge_keypoints)
    app.connect("doctree-resolved", resolve_keypoints_index)

    app.add_css_file("eb-lesson.css")

    return {
        "version": __version__,
        "env_version": 2,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
