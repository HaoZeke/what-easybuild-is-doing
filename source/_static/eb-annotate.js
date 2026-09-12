/**
 * Annotations: highlights and notes a reader owns and can take away.
 *
 * The model is the W3C Web Annotation Data Model, reduced to what a static
 * page needs. Each annotation targets a passage with three selectors, which
 * is what Hypothesis does and for the same reason: any one of them alone
 * breaks when the page is edited.
 *
 *   exact / prefix / suffix   a TextQuoteSelector: the quoted words, with
 *                             enough on each side to disambiguate repeats
 *   start / end               a TextPositionSelector: character offsets into
 *                             the article's text
 *
 * Re-anchoring on load tries position first (cheap, exact), then falls back
 * to searching for the quote and scoring candidates by their surroundings. An
 * annotation that anchors nowhere is *kept and shown as orphaned* rather than
 * dropped: a note whose passage was edited away is still the reader's note.
 *
 * Storage is this browser, this origin: localStorage, one key for the book.
 * Nothing is sent anywhere and no account exists. Which means the export is
 * not a nice extra, it is the only way the reader's work leaves the machine,
 * so it comes in two formats and both are complete.
 *
 * Accessibility is a requirement rather than a pass at the end:
 *
 * - every action has a keyboard path, and the panel is reachable without a
 *   pointer. A selection made with shift+arrow keys is a first-class input.
 * - a highlight is a <mark> with aria-describedby pointing at the note text,
 *   so a screen reader reads the annotation where the passage is, and is
 *   focusable so it can be reached by keyboard at all.
 * - the panel is a labelled dialog with focus containment and a documented
 *   escape, and every change is announced on an aria-live region.
 * - nothing depends on colour alone: a highlight is underlined as well as
 *   tinted, and an orphaned note is labelled rather than only greyed.
 */
(function () {
  "use strict";

  var KEY = "eb-annotations-v1";
  var CONTEXT = 32; // characters of prefix and suffix stored
  var state = { notes: [], live: null, panel: null, open: false };

  // --- storage --------------------------------------------------------------

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      state.notes = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.notes = [];
    }
    if (!Array.isArray(state.notes)) state.notes = [];
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state.notes));
    } catch (e) {
      announce(
        "this browser refused to store the note, so it will be lost on reload; export now"
      );
    }
  }

  function uid() {
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // --- the article, as one string ------------------------------------------

  function article() {
    return document.querySelector("article.yue") || document.querySelector("article");
  }

  /** Text nodes of the article, in document order, skipping our own markup. */
  function textNodes() {
    var root = article();
    if (!root) return [];
    var out = [];
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        while (p && p !== root) {
          if (
            p.classList &&
            (p.classList.contains("eb-note-desc") ||
              p.classList.contains("eb-annot") ||
              p.classList.contains("eb-knowl-box"))
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walk.nextNode())) out.push(n);
    return out;
  }

  function plainText(nodes) {
    var s = "";
    for (var i = 0; i < nodes.length; i++) s += nodes[i].nodeValue;
    return s;
  }

  /** Map a character offset in the joined text back to (node, offset). */
  function locate(nodes, offset) {
    var seen = 0;
    for (var i = 0; i < nodes.length; i++) {
      var len = nodes[i].nodeValue.length;
      if (offset <= seen + len) return { node: nodes[i], offset: offset - seen };
      seen += len;
    }
    var last = nodes[nodes.length - 1];
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  /** Character offset of a (node, offset) pair in the joined text. */
  function offsetOf(nodes, node, off) {
    var seen = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) return seen + off;
      seen += nodes[i].nodeValue.length;
    }
    return -1;
  }

  // --- anchoring ------------------------------------------------------------

  /**
   * Find where an annotation belongs now.
   *
   * Position first: if the stored offsets still hold the stored quote, the
   * page has not changed there and nothing else needs checking. Otherwise
   * every occurrence of the quote is scored by how much of the stored prefix
   * and suffix it still has, and the best wins. A tie, or no occurrence at
   * all, is an orphan, and orphans are reported rather than discarded.
   */
  function anchor(note, nodes, text) {
    var t = note.target || {};
    var exact = t.exact || "";
    if (!exact) return null;

    if (typeof t.start === "number" && text.substr(t.start, exact.length) === exact) {
      return { start: t.start, end: t.start + exact.length };
    }

    var candidates = [];
    var from = 0;
    var at;
    while ((at = text.indexOf(exact, from)) !== -1) {
      candidates.push(at);
      from = at + 1;
      if (candidates.length > 200) break;
    }
    if (!candidates.length) return null;
    if (candidates.length === 1) {
      return { start: candidates[0], end: candidates[0] + exact.length };
    }

    var prefix = t.prefix || "";
    var suffix = t.suffix || "";
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var score = 0;
      if (prefix) {
        var before = text.slice(Math.max(0, c - prefix.length), c);
        score += common(before, prefix, true);
      }
      if (suffix) {
        var after = text.substr(c + exact.length, suffix.length);
        score += common(after, suffix, false);
      }
      // Distance from the remembered position breaks a tie, so a repeated
      // phrase anchors near where the reader put it.
      if (typeof t.start === "number") {
        score += Math.max(0, 8 - Math.abs(c - t.start) / 200);
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best === null ? null : { start: best, end: best + exact.length };
  }

  /** Length of the shared run, from the end (prefix) or the start (suffix). */
  function common(a, b, fromEnd) {
    var n = Math.min(a.length, b.length);
    var k = 0;
    for (var i = 0; i < n; i++) {
      var ca = fromEnd ? a[a.length - 1 - i] : a[i];
      var cb = fromEnd ? b[b.length - 1 - i] : b[i];
      if (ca !== cb) break;
      k++;
    }
    return k;
  }

  // --- painting -------------------------------------------------------------

  function clearMarks() {
    var marks = document.querySelectorAll("mark.eb-annot");
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
    var descs = document.querySelectorAll(".eb-note-desc");
    for (var j = 0; j < descs.length; j++) descs[j].remove();
  }

  /** Wrap one character range in <mark>, splitting across elements. */
  function paintRange(nodes, start, end, note) {
    var a = locate(nodes, start);
    var b = locate(nodes, end);
    if (!a || !b) return false;
    var range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);

    // Per text node, so a quote spanning a <code> or a link still wraps.
    var pieces = [];
    var walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      null
    );
    var n;
    while ((n = walker.nextNode())) {
      if (!range.intersectsNode(n)) continue;
      var s = n === a.node ? a.offset : 0;
      var e = n === b.node ? b.offset : n.nodeValue.length;
      if (e > s) pieces.push({ node: n, start: s, end: e });
    }
    if (!pieces.length) return false;

    var descId = "eb-note-desc-" + note.id;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var r = document.createRange();
      r.setStart(p.node, p.start);
      r.setEnd(p.node, p.end);
      var mark = document.createElement("mark");
      mark.className = "eb-annot" + (note.body ? " eb-annot--noted" : "");
      mark.setAttribute("data-eb-note", note.id);
      mark.setAttribute("tabindex", "0");
      mark.setAttribute("aria-describedby", descId);
      try {
        r.surroundContents(mark);
      } catch (err) {
        return false;
      }
    }

    // The note text, in the document, where a screen reader meets the
    // passage. Visually hidden; not hidden from assistive technology.
    var desc = document.createElement("span");
    desc.className = "eb-note-desc";
    desc.id = descId;
    desc.textContent = note.body
      ? "Your note: " + note.body
      : "Your highlight, with no note.";
    var first = document.querySelector('mark.eb-annot[data-eb-note="' + note.id + '"]');
    if (first && first.parentNode) {
      first.parentNode.insertBefore(desc, first.nextSibling);
    }
    return true;
  }

  function repaint() {
    clearMarks();
    var nodes = textNodes();
    if (!nodes.length) return;
    var text = plainText(nodes);
    var here = pageId();
    var mine = state.notes.filter(function (n) {
      return n.page === here;
    });
    // Paint from the end backwards: wrapping earlier text does not then
    // shift the offsets of a later annotation.
    mine
      .map(function (n) {
        return { note: n, at: anchor(n, nodes, text) };
      })
      .sort(function (x, y) {
        return (y.at ? y.at.start : -1) - (x.at ? x.at.start : -1);
      })
      .forEach(function (item) {
        item.note.orphan = !item.at;
        if (item.at) {
          // Re-read the nodes each time: a previous paint changed the tree.
          var ns = textNodes();
          var tx = plainText(ns);
          var at = anchor(item.note, ns, tx);
          if (at) paintRange(ns, at.start, at.end, item.note);
          else item.note.orphan = true;
        }
      });
    renderList();
  }

  function pageId() {
    var path = window.location.pathname;
    return path.substring(path.lastIndexOf("/") + 1) || "index.html";
  }

  function pageTitle() {
    var h1 = document.querySelector("article h1");
    return (h1 ? h1.textContent : document.title || "").replace(/¶$/, "").trim();
  }

  // --- creating -------------------------------------------------------------

  function fromSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var root = article();
    var range = sel.getRangeAt(0);
    if (!root || !root.contains(range.commonAncestorContainer)) return null;
    var nodes = textNodes();
    var text = plainText(nodes);
    var start = offsetOf(nodes, range.startContainer, range.startOffset);
    var end = offsetOf(nodes, range.endContainer, range.endOffset);
    if (start < 0 || end < 0 || end <= start) return null;
    return {
      exact: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT), start),
      suffix: text.substr(end, CONTEXT),
      start: start,
      end: end
    };
  }

  /** The nearest heading above the caret, so a keyboard user can always
   *  annotate something even with nothing selected. */
  function fromSection() {
    var heads = article() ? article().querySelectorAll("h1, h2, h3") : [];
    if (!heads.length) return null;
    var target = heads[0];
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top < window.innerHeight * 0.4) {
        target = heads[i];
      }
    }
    var nodes = textNodes();
    var text = plainText(nodes);
    var label = target.textContent.replace(/¶$/, "").trim();
    var at = text.indexOf(label);
    if (at < 0) return null;
    return {
      exact: label,
      prefix: text.slice(Math.max(0, at - CONTEXT), at),
      suffix: text.substr(at + label.length, CONTEXT),
      start: at,
      end: at + label.length
    };
  }

  function addNote(target, body) {
    var note = {
      id: uid(),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      page: pageId(),
      pageTitle: pageTitle(),
      target: target,
      body: body || "",
      tags: []
    };
    state.notes.push(note);
    save();
    repaint();
    announce(body ? "note added" : "highlight added");
    return note;
  }

  function removeNote(id) {
    state.notes = state.notes.filter(function (n) {
      return n.id !== id;
    });
    save();
    repaint();
    announce("note deleted");
  }

  // --- export and import ----------------------------------------------------

  function exportJson() {
    return JSON.stringify(
      {
        "@context": "http://www.w3.org/ns/anno.jsonld",
        generator: "what-easybuild-is-doing",
        exported: new Date().toISOString(),
        total: state.notes.length,
        items: state.notes.map(function (n) {
          return {
            id: n.id,
            type: "Annotation",
            created: n.created,
            modified: n.modified,
            body: n.body
              ? [{ type: "TextualBody", value: n.body, format: "text/plain" }]
              : [],
            target: {
              source: n.page,
              sourceTitle: n.pageTitle,
              selector: [
                {
                  type: "TextQuoteSelector",
                  exact: n.target.exact,
                  prefix: n.target.prefix,
                  suffix: n.target.suffix
                },
                {
                  type: "TextPositionSelector",
                  start: n.target.start,
                  end: n.target.end
                }
              ]
            }
          };
        })
      },
      null,
      1
    );
  }

  function exportMarkdown() {
    var byPage = {};
    state.notes.forEach(function (n) {
      (byPage[n.page] = byPage[n.page] || []).push(n);
    });
    var out = ["# Notes on EasyBuild: the file, the tree, and the run", ""];
    out.push("Exported " + new Date().toISOString() + ".", "");
    Object.keys(byPage)
      .sort()
      .forEach(function (page) {
        var notes = byPage[page].slice().sort(function (a, b) {
          return (a.target.start || 0) - (b.target.start || 0);
        });
        out.push("## " + (notes[0].pageTitle || page), "");
        notes.forEach(function (n) {
          // A text fragment, so the link opens the page at the passage even
          // though the annotation itself lives only in this reader's browser.
          var frag = "#:~:text=" + encodeURIComponent(n.target.exact.slice(0, 120));
          out.push("> " + n.target.exact.replace(/\n+/g, " "));
          out.push("");
          if (n.body) out.push(n.body, "");
          out.push("[" + page + "](" + page + frag + ")" + (n.orphan ? " (passage not found in the current text)" : ""));
          out.push("");
        });
      });
    return out.join("\n");
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    announce("exported " + name);
  }

  function importJson(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      announce("that file is not JSON this can read");
      return;
    }
    var items = data.items || data.notes || [];
    var have = {};
    state.notes.forEach(function (n) {
      have[n.id] = true;
    });
    var added = 0;
    items.forEach(function (it) {
      var quote = null;
      var pos = null;
      var sels = (it.target && it.target.selector) || [];
      (Array.isArray(sels) ? sels : [sels]).forEach(function (s) {
        if (s && s.type === "TextQuoteSelector") quote = s;
        if (s && s.type === "TextPositionSelector") pos = s;
      });
      if (!quote) return;
      var id = it.id || uid();
      if (have[id]) return;
      var body = "";
      if (Array.isArray(it.body) && it.body.length) body = it.body[0].value || "";
      else if (typeof it.body === "string") body = it.body;
      state.notes.push({
        id: id,
        created: it.created || new Date().toISOString(),
        modified: it.modified || new Date().toISOString(),
        page: (it.target && it.target.source) || pageId(),
        pageTitle: (it.target && it.target.sourceTitle) || "",
        target: {
          exact: quote.exact,
          prefix: quote.prefix || "",
          suffix: quote.suffix || "",
          start: pos ? pos.start : null,
          end: pos ? pos.end : null
        },
        body: body,
        tags: it.tags || []
      });
      added++;
    });
    save();
    repaint();
    announce(added + " annotations imported");
  }

  // --- the panel ------------------------------------------------------------

  function announce(msg) {
    if (state.live) state.live.textContent = msg;
  }

  function build() {
    var live = document.createElement("div");
    live.className = "eb-annot-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    document.body.appendChild(live);
    state.live = live;

    var panel = document.createElement("div");
    panel.className = "eb-annot-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Your notes");
    panel.hidden = true;
    panel.innerHTML =
      '<div class="eb-annot-panel__head">' +
      "  <h2>Your notes</h2>" +
      '  <button type="button" class="eb-annot-x" aria-label="close notes">esc</button>' +
      "</div>" +
      '<p class="eb-annot-panel__note">Stored in this browser only. Nothing is' +
      " sent anywhere, and clearing site data deletes it, so export what you" +
      " want to keep.</p>" +
      '<div class="eb-annot-add">' +
      '  <button type="button" class="eb-annot-from-selection">Note the selected text</button>' +
      '  <button type="button" class="eb-annot-from-section">Note this section</button>' +
      "</div>" +
      '<form class="eb-annot-form" hidden>' +
      '  <blockquote class="eb-annot-form__quote"></blockquote>' +
      '  <label for="eb-annot-body">Your note</label>' +
      '  <textarea id="eb-annot-body" rows="3"></textarea>' +
      '  <div class="eb-annot-form__row">' +
      '    <button type="submit">Save</button>' +
      '    <button type="button" class="eb-annot-cancel">Cancel</button>' +
      "  </div>" +
      "</form>" +
      '<ul class="eb-annot-list"></ul>' +
      '<div class="eb-annot-io">' +
      '  <button type="button" class="eb-annot-json">Export JSON</button>' +
      '  <button type="button" class="eb-annot-md">Export Markdown</button>' +
      '  <label class="eb-annot-import">Import JSON' +
      '    <input type="file" accept="application/json,.json" />' +
      "  </label>" +
      "</div>";
    document.body.appendChild(panel);
    state.panel = panel;

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "eb-annot-launcher";
    launcher.innerHTML =
      '<span class="eb-annot-launcher__label">Notes</span>' +
      '<span class="eb-annot-launcher__count" aria-hidden="true">0</span>';
    launcher.setAttribute("aria-label", "your notes");
    launcher.addEventListener("click", function () {
      toggle(true);
    });
    document.body.appendChild(launcher);
    state.launcher = launcher;

    panel.querySelector(".eb-annot-x").addEventListener("click", function () {
      toggle(false);
    });
    panel
      .querySelector(".eb-annot-from-selection")
      .addEventListener("click", function () {
        startNote(fromSelection(), "Select some text in the page first, with the mouse or with shift and the arrow keys.");
      });
    panel
      .querySelector(".eb-annot-from-section")
      .addEventListener("click", function () {
        startNote(fromSection(), "No heading found to attach a note to.");
      });
    panel.querySelector(".eb-annot-cancel").addEventListener("click", function () {
      hideForm();
    });
    panel.querySelector(".eb-annot-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var body = panel.querySelector("#eb-annot-body").value.trim();
      if (state.pending) addNote(state.pending, body);
      hideForm();
    });
    panel.querySelector(".eb-annot-json").addEventListener("click", function () {
      download("eb-notes.json", exportJson(), "application/json");
    });
    panel.querySelector(".eb-annot-md").addEventListener("click", function () {
      download("eb-notes.md", exportMarkdown(), "text/markdown");
    });
    panel
      .querySelector(".eb-annot-import input")
      .addEventListener("change", function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          importJson(String(reader.result));
        };
        reader.readAsText(file);
        ev.target.value = "";
      });
  }

  function startNote(target, complaint) {
    if (!target || !target.exact.trim()) {
      announce(complaint);
      return;
    }
    state.pending = target;
    var form = state.panel.querySelector(".eb-annot-form");
    form.hidden = false;
    form.querySelector(".eb-annot-form__quote").textContent = target.exact;
    var body = form.querySelector("#eb-annot-body");
    body.value = "";
    body.focus();
  }

  function hideForm() {
    state.pending = null;
    var form = state.panel.querySelector(".eb-annot-form");
    form.hidden = true;
  }

  function renderList() {
    if (!state.panel) return;
    var list = state.panel.querySelector(".eb-annot-list");
    list.textContent = "";
    var here = pageId();
    var sorted = state.notes.slice().sort(function (a, b) {
      if (a.page !== b.page) return a.page === here ? -1 : b.page === here ? 1 : a.page < b.page ? -1 : 1;
      return (a.target.start || 0) - (b.target.start || 0);
    });
    sorted.forEach(function (n) {
      var li = document.createElement("li");
      li.className = "eb-annot-item" + (n.orphan ? " eb-annot-item--orphan" : "");

      var where = document.createElement("p");
      where.className = "eb-annot-item__where";
      if (n.page === here) {
        var jump = document.createElement("button");
        jump.type = "button";
        jump.className = "eb-annot-jump";
        jump.textContent = "on this page";
        jump.addEventListener("click", function () {
          var mark = document.querySelector('mark.eb-annot[data-eb-note="' + n.id + '"]');
          if (mark) {
            mark.scrollIntoView({ block: "center", behavior: "smooth" });
            mark.focus();
          } else {
            announce("that passage is not in the current text");
          }
        });
        where.appendChild(jump);
      } else {
        var link = document.createElement("a");
        link.href = n.page + "#:~:text=" + encodeURIComponent(n.target.exact.slice(0, 120));
        link.textContent = n.pageTitle || n.page;
        where.appendChild(link);
      }
      if (n.orphan) {
        var flag = document.createElement("span");
        flag.className = "eb-annot-item__flag";
        flag.textContent = "passage not found";
        where.appendChild(flag);
      }
      li.appendChild(where);

      var quote = document.createElement("blockquote");
      quote.textContent = n.target.exact;
      li.appendChild(quote);

      if (n.body) {
        var body = document.createElement("p");
        body.className = "eb-annot-item__body";
        body.textContent = n.body;
        li.appendChild(body);
      }

      var row = document.createElement("div");
      row.className = "eb-annot-item__row";
      var edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", function () {
        var next = window.prompt("Your note", n.body || "");
        if (next === null) return;
        n.body = next.trim();
        n.modified = new Date().toISOString();
        save();
        repaint();
        announce("note updated");
      });
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        removeNote(n.id);
      });
      row.appendChild(edit);
      row.appendChild(del);
      li.appendChild(row);
      list.appendChild(li);
    });

    if (!sorted.length) {
      var empty = document.createElement("li");
      empty.className = "eb-annot-item eb-annot-item--empty";
      empty.textContent =
        "No notes yet. Select a passage and press alt+n, or use the buttons above.";
      list.appendChild(empty);
    }
    if (state.launcher) {
      state.launcher.querySelector(".eb-annot-launcher__count").textContent =
        String(state.notes.length);
      state.launcher.setAttribute(
        "aria-label",
        state.notes.length === 1 ? "your notes, 1 note" : "your notes, " + state.notes.length + " notes"
      );
    }
  }

  function toggle(open) {
    state.open = open;
    state.panel.hidden = !open;
    document.documentElement.classList.toggle("eb-annot-open", open);
    if (open) {
      renderList();
      state.panel.querySelector(".eb-annot-from-selection").focus();
    } else {
      hideForm();
      if (state.launcher) state.launcher.focus();
    }
  }

  function onKeydown(ev) {
    if (ev.key === "Escape" && state.open) {
      toggle(false);
      return;
    }
    var typing =
      ev.target &&
      (ev.target.tagName === "INPUT" ||
        ev.target.tagName === "TEXTAREA" ||
        ev.target.isContentEditable);
    if (typing) return;
    if (ev.altKey && (ev.key === "n" || ev.key === "N")) {
      ev.preventDefault();
      var target = fromSelection();
      if (!state.open) toggle(true);
      startNote(
        target,
        "Select some text first, with the mouse or with shift and the arrow keys, then press alt+n."
      );
    }
  }

  function onMarkActivate(ev) {
    var mark = ev.target.closest ? ev.target.closest("mark.eb-annot") : null;
    if (!mark) return;
    if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
    if (ev.type === "keydown") ev.preventDefault();
    if (!state.open) toggle(true);
    var id = mark.getAttribute("data-eb-note");
    var item = state.panel.querySelector(".eb-annot-list");
    if (item) item.scrollTop = 0;
    announce("note for the highlighted passage is listed in the panel");
    var note = state.notes.filter(function (n) {
      return n.id === id;
    })[0];
    if (note) {
      var body = state.panel.querySelector("#eb-annot-body");
      if (body) body.setAttribute("placeholder", note.body || "");
    }
  }

  function init() {
    if (!article()) return;
    load();
    build();
    repaint();
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("click", onMarkActivate);
    document.addEventListener("keydown", onMarkActivate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
