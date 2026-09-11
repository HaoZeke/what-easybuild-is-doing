// Island runtime: hydrate each widget on its own terms, and load the
// engine once, lazily, for the whole page.
//
// The page engine applies tables exported from eb-stack (charmap,
// templates, hierarchy, a canned universe). It is not eb-stack and not
// EasyBuild. eb-stack is the updater/generator that emits .eb files;
// EasyBuild builds them. The crate does not build for wasm32 yet
// (ureq, fs2). eb-widget-engine.js is the stand-in: implemented
// widgets go live, the rest settle inert.
//
// That partial state is deliberate rather than a placeholder. The book
// publishes a chapter at a time, and a chapter whose prose only works once
// its widget is live is a chapter that cannot ship.
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
  var UNIMPLEMENTED_NOTE =
    "The engine is loaded but does not implement this widget yet, so this " +
    "sample is read-only. The code above is the real input it will take.";

  // How long an island waits for the engine before saying so. The engine
  // fetches its tables, so it is not ready when this script runs, and an
  // island scheduled immediately would otherwise decide it never will be.
  var ENGINE_WAIT_MS = 15000;

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

      // The engine is a separate script on this page and announces itself
      // once its tables are in, so wait for the announcement. Guessing a
      // module URL here is what made the first island on a page settle
      // inert: it lost the race, took a 404, and rejected the one promise
      // every later island shares.
      var settled = false;
      var timer = null;

      function finish(fn, arg) {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("eb-stack-ready", onReady);
        if (timer) {
          clearTimeout(timer);
        }
        fn(arg);
      }

      function onReady() {
        if (window.EB_STACK_ENGINE) {
          finish(resolve, window.EB_STACK_ENGINE);
        } else {
          finish(reject, new Error("engine announced but absent"));
        }
      }

      window.addEventListener("eb-stack-ready", onReady);

      // An explicitly configured module still wins, for a host that
      // supplies the engine some other way than a script on the page.
      if (window.EB_STACK_ENGINE_URL) {
        import(/* webpackIgnore: true */ window.EB_STACK_ENGINE_URL).then(
          function (mod) {
            var engine = mod.engine || mod.default || mod;
            if (typeof mod.init === "function") {
              Promise.resolve(mod.init()).then(function () {
                finish(resolve, engine);
              }, function (err) {
                finish(reject, err);
              });
              return;
            }
            finish(resolve, engine);
          },
          function (err) {
            finish(reject, err);
          }
        );
      }

      timer = setTimeout(function () {
        finish(reject, new Error("engine did not load"));
      }, ENGINE_WAIT_MS);
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

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // A small tokeniser for the easyconfig subset the samples use. It is not a
  // Python lexer and does not need to be: what a reader has to pick out is a
  // string from a name, a comment from code, and above all a %(...)s template
  // from the text around it, because the template is what half these chapters
  // are about.
  //
  // Order matters. Comments and strings are matched before anything else, so
  // a # inside a string stays a string and a keyword inside a comment stays a
  // comment.
  var EC_TOKEN = /(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?""")|('[^'\n]*'|"[^"\n]*")|\b(True|False|None|SYSTEM)\b|\b(\d[\w.]*)\b|^([A-Za-z_][A-Za-z0-9_]*)(?=\s*=)/gm;

  function paintString(text) {
    // Inside a string, a template is the part that will change when the
    // reader edits a version. Marking it is the reason this is coloured.
    return escapeHtml(text).replace(
      /%\(([a-z_][a-z0-9_]*)\)s/g,
      '<span class="ec-tpl">%($1)s</span>'
    );
  }

  function highlightEasyconfig(source) {
    var out = "";
    var last = 0;
    var m;
    EC_TOKEN.lastIndex = 0;
    while ((m = EC_TOKEN.exec(source)) !== null) {
      out += escapeHtml(source.slice(last, m.index));
      if (m[1]) {
        out += '<span class="ec-comment">' + escapeHtml(m[1]) + "</span>";
      } else if (m[2] || m[3]) {
        out += '<span class="ec-str">' + paintString(m[2] || m[3]) + "</span>";
      } else if (m[4]) {
        out += '<span class="ec-const">' + escapeHtml(m[4]) + "</span>";
      } else if (m[5]) {
        out += '<span class="ec-num">' + escapeHtml(m[5]) + "</span>";
      } else if (m[6]) {
        out += '<span class="ec-key">' + escapeHtml(m[6]) + "</span>";
      }
      last = m.index + m[0].length;
      // A zero-width match would spin here. The alternation cannot produce
      // one, but a hang is unrecoverable and the guard costs nothing.
      if (m[0].length === 0) {
        EC_TOKEN.lastIndex += 1;
      }
    }
    out += escapeHtml(source.slice(last));
    // A trailing newline collapses in a <pre>, which would shorten the
    // backdrop by a line and misalign it against the textarea.
    return out + "\n";
  }

  function activate(island, engine) {
    // Activating twice is possible: an island can be waiting on the engine
    // when the engine announces itself, which resolves its own wait and
    // also brings it back through the listener. The second pass would find
    // the output element where the source used to be and reseed the editor
    // with the previous answer, so refuse it here.
    if (island.querySelector(".eb-widget-editor")) {
      return;
    }

    var widget = island.getAttribute("data-eb-widget");
    var universe = island.getAttribute("data-eb-universe") || null;
    var run = engine && engine[widget];
    // The highlighted source block specifically. Any pre would also match
    // this widget's own output, which is a pre by design.
    var pre =
      island.querySelector(".highlight pre") ||
      island.querySelector("pre:not(.eb-widget-output)");

    if (!pre) {
      settleInert(island, FAILED_NOTE);
      return;
    }
    if (typeof run !== "function") {
      // A partial engine is the normal case while the book is being written,
      // so say which of the two things is missing rather than blaming the
      // load.
      settleInert(island, UNIMPLEMENTED_NOTE);
      return;
    }

    // A textarea, with a highlighted copy of its own text painted behind it.
    // The textarea keeps every native behaviour a reader expects; the <pre>
    // behind it restores the colour the static block had. Without that, a
    // sample visibly degrades the moment it becomes editable, which reads as
    // something breaking rather than something waking up.
    var seed = pre.textContent.replace(/\n+$/, "");
    var editor = document.createElement("textarea");
    editor.className = "eb-widget-editor";
    editor.spellcheck = false;
    editor.autocapitalize = "off";
    editor.autocomplete = "off";
    editor.setAttribute("autocorrect", "off");
    editor.value = seed;
    editor.setAttribute("aria-label", "editable " + widget + " sample");

    // Deliberately not the theme's `highlight` class. That class carries
    // rules meant for a static block, including `display: grid` on the pre
    // for line highlighting, which turns every token of the backdrop into
    // its own row. The wrapper styles itself.
    var wrap = document.createElement("div");
    wrap.className = "eb-widget-editor-wrap";

    // The easyblock widget takes bare software names rather than easyconfig
    // syntax, so colouring it as code would assert a grammar it has not got.
    var backdrop = null;
    if (widget !== "easyblock") {
      backdrop = document.createElement("pre");
      backdrop.className = "eb-widget-highlight";
      backdrop.setAttribute("aria-hidden", "true");
      wrap.appendChild(backdrop);
    }
    wrap.appendChild(editor);

    function paint() {
      if (backdrop) {
        backdrop.innerHTML = highlightEasyconfig(editor.value);
      }
    }

    // Grow to fit rather than scroll. A sample that hides its own last line
    // behind an inner scrollbar is worse than a tall page.
    function fit() {
      editor.style.height = "auto";
      editor.style.height = editor.scrollHeight + "px";
    }

    var output = document.createElement("pre");
    output.className = "eb-widget-output";
    // The answer changes without the reader asking, so a screen reader has
    // to be told. polite rather than assertive: it is an update, not an
    // emergency, and it should not interrupt what is being read.
    output.setAttribute("aria-live", "polite");
    output.setAttribute("aria-atomic", "true");

    // Every good implementation of this has a way back. A reader who breaks
    // a sample to see what happens, which this book asks them to do, must be
    // able to restore the canonical one without reloading and losing their
    // place on the page.
    var reset = document.createElement("button");
    reset.className = "eb-widget-reset";
    reset.type = "button";
    reset.textContent = "Reset";
    reset.title = "Restore the original sample";
    reset.setAttribute("aria-label", "Reset this sample to its original text");
    reset.hidden = true;

    function evaluate() {
      try {
        output.textContent = String(run(editor.value, universe));
      } catch (err) {
        // A parse error is a legitimate result, not a crash: a reader
        // learns as much from what the parser rejects as from what it
        // accepts.
        output.textContent = String((err && err.message) || err);
      }
    }

    // Re-run as the reader types, debounced. The prose says "change the
    // version and watch it move", and a button between the edit and the
    // answer is exactly what stops that being true.
    var pending = null;
    editor.addEventListener("input", function () {
      // Paint and size follow the keystroke; only the answer waits, so the
      // text never lags behind the caret.
      paint();
      fit();
      reset.hidden = editor.value === seed;
      if (pending) {
        clearTimeout(pending);
      }
      // Long enough to fire on a pause rather than per keystroke. A shorter
      // delay answers a half-typed line, and half a line is usually an
      // error the reader did not ask about.
      pending = setTimeout(function () {
        pending = null;
        evaluate();
      }, 320);
    });

    reset.addEventListener("click", function () {
      editor.value = seed;
      paint();
      fit();
      reset.hidden = true;
      evaluate();
      editor.focus();
    });

    // Ctrl-Enter for anyone who would rather ask explicitly.
    editor.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (pending) {
          clearTimeout(pending);
          pending = null;
        }
        evaluate();
      }
    });

    pre.replaceWith(wrap);
    island.appendChild(reset);
    island.appendChild(output);

    paint();
    fit();

    // Answer before being asked. A reader who scrolls past a live sample
    // should see what it says, not an empty box beside a button.
    evaluate();
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

  // Escape opens a page-level playground, the same idea as janet.guide:
  // the reader is not restricted to the samples the chapter thought of.
  // Other panels on this page already own Escape when they are open, so
  // this yields to an open knowl, Ask overlay, or annotation panel.
  var REPL_WIDGETS = [
    "parse",
    "template",
    "easyblock",
    "hierarchy",
    "modname",
    "solve",
    "lint",
    "emit",
  ];
  var REPL_SEEDS = {
    parse:
      "name = 'code-server'\nversion = '4.130.0'\ntoolchain = SYSTEM\n" +
      "sources = ['code-server-%(version)s-linux-%(mapped_arch)s.tar.gz']\n" +
      "moduleclass = 'tools'\n",
    template:
      "name = 'code-server'\nversion = '4.130.0'\n" +
      "sources = ['code-server-%(version)s-linux-%(mapped_arch)s.tar.gz']\n",
    easyblock: "code-server\nc++\nC#\nnetCDF-Fortran\n",
    hierarchy: "foss-2025a\n",
    modname:
      "name = 'GROMACS'\nversion = '2025.2'\n" +
      "toolchain = {'name': 'foss', 'version': '2025a'}\n" +
      "versionsuffix = '-CUDA-12.8.0'\n",
    solve:
      "name = 'GROMACS'\nversion = '2025.2'\n" +
      "toolchain = {'name': 'foss', 'version': '2025a'}\n" +
      "dependencies = [\n    ('Python', '3.13.1'),\n    ('FFTW', '3.3.10'),\n]\n" +
      "builddependencies = [\n    ('CMake', '3.31.4'),\n]\n",
    lint:
      "name = 'code-server'\nversion = '4.130.0'\ntoolchain = SYSTEM\n" +
      "sources = ['code-server-%(version)s-linux-amd64.tar.gz']\n",
    emit:
      "name = 'zlib'\nversion = '1.3.1'\n" +
      "toolchain = {'name': 'GCCcore', 'version': '14.2.0'}\n" +
      "sources = [SOURCELOWER_TAR_GZ]\n",
  };

  function otherPanelOwnsEscape() {
    if (document.querySelector(".eb-knowl-box")) {
      return true;
    }
    var ask = document.querySelector("[data-eb-ask-overlay], .eb-ask-overlay");
    if (ask && !ask.hidden && ask.getAttribute("hidden") === null) {
      var style = window.getComputedStyle ? window.getComputedStyle(ask) : null;
      if (!style || style.display !== "none" && style.visibility !== "hidden") {
        if (ask.offsetParent !== null || ask.getAttribute("aria-hidden") === "false") {
          if (!ask.hidden) {
            return ask.getAttribute("hidden") !== "true";
          }
        }
      }
    }
    var annot = document.querySelector(".eb-annot-panel");
    if (annot && annot.getAttribute("data-eb-open") === "1") {
      return true;
    }
    return false;
  }

  function buildRepl() {
    if (document.querySelector(".eb-repl")) {
      return document.querySelector(".eb-repl");
    }
    var dock = document.createElement("div");
    dock.className = "eb-repl";
    dock.setAttribute("role", "dialog");
    dock.setAttribute("aria-label", "EasyBuild playground");
    dock.hidden = true;

    var bar = document.createElement("div");
    bar.className = "eb-repl-bar";

    var title = document.createElement("span");
    title.className = "eb-repl-title";
    title.textContent = "Playground  ·  Esc to close";

    var select = document.createElement("select");
    select.className = "eb-repl-widget";
    select.setAttribute("aria-label", "playground widget");
    for (var i = 0; i < REPL_WIDGETS.length; i++) {
      var opt = document.createElement("option");
      opt.value = REPL_WIDGETS[i];
      opt.textContent = REPL_WIDGETS[i];
      select.appendChild(opt);
    }

    var close = document.createElement("button");
    close.type = "button";
    close.className = "eb-repl-close";
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close playground");

    bar.appendChild(title);
    bar.appendChild(select);
    bar.appendChild(close);

    var editor = document.createElement("textarea");
    editor.className = "eb-repl-editor";
    editor.spellcheck = false;
    editor.setAttribute("aria-label", "playground input");
    editor.value = REPL_SEEDS.parse;

    var output = document.createElement("pre");
    output.className = "eb-repl-output";
    output.setAttribute("aria-live", "polite");
    output.setAttribute("role", "status");

    dock.appendChild(bar);
    dock.appendChild(editor);
    dock.appendChild(output);
    document.body.appendChild(dock);

    var pending = null;
    function run() {
      var engine = window.EB_STACK_ENGINE;
      var name = select.value;
      if (!engine || typeof engine[name] !== "function") {
        output.textContent =
          "That widget is not loaded. Wait a moment, or reload.";
        return;
      }
      try {
        output.textContent = String(engine[name](editor.value, null));
      } catch (err) {
        output.textContent = String((err && err.message) || err);
      }
    }

    function onInput() {
      if (pending) {
        clearTimeout(pending);
      }
      pending = setTimeout(function () {
        pending = null;
        run();
      }, 320);
    }

    editor.addEventListener("input", onInput);
    select.addEventListener("change", function () {
      if (Object.prototype.hasOwnProperty.call(REPL_SEEDS, select.value)) {
        if (!editor.value.trim() || editor.value === REPL_SEEDS[editor.getAttribute("data-eb-seed")]) {
          editor.value = REPL_SEEDS[select.value];
        }
        editor.setAttribute("data-eb-seed", select.value);
      }
      run();
    });
    editor.setAttribute("data-eb-seed", "parse");
    close.addEventListener("click", function () {
      setReplOpen(false);
    });

    dock._ebRun = run;
    dock._ebEditor = editor;
    return dock;
  }

  function setReplOpen(open) {
    var dock = buildRepl();
    dock.hidden = !open;
    document.body.classList.toggle("eb-repl-open", open);
    if (open) {
      if (window.EB_STACK_ENGINE) {
        dock._ebRun();
      } else {
        loadEngine().then(
          function () {
            dock._ebRun();
          },
          function () {
            dock.querySelector(".eb-repl-output").textContent =
              "The engine did not load.";
          }
        );
      }
      dock._ebEditor.focus();
    }
  }

  function toggleRepl() {
    var dock = document.querySelector(".eb-repl");
    var open = dock && !dock.hidden;
    setReplOpen(!open);
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") {
      return;
    }
    if (ev.defaultPrevented) {
      return;
    }
    if (otherPanelOwnsEscape()) {
      return;
    }
    ev.preventDefault();
    toggleRepl();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleAll);
  } else {
    scheduleAll();
  }

  // An engine that finishes loading independently can announce itself, and
  // every island that is not already live reconsiders. Islands still marked
  // hydrating are included on purpose: one of them is whichever island
  // asked first, and excluding it is the bug this listener existed to
  // prevent.
  window.addEventListener("eb-stack-ready", function () {
    enginePromise = null;
    var islands = document.querySelectorAll(
      '.eb-widget:not([data-eb-state="live"])'
    );
    for (var i = 0; i < islands.length; i++) {
      islands[i].removeAttribute("data-eb-hydrating");
      hydrate(islands[i]);
    }
  });
})();
