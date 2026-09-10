/**
 * Dive-in details, in the reader's browser.
 *
 * A knowl link opens its target under the block the reader is standing in,
 * rather than taking them to it. PreTeXt's phrase for what that buys is the
 * right one: the page splits and a box opens. The reader's place on the page
 * does not move, so reference material costs a glance instead of a
 * navigation and a scroll back.
 *
 * Four properties this file is responsible for, none of them free:
 *
 * - *The link works without it.* Every knowl is an anchor with a real href
 *   to where the block is born. No script, a failed fetch, a middle click,
 *   or a reader who opened build/html from the filesystem all get the
 *   ordinary link. That is why nothing here removes the href.
 * - *Fetched once.* Fragments are cached by id for the life of the page, and
 *   a hover or a keyboard focus starts the fetch before the click.
 * - *Nesting.* A fragment may itself contain knowls. Delegation on the
 *   document is what makes that work, and the depth is tracked so Escape
 *   closes the innermost box rather than all of them.
 * - *Focus goes with the content.* Opening moves focus into the box and
 *   closing puts it back on the link, because a box that appears out of
 *   reach of the keyboard is a box a screen-reader user cannot read.
 */
(function () {
  "use strict";

  var FRAGMENTS = new Map();
  var PENDING = new Map();

  /** Fetch a fragment once. Rejects, and the caller falls back to the link. */
  function fragment(url) {
    if (FRAGMENTS.has(url)) return Promise.resolve(FRAGMENTS.get(url));
    if (PENDING.has(url)) return PENDING.get(url);
    var p = fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("knowl " + url + ": HTTP " + r.status);
        return r.text();
      })
      .then(function (html) {
        FRAGMENTS.set(url, html);
        PENDING.delete(url);
        return html;
      })
      .catch(function (err) {
        PENDING.delete(url);
        throw err;
      });
    PENDING.set(url, p);
    return p;
  }

  /**
   * Where the page should split.
   *
   * The box goes after the reader's current block, not after the word, so
   * the sentence they are reading stays whole. A knowl inside a list item
   * splits the item; one inside a table cell splits the table, because
   * putting block content inside a cell breaks the layout of the table it
   * is explaining.
   */
  function splitPoint(link) {
    var el = link;
    while (el && el !== document.body) {
      var parent = el.parentElement;
      if (!parent) break;
      var tag = el.tagName;
      if (tag === "P" || tag === "LI" || tag === "DD" || tag === "DT") {
        // A paragraph inside a table cell is still inside a table.
        var cell = el.closest("table");
        if (cell) return cell.closest(".table-wrapper") || cell;
        return el;
      }
      if (tag === "TABLE" || tag === "FIGURE" || tag === "BLOCKQUOTE") {
        return el.closest(".table-wrapper") || el;
      }
      el = parent;
    }
    return link;
  }

  function close(link) {
    var id = link.getAttribute("data-eb-box");
    if (!id) return;
    var box = document.getElementById(id);
    if (box) box.remove();
    link.removeAttribute("data-eb-box");
    link.setAttribute("aria-expanded", "false");
    link.focus();
  }

  var seq = 0;

  function open(link) {
    var url = link.getAttribute("data-eb-fragment");
    var title = link.textContent.trim();
    var boxId = "eb-knowl-box-" + ++seq;
    var box = document.createElement("div");
    box.className = "eb-knowl-box eb-knowl-box--loading";
    box.id = boxId;
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", title);
    box.setAttribute("tabindex", "-1");
    box.textContent = "";
    var after = splitPoint(link);
    after.parentNode.insertBefore(box, after.nextSibling);
    link.setAttribute("data-eb-box", boxId);
    link.setAttribute("aria-expanded", "true");

    fragment(url)
      .then(function (html) {
        box.classList.remove("eb-knowl-box--loading");
        box.innerHTML = html;
        var closer = document.createElement("button");
        closer.type = "button";
        closer.className = "eb-knowl-box__close";
        closer.setAttribute("aria-label", "close " + title);
        closer.textContent = "close";
        closer.addEventListener("click", function () {
          close(link);
        });
        box.appendChild(closer);
        box.focus();
      })
      .catch(function () {
        // The href is still the href. Send them where the block is born
        // rather than leaving an empty box and a broken promise.
        box.remove();
        link.removeAttribute("data-eb-box");
        link.setAttribute("aria-expanded", "false");
        window.location.href = link.getAttribute("href");
      });
  }

  function onClick(ev) {
    var link = ev.target.closest ? ev.target.closest("a.eb-knowl") : null;
    if (!link) return;
    // Anything that means "somewhere else, please" is left alone.
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    if (link.getAttribute("data-eb-box")) close(link);
    else open(link);
  }

  function onKeydown(ev) {
    if (ev.key !== "Escape") return;
    // The innermost open box, which is the one the reader is in.
    var box = ev.target.closest ? ev.target.closest(".eb-knowl-box") : null;
    if (!box) return;
    var link = document.querySelector('a.eb-knowl[data-eb-box="' + box.id + '"]');
    if (link) {
      ev.preventDefault();
      close(link);
    }
  }

  function prefetch(ev) {
    var link = ev.target.closest ? ev.target.closest("a.eb-knowl") : null;
    if (!link) return;
    var url = link.getAttribute("data-eb-fragment");
    if (url) fragment(url).catch(function () {});
  }

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("mouseover", prefetch, { passive: true });
  document.addEventListener("focusin", prefetch, { passive: true });
})();
