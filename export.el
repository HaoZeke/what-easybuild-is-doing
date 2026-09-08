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

;; #+begin_eb ... #+end_eb becomes the `eb' Sphinx directive.  Options ride
;; on #+attr_eb, so the org source stays readable and the widget's
;; configuration lives next to the code it seeds:
;;
;;   #+attr_eb: :widget parse :universe none
;;   #+begin_eb
;;   name = 'zlib'
;;   #+end_eb
;;
;; Every other special block falls through to ox-rst unchanged.
(defun ebguide-rst-special-block (special-block contents info)
  "Translate an `eb' SPECIAL-BLOCK to an RST directive, else defer to rst."
  (let ((type (org-element-property :type special-block)))
    (if (not (string-equal (downcase (or type "")) "eb"))
        (org-export-with-backend 'rst special-block contents info)
      (let* ((attrs (org-export-read-attribute :attr_eb special-block))
             (widget (or (plist-get attrs :widget) "parse"))
             (universe (plist-get attrs :universe))
             (label (plist-get attrs :label)))
        (concat ".. eb::\n"
                (format "   :widget: %s\n" widget)
                (when universe (format "   :universe: %s\n" universe))
                (when label (format "   :label: %s\n" label))
                "\n"
                (ebguide--indent (or contents "") 3)
                "\n\n")))))

(org-export-define-derived-backend 'ebguide-rst 'rst
  :translate-alist '((special-block . ebguide-rst-special-block)))

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
