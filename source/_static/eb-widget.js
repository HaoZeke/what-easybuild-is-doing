// Island runtime: hydrate each widget on its own terms, and load the
// engine once, lazily, for the whole page.
//
// The engine is eb-stack compiled to WebAssembly. It does not exist yet,
// so today every island settles into an inert state showing read-only
// code and saying so. That is deliberate rather than a placeholder: the
// book publishes a chapter at a time, and a chapter whose prose only works
// once the widget is live is a chapter that cannot ship.
//
// The drop-in contract, so the engine can land without touching this file:
//
//   window.EB_STACK_ENGINE      an object with one method per widget name,
//                               each (source, universe) -> string; or
//   window.EB_STACK_ENGINE_URL  a module URL to import, whose default
//                               export or `engine` named export is that
//                               object.
//
// With neither, the default URL below is tried and its failure is the
// inert path. Nothing here changes when the engine arrives.

(function () {
  "use strict";

  var INERT_NOTE =
    "The interactive engine is not loaded yet. The code above is the real " +
    "input it will take.";
  var FAILED_NOTE =
    "The interactive engine failed to load, so this sample is read-only.";

  // Derived from this script's own URL so it works at any page depth,
  // which a relative path from the page would not.
  function defaultEngineUrl() {
    var self = document.currentScript;
    if (!self || !self.src) {
      return null;
    }
    return self.src.replace(/eb-widget\.js(\?.*)?$/, "engine/eb_stack.js");
  }

  var DEFAULT_ENGINE_URL = defaultEngineUrl();

  // One promise for the whole page. Whichever island hydrates first pays
  // for the engine; every other island reuses it. This is the property
  // that makes the model worth porting.
  var enginePromise = null;

  function loadEngine() {
    if (enginePromise) {
      return enginePromise;
    }
    enginePromise = new Promise(function (resolve, reject) {
      if (window.EB_STACK_ENGINE) {
        resolve(window.EB_STACK_ENGINE);
        return;
      }
      var url = window.EB_STACK_ENGINE_URL || DEFAULT_ENGINE_URL;
      if (!url) {
        reject(new Error("no engine configured"));
        return;
      }
      import(/* webpackIgnore: true */ url).then(function (mod) {
        var engine = mod.engine || mod.default || mod;
        if (typeof mod.init === "function") {
          Promise.resolve(mod.init()).then(function () {
            resolve(engine);
          }, reject);
          return;
        }
        resolve(engine);
      }, reject);
    });
    return enginePromise;
  }

  function note(text) {
    var el = document.createElement("p");
    el.className = "eb-widget-note";
    el.textContent = text;
    return el;
  }

  function settleInert(island, text) {
    if (island.querySelector(".eb-widget-note")) {
      return;
    }
    island.appendChild(note(text));
    island.setAttribute("data-eb-state", "inert");
  }

  function activate(island, engine) {
    var widget = island.getAttribute("data-eb-widget");
    var universe = island.getAttribute("data-eb-universe") || null;
    var run = engine && engine[widget];
    var pre = island.querySelector("pre");

    if (typeof run !== "function" || !pre) {
      settleInert(island, FAILED_NOTE);
      return;
    }

    // A textarea is the placeholder editor. CodeMirror replaces it once the
    // engine can answer completion queries, which is how janet.guide builds
    // its autocomplete: query the WASM environment at startup.
    var seed = pre.textContent;
    var editor = document.createElement("textarea");
    editor.className = "eb-widget-editor";
    editor.spellcheck = false;
    editor.value = seed;
    editor.rows = Math.min(24, seed.split("\n").length + 1);

    var output = document.createElement("pre");
    output.className = "eb-widget-output";

    var button = document.createElement("button");
    button.className = "eb-widget-run";
    button.type = "button";
    button.textContent = "Run";
    button.addEventListener("click", function () {
      try {
        output.textContent = String(run(editor.value, universe));
      } catch (err) {
        // A parse error is a legitimate result, not a crash: a reader
        // learns as much from what the parser rejects as from what it
        // accepts.
        output.textContent = String((err && err.message) || err);
      }
    });

    pre.replaceWith(editor);
    island.appendChild(button);
    island.appendChild(output);
    island.setAttribute("data-eb-state", "live");
  }

  function hydrate(island) {
    if (island.getAttribute("data-eb-state") === "live") {
      return;
    }
    if (island.getAttribute("data-eb-hydrating") === "1") {
      return;
    }
    island.setAttribute("data-eb-hydrating", "1");
    loadEngine().then(
      function (engine) {
        island.removeAttribute("data-eb-hydrating");
        var stale = island.querySelector(".eb-widget-note");
        if (stale) {
          stale.remove();
        }
        activate(island, engine);
      },
      function () {
        island.removeAttribute("data-eb-hydrating");
        settleInert(island, INERT_NOTE);
      }
    );
  }

  function whenIdle(fn) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(fn, { timeout: 2000 });
    } else {
      window.setTimeout(fn, 200);
    }
  }

  function observeVisible(island) {
    if (typeof window.IntersectionObserver !== "function") {
      // Without an observer, treat visible as load: correct, just less
      // frugal, which is the right direction to fail in.
      hydrate(island);
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            observer.disconnect();
            hydrate(island);
            return;
          }
        }
      },
      // A little ahead of the viewport, so the engine is loading by the
      // time the reader arrives at the widget rather than after.
      { rootMargin: "200px 0px" }
    );
    observer.observe(island);
  }

  function schedule(island) {
    switch (island.getAttribute("data-eb-hydrate")) {
      case "load":
        hydrate(island);
        break;
      case "idle":
        whenIdle(function () {
          hydrate(island);
        });
        break;
      default:
        observeVisible(island);
    }
  }

  function scheduleAll() {
    var islands = document.querySelectorAll(".eb-widget");
    for (var i = 0; i < islands.length; i++) {
      schedule(islands[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleAll);
  } else {
    scheduleAll();
  }

  // An engine that finishes loading independently can announce itself, and
  // every island that had settled inert reconsiders.
  window.addEventListener("eb-stack-ready", function () {
    enginePromise = null;
    var islands = document.querySelectorAll('.eb-widget[data-eb-state="inert"]');
    for (var i = 0; i < islands.length; i++) {
      hydrate(islands[i]);
    }
  });
})();
