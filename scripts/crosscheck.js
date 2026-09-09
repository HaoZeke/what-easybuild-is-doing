// Cross-check the browser engine against eb-stack's own answers.
//
// Two implementations of one rule is the risk the generated tables were meant
// to reduce; they reduce drift in the *data*, not in the lines that apply it.
// So apply both to many inputs and compare against the binary.
//
// Run with EB_STACK pointing at the binary if it is not on PATH.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const stat = path.join(root, "source", "_static");
const bin = process.env.EB_STACK || "eb-stack";

function ebstack(args) {
  return execFileSync(bin, args, { encoding: "utf8" });
}

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(stat, name), "utf8"));
}

let failures = 0;
let checks = 0;

function fail(msg) {
  console.log("MISMATCH " + msg);
  failures += 1;
}

// --- easyblock --------------------------------------------------------------
{
  const table = load("eb-charmap.json");
  const map = Object.create(null);
  for (const entry of table.charmap) {
    map[entry.from] = entry.to;
  }
  const encodeString = (name) => {
    let out = "";
    for (let i = 0; i < name.length; i++) {
      const c = name.charAt(i);
      out += Object.prototype.hasOwnProperty.call(map, c) ? map[c] : c;
    }
    return out;
  };

  const names = [
    "code-server", "c++", "C#", "Xerces-C++", "GROMACS", "Qt6",
    "Python-bundle-PyPI", "zlib-ng", "R",
  ];
  // Every mapped character, alone and doubled and embedded, since the doubling
  // is where a collapsing bug would hide.
  for (const entry of table.charmap) {
    names.push(entry.from, entry.from + entry.from, "a" + entry.from + "b");
  }

  for (const name of names) {
    const rust = ebstack(["recipe", "easyblock", "--", name]).trim();
    const js = table.prefix + encodeString(name);
    checks += 1;
    if (rust !== js) {
      fail(`easyblock ${JSON.stringify(name)} rust=${rust} js=${js}`);
    }
  }
}

// --- template ---------------------------------------------------------------
{
  const spec = load("eb-templates.json");

  // The same rule application the engine does. Kept in step by this check
  // rather than by hope: the engine is the only other copy.
  function applyRule(rule, fields) {
    const name = fields.name || "";
    const version = fields.version || "";
    const parts = version.split(".");
    let value = null;
    let gate = null;
    for (const clause of rule.split(";")) {
      const colon = clause.indexOf(":");
      const head = colon < 0 ? clause : clause.slice(0, colon);
      const arg = colon < 0 ? null : clause.slice(colon + 1);
      if (head === "only_if_name") gate = arg;
      else if (head === "field") {
        value = Object.prototype.hasOwnProperty.call(fields, arg)
          ? fields[arg]
          : arg === "versionsuffix" || arg === "toolchain_version" ? "" : null;
      } else if (head === "lower") value = name.toLowerCase();
      else if (head === "first_char") value = name.length ? name.charAt(0) : null;
      else if (head === "first_char_lower")
        value = name.length ? name.charAt(0).toLowerCase() : null;
      else if (head === "part") {
        const i = parseInt(arg, 10) || 0;
        value = parts.length > i && parts[i] !== "" ? parts[i] : null;
      } else if (head === "join") {
        const [a, b] = (arg || "0-0").split("-").map((n) => parseInt(n, 10) || 0);
        value = parts.length > b ? parts.slice(a, b + 1).join(".") : null;
      } else if (head === "host_arch") value = "x86_64";
    }
    if (gate !== null && name !== gate) return null;
    return value;
  }

  const cases = [
    ["code-server", "4.130.0"],
    ["Python", "3.13.1"],
    ["Python", "3.9"],
    ["R", "4.4.2"],
    ["GROMACS", "2025.2"],
    ["QMCPACK", "4.4.0"],
    ["NVHPC", "25.11"],
    ["Xerces-C++", "3.2.5"],
    ["foss", "2025a"],
    ["zlib-ng", "2.2.1"],
    ["zlib", "1"],
    ["HDF5", "1.14.6.1"],
  ];

  for (const [name, version] of cases) {
    const rust = JSON.parse(
      ebstack(["recipe", "templates", "--name", name, "--version", version])
    );
    const fields = {
      name,
      version,
      versionsuffix: "",
      toolchain_name: "system",
      toolchain_version: "",
    };
    const js = {};
    for (const entry of spec.derived) {
      const got = applyRule(entry.rule, fields);
      if (got !== null) js[entry.key] = got;
    }
    const keys = new Set([...Object.keys(rust), ...Object.keys(js)]);
    for (const key of [...keys].sort()) {
      checks += 1;
      if (rust[key] !== js[key]) {
        fail(
          `template ${name}-${version} %(${key})s ` +
            `rust=${JSON.stringify(rust[key])} js=${JSON.stringify(js[key])}`
        );
      }
    }
  }
}

// --- hierarchy --------------------------------------------------------------
{
  const table = load("eb-hierarchy.json");
  const rust = JSON.parse(ebstack(["recipe", "hierarchy", "--export"]));
  checks += 1;
  if (JSON.stringify(rust) !== JSON.stringify(table)) {
    fail("hierarchy export differs from the asset on disk");
  }
  // The order is the content, so assert it rather than trusting the shape.
  for (const gen of table.generations) {
    checks += 1;
    const members = gen.members.map((m) => m.name);
    if (members[0] !== "system" || members[members.length - 1] !== gen.parent.name) {
      fail(`hierarchy ${gen.parent.name}-${gen.parent.version} order: ${members}`);
    }
  }
}

console.log(
  failures === 0
    ? `all ${checks} comparisons agree between Rust and JavaScript`
    : `${failures} mismatches out of ${checks} comparisons`
);
process.exit(failures === 0 ? 0 : 1);
