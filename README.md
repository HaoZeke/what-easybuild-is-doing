# What EasyBuild Is Doing

An interactive book about what EasyBuild actually does, for people who
can read code and have not installed EasyBuild.

EasyBuild has good reference documentation and a hands-on workshop
series. Between them they will get you to a working install. Neither
explains why an easyconfig is a Python file, why a toolchain is a
hierarchy rather than a name, or why the version beside a dependency is
not a minimum. This is the book for those.

The samples run in the browser. They apply tables exported from
[eb-stack](https://eb-stack.rgoswami.me) at book-build time: the
easyblock encoding, the template constants, and the foss hierarchies.
eb-stack itself is an updater and generator. It ingests foreign and
EasyBuild recipes, Resolvo-solves a profile, emits a conventional
`.eb`, and a campaign then runs that file through real EasyBuild.
Nothing on these pages compiles software. Steps that need a compiler
ship as recordings of real runs.

## Status

First draft: four chapters, front-loaded on purpose.

The in-page engine is a table-backed stand-in, not eb-stack and not
EasyBuild. `parse`, `template`, `easyblock`, `hierarchy`, `modname`,
`solve`, `lint`, and `emit` are live. Press Escape on any page for a
playground. The crate does not compile for `wasm32` yet (`ureq` and
`fs2`); when it does, the page already has a drop-in contract.

## Build

Nothing here compiles, but the build requires Emacs and Sphinx, so it runs
in a pixi environment rather than against whatever is on `PATH`.

```sh
pixi run -e docs all
```

That runs three builders from one source, which is the whole reason
this book is built with Sphinx:

| Task | Output | Widgets |
|---|---|---|
| `pixi run -e docs html` | `build/html`, page per chapter | live |
| `pixi run -e docs singlehtml` | `build/singlehtml`, one page | live |
| `pixi run -e docs epub` | `build/epub` | absent, code only |

`pixi run -e docs mkrst` alone runs the org export and
`pixi run -e docs charmap` alone re-exports the encoding table;
`pixi run -e docs clean` removes the generated `.rst` and `build/`.

The `charmap` step needs the `eb-stack` binary. Set `EB_STACK` to it when
it is not on `PATH`, which is the normal case on a build host where the
engine was compiled rather than installed.

## Layout

```
orgmode/            the book. org-mode, and the only place prose is edited
export.el           orgmode/ -> source/*.rst, via Emacs batch + ox-rst
source/conf.py      Sphinx config for all three builders
source/_ext/        the `eb` directive, which mounts a widget
source/_static/     widget CSS and the mount script
source/*.rst        generated, not committed
```

Prose is written in org and never in the generated `.rst`. The custom
`eb` block carries the widgets:

```org
#+begin_src easyconfig :widget parse
name = 'zlib'
version = '1.3.1'
#+end_src
```

A src block rather than a special block, because a special block's
contents get org markup treatment: `source_urls` comes out as a
subscript.

`:widget` must name one of the widgets in `source/_ext/eb_widget.py`, so
a typo fails the build rather than rendering an inert box.

## Why Sphinx

Because it is the only generator whose builders cover all three
renderings natively, because the org-to-RST step was already a working
pipeline in eb-stack rather than a plan, and because the interactive
part is a directive that emits a `div`, not a framework.

The Pyodide-based interactive Sphinx extensions, `jupyterlite-sphinx`
and `sphinx-thebe`, are deliberately unused: both exist to give a page a
Python kernel, tens of megabytes of runtime, and the engine here is a
small Rust module that needs none of it.

The design, including the generator survey it came out of, is written
up privately; the short version is in this section.

## License

Prose CC BY 4.0, code MIT.
