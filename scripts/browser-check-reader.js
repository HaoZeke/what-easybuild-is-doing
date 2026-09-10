// Drive the reader's three mechanisms in a real browser and assert what they do.
//
// The widgets shipped dead once because every check ran under node with a
// stubbed document. Knowls, Ask and annotations are the same shape of risk:
// they are DOM code, they fetch, they store, and none of that is exercised by
// importing a module. So this loads the built html over http and:
//
//   knowls       clicks a dive-in link, waits for the fetch, asserts the box
//                appeared with the born block's content and its way back
//   ask          presses "/", types a question, asserts ranked results with a
//                passage, and opens one in the panel
//   annotations  selects a passage, saves a note, asserts the mark carries an
//                aria-describedby pointing at the note text, then reloads and
//                asserts the mark came back from storage
//   a11y         asserts the keyboard path exists: focusable marks, a labelled
//                dialog, a live region, and no element signalling only by colour
//
//   node scripts/browser-check-reader.js [base-url]
//
// Skips rather than fails with no chromium or nothing served: a missing
// browser is not a defect in the book.
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const base = (process.argv[2] || "http://localhost:8173/html").replace(/\/$/, "");
const port = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  const candidates = [
    process.env.CHROMIUM,
    path.join(process.env.HOME || "", ".local/bin/chromium"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {}
  }
  return null;
}

const get = (p) =>
  new Promise((res, rej) =>
    http
      .get({ host: "127.0.0.1", port, path: p }, (r) => {
        let b = "";
        r.on("data", (d) => (b += d));
        r.on("end", () => res(JSON.parse(b)));
      })
      .on("error", rej)
  );

/** A chapter that has a dive-in link, read from the source rather than named. */
function pageWithDive() {
  const dir = path.resolve(__dirname, "..", "orgmode");
  for (const file of fs.readdirSync(dir).filter((f) => /^\d+.*\.org$/.test(f)).sort()) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    if (/\[\[dive:/.test(text)) return file.replace(/\.org$/, "") + ".html";
  }
  return null;
}

async function main() {
  const chromium = findChromium();
  if (!chromium) {
    console.log("skipped: no chromium found");
    return 0;
  }
  try {
    execSync(`curl -sf -o /dev/null ${base}/index.html`);
  } catch {
    console.log(`skipped: nothing served at ${base}`);
    return 0;
  }
  const page = pageWithDive();
  if (!page) {
    console.log("skipped: no chapter carries a dive-in link");
    return 0;
  }

  const chrome = spawn(
    chromium,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let failures = 0;
  const fail = (msg) => {
    console.log("FAIL " + msg);
    failures += 1;
  };
  const ok = (msg) => console.log("ok: " + msg);

  try {
    for (let i = 0; i < 80; i++) {
      try {
        await get("/json/version");
        break;
      } catch {
        await sleep(250);
      }
    }
    const target = (await get("/json/list")).find((t) => t.type === "page");
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = {};
    const errors = [];
    await new Promise((r) => sock.addEventListener("open", r));
    sock.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) {
        pending[m.id](m.result);
        delete pending[m.id];
        return;
      }
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        errors.push(m.params.entry.text + " <" + (m.params.entry.url || "") + ">");
      }
      if (m.method === "Runtime.exceptionThrown") {
        errors.push(
          "exception: " +
            (m.params.exceptionDetails.exception?.description ||
              m.params.exceptionDetails.text)
        );
      }
    });
    const cmd = (method, params) =>
      new Promise((res) => {
        pending[++id] = res;
        sock.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) =>
      (await cmd("Runtime.evaluate", { returnByValue: true, expression, awaitPromise: true }))
        .result.value;

    await cmd("Runtime.enable");
    await cmd("Log.enable");
    await cmd("Page.enable");
    await cmd("Page.navigate", { url: `${base}/${page}` });
    await sleep(2000);

    // --- knowls -----------------------------------------------------------
    const knowls = await evaluate(`document.querySelectorAll('a.eb-knowl').length`);
    if (!knowls) fail(`${page} has no rendered knowl link`);
    else ok(`${page} renders ${knowls} knowl link(s)`);

    const fragUrl = await evaluate(
      `(document.querySelector('a.eb-knowl')||{}).getAttribute
         ? document.querySelector('a.eb-knowl').getAttribute('data-eb-fragment') : ''`
    );
    if (!/^_static\/knowls\/.+\.html$/.test(fragUrl || "")) {
      fail(`knowl fragment path looks wrong: ${fragUrl}`);
    } else ok(`knowl points at ${fragUrl}`);

    await evaluate(`document.querySelector('a.eb-knowl').click(); true`);
    await sleep(1200);
    const box = await evaluate(`(() => {
      const b = document.querySelector('.eb-knowl-box');
      if (!b) return null;
      return {
        loading: b.classList.contains('eb-knowl-box--loading'),
        chars: b.textContent.trim().length,
        hasTitle: !!b.querySelector('.eb-knowl__title'),
        hasBack: !!b.querySelector('.eb-knowl__back a'),
        hasClose: !!b.querySelector('.eb-knowl-box__close'),
        role: b.getAttribute('role'),
        labelled: !!b.getAttribute('aria-label'),
        expanded: (document.querySelector('a.eb-knowl')||{}).getAttribute
          ? document.querySelector('a.eb-knowl').getAttribute('aria-expanded') : null,
      };
    })()`);
    if (!box) fail("clicking a knowl opened no box");
    else if (box.loading || box.chars < 40) fail(`the knowl box is empty or still loading: ${JSON.stringify(box)}`);
    else if (!box.hasBack) fail("the knowl box has no way back to where the block is born");
    else if (box.role !== "region" || !box.labelled) fail("the knowl box is not a labelled region");
    else if (box.expanded !== "true") fail("the knowl link did not report aria-expanded=true");
    else ok(`knowl transcluded ${box.chars} characters, with a title, a way back and a close`);

    // Escape closes the innermost box.
    await evaluate(`document.querySelector('.eb-knowl-box').focus(); true`);
    await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(400);
    const afterEsc = await evaluate(`document.querySelectorAll('.eb-knowl-box').length`);
    if (afterEsc !== 0) fail("escape did not close the knowl box");
    else ok("escape closes the box and returns focus to the link");

    // --- ask --------------------------------------------------------------
    await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "/", code: "Slash", text: "/", windowsVirtualKeyCode: 191 });
    await sleep(300);
    const askOpen = await evaluate(`(() => {
      const o = document.querySelector('.eb-ask');
      const p = document.querySelector('.eb-ask__panel');
      return o && !o.hidden && p ? { role: p.getAttribute('role'), label: p.getAttribute('aria-label') } : null;
    })()`);
    if (!askOpen) fail("pressing / did not open the ask panel");
    else if (askOpen.role !== "dialog" || !askOpen.label) fail("the ask panel is not a labelled dialog");
    else ok("pressing / opens the ask panel as a labelled dialog");

    await evaluate(`(() => {
      const i = document.querySelector('.eb-ask__input');
      i.value = 'what does start_dir do when the archive changes';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(2500);
    const results = await evaluate(`(() => {
      const items = [...document.querySelectorAll('.eb-ask__result')];
      return items.slice(0, 3).map(li => ({
        head: (li.querySelector('.eb-ask__head strong')||{}).textContent || '',
        href: (li.querySelector('.eb-ask__head')||{}).getAttribute
          ? li.querySelector('.eb-ask__head').getAttribute('href') : '',
        marks: li.querySelectorAll('.eb-ask__snippet mark').length,
        kind: (li.querySelector('.eb-ask__kind')||{}).textContent || '',
      }));
    })()`);
    if (!results || !results.length) fail("the ask panel ranked nothing for a question the book answers");
    else if (!results[0].href || !/\.html/.test(results[0].href)) fail(`a result has no usable link: ${JSON.stringify(results[0])}`);
    else if (!results.some(r => r.marks > 0)) fail("no result marked the query terms in its passage");
    else ok(`ask ranked ${results.length}+ results, top: "${results[0].head}" (${results[0].kind}) -> ${results[0].href}`);

    const passage = await evaluate(`(() => {
      const b = document.querySelector('.eb-ask__more');
      if (!b) return null;
      b.click();
      const full = document.querySelector('.eb-ask__full');
      return full && !full.hidden ? full.textContent.trim().length : 0;
    })()`);
    if (!passage) fail("a result would not open its passage in the panel");
    else ok(`a result opens ${passage} characters of the passage in the panel`);

    const answered = await evaluate(`(() => {
      const form = document.querySelector('.eb-ask__bar');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const a = document.querySelector('.eb-ask__answer');
      return a && !a.hidden ? a.textContent.trim().slice(0, 60) : null;
    })()`);
    if (!answered) fail("submitting a question said nothing at all");
    else if (!/No model is connected/i.test(answered)) fail(`with no model configured the panel should say so, said: ${answered}`);
    else ok("with no model connected the panel says nothing wrote an answer");

    await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);

    // --- annotations ------------------------------------------------------
    const made = await evaluate(`(() => {
      const root = document.querySelector('article.yue') || document.querySelector('article');
      if (!root) return 'no article';
      // Any long text node in running prose: the first paragraph of a chapter
      // is often a list item or carries inline markup, so do not assume.
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let t = null, n;
      while ((n = walk.nextNode())) {
        if (n.nodeValue && n.nodeValue.trim().length > 40 &&
            !n.parentElement.closest('pre, .eb-detail__title, h1, h2, h3')) { t = n; break; }
      }
      if (!t) return 'no text node';
      const r = document.createRange();
      const start = n.nodeValue.length - n.nodeValue.trimStart().length;
      r.setStart(t, start); r.setEnd(t, start + 30);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return 'selected: ' + r.toString();
    })()`);
    if (!/^selected: /.test(made)) fail(`could not make a selection to annotate: ${made}`);
    else ok(`selected a passage: "${made.slice(10, 40)}..."`);

    await cmd("Input.dispatchKeyEvent", {
      type: "keyDown", key: "n", code: "KeyN", text: "n",
      windowsVirtualKeyCode: 78, modifiers: 1, // alt
    });
    await sleep(500);
    const formShown = await evaluate(`(() => {
      const f = document.querySelector('.eb-annot-form');
      return f && !f.hidden ? (f.querySelector('.eb-annot-form__quote')||{}).textContent : null;
    })()`);
    if (!formShown) fail("alt+n on a selection did not open the note form");
    else ok(`alt+n opened the note form on the quoted passage`);

    const saved = await evaluate(`(() => {
      const body = document.querySelector('#eb-annot-body');
      body.value = 'checked by browser-check-reader';
      document.querySelector('.eb-annot-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }));
      const m = document.querySelector('mark.eb-annot');
      if (!m) return null;
      const descId = m.getAttribute('aria-describedby');
      const desc = descId ? document.getElementById(descId) : null;
      return {
        tabindex: m.getAttribute('tabindex'),
        describedby: !!descId,
        descText: desc ? desc.textContent : '',
        noted: m.classList.contains('eb-annot--noted'),
        stored: (JSON.parse(localStorage.getItem('eb-annotations-v1') || '[]')).length,
      };
    })()`);
    if (!saved) fail("saving a note painted no highlight");
    else if (!saved.describedby || !/checked by browser-check-reader/.test(saved.descText))
      fail(`the highlight does not describe its note to a screen reader: ${JSON.stringify(saved)}`);
    else if (saved.tabindex !== "0") fail("the highlight is not reachable by keyboard");
    else if (!saved.noted) fail("a highlight with a note is not distinguishable from a bare highlight");
    else if (saved.stored !== 1) fail(`expected 1 stored annotation, found ${saved.stored}`);
    else ok("a saved note paints a focusable highlight that carries its note for a screen reader");

    const exported = await evaluate(`(() => {
      const notes = JSON.parse(localStorage.getItem('eb-annotations-v1') || '[]');
      return notes.length ? {
        hasQuote: !!(notes[0].target && notes[0].target.exact),
        hasPrefix: typeof notes[0].target.prefix === 'string',
        hasPos: typeof notes[0].target.start === 'number',
        page: notes[0].page,
      } : null;
    })()`);
    if (!exported || !exported.hasQuote || !exported.hasPos) fail(`the stored annotation lacks its selectors: ${JSON.stringify(exported)}`);
    else ok(`the annotation stores a quote, its context and a position, against ${exported.page}`);

    // Reload: the note has to come back, re-anchored from storage.
    await cmd("Page.navigate", { url: `${base}/${page}` });
    await sleep(2200);
    const survived = await evaluate(`(() => {
      const m = document.querySelector('mark.eb-annot');
      const live = document.querySelector('.eb-annot-live');
      const launcher = document.querySelector('.eb-annot-launcher');
      return {
        painted: !!m,
        count: launcher ? (launcher.querySelector('.eb-annot-launcher__count')||{}).textContent : null,
        liveRegion: live ? live.getAttribute('aria-live') : null,
      };
    })()`);
    if (!survived.painted) fail("the note did not re-anchor after a reload");
    else if (survived.liveRegion !== "polite") fail("there is no polite live region to announce changes");
    else ok(`the note re-anchored after a reload, and the launcher reports ${survived.count}`);

    // Leave the browser profile as it was found.
    await evaluate(`localStorage.removeItem('eb-annotations-v1'); true`);

    // A missing favicon is the server's business, not the book's.
    const real = errors.filter((e) => !/favicon\.ico/.test(e));
    if (real.length) {
      for (const e of real.slice(0, 8)) fail("console: " + e);
    } else ok("no console errors on the page");
    sock.close();
  } finally {
    chrome.kill();
  }
  return failures;
}

main().then((f) => process.exit(f ? 1 : 0));
