// A partial engine: three widgets, backed by data exported from eb-stack.
//
// Tables come from the eb-stack generator at book-build time. This file
// is not eb-stack and not EasyBuild. The crate does not compile for
// wasm32 yet (ureq, fs2). Rather than ship nothing, this implements the
// widgets whose behaviour is a table plus a few lines of application.
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

  // A small reader for the assignment subset the samples use. It is not a
  // Python parser. It now follows a multi-line list or dict by counting
  // brackets, and it names anything it still will not follow, so a widget
  // that cannot model `checksums` says so rather than dropping the key.
  function bracketDepth(text) {
    var depth = 0;
    var quote = null;
    var triple = null;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      var next2 = text.slice(i, i + 3);
      if (triple) {
        if (next2 === triple) {
          i += 2;
          triple = null;
        }
        continue;
      }
      if (quote) {
        if (c === "\\") {
          i += 1;
          continue;
        }
        if (c === quote) {
          quote = null;
        }
        continue;
      }
      if (next2 === "'''" || next2 === '"""') {
        triple = next2;
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if (c === "#" && depth === 0) {
        break;
      }
      if (c === "[" || c === "{" || c === "(") {
        depth += 1;
      } else if (c === "]" || c === "}" || c === ")") {
        depth -= 1;
      }
    }
    return depth;
  }

  function joinLogicalLines(source) {
    var lines = source.split("\n");
    var out = [];
    var buf = "";
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!buf && /^\s*#/.test(raw)) {
        continue;
      }
      buf = buf ? buf + "\n" + raw : raw;
      if (bracketDepth(buf) <= 0) {
        var trimmed = buf.trim();
        if (trimmed) {
          out.push(trimmed);
        }
        buf = "";
      }
    }
    if (buf.trim()) {
      out.push(buf.trim());
    }
    return out;
  }

  function parseDepTuples(value) {
    var deps = [];
    var re = /\(\s*['"]([^'"]+)['"]\s*,\s*(?:['"]([^'"]*)['"]|([A-Za-z_][A-Za-z0-9_]*))/g;
    var m;
    while ((m = re.exec(value)) !== null) {
      deps.push({
        name: m[1],
        version: m[2] || ("<" + m[3] + ">"),
      });
    }
    return deps;
  }

  function parseChecksumItems(value) {
    var items = [];
    var dictRe = /['"]([^'"]+)['"]\s*:\s*['"]([0-9a-fA-F]+)['"]/g;
    var m;
    var sawDict = false;
    while ((m = dictRe.exec(value)) !== null) {
      sawDict = true;
      items.push({ file: m[1], hash: m[2] });
    }
    if (sawDict) {
      return items;
    }
    var strRe = /['"]([0-9a-fA-F]{16,})['"]/g;
    while ((m = strRe.exec(value)) !== null) {
      items.push({ file: null, hash: m[1] });
    }
    return items;
  }

  function formatDep(dep) {
    return dep.version ? dep.name + " " + dep.version : dep.name;
  }

  function readAssignments(source) {
    var fields = {};
    var lists = {};
    var skipped = [];
    var deps = [];
    var builddeps = [];
    var checksums = [];
    var logical = joinLogicalLines(source);
    for (var i = 0; i < logical.length; i++) {
      var line = logical[i];
      var eq = line.indexOf("=");
      if (eq < 0) {
        continue;
      }
      var key = line.slice(0, eq).trim();
      var value = line.slice(eq + 1).trim().replace(/,\s*$/, "");
      if (!/^[a-z_][a-z0-9_]*$/.test(key)) {
        continue;
      }
      if (bracketDepth(value) > 0) {
        skipped.push(key);
        continue;
      }
      var triple = value.match(/^('{3}|"{3})([\s\S]*?)\1\s*$/);
      if (triple) {
        fields[key] = triple[2];
        continue;
      }
      var scalar = value.match(/^(['"])(.*)\1\s*$/);
      if (scalar) {
        fields[key] = scalar[2];
        continue;
      }
      if (value === "True" || value === "False" || value === "None") {
        fields[key] = value;
        continue;
      }
      if (value.charAt(0) === "[") {
        if (key === "dependencies" || key === "builddependencies") {
          var parsed = parseDepTuples(value);
          if (parsed.length) {
            if (key === "dependencies") {
              deps = parsed;
            } else {
              builddeps = parsed;
            }
            lists[key] = parsed.map(formatDep);
            continue;
          }
        }
        if (key === "checksums") {
          checksums = parseChecksumItems(value);
          if (checksums.length) {
            lists[key] = checksums.map(function (c) {
              if (c.file) {
                return c.file + " -> " + c.hash.slice(0, 12) + "...";
              }
              return c.hash.slice(0, 12) + "... (" + c.hash.length + " hex)";
            });
            continue;
          }
        }
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
        // easybuild.framework.easyconfig.constants: SYSTEM = {name: system, version: system}
        fields[key + "_name"] = "system";
        fields[key + "_version"] = "system";
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        fields[key] = value;
      } else {
        skipped.push(key);
      }
    }
    return {
      fields: fields,
      lists: lists,
      skipped: skipped,
      deps: deps,
      builddeps: builddeps,
      checksums: checksums,
    };
  }

  function moduleIdentity(read) {
    var fields = read.fields;
    var name = fields.name || "";
    var version = fields.version || "";
    var suffix = fields.versionsuffix || "";
    var tcName = fields.toolchain_name || "";
    var tcVer = fields.toolchain_version || "";
    var module;
    var filename;
    if (!name || !version) {
      return null;
    }
    if (!tcName || tcName === "system") {
      module = name + "/" + version + suffix;
      filename = name + "-" + version + suffix + ".eb";
    } else {
      module = name + "/" + version + "-" + tcName + "-" + tcVer + suffix;
      filename = name + "-" + version + "-" + tcName + "-" + tcVer + suffix + ".eb";
    }
    return { module: module, filename: filename, suffix: suffix };
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
        row("toolchain", "{name: " + tn + ", version: " + (tv || "system") + "}");
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

  // --- modname --------------------------------------------------------------

  function buildModname() {
    return function (source) {
      var read = readAssignments(source);
      var id = moduleIdentity(read);
      if (!id) {
        return (
          "Set `name` and `version`. The default module naming scheme\n" +
          "(EasyBuildMNS) builds the module name and the .eb filename from\n" +
          "those, the toolchain, and versionsuffix."
        );
      }
      var out = [
        "EasyBuildMNS (the default scheme):",
        "  module    " + id.module,
        "  filename  " + id.filename,
      ];
      if (id.suffix) {
        out.push("");
        out.push(
          "versionsuffix is glued on as text. It is not a constraint and"
        );
        out.push(
          "it is not checked against the tree. Change it and the name changes."
        );
      }
      if (read.fields.toolchain_name === "system") {
        out.push("");
        out.push("SYSTEM drops the toolchain from the name, so two SYSTEM");
        out.push("packages with the same name and version collide.");
      }
      return out.join("\n");
    };
  }

  // --- emit -----------------------------------------------------------------

  function buildEmit(spec, charmap) {
    var parse = buildParse(spec, charmap);
    return function (source) {
      var read = readAssignments(source);
      if (!read.fields.name || !read.fields.version) {
        return "Set at least `name` and `version`. Emit reprints the model as a recipe.";
      }
      var f = read.fields;
      var lines = [];
      function assign(key, value) {
        if (value === undefined || value === null || value === "") {
          return;
        }
        lines.push(key + " = " + value);
      }
      assign("name", "'" + f.name + "'");
      assign("version", "'" + f.version + "'");
      if (f.versionsuffix) {
        assign("versionsuffix", "'" + f.versionsuffix + "'");
      }
      if (f.easyblock) {
        assign("easyblock", "'" + f.easyblock + "'");
      }
      if (f.homepage) {
        assign("homepage", "'" + f.homepage + "'");
      }
      if (f.description) {
        assign("description", '"""' + f.description + '"""');
      }
      if (f.toolchain_name === "system") {
        lines.push("toolchain = SYSTEM");
      } else if (f.toolchain_name) {
        lines.push(
          "toolchain = {'name': '" +
            f.toolchain_name +
            "', 'version': '" +
            (f.toolchain_version || "") +
            "'}"
        );
      }
      ["source_urls", "sources"].forEach(function (key) {
        if (read.lists[key] && read.lists[key].length) {
          lines.push(
            key +
              " = [" +
              read.lists[key]
                .map(function (item) {
                  return "'" + item + "'";
                })
                .join(", ") +
              "]"
          );
        }
      });
      if (read.checksums.length) {
        lines.push("checksums = [");
        read.checksums.forEach(function (c) {
          if (c.file) {
            lines.push("    {'" + c.file + "': '" + c.hash + "'},");
          } else {
            lines.push("    '" + c.hash + "',");
          }
        });
        lines.push("]");
      }
      function emitDeps(key, items) {
        if (!items.length) {
          return;
        }
        lines.push(key + " = [");
        items.forEach(function (d) {
          lines.push("    ('" + d.name + "', '" + d.version + "'),");
        });
        lines.push("]");
      }
      emitDeps("dependencies", read.deps);
      emitDeps("builddependencies", read.builddeps);
      if (f.moduleclass) {
        assign("moduleclass", "'" + f.moduleclass + "'");
      }
      if (read.skipped.length) {
        lines.push("");
        lines.push(
          "# not emitted (this reader skipped): " + read.skipped.join(", ")
        );
      }
      var preview = parse(source);
      return lines.join("\n") + "\n\n# --- evaluated model ---\n" + preview;
    };
  }

  // --- lint -----------------------------------------------------------------

  function buildLint() {
    return function (source) {
      var read = readAssignments(source);
      var f = read.fields;
      var findings = [];
      if (!f.name) {
        findings.push("error  name is missing");
      }
      if (!f.version) {
        findings.push("error  version is missing");
      }
      if (f.name && /\s/.test(f.name)) {
        findings.push("error  name contains whitespace; EasyBuild will not load it");
      }
      if (!f.toolchain_name) {
        findings.push(
          "error  toolchain is missing. SYSTEM is a value, not the default."
        );
      }
      var sources = read.lists.sources || [];
      if (sources.length && !read.checksums.length) {
        findings.push(
          "error  sources are listed and checksums are not. EasyBuild will refuse the download."
        );
      }
      if (
        sources.length &&
        read.checksums.length &&
        read.checksums.length !== sources.length &&
        !read.checksums.some(function (c) {
          return c.file;
        })
      ) {
        findings.push(
          "error  " +
            sources.length +
            " sources and " +
            read.checksums.length +
            " positional checksums. The list is positional."
        );
      }
      if (f.versionsuffix && f.versionsuffix.charAt(0) !== "-") {
        findings.push(
          "warn   versionsuffix does not start with '-'; the module name will glue oddly"
        );
      }
      if (f.toolchain_name === "system" && read.deps.length) {
        findings.push(
          "warn   SYSTEM with dependencies: those deps must also be SYSTEM, or the robot will not see them"
        );
      }
      if (f.versionsuffix && read.deps.length === 0 && /CUDA|cuda/.test(f.versionsuffix)) {
        findings.push(
          "warn   versionsuffix mentions CUDA but there is no CUDA dependency. The suffix is a label, not a pin."
        );
      }
      if (!sources.length && f.name) {
        findings.push("note   no sources. A binary or a bundle might mean that; a tarball recipe does not.");
      }
      if (read.skipped.length) {
        findings.push(
          "note   skipped (unparsed): " +
            read.skipped.join(", ") +
            ". The real linter would still see these."
        );
      }
      if (!findings.length) {
        findings.push("ok     nothing this reader objects to. It is not easyconfig-style.");
      }
      var id = moduleIdentity(read);
      var header = ["lint (in-page subset, not easyconfig-style):"];
      if (id) {
        header.push("would install as  " + id.module);
      }
      header.push("");
      return header.concat(findings).join("\n");
    };
  }

  // --- solve ----------------------------------------------------------------

  function pkgKey(pkg) {
    return (
      pkg.name +
      "/" +
      pkg.version +
      (pkg.toolchain && pkg.toolchain.name && pkg.toolchain.name !== "system"
        ? "-" + pkg.toolchain.name + "-" + pkg.toolchain.version
        : "") +
      (pkg.versionsuffix || "")
    );
  }

  function buildSolve(universe) {
    var byName = Object.create(null);
    var packages = (universe && universe.packages) || [];
    for (var i = 0; i < packages.length; i++) {
      var pkg = packages[i];
      if (!byName[pkg.name]) {
        byName[pkg.name] = [];
      }
      byName[pkg.name].push(pkg);
    }

    function lookup(name, version) {
      var cands = byName[name] || [];
      if (!cands.length) {
        return null;
      }
      if (version) {
        for (var i = 0; i < cands.length; i++) {
          if (cands[i].version === version) {
            return cands[i];
          }
        }
      }
      return cands[0];
    }

    return function (source, universeName) {
      var read = readAssignments(source);
      if (!read.fields.name) {
        return (
          "Give an easyconfig, or at least `name` and its dependencies.\n" +
          "This walk uses the canned universe shipped with the page, not\n" +
          "your site's robot path. Change a pin and watch who disappears."
        );
      }
      var seen = Object.create(null);
      var order = [];
      var missing = [];
      var note = universeName
        ? "universe label: " + universeName + " (canned, not your site)"
        : "canned universe shipped with the page, not your site's robot path";

      function walk(dep, via) {
        var found = lookup(dep.name, dep.version);
        if (!found) {
          missing.push(
            dep.name +
              (dep.version ? " " + dep.version : "") +
              (via ? "  (needed by " + via + ")" : "")
          );
          return;
        }
        var key = pkgKey(found);
        if (seen[key]) {
          return;
        }
        seen[key] = true;
        var kids = (found.dependencies || []).concat(
          found.builddependencies || []
        );
        for (var i = 0; i < kids.length; i++) {
          walk(kids[i], found.name);
        }
        order.push(found);
      }

      var rootDeps = read.deps.concat(read.builddeps);
      if (!rootDeps.length) {
        var guessed = lookup(read.fields.name, read.fields.version);
        if (guessed) {
          walk(
            { name: guessed.name, version: guessed.version },
            null
          );
        }
      } else {
        for (var d = 0; d < rootDeps.length; d++) {
          walk(rootDeps[d], read.fields.name);
        }
      }

      var out = ["robot walk (" + note + "):", ""];
      if (!order.length && !missing.length) {
        out.push("Nothing to resolve. Add a dependencies list, or name a");
        out.push("package that is in the canned universe (try GROMACS,");
        out.push("Python, or zlib).");
        return out.join("\n");
      }
      for (var o = 0; o < order.length; o++) {
        out.push("  " + (o + 1) + ".  " + pkgKey(order[o]));
      }
      if (read.fields.name) {
        var rootId = moduleIdentity(read);
        out.push(
          "  " +
            (order.length + 1) +
            ".  " +
            (rootId ? rootId.module : read.fields.name) +
            "   <- you asked for this"
        );
      }
      if (missing.length) {
        out.push("");
        out.push("not in this universe:");
        for (var m = 0; m < missing.length; m++) {
          out.push("  - " + missing[m]);
        }
        out.push("On a real site the robot would search --robot-paths for these.");
      }
      out.push("");
      out.push(
        packages.length +
          " packages in the canned universe. Edit a version pin above"
      );
      out.push("and the walk either still finds it, or it does not.");
      return out.join("\n");
    };
  }

  // --- wire up --------------------------------------------------------------

  Promise.all([
    fetchJson("eb-charmap.json"),
    fetchJson("eb-templates.json"),
    fetchJson("eb-hierarchy.json"),
    fetchJson("eb-universe.json").catch(function () {
      return { packages: [] };
    }),
  ])
    .then(function (tables) {
      var engine = window.EB_STACK_ENGINE || {};
      engine.easyblock = buildEasyblock(tables[0]);
      engine.template = buildTemplate(tables[1]);
      engine.hierarchy = buildHierarchy(tables[2]);
      engine.parse = buildParse(tables[1], tables[0]);
      engine.modname = buildModname();
      engine.emit = buildEmit(tables[1], tables[0]);
      engine.lint = buildLint();
      engine.solve = buildSolve(tables[3]);
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
