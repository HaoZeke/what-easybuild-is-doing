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
(require 'ol)
(require 'subr-x)

;; [[cite:hosteEasybuildBuildingSoftware2012][Hoste et al. 2012]]
;; becomes :cite:t:`key` so Sphinx prints Author (year) from refs.bib.
(org-link-set-parameters
 "cite"
 :export (lambda (path desc backend _info)
           (if (org-export-derived-backend-p backend 'rst)
               (if (and desc (not (string= desc path)))
                   (format ":cite:t:`%s`" path)
                 (format ":cite:`%s`" path))
             (or desc path))))

;; A clean Emacs has no org-cite bibliography. Without this, a cite:
;; link that org-element still parses as fuzzy aborts the whole
;; publish. The handler above is the real export; this is the latch.
(setq org-export-with-broken-links t)
(let ((bib (expand-file-name "source/refs.bib"
                             (file-name-directory load-file-name))))
  (when (file-readable-p bib)
    (setq org-cite-global-bibliography (list bib))))

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
             (fails (ebguide--header-value args :fails))
             (code (or (org-element-property :value src-block) "")))
        (concat ".. eb::\n"
                (format "   :widget: %s\n" widget)
                (when universe (format "   :universe: %s\n" universe))
                (when label (format "   :label: %s\n" label))
                (when hydrate (format "   :hydrate: %s\n" hydrate))
                (when fails (format "   :fails: %s\n" fails))
                "\n"
                (ebguide--indent code 3)
                "\n\n"))))))

;; Lesson blocks ride on a *special* block, for the opposite reason widgets
;; cannot: their content is prose, with emphasis and inline code and links,
;; and a special block is what gets markup treatment.
;;
;;   #+ATTR_EB: :id EB-Easyconfig-1 :title What will it download
;;   #+begin_exercise
;;   Change the version to 4.131.0. Which two lines move?
;;   #+end_exercise
;;
;; `#+ATTR_EB:' carries the attributes because a special block's own header
;; line has nowhere to put them.

(defconst ebguide-lesson-blocks
  '("questions" "objectives" "exercise" "solution" "keypoints"
    "prerequisites" "predict" "reveal")
  "Special-block types that become lesson directives.")

;; A dive-in detail is born in one place and transcluded from anywhere, so
;; unlike a lesson block it carries its title as the directive's argument
;; rather than as an option. It still reads its attributes from `#+ATTR_EB:',
;; because a special block's own begin line has nowhere to put them:
;;
;;   #+ATTR_EB: :id steps-order :title The eighteen steps :kind reference
;;   #+begin_detail
;;   ...the table...
;;   #+end_detail

(defun ebguide-rst-detail-block (special-block contents _info)
  "Translate a detail SPECIAL-BLOCK to the eb-detail directive."
  (let* ((attrs (org-export-read-attribute :attr_eb special-block))
         (id (plist-get attrs :id))
         (title (plist-get attrs :title))
         (kind (plist-get attrs :kind))
         (name (plist-get attrs :name)))
    (unless (and id title)
      (error "detail block needs #+ATTR_EB: :id ... :title ..."))
    (concat (format ".. eb-detail:: %s\n" title)
            (format "   :id: %s\n" id)
            (when kind (format "   :kind: %s\n" kind))
            (when name (format "   :name: %s\n" name))
            "\n"
            (ebguide--indent (or contents "") 3)
            "\n\n")))

(defun ebguide-rst-special-block (special-block contents info)
  "Translate a lesson SPECIAL-BLOCK to its directive, else defer to rst."
  (let ((type (downcase (or (org-element-property :type special-block) ""))))
    (cond
     ((string= type "detail")
      (ebguide-rst-detail-block special-block contents info))
     ((not (member type ebguide-lesson-blocks))
      (org-export-with-backend 'rst special-block contents info))
     (t
      (let* ((attrs (org-export-read-attribute :attr_eb special-block))
             (id (plist-get attrs :id))
             (title (plist-get attrs :title)))
        (concat (format ".. %s::\n" type)
                (when id (format "   :id: %s\n" id))
                (when title (format "   :title: %s\n" title))
                "\n"
                (ebguide--indent (or contents "") 3)
                "\n\n"))))))

;; And the reference to one, as its own link type so it reads as a link in
;; the org source and follows in an editor:
;;
;;   [[dive:steps-order]]  or  [[dive:steps-order][the eighteen steps]]

(defun ebguide-dive-link-export (path desc backend _info)
  "Export a dive: link to the :dive: role."
  (if (org-export-derived-backend-p backend 'rst)
      (if (and desc (not (string= desc "")))
          (format ":dive:`%s <%s>`" desc path)
        (format ":dive:`%s`" path))
    (or desc path)))

(org-link-set-parameters "dive" :export #'ebguide-dive-link-export)

(org-export-define-derived-backend 'ebguide-rst 'rst
  :translate-alist '((src-block . ebguide-rst-src-block)
                     (special-block . ebguide-rst-special-block)))

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
