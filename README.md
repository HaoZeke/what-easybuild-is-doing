# What EasyBuild Is Doing

An interactive book about what EasyBuild actually does, for people who
can read code and have not installed EasyBuild.

EasyBuild has good reference documentation and a hands-on workshop
series. Between them they will get you to a working install. Neither
explains why an easyconfig is a Python file, why a toolchain is a
hierarchy rather than a name, or why the version beside a dependency is
not a minimum. This is the book for those.

The samples run in the browser. The engine is
[eb-stack](https://eb-stack.rgoswami.me) compiled to WebAssembly, which
can parse an easyconfig, resolve its templates, walk a toolchain
hierarchy and solve a dependency closure without a server and without
Python. Steps that genuinely need a compiler, a filesystem or a module
system cannot run in a browser and are not faked; those ship as
recordings of real runs.

## Status

Scaffold. One chapter, and the engine is not wired up yet, so every
widget renders as read-only code with a note saying so. The book is
published a chapter at a time on purpose.

## Build

Nothing here compiles, but the build wants Emacs and Sphinx, so it runs
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

`pixi run -e docs mkrst` alone runs the org export;
`pixi run -e docs clean` removes the generated `.rst` and `build/`.

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
#+attr_eb: :widget parse
#+begin_eb
name = 'zlib'
version = '1.3.1'
#+end_eb
```

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
