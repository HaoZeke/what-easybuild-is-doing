// Drive the built book in a real browser and assert what a reader sees.
//
// Every other check in this repo runs the engine under node with a stubbed
// document, which is how three islands shipped dead: the engine was fine and
// the page was not. This one loads the built html over http, waits for
// hydration, scrolls so every island enters the viewport, types into an
// editor, and reads the answers back out of the DOM.
//
//   node scripts/browser-check.js [base-url]
//
// Needs a chromium on PATH or at ~/.local/bin/chromium, and the book served
// (scripts/serve.sh). Skips rather than fails when either is absent, because
// a missing browser is not a defect in the book.
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const base = (process.argv[2] || "http://localhost:8173/html").replace(/\/$/, "");
const port = 9334;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// Which chapters carry which widgets, read from the source rather than listed
// here, so a new widget in a new chapter is checked without editing this file.
function expectedWidgets() {
  const dir = path.resolve(__dirname, "..", "orgmode");
  const out = {};
  for (const file of fs.readdirSync(dir).filter((f) => /^\d+.*\.org$/.test(f))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const kinds = [...text.matchAll(/^#\+begin_src easyconfig :widget (\w+)/gm)].map(
      (m) => m[1]
    );
    if (kinds.length) {
      out[file.replace(/\.org$/, "") + ".html"] = kinds;
    }
  }
  return out;
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

  const chrome = spawn(
    chromium,
    ["--headless", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`, "about:blank"],
    { stdio: "ignore" }
  );

  let failures = 0;
  const fail = (msg) => {
    console.log("FAIL " + msg);
    failures += 1;
  };

  try {
    for (let i = 0; i < 80; i++) {
      try {
        await get("/json/version");
        break;
      } catch {
        await sleep(250);
      }
    }

    const pages = expectedWidgets();
    for (const [page, kinds] of Object.entries(pages)) {
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

      await cmd("Runtime.enable");
      await cmd("Log.enable");
      await cmd("Page.enable");
      await cmd("Page.navigate", { url: `${base}/${page}` });
      await sleep(2500);
      // Islands hydrate on visibility, so bring them all into view.
      await cmd("Runtime.evaluate", {
        expression: "window.scrollTo(0, document.body.scrollHeight)",
      });
      await sleep(2000);

      const state = (
        await cmd("Runtime.evaluate", {
          returnByValue: true,
          expression: `[...document.querySelectorAll('.eb-widget')].map(el => ({
            kind: el.getAttribute('data-eb-widget'),
            state: el.getAttribute('data-eb-state'),
            editor: !!el.querySelector('.eb-widget-editor'),
            editors: el.querySelectorAll('.eb-widget-editor').length,
            outputs: el.querySelectorAll('.eb-widget-output').length,
            out: ((el.querySelector('.eb-widget-output')||{}).textContent||''),
            note: ((el.querySelector('.eb-widget-note')||{}).textContent||''),
          }))`,
        })
      ).result.value;

      const seen = state.map((s) => s.kind);
      if (seen.join(",") !== kinds.join(",")) {
        fail(`${page}: expected widgets [${kinds}] but the page has [${seen}]`);
      }

      for (const island of state) {
        const where = `${page} ${island.kind}`;
        if (island.state !== "live") {
          fail(`${where}: state is ${island.state || "unhydrated"} (${island.note})`);
          continue;
        }
        if (!island.editor) {
          fail(`${where}: live with no editor`);
        }
        if (island.editors !== 1 || island.outputs !== 1) {
          fail(`${where}: ${island.editors} editors and ${island.outputs} outputs`);
        }
        if (!island.out.trim()) {
          fail(`${where}: answered with nothing before being asked`);
        }
        // The one thing a reader must never see in a live island.
        if (/does not implement|not loaded/.test(island.out + island.note)) {
          fail(`${where}: reports itself unavailable while live`);
        }
      }

      // Typing has to change the answer, since the prose promises it does.
      if (kinds.includes("template")) {
        const moved = (
          await cmd("Runtime.evaluate", {
            returnByValue: true,
            awaitPromise: true,
            expression: `(async () => {
              const island = [...document.querySelectorAll('.eb-widget')]
                .find(el => el.getAttribute('data-eb-widget') === 'template');
              const ed = island.querySelector('.eb-widget-editor');
              const out = island.querySelector('.eb-widget-output');
              const before = out.textContent;
              ed.value = ed.value.replace(/4\\.130\\.0/g, '7.7.7');
              ed.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 600));
              return { changed: out.textContent !== before, has777: /7\\.7\\.7/.test(out.textContent) };
            })()`,
          })
        ).result.value;
        if (!moved.changed) {
          fail(`${page} template: typing did not change the answer`);
        }
        if (!moved.has777) {
          fail(`${page} template: the edited version does not appear in the answer`);
        }
      }

      const realErrors = errors.filter((e) => !/favicon\.ico/.test(e));
      for (const e of realErrors) {
        fail(`${page}: console error: ${e}`);
      }

      sock.close();
    }

    const total = Object.values(pages).flat().length;
    console.log(
      failures === 0
        ? `browser: ${total} islands across ${Object.keys(pages).length} pages are live and answering`
        : `${failures} browser check(s) failed`
    );
  } finally {
    chrome.kill();
  }
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => {
  console.error(err);
  process.exit(1);
});
