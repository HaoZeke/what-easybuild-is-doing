// The tutorial tells a reader what they will see. Check that they will.
//
// It is the one document in the book that makes a promise per step, in the
// form "*You should see* X". A promise about a live sample is testable, and
// an untested one is worse than no tutorial: a reader who does not see X
// concludes the page is broken and stops.
//
// Each case below is one step, with the edit that step asks for.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const stat = path.join(root, "source", "_static");
global.document = { currentScript: { src: "file:///_static/eb-widget-engine.js" } };
global.fetch = (u) =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve(
        JSON.parse(fs.readFileSync(path.join(stat, String(u).split("/").pop()), "utf8"))
      ),
  });
global.window = { dispatchEvent() {} };
global.Event = function (t) {
  this.type = t;
};
require(path.join(stat, "eb-widget-engine.js"));

const tutorial = fs.readFileSync(
  path.join(root, "orgmode", "00-tutorial-read-an-easyconfig.org"),
  "utf8"
);

function sample(kind) {
  const re = new RegExp(
    "^#\\+begin_src easyconfig :widget " + kind + "[^\\n]*\\n([\\s\\S]*?)^#\\+end_src",
    "m"
  );
  const m = tutorial.match(re);
  if (!m) {
    throw new Error("the tutorial has no " + kind + " sample");
  }
  return m[1].replace(/\n+$/, "");
}

let failures = 0;
function promise(step, text, expected) {
  const ok = expected instanceof RegExp ? expected.test(text) : text.includes(expected);
  if (!ok) {
    console.log(
      "FAIL " + step + ": expected " + expected + "\n      got: " +
        JSON.stringify(text.slice(0, 220))
    );
    failures += 1;
  }
}

setTimeout(() => {
  const e = window.EB_STACK_ENGINE;
  const base = sample("parse");

  // Step 1: three things in the model that are not in the file.
  const step1 = e.parse(base);
  promise("step 1 toolchain is a structure", step1, "{name: system, version: (none)}");
  promise("step 1 template resolved", step1, "/v4.130.0/");
  promise("step 1 easyblock derived", step1, "EB_code_minus_server");

  // Step 2: the version moves, and so does the derived name.
  const bumped = e.parse(base.replace(/4\.130\.0/g, "4.131.0"));
  promise("step 2 url follows the version", bumped, "/v4.131.0/");
  promise("step 2 filename follows the version", bumped, "code-server-4.131.0-linux");
  const renamed = e.parse(base.replace(/'code-server'/, "'codeserver'"));
  promise("step 2 easyblock follows the name", renamed, "EB_codeserver");

  // Step 3: the refusal, the silence, and the named omission.
  const noVersion = e.parse(base.split("\n").filter((l) => !/^version /.test(l)).join("\n"));
  promise("step 3 refuses without a version", noVersion, /Set at least .name. and .version./);
  const noSources = e.parse(base.split("\n").filter((l) => !/^sources /.test(l)).join("\n"));
  promise("step 3 model without sources", noSources, "name          code-server");
  if (/^\s*sources\b/m.test(noSources)) {
    console.log("FAIL step 3: sources still reported after being deleted");
    failures += 1;
  }
  const openList = e.parse(base + "\nchecksums = [");
  promise("step 3 names what it skipped", openList, "not modelled by this reader: checksums");

  // Step 4: the encoding, including the doubled separator and the underscore.
  const names = e.easyblock(sample("easyblock"));
  promise("step 4 hyphen becomes minus", names, "code-server  ->  EB_code_minus_server");
  promise("step 4 doubled separator", names, "EB_c_plus__plus_");
  promise("step 4 underscore is encoded", e.easyblock("my_tool"), "EB_my_underscore_tool");

  // Step 5: the chain, the sibling note, and the refusal.
  const hier = e.hierarchy(sample("hierarchy"));
  promise("step 5 chain starts at system", hier, /^system\n/);
  promise("step 5 chain ends at foss", hier, "foss-2025a");
  promise("step 5 sibling caveat", hier, "gompi and gfbf");
  const older = e.hierarchy(sample("hierarchy").replace("2025a", "2024a"));
  promise("step 5 another generation answers", older, "foss-2024a");
  const bogus = e.hierarchy(sample("hierarchy").replace("2025a", "1999z"));
  promise("step 5 unknown generation refused", bogus, "not one of the exported generations");

  console.log(
    failures === 0
      ? "tutorial: every promised output checks out"
      : failures + " tutorial promise(s) not met"
  );
  process.exit(failures === 0 ? 0 : 1);
}, 60);
