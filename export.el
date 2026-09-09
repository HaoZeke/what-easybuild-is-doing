;;; export.el --- Publish orgmode/ to reStructuredText for Sphinx  -*- lexical-binding: t; -*-

;; Same shape as the eb-stack docs pipeline: Emacs in batch mode drives
;; ox-rst through org-publish.  The addition here is a handler for the
;; `eb' special block, which carries the interactive widgets.

(require 'package)
(add-to-list 'package-archives '("melpa" . "https://melpa.org/packages/") t)
(package-initialize)

(unless (package-installed-p 'ox-rst)
  (package-refresh-contents)
  (package-install 'ox-rst))

(require 'ox-rst)
(require 'ox-publish)
(require 'subr-x)

(defun ebguide--indent (text n)
  "Indent every non-blank line of TEXT by N spaces."
  (let ((pad (make-string n ?\s)))
    (mapconcat (lambda (line)
                 (if (string-empty-p line) line (concat pad line)))
               (split-string (string-trim-right text) "\n")
               "\n")))

;; Widgets ride on a *source* block, not a special block.
;;
;; The first attempt used `#+begin_eb', and org exported its contents as
;; ordinary paragraph text: `source_urls' became a subscript, and
;; `%(mapped_arch)s' became `%(mapped :sub:`arch`)s'. Special blocks get
;; markup treatment. Code needs a verbatim container, which is what a src
;; block is, so the widget is a src block in the `easyconfig' language:
;;
;;   #+begin_src easyconfig :widget parse :universe foss-2025a
;;   name = 'zlib'
;;   #+end_src
;;
;; `:hydrate' takes load, idle or visible and controls when the island wakes
;; up; omitted, the directive's own default applies.
;;
;; Every other src block, and every other language, falls through to
;; ox-rst unchanged.

(defconst ebguide-widget-language "easyconfig"
  "Src-block language that marks a block as an interactive widget.")

(defconst ebguide-transcript-language "ebtranscript"
  "Src-block language that marks a block as a recording of a real run.")

(defun ebguide--header-value (args key)
  "Look up KEY in parsed babel header ARGS, returning nil when absent or blank."
  (let ((val (cdr (assq key args))))
    (when (and val (stringp val) (not (string-empty-p (string-trim val))))
      (string-trim val))))

(defun ebguide-rst-src-block (src-block contents info)
  "Translate an `easyconfig' SRC-BLOCK to the eb directive, else defer to rst."
  (let ((lang (downcase (or (org-element-property :language src-block) ""))))
    (if (string-equal lang ebguide-transcript-language)
        (let* ((args (org-babel-parse-header-arguments
                      (or (org-element-property :parameters src-block) "")))
               (src (ebguide--header-value args :source))
               (cap (ebguide--header-value args :caption))
               (code (or (org-element-property :value src-block) "")))
          (concat ".. ebtranscript::\n"
                  (when src (format "   :source: %s\n" src))
                  (when cap (format "   :caption: %s\n" cap))
                  "\n"
                  (ebguide--indent code 3)
                  "\n\n"))
    (if (not (string-equal lang ebguide-widget-language))
        (org-export-with-backend 'rst src-block contents info)
      (let* ((args (org-babel-parse-header-arguments
                    (or (org-element-property :parameters src-block) "")))
             (widget (or (ebguide--header-value args :widget) "parse"))
             (universe (ebguide--header-value args :universe))
             (label (ebguide--header-value args :label))
             (hydrate (ebguide--header-value args :hydrate))
             (code (or (org-element-property :value src-block) "")))
        (concat ".. eb::\n"
                (format "   :widget: %s\n" widget)
                (when universe (format "   :universe: %s\n" universe))
                (when label (format "   :label: %s\n" label))
                (when hydrate (format "   :hydrate: %s\n" hydrate))
                "\n"
                (ebguide--indent code 3)
                "\n\n"))))))

(org-export-define-derived-backend 'ebguide-rst 'rst
  :translate-alist '((src-block . ebguide-rst-src-block)))

(defun ebguide-publish-to-rst (plist filename pub-dir)
  "Publish FILENAME as RST through the ebguide-rst backend."
  (org-publish-org-to 'ebguide-rst filename ".rst" plist pub-dir))

;; Sphinx resolves :doc: roles to rendered pages; ox-rst would otherwise
;; emit literal links to the generated .rst files.
(defun ebguide-rst-doc-link-filter (text backend _info)
  (if (org-export-derived-backend-p backend 'rst)
      (replace-regexp-in-string
       "`\\([^`]+\\) <\\([^>]+\\)\\.rst>`_"
       ":doc:`\\1 <\\2>`"
       text)
    text))

(add-to-list 'org-export-filter-link-functions
             #'ebguide-rst-doc-link-filter)

(setq org-publish-project-alist
      '(("guide-rst"
         :base-directory "./orgmode/"
         :base-extension "org"
         :publishing-directory "./source/"
         :publishing-function ebguide-publish-to-rst
         :recursive t
         :with-sub-superscript nil
         :headline-levels 4)
        ("guide-assets"
         :base-directory "./orgmode/"
         :base-extension "svg\\|png\\|jpg\\|jpeg\\|webp"
         :publishing-directory "./source/"
         :publishing-function org-publish-attachment
         :recursive t)
        ("guide" :components ("guide-rst" "guide-assets"))))

(org-publish "guide" t)

;;; export.el ends here
