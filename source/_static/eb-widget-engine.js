// A partial engine: one widget, backed by data exported from eb-stack.
//
// The full engine is eb-stack compiled to WebAssembly, and it cannot be built
// yet: the crate does not compile for wasm32 until its IO-free core exists
// (ureq and fs2 are the blockers). So rather than ship nothing, this
// implements the one widget whose whole behaviour is a lookup table.
//
// `easyblock` answers which easyblock class EasyBuild will derive from a
// software name. That is `EB_` followed by a per-character substitution, and
// the table is generated at build time by
//
//     eb-stack recipe easyblock --charmap
//
// so the data has one source of truth and cannot drift from the framework's
// own STRING_ENCODING_CHARMAP. Only the five-line substitution lives here.
// Every other widget stays unimplemented and says so; see eb-widget.js.
//
// This file is deliberately named to match the widget asset prefix, so the
// per-page stripping in _ext/eb_widget.py removes it from chapters that hold
// no island. A chapter of pure prose must still ship no JavaScript.

(function () {
  "use strict";

  function charmapUrl() {
    var self = document.currentScript;
    if (!self || !self.src) {
      return null;
    }
    return self.src.replace(
      /eb-widget-engine\.js(\?.*)?$/,
      "eb-charmap.json"
    );
  }

  var url = charmapUrl();
  if (!url) {
    return;
  }

  fetch(url)
    .then(function (response) {
      if (!response.ok) {
        throw new Error("charmap " + response.status);
      }
      return response.json();
    })
    .then(function (table) {
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

      var engine = window.EB_STACK_ENGINE || {};
      engine.easyblock = function (source) {
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
