// Mount the interactive widgets, and degrade honestly when the engine is
// absent.
//
// The engine is eb-stack compiled to WebAssembly. It does not exist yet
// (tracked as ebstack-4fcp), so today every widget renders as read-only
// code with a note saying so. That is deliberate: the book is publishable
// one chapter at a time, and a chapter whose prose only works once the
// widget is live is a chapter that cannot ship.
//
// When the engine lands it registers itself as `window.ebStack` with one
// method per widget name in KNOWN_WIDGETS (see _ext/eb_widget.py), each
// taking the seed source plus an optional universe id and returning a
// string to display. Nothing here needs to change for that to start
// working.

(function () {
  "use strict";

  var NOTE =
    "The interactive engine is not loaded on this page yet. " +
    "The sample below is the real input it will take.";

  function badge(text) {
    var el = document.createElement("p");
    el.className = "eb-widget-note";
    el.textContent = text;
    return el;
  }

  function runButton(mount, widget, universe, getSource, setOutput) {
    var button = document.createElement("button");
    button.className = "eb-widget-run";
    button.type = "button";
    button.textContent = "Run";
    button.addEventListener("click", function () {
      var engine = window.ebStack;
      var fn = engine && engine[widget];
      if (typeof fn !== "function") {
        setOutput("The engine exposes no " + widget + " method.");
        return;
      }
      try {
        setOutput(String(fn(getSource(), universe || null)));
      } catch (err) {
        // A parse error is a legitimate result here, not a crash: readers
        // learn from what the parser rejects.
        setOutput(String((err && err.message) || err));
      }
    });
    return button;
  }

  function mountOne(mount) {
    // mountAll runs again when the engine announces itself, so an already
    // live widget is left alone and an inert one is reconsidered.
    if (mount.getAttribute("data-eb-state") === "live") {
      return;
    }
    var stale = mount.querySelector(".eb-widget-note");
    if (stale) {
      stale.remove();
    }

    var widget = mount.getAttribute("data-eb-widget");
    var universe = mount.getAttribute("data-eb-universe");
    var pre = mount.querySelector("pre");
    if (!pre) {
      return;
    }

    var seed = pre.textContent;
    var engineReady =
      window.ebStack && typeof window.ebStack[widget] === "function";

    if (!engineReady) {
      mount.appendChild(badge(NOTE));
      mount.setAttribute("data-eb-state", "inert");
      return;
    }

    // A textarea is the placeholder editor. CodeMirror replaces it once the
    // engine can answer completion queries, which is how janet.guide builds
    // its autocomplete: query the WASM environment at startup.
    var editor = document.createElement("textarea");
    editor.className = "eb-widget-editor";
    editor.spellcheck = false;
    editor.value = seed;
    editor.rows = Math.min(24, seed.split("\n").length + 1);

    var output = document.createElement("pre");
    output.className = "eb-widget-output";

    function setOutput(text) {
      output.textContent = text;
    }

    pre.replaceWith(editor);
    mount.appendChild(
      runButton(
        mount,
        widget,
        universe,
        function () {
          return editor.value;
        },
        setOutput
      )
    );
    mount.appendChild(output);
    mount.setAttribute("data-eb-state", "live");
  }

  function mountAll() {
    var mounts = document.querySelectorAll(".eb-widget");
    for (var i = 0; i < mounts.length; i++) {
      mountOne(mounts[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }

  // The engine may finish loading after this script runs.
  window.addEventListener("eb-stack-ready", mountAll);
})();
