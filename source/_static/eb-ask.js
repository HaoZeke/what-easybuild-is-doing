/**
 * Ask: the reader's half of retrieval.
 *
 * One panel, two things in it. A question is ranked against a pack of the
 * book's own chunks with BM25, and the passages that answer it open inside
 * the panel, so a reader who wanted one fact gets it without losing the page
 * they were on. That is the whole default behaviour and it needs no network
 * beyond the pack.
 *
 * A model is optional and separate. A reader who has an OpenAI-compatible
 * endpoint can point this at it and get prose with citation markers; the
 * endpoint and key stay in their own browser. A reader who has not gets the
 * ranked passages and a sentence saying that nothing wrote an answer, which
 * is the honest report and the one snelnext's Ask gives when its rails
 * refuse.
 *
 * Two rules the code enforces rather than hopes for:
 *
 * - *No pack, no panel.* If the pack fails to load the panel says so and
 *   offers Sphinx's own search page. It does not fall back to matching
 *   substrings and calling that a ranking.
 * - *No citation, no sentence.* An answer's sentences are kept only if they
 *   carry a marker pointing at a retrieved passage. A model that writes
 *   something the passages do not support has that sentence dropped before
 *   the reader sees it, and the panel says how many it dropped.
 */
(function () {
  "use strict";

  var PACK_URL = null; // resolved from this script's own src
  var pack = null;
  var packError = null;
  var packLoading = null;

  // --- the tokenizer, which has to be the one in eb_ask.py -----------------

  var TOKEN = /[a-z0-9_]{2,}/g;

  var STOP = new Set(
    ("the and for that this with what how why when where which are was were " +
      "does did doing have has had been being from into out not but can could " +
      "should would will you your our its their them they it is be of in on to " +
      "at by as or if do about over under than then there here all any some")
      .split(" ")
  );

  function tokenize(text) {
    var out = [];
    var raws = String(text == null ? "" : text).toLowerCase().match(TOKEN) || [];
    for (var i = 0; i < raws.length; i++) {
      var raw = raws[i];
      out.push(raw);
      if (raw.indexOf("_") !== -1) {
        var parts = raw.split("_");
        for (var j = 0; j < parts.length; j++) {
          if (parts[j].length >= 2) out.push(parts[j]);
        }
      }
    }
    return out;
  }

  function queryTokens(text) {
    return tokenize(text).filter(function (t) {
      return !STOP.has(t);
    });
  }

  // --- BM25, with every logarithm read from the pack ------------------------

  /**
   * Kahan-Babuska summation.
   *
   * Not a nicety. Naive summation moves the low bits of a score, and two
   * chunks whose scores differ in the low bits swap places, which is exactly
   * what check-ask.js reports as a disagreement with the reference ranker.
   */
  function kahan(values) {
    var sum = 0.0;
    var c = 0.0;
    for (var i = 0; i < values.length; i++) {
      var t = sum + values[i];
      if (Math.abs(sum) >= Math.abs(values[i])) c += sum - t + values[i];
      else c += values[i] - t + sum;
      sum = t;
    }
    return sum + c;
  }

  function bm25(qtoks, limit) {
    var k1 = pack.k1;
    var b = pack.b;
    var avgdl = pack.avgdl;
    var idf = pack.idf;
    var scored = [];
    for (var i = 0; i < pack.chunks.length; i++) {
      var chunk = pack.chunks[i];
      var terms = [];
      for (var t = 0; t < qtoks.length; t++) {
        var tok = qtoks[t];
        var f = chunk.tf[tok];
        if (!f) continue;
        var iv = idf[tok];
        if (iv === undefined) continue;
        var denom = f + k1 * (1 - b + (b * chunk.dl) / avgdl);
        terms.push((iv * (f * (k1 + 1))) / denom);
      }
      if (!terms.length) continue;
      scored.push({ chunk: chunk, score: kahan(terms), hits: terms.length });
    }
    // More query terms matched beats a higher score from one rare term: a
    // question is a conjunction in the reader's head even when BM25 treats
    // it as a bag. Ties then go to the score, then to pack order, so the
    // ranking is total and two implementations can be compared exactly.
    scored.sort(function (a, b2) {
      if (b2.hits !== a.hits) return b2.hits - a.hits;
      if (b2.score !== a.score) return b2.score - a.score;
      return a.chunk.id < b2.chunk.id ? -1 : 1;
    });
    return scored.slice(0, limit || 8);
  }

  // --- snippets -------------------------------------------------------------

  /** The window of the passage that actually contains the query terms. */
  function snippet(text, qtoks, width) {
    var lower = text.toLowerCase();
    var best = 0;
    var bestHits = -1;
    var step = 40;
    for (var start = 0; start < Math.max(1, lower.length - width); start += step) {
      var window = lower.slice(start, start + width);
      var hits = 0;
      for (var i = 0; i < qtoks.length; i++) {
        if (window.indexOf(qtoks[i]) !== -1) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = start;
      }
    }
    var cut = text.slice(best, best + width);
    if (best > 0) {
      var space = cut.indexOf(" ");
      if (space > 0 && space < 24) cut = cut.slice(space + 1);
      cut = "…" + cut;
    }
    if (best + width < text.length) cut = cut + "…";
    return cut;
  }

  function markTerms(text, qtoks) {
    var frag = document.createDocumentFragment();
    if (!qtoks.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    var escaped = qtoks
      .slice()
      .sort(function (a, b) {
        return b.length - a.length;
      })
      .map(function (t) {
        return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
    var re = new RegExp("(" + escaped.join("|") + ")", "gi");
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      var mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    return frag;
  }

  // --- the pack -------------------------------------------------------------

  function loadPack() {
    if (pack) return Promise.resolve(pack);
    if (packLoading) return packLoading;
    packLoading = fetch(PACK_URL, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("pack: HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        pack = data;
        packLoading = null;
        return pack;
      })
      .catch(function (err) {
        packError = err;
        packLoading = null;
        throw err;
      });
    return packLoading;
  }

  // --- the model, if the reader brought one ---------------------------------

  var MODEL_KEY = "eb-ask-model";

  function modelConfig() {
    try {
      var raw = window.localStorage.getItem(MODEL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveModelConfig(cfg) {
    try {
      if (cfg) window.localStorage.setItem(MODEL_KEY, JSON.stringify(cfg));
      else window.localStorage.removeItem(MODEL_KEY);
    } catch (e) {
      /* a browser with storage off still gets retrieval */
    }
  }

  var PROMPT =
    "Answer the question using only the numbered passages. Every sentence " +
    "must end with a citation like [2] naming the passage it came from. If " +
    "the passages do not answer the question, say exactly: the passages do " +
    "not answer this. Do not use any other knowledge.";

  function askModel(question, results) {
    var cfg = modelConfig();
    var passages = results
      .map(function (r, i) {
        return (
          "[" + (i + 1) + "] (" + r.chunk.crumb + " / " + r.chunk.title + ")\n" +
          r.chunk.text
        );
      })
      .join("\n\n");
    return fetch(cfg.base.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (cfg.key || "")
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: passages + "\n\nQuestion: " + question }
        ]
      })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("model: HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var text =
          (data.choices &&
            data.choices[0] &&
            data.choices[0].message &&
            data.choices[0].message.content) ||
          "";
        return enforceCitations(text, results.length);
      });
  }

  /**
   * Drop every sentence that does not cite a retrieved passage.
   *
   * The rail, and the reason a reader can trust the panel at all: what
   * survives is what the passages say. The count of what did not survive is
   * shown, because silently deleting a model's output would be its own kind
   * of dishonesty.
   */
  function enforceCitations(text, count) {
    var sentences = String(text)
      .split(/(?<=[.!?])\s+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    var kept = [];
    var dropped = 0;
    for (var i = 0; i < sentences.length; i++) {
      var cites = sentences[i].match(/\[(\d+)\]/g) || [];
      var ok = cites.some(function (c) {
        var n = parseInt(c.slice(1, -1), 10);
        return n >= 1 && n <= count;
      });
      if (ok) kept.push(sentences[i]);
      else dropped++;
    }
    return { text: kept.join(" "), dropped: dropped, total: sentences.length };
  }

  // --- the panel ------------------------------------------------------------

  var el = {};
  var lastResults = [];
  var lastTokens = [];

  function build() {
    var overlay = document.createElement("div");
    overlay.className = "eb-ask";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="eb-ask__scrim" data-eb-ask-close="1"></div>' +
      '<div class="eb-ask__panel" role="dialog" aria-modal="true"' +
      ' aria-label="Ask the book">' +
      '  <form class="eb-ask__bar" autocomplete="off">' +
      '    <input class="eb-ask__input" type="search" spellcheck="false"' +
      '           placeholder="Ask a question, or search for a parameter"' +
      '           aria-label="Ask a question" />' +
      '    <button class="eb-ask__x" type="button" data-eb-ask-close="1"' +
      '            aria-label="close">esc</button>' +
      "  </form>" +
      '  <p class="eb-ask__note"></p>' +
      '  <div class="eb-ask__answer" hidden></div>' +
      '  <ul class="eb-ask__results"></ul>' +
      '  <div class="eb-ask__foot">' +
      '    <details class="eb-ask__model">' +
      "      <summary>connect a model</summary>" +
      '      <p class="eb-ask__modelnote">Retrieval above runs here and needs' +
      " nothing. An answer needs a model, and it is yours: an" +
      " OpenAI-compatible endpoint, called from this browser, stored in this" +
      " browser. Sentences that cite no passage are dropped.</p>" +
      '      <label>endpoint <input class="eb-ask__base" type="url"' +
      '             placeholder="https://host/v1" /></label>' +
      '      <label>model <input class="eb-ask__model-name" type="text"' +
      '             placeholder="a model name" /></label>' +
      '      <label>key <input class="eb-ask__key" type="password"' +
      '             placeholder="optional" /></label>' +
      '      <div class="eb-ask__modelrow">' +
      '        <button class="eb-ask__save" type="button">save</button>' +
      '        <button class="eb-ask__forget" type="button">forget</button>' +
      "      </div>" +
      "    </details>" +
      '    <kbd>/</kbd> to open, <kbd>esc</kbd> to close' +
      "  </div>" +
      "</div>";
    document.body.appendChild(overlay);

    el.overlay = overlay;
    el.input = overlay.querySelector(".eb-ask__input");
    el.note = overlay.querySelector(".eb-ask__note");
    el.results = overlay.querySelector(".eb-ask__results");
    el.answer = overlay.querySelector(".eb-ask__answer");
    el.base = overlay.querySelector(".eb-ask__base");
    el.modelName = overlay.querySelector(".eb-ask__model-name");
    el.key = overlay.querySelector(".eb-ask__key");

    var cfg = modelConfig();
    if (cfg) {
      el.base.value = cfg.base || "";
      el.modelName.value = cfg.model || "";
      el.key.value = cfg.key || "";
    }

    overlay.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-eb-ask-close]")) hide();
    });
    overlay.querySelector(".eb-ask__bar").addEventListener("submit", function (ev) {
      ev.preventDefault();
      answer();
    });
    overlay.querySelector(".eb-ask__save").addEventListener("click", function () {
      saveModelConfig({
        base: el.base.value.trim(),
        model: el.modelName.value.trim(),
        key: el.key.value
      });
      el.note.textContent = "model saved in this browser.";
    });
    overlay.querySelector(".eb-ask__forget").addEventListener("click", function () {
      saveModelConfig(null);
      el.base.value = el.modelName.value = el.key.value = "";
      el.note.textContent = "model forgotten.";
    });

    var debounce = null;
    el.input.addEventListener("input", function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(search, 120);
    });

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "eb-ask-launcher";
    launcher.innerHTML =
      '<span class="eb-ask-launcher__label">Ask the book</span>' +
      '<kbd class="eb-ask-launcher__key">/</kbd>';
    launcher.addEventListener("click", function () {
      show();
    });
    document.body.appendChild(launcher);
  }

  function show() {
    el.overlay.hidden = false;
    document.documentElement.classList.add("eb-ask-open");
    el.input.focus();
    el.input.select();
    loadPack()
      .then(function () {
        if (!el.results.children.length && el.input.value.trim()) search();
        if (!el.input.value.trim()) {
          el.note.textContent =
            pack.chunks.length +
            " passages indexed. Retrieval runs here; nothing is sent anywhere.";
        }
      })
      .catch(function () {
        el.note.innerHTML =
          "the index did not load, so nothing here can rank a question. " +
          '<a href="search.html">Sphinx’s own search</a> still works.';
      });
  }

  function hide() {
    el.overlay.hidden = true;
    document.documentElement.classList.remove("eb-ask-open");
  }

  function kindBadge(kind) {
    var span = document.createElement("span");
    span.className = "eb-ask__kind eb-ask__kind--" + kind;
    span.textContent = kind;
    return span;
  }

  function search() {
    var q = el.input.value.trim();
    el.answer.hidden = true;
    el.answer.textContent = "";
    el.results.textContent = "";
    if (!q) {
      el.note.textContent = pack
        ? pack.chunks.length + " passages indexed."
        : "";
      return;
    }
    if (!pack) {
      el.note.textContent = packError ? "no index." : "loading the index…";
      return;
    }
    var qtoks = queryTokens(q);
    if (!qtoks.length) {
      el.note.textContent = "nothing to search on: every word was a stop word.";
      return;
    }
    var results = bm25(qtoks, 8);
    lastResults = results;
    lastTokens = qtoks;
    if (!results.length) {
      el.note.textContent =
        "no passage uses those words. The book may not cover it; that is " +
        "worth knowing rather than working around.";
      return;
    }
    el.note.textContent =
      results.length +
      " passages, ranked. Enter asks a model if you connected one.";
    results.forEach(function (r, i) {
      var li = document.createElement("li");
      li.className = "eb-ask__result";

      var head = document.createElement("a");
      head.className = "eb-ask__head";
      head.href = r.chunk.url;
      head.appendChild(document.createTextNode("[" + (i + 1) + "] "));
      var title = document.createElement("strong");
      title.textContent = r.chunk.title;
      head.appendChild(title);
      var crumb = document.createElement("span");
      crumb.className = "eb-ask__crumb";
      crumb.textContent = r.chunk.crumb;
      head.appendChild(crumb);
      head.appendChild(kindBadge(r.chunk.kind));
      li.appendChild(head);

      var body = document.createElement("p");
      body.className = "eb-ask__snippet";
      body.appendChild(markTerms(snippet(r.chunk.text, qtoks, 260), qtoks));
      li.appendChild(body);

      // The passage opens here, in the panel, for the same reason a knowl
      // opens in the page: the reader asked one question and should not
      // have to give up their place to have it answered.
      var more = document.createElement("button");
      more.type = "button";
      more.className = "eb-ask__more";
      more.textContent = "read the passage";
      var full = document.createElement("div");
      full.className = "eb-ask__full";
      full.hidden = true;
      more.addEventListener("click", function () {
        if (full.hidden) {
          full.textContent = "";
          full.appendChild(markTerms(r.chunk.text, qtoks));
          full.hidden = false;
          more.textContent = "close the passage";
        } else {
          full.hidden = true;
          more.textContent = "read the passage";
        }
      });
      li.appendChild(more);
      li.appendChild(full);
      el.results.appendChild(li);
    });
  }

  function answer() {
    var q = el.input.value.trim();
    if (!q || !lastResults.length) return;
    var cfg = modelConfig();
    el.answer.hidden = false;
    if (!cfg || !cfg.base || !cfg.model) {
      el.answer.className = "eb-ask__answer eb-ask__answer--none";
      el.answer.textContent =
        "No model is connected, so nothing wrote an answer. These are the " +
        "passages your question ranked to; the first one usually is the " +
        "answer, and it is in the book rather than in a paraphrase of it.";
      return;
    }
    el.answer.className = "eb-ask__answer eb-ask__answer--waiting";
    el.answer.textContent = "asking " + cfg.model + "…";
    askModel(q, lastResults)
      .then(function (res) {
        el.answer.className = "eb-ask__answer";
        el.answer.textContent = "";
        var p = document.createElement("p");
        p.textContent = res.text || "the passages do not answer this.";
        el.answer.appendChild(p);
        var foot = document.createElement("p");
        foot.className = "eb-ask__answerfoot";
        foot.textContent =
          res.dropped > 0
            ? res.dropped +
              " of " +
              res.total +
              " sentences cited no passage and were dropped."
            : "every sentence cites a passage below.";
        el.answer.appendChild(foot);
      })
      .catch(function (err) {
        el.answer.className = "eb-ask__answer eb-ask__answer--none";
        el.answer.textContent =
          "the model did not answer (" +
          err.message +
          "). The passages below are unaffected: they were ranked here.";
      });
  }

  function onKeydown(ev) {
    var typing =
      ev.target &&
      (ev.target.tagName === "INPUT" ||
        ev.target.tagName === "TEXTAREA" ||
        ev.target.isContentEditable);
    if (ev.key === "Escape" && !el.overlay.hidden) {
      hide();
      return;
    }
    if (typing) return;
    if (ev.key === "/" || ((ev.metaKey || ev.ctrlKey) && ev.key === "k")) {
      ev.preventDefault();
      show();
    }
  }

  function init() {
    var self = document.querySelector('script[src*="eb-ask.js"]');
    var src = self ? self.getAttribute("src") : "_static/eb-ask.js";
    PACK_URL = src.replace(/eb-ask\.js.*$/, "eb-ask-pack.json");
    build();
    document.addEventListener("keydown", onKeydown);
    // The pack is a download the reader has not asked for yet, so it waits
    // for an idle moment and for the panel to be wanted.
    if (window.requestIdleCallback) {
      window.requestIdleCallback(function () {
        loadPack().catch(function () {});
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
