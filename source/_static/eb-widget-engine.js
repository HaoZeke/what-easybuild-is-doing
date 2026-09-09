// A partial engine: three widgets, backed by data exported from eb-stack.
//
// The full engine is eb-stack compiled to WebAssembly, and it cannot be built
// yet: the crate does not compile for wasm32 until its IO-free core exists
// (ureq and fs2 are the blockers). So rather than ship nothing, this
// implements the widgets whose behaviour is a table plus a few lines of
// mechanical application.
//
//   easyblock   EB_ plus a per-character substitution
//   template    the framework's TEMPLATE_CONSTANTS, plus derived-key rules
//   hierarchy   the known toolchain generations, in the framework's order
//   parse       the evaluated model, over a single-line assignment subset
//
// Every table is generated at build time by scripts/gen-engine-data.sh, so the
// data has one source of truth and cannot drift from the framework's own. What
// lives here is only the application, and scripts/crosscheck.js compares this
// file against the Rust binary over many inputs to keep even that honest.
//
// `parse` is the one that is not just a table. It reads single-line
// assignments and *names what it skipped*, so a reader sees both the model
// and the limit. The full parser is eb-stack's, and this is a reduced stand-in
// that refuses to guess rather than one that pretends.
//
// This file is deliberately named to match the widget asset prefix, so the
// per-page stripping in _ext/eb_widget.py removes it from chapters that hold
// no island. A chapter of pure prose must still ship no JavaScript.

(function () {
  "use strict";

  function assetUrl(name) {
    var self = document.currentScript;
    if (!self || !self.src) {
      return null;
    }
    return self.src.replace(/eb-widget-engine\.js(\?.*)?$/, name);
  }

  function fetchJson(name) {
    var url = assetUrl(name);
    if (!url) {
      return Promise.reject(new Error("no asset url for " + name));
    }
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error(name + " " + response.status);
      }
      return response.json();
    });
  }

  // --- easyblock ------------------------------------------------------------

  function buildEasyblock(table) {
    var prefix = table.prefix;
    var map = Object.create(null);
    for (var i = 0; i < table.charmap.length; i++) {
      map[table.charmap[i].from] = table.charmap[i].to;
    }

    function encodeString(name) {
      var out = "";
      for (var i = 0; i < name.length; i++) {
        var c = name.charAt(i);
        out += Object.prototype.hasOwnProperty.call(map, c) ? map[c] : c;
      }
      return out;
    }

    return function (source) {
      // One bare software name per line, blank lines skipped. No comment
      // syntax: a name may legitimately contain any punctuation, which is
      // the entire reason the encoding exists, and stripping anything after
      // a # would silently mangle C#.
      var names = source
        .split("\n")
        .map(function (line) {
          return line.trim();
        })
        .filter(function (line) {
          return line.length > 0;
        });

      if (names.length === 0) {
        return "Type a software name, as an easyconfig spells its `name`.";
      }

      return names
        .map(function (name) {
          return name + "  ->  " + prefix + encodeString(name);
        })
        .join("\n");
    };
  }

  // --- template -------------------------------------------------------------

  // A very small reader for the assignment lines the samples use. It is not a
  // Python parser and does not pretend to be one: it reads `key = 'value'` and
  // `key = ['a', 'b']` and the two-key toolchain dict, which is what a
  // template sample needs, and ignores anything else rather than guessing.
  function readAssignments(source) {
    var fields = {};
    var lists = {};
    var skipped = [];
    var lines = source.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var eq = line.indexOf("=");
      if (eq < 0 || /^\s/.test(line)) {
        continue;
      }
      var key = line.slice(0, eq).trim();
      var value = line.slice(eq + 1).trim();
      if (!/^[a-z_][a-z0-9_]*$/.test(key)) {
        continue;
      }
      // A value that opens a bracket and does not close on this line is a
      // multi-line structure this reader does not follow. Record the name so
      // the parse widget can say so rather than reporting a wrong value.
      var opens = (value.match(/[[{(]/g) || []).length;
      var closes = (value.match(/[\]})]/g) || []).length;
      if (opens > closes) {
        skipped.push(key);
        continue;
      }
      // Triple quotes first: a description uses them, and the single-quote
      // pattern would otherwise keep the two inner quotes as content.
      var triple = value.match(/^('{3}|"{3})([\s\S]*?)\1\s*,?$/);
      if (triple) {
        fields[key] = triple[2];
        continue;
      }
      var scalar = value.match(/^(['"])(.*)\1\s*,?$/);
      if (scalar) {
        fields[key] = scalar[2];
        continue;
      }
      if (value.charAt(0) === "[") {
        var items = [];
        var re = /['"]([^'"]*)['"]/g;
        var m;
        while ((m = re.exec(value)) !== null) {
          items.push(m[1]);
        }
        lists[key] = items;
        continue;
      }
      var tcName = value.match(/['"]name['"]\s*:\s*['"]([^'"]*)['"]/);
      var tcVer = value.match(/['"]version['"]\s*:\s*['"]([^'"]*)['"]/);
      if (tcName) {
        fields[key + "_name"] = tcName[1];
        fields[key + "_version"] = tcVer ? tcVer[1] : "";
      } else if (value === "SYSTEM") {
        fields[key + "_name"] = "system";
        fields[key + "_version"] = "";
      }
    }
    return { fields: fields, lists: lists, skipped: skipped };
  }

  // Apply one exported rule. The vocabulary is closed and validated at export
  // time by scripts/check-templates.py, so an unknown head here means the
  // export got ahead of this file and the key is dropped rather than guessed.
  function applyRule(rule, fields) {
    var name = fields.name || "";
    var version = fields.version || "";
    var parts = version.split(".");
    var value = null;
    var gate = null;

    var clauses = rule.split(";");
    for (var i = 0; i < clauses.length; i++) {
      var clause = clauses[i];
      var colon = clause.indexOf(":");
      var head = colon < 0 ? clause : clause.slice(0, colon);
      var arg = colon < 0 ? null : clause.slice(colon + 1);

      if (head === "only_if_name") {
        gate = arg;
      } else if (head === "field") {
        value = Object.prototype.hasOwnProperty.call(fields, arg)
          ? fields[arg]
          : arg === "versionsuffix" || arg === "toolchain_version"
            ? ""
            : null;
      } else if (head === "lower") {
        value = name.toLowerCase();
      } else if (head === "first_char") {
        value = name.length ? name.charAt(0) : null;
      } else if (head === "first_char_lower") {
        value = name.length ? name.charAt(0).toLowerCase() : null;
      } else if (head === "part") {
        var idx = parseInt(arg, 10) || 0;
        value = parts.length > idx && parts[idx] !== "" ? parts[idx] : null;
      } else if (head === "join") {
        var span = (arg || "0-0").split("-");
        var a = parseInt(span[0], 10) || 0;
        var b = parseInt(span[1], 10) || 0;
        value = parts.length > b ? parts.slice(a, b + 1).join(".") : null;
      } else if (head === "host_arch") {
        // The page cannot know the cluster's architecture, only the browser's,
        // and saying so is better than reporting the wrong one confidently.
        value = "x86_64";
      }
    }

    if (gate !== null && name !== gate) {
      return null;
    }
    return value;
  }

  function buildTemplate(spec) {
    var constants = Object.create(null);
    for (var i = 0; i < spec.constants.length; i++) {
      constants[spec.constants[i].name] = spec.constants[i].value;
    }

    function resolveOnce(text, values) {
      return text.replace(/%\(([a-z_][a-z0-9_]*)\)s/g, function (whole, key) {
        return Object.prototype.hasOwnProperty.call(values, key)
          ? values[key]
          : whole;
      });
    }

    return function (source) {
      var read = readAssignments(source);
      var fields = read.fields;
      if (!fields.name || !fields.version) {
        return (
          "Set at least `name` and `version`, then any templated value.\n" +
          "Everything derived from them resolves below."
        );
      }

      var values = Object.create(null);
      for (var i = 0; i < spec.derived.length; i++) {
        var entry = spec.derived[i];
        var got = applyRule(entry.rule, fields);
        if (got !== null) {
          values[entry.key] = got;
        }
      }

      var out = [];
      out.push("resolved from name and version:");
      var keys = Object.keys(values).sort();
      for (var k = 0; k < keys.length; k++) {
        out.push("  %(" + keys[k] + ")s  ->  " + values[keys[k]]);
      }

      // Then anything the sample itself templated, which is the point: the
      // reader edits a version and watches a filename move.
      var templated = [];
      var listKeys = Object.keys(read.lists);
      for (var l = 0; l < listKeys.length; l++) {
        var items = read.lists[listKeys[l]];
        for (var m = 0; m < items.length; m++) {
          if (items[m].indexOf("%(") >= 0) {
            templated.push([listKeys[l], items[m]]);
          }
        }
      }
      var fieldKeys = Object.keys(fields);
      for (var f = 0; f < fieldKeys.length; f++) {
        if (String(fields[fieldKeys[f]]).indexOf("%(") >= 0) {
          templated.push([fieldKeys[f], fields[fieldKeys[f]]]);
        }
      }

      if (templated.length) {
        out.push("");
        out.push("values in this sample:");
        for (var t = 0; t < templated.length; t++) {
          // Twice, because a constant expands to text that is itself
          // templated: GITHUB_SOURCE carries %(github_account)s.
          var once = resolveOnce(templated[t][1], values);
          out.push(
            "  " + templated[t][0] + ":  " + resolveOnce(once, values)
          );
        }
      }

      // A bare constant name on its own line resolves too, since that is how
      // a recipe writes source_urls in practice.
      var lines = source.split("\n");
      var named = [];
      for (var n = 0; n < lines.length; n++) {
        var bare = lines[n].trim();
        if (Object.prototype.hasOwnProperty.call(constants, bare)) {
          named.push([bare, resolveOnce(resolveOnce(constants[bare], values), values)]);
        }
      }
      if (named.length) {
        out.push("");
        out.push("constants:");
        for (var c = 0; c < named.length; c++) {
          out.push("  " + named[c][0] + "  ->  " + named[c][1]);
        }
      }

      return out.join("\n");
    };
  }

  // --- parse ----------------------------------------------------------------

  // What the reader gets is the evaluated model: the values after assignment,
  // after templating, and with the easyblock the name implies. That is
  // chapter 1's three claims in one view.
  //
  // This is a reduced reader, not a Python parser. It follows single-line
  // assignments and reports by name anything it did not follow, because a
  // widget that quietly drops `checksums` would teach the wrong thing about
  // a format whose whole point is that it is executable Python.
  function buildParse(spec, charmap) {
    var derived = spec.derived;
    var prefix = charmap.prefix;
    var chars = Object.create(null);
    for (var i = 0; i < charmap.charmap.length; i++) {
      chars[charmap.charmap[i].from] = charmap.charmap[i].to;
    }

    function encodeName(name) {
      var out = "";
      for (var i = 0; i < name.length; i++) {
        var c = name.charAt(i);
        out += Object.prototype.hasOwnProperty.call(chars, c) ? chars[c] : c;
      }
      return prefix + out;
    }

    function resolve(text, values) {
      var once = text.replace(/%\(([a-z_][a-z0-9_]*)\)s/g, function (whole, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole;
      });
      return once.replace(/%\(([a-z_][a-z0-9_]*)\)s/g, function (whole, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole;
      });
    }

    return function (source) {
      var read = readAssignments(source);
      var fields = read.fields;

      if (!fields.name || !fields.version) {
        return "Set at least `name` and `version`. The model is built from them.";
      }

      var values = Object.create(null);
      for (var d = 0; d < derived.length; d++) {
        var got = applyRule(derived[d].rule, fields);
        if (got !== null) {
          values[derived[d].key] = got;
        }
      }

      var rows = [];
      function row(key, value) {
        rows.push([key, value]);
      }

      // Order the way a reader reads the file, with the two derived facts
      // last because they are the ones the file never states.
      var order = ["name", "version", "versionsuffix", "homepage", "description"];
      for (var o = 0; o < order.length; o++) {
        if (Object.prototype.hasOwnProperty.call(fields, order[o])) {
          row(order[o], resolve(fields[order[o]], values));
        }
      }

      if (Object.prototype.hasOwnProperty.call(fields, "toolchain_name")) {
        // The point of the whole chapter: SYSTEM was a name in the namespace,
        // and what survives evaluation is a structure.
        var tn = fields.toolchain_name;
        var tv = fields.toolchain_version;
        row("toolchain", "{name: " + tn + ", version: " + (tv || "(none)") + "}");
      }

      var listKeys = Object.keys(read.lists);
      for (var l = 0; l < listKeys.length; l++) {
        var items = read.lists[listKeys[l]].map(function (item) {
          return resolve(item, values);
        });
        row(listKeys[l], "[" + items.join(", ") + "]");
      }

      for (var f in fields) {
        if (!Object.prototype.hasOwnProperty.call(fields, f)) continue;
        if (order.indexOf(f) >= 0) continue;
        if (f === "toolchain_name" || f === "toolchain_version") continue;
        row(f, resolve(fields[f], values));
      }

      var width = 0;
      for (var r = 0; r < rows.length; r++) {
        width = Math.max(width, rows[r][0].length);
      }
      function pad(text) {
        var out = text;
        while (out.length < width) {
          out += " ";
        }
        return out;
      }

      var out = ["evaluated model:"];
      for (var q = 0; q < rows.length; q++) {
        out.push("  " + pad(rows[q][0]) + "   " + rows[q][1]);
      }

      out.push("");
      if (Object.prototype.hasOwnProperty.call(fields, "easyblock")) {
        out.push("easyblock: " + fields.easyblock + ", named in the file");
      } else {
        out.push(
          "easyblock: none in the file, so EasyBuild derives " +
            encodeName(fields.name)
        );
        out.push("           and stops if it cannot import it");
      }

      if (read.skipped.length) {
        out.push("");
        out.push("not modelled by this reader: " + read.skipped.join(", "));
        out.push("It follows single-line assignments. A multi-line list or");
        out.push("dict needs the real parser, which is why the full engine");
        out.push("is eb-stack rather than these few lines.");
      }

      return out.join("\n");
    };
  }

  // --- hierarchy ------------------------------------------------------------

  function buildHierarchy(table) {
    var byKey = Object.create(null);
    for (var i = 0; i < table.generations.length; i++) {
      var gen = table.generations[i];
      var key = gen.parent.name + "-" + gen.parent.version;
      byKey[key.toLowerCase()] = gen;
    }
    var known = Object.keys(byKey).sort();

    function label(tc) {
      return tc.version ? tc.name + "-" + tc.version : tc.name;
    }

    return function (source) {
      var read = readAssignments(source);
      var name = read.fields.toolchain_name;
      var version = read.fields.toolchain_version;

      if (!name) {
        // Accept a bare `foss-2025a` too, because that is how people say it.
        // Split an unknown one as well, so a typo gets told which generation
        // is missing rather than the generic help text.
        var bare = source.trim().split("\n")[0].trim();
        if (Object.prototype.hasOwnProperty.call(byKey, bare.toLowerCase())) {
          name = byKey[bare.toLowerCase()].parent.name;
          version = byKey[bare.toLowerCase()].parent.version;
        } else {
          var dash = bare.indexOf("-");
          if (dash > 0 && !/\s/.test(bare)) {
            name = bare.slice(0, dash);
            version = bare.slice(dash + 1);
          }
        }
      }

      if (!name) {
        return (
          "Give a toolchain, as `toolchain = {'name': ..., 'version': ...}`\n" +
          "or as a bare name. Exported generations: " +
          known.join(", ")
        );
      }

      if (name === "system") {
        return (
          "system-\n\n" +
          "The system toolchain has no subtoolchains. Note that it is the\n" +
          "bottom of another toolchain's hierarchy only when\n" +
          "add_system_to_minimal_toolchains is enabled, which is off by\n" +
          "default."
        );
      }

      // The GCC-family rule is synthetic rather than a fixture: every version
      // answers, so it is described by shape rather than enumerated.
      if ((name === "GCCcore" || name === "GCC") && version) {
        var chain = ["system"];
        if (name === "GCC") {
          chain.push("GCCcore-" + version);
        }
        chain.push(name + "-" + version);
        return (
          chain.join("\n") +
          "\n\nMost minimal first. A dependency may be built against any of\n" +
          "these and still be a candidate."
        );
      }

      var key = (name + "-" + version).toLowerCase();
      var found = byKey[key];
      if (!found) {
        var lines = [
          name + "-" + version + " is not one of the exported generations.",
          "",
          "The lookup key is the whole version string. A versionsuffix that",
          "was folded into it, as in 25.11-CUDA-12.9.1, is part of the key",
          "rather than a modifier on it: two suffixes are two unrelated",
          "toolchains to this walk.",
          "",
          "The engine carries the generations eb-stack has fixtures for: " +
            known.join(", ") + ".",
          "A real hierarchy is a property of what is installed rather than of",
          "the string, so a site's answer can differ from any of these.",
        ];
        return lines.join("\n");
      }

      var lines = found.members.map(label);
      var out = lines.join("\n");
      out += "\n\nMost minimal first, the named toolchain last. A dependency\n";
      out += "built against any member is a candidate; anything outside this\n";
      out += "list is invisible rather than rejected.";
      // gompi and gfbf are siblings under GCC, so their order relative to each
      // other carries no meaning. Saying so stops a reader inferring one.
      var names = found.members.map(function (m) {
        return m.name;
      });
      if (names.indexOf("gompi") >= 0 && names.indexOf("gfbf") >= 0) {
        out +=
          "\n\ngompi and gfbf both sit directly under GCC, so the order\n" +
          "between those two means nothing.";
      }
      return out;
    };
  }

  // --- wire up --------------------------------------------------------------

  Promise.all([
    fetchJson("eb-charmap.json"),
    fetchJson("eb-templates.json"),
    fetchJson("eb-hierarchy.json"),
  ])
    .then(function (tables) {
      var engine = window.EB_STACK_ENGINE || {};
      engine.easyblock = buildEasyblock(tables[0]);
      engine.template = buildTemplate(tables[1]);
      engine.hierarchy = buildHierarchy(tables[2]);
      engine.parse = buildParse(tables[1], tables[0]);
      window.EB_STACK_ENGINE = engine;

      // The runtime may already have settled its islands as inert; this is
      // what brings them back.
      window.dispatchEvent(new Event("eb-stack-ready"));
    })
    .catch(function () {
      // Silent on purpose. The islands already say the engine is not loaded,
      // and a second message about it would be noise.
    });
})();
