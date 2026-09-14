(function () {
  function labelSearch() {
    var q = document.querySelector('form.searchbox input[name="q"]');
    if (q && !q.getAttribute("aria-label")) {
      q.setAttribute("aria-label", "Search the book");
    }
  }
  function permalinkNames() {
    document.querySelectorAll("article.yue a.headerlink").forEach(function (a) {
      var parent = a.parentElement;
      if (!parent) return;
      var name = parent.textContent.replace(a.textContent, "").trim();
      if (name) a.setAttribute("aria-label", "Permalink to " + name);
    });
  }
  function skipLink() {
    if (document.querySelector("a.eb-skip")) return;
    var main = document.querySelector("main.sy-main") || document.querySelector("article.yue");
    if (!main) return;
    if (!main.id) main.id = "eb-main";
    var a = document.createElement("a");
    a.className = "eb-skip";
    a.href = "#" + main.id;
    a.textContent = "Skip to content";
    document.body.insertBefore(a, document.body.firstChild);
    var article = document.querySelector("article.yue[role='main']");
    if (article && document.querySelector("main.sy-main")) {
      article.removeAttribute("role");
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      labelSearch();
      skipLink();
    });
  } else {
    labelSearch();
    skipLink();
  }
})();
