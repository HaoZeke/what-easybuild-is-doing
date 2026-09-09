// Exercise the widget entry points, not just the rules underneath them.
//
// scripts/crosscheck.js compares rule application against the binary. That
// leaves the functions the page actually calls untested, so this loads the
// engine with a stubbed document and fetch, then feeds it the samples the
// chapters really contain.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const stat = path.join(root, "source", "_static");

// The engine derives its asset URLs from its own script src, and reads them
// with fetch. Both are stubbed to the files on disk.
global.document = { currentScript: { src: "file:///_static/eb-widget-engine.js" } };
global.fetch = (url) => {
  const name = String(url).split("/").pop();
  const body = fs.readFileSync(path.join(stat, name), "utf8");
  return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(body)) });
};
global.window = {
  dispatchEvent() {},
};
global.Event = function Event(type) {
  this.type = type;
};

require(path.join(stat, "eb-widget-engine.js"));

// Pull the widget bodies straight out of the chapters, so this tests what a
// reader is actually given rather than a sample invented here.
function samplesFor(kind) {
  const out = [];
  const dir = path.join(root, "orgmode");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".org"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const re = new RegExp(
      "^#\\+begin_src easyconfig :widget " + kind + "[^\\n]*\\n([\\s\\S]*?)^#\\+end_src",
      "gm"
    );
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ file, body: m[1] });
    }
  }
  return out;
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    console.log("FAIL " + label + (detail ? ": " + detail : ""));
    failures += 1;
  }
}

setTimeout(() => {
  const engine = global.window.EB_STACK_ENGINE;
  check("engine loaded", !!engine);
  if (!engine) {
    process.exit(1);
  }
  for (const kind of ["easyblock", "template", "hierarchy"]) {
    check(kind + " implemented", typeof engine[kind] === "function");
  }

  // easyblock: the chapter's own sample must produce the class the chapter
  // names in its prose.
  const eb = engine.easyblock("code-server\nc++\nC#");
  check("easyblock code-server", eb.includes("EB_code_minus_server"), eb);
  check("easyblock c++", eb.includes("EB_c_plus__plus_"), eb);

  // template: every template sample in the book must resolve, and must not
  // leave a raw placeholder in the values it reports.
  const tmpl = samplesFor("template");
  check("a template sample exists", tmpl.length > 0);
  for (const s of tmpl) {
    const out = engine.template(s.body);
    check("template " + s.file + " resolved version", out.includes("%(version)s  ->"), out);
    check(
      "template " + s.file + " expanded the sources line",
      /sources:.*code-server-4\.130\.0-linux/.test(out),
      out
    );
  }

  // A reader editing the version is the whole point, so check the edit moves.
  const edited = engine.template(
    "name = 'code-server'\nversion = '9.9.9'\n" +
      "sources = ['code-server-%(version)s-linux-%(mapped_arch)s.tar.gz']\n"
  );
  check("template follows an edited version", edited.includes("code-server-9.9.9-linux"), edited);
  check(
    "template leaves an unknown placeholder visible",
    edited.includes("%(mapped_arch)s"),
    edited
  );

  // hierarchy: the book's sample, and the sibling caveat that the exported
  // order made necessary.
  const hier = samplesFor("hierarchy");
  check("a hierarchy sample exists", hier.length > 0);
  for (const s of hier) {
    const out = engine.hierarchy(s.body);
    // A sample whose toolchain carries a folded versionsuffix has no fixture,
    // and declining it is the correct answer. What the decline must do is
    // explain why, since that is chapter 5's point.
    if (/is not one of the exported generations/.test(out)) {
      check(
        "hierarchy " + s.file + " explains the folded key",
        out.includes("whole version string"),
        out
      );
    } else {
      check("hierarchy " + s.file + " names GCCcore", out.includes("GCCcore"), out);
    }
  }
  const bare = engine.hierarchy("foss-2025a");
  check("hierarchy accepts a bare name", bare.includes("GCCcore-"), bare);
  check(
    "hierarchy states the sibling caveat",
    bare.includes("gompi and gfbf"),
    bare
  );
  const unknown = engine.hierarchy("foss-1999z");
  check(
    "hierarchy declines an unknown generation",
    unknown.includes("not one of the exported generations"),
    unknown
  );

  console.log(
    failures === 0
      ? "widget entry points: all checks pass"
      : failures + " widget check(s) failed"
  );
  process.exit(failures === 0 ? 0 : 1);
}, 50);
