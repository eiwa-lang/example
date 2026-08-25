function initApp() {
  function highlightAll(scope) {
    const root = scope || document;
    root.querySelectorAll("pre code").forEach(function (block) {
      if (window.hljs) hljs.highlightElement(block);
    });
  }

  function bindTabs(selector) {
    const tabs = document.querySelectorAll(selector);
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (item) {
          item.classList.remove("active");
        });
        tab.classList.add("active");
        if (typeof tab.scrollIntoView === "function") {
          tab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      });
    });
  }

  function bindLessonRun() {
    const runButton = document.getElementById("run-lesson");
    const output = document.getElementById("lesson-output");
    const hint = document.getElementById("lesson-hint");
    if (!runButton || !output || !hint) return;

    runButton.addEventListener("click", function () {
      const fragment = document.querySelector("#lesson-preview .lesson-fragment");
      if (!fragment) {
        output.textContent = "Load a lesson first.";
        return;
      }
      output.textContent = fragment.getAttribute("data-output") || "No output provided.";
      hint.textContent = fragment.getAttribute("data-hint") || "";
    });
  }

  function bindMobileMenu() {
    const menuToggle = document.getElementById("menu-toggle");
    const mobileMenu = document.getElementById("mobile-menu");
    if (!menuToggle || !mobileMenu) return;

    function toggleMenu(forceState) {
      const willOpen = typeof forceState === "boolean" ? forceState : !mobileMenu.classList.contains("open");
      if (willOpen) {
        menuToggle.classList.add("open");
        mobileMenu.classList.add("open");
        document.body.style.overflow = "hidden";
      } else {
        menuToggle.classList.remove("open");
        mobileMenu.classList.remove("open");
        document.body.style.overflow = "";
      }
    }

    menuToggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    mobileMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        toggleMenu(false);
      });
    });

    document.addEventListener("click", function (e) {
      if (mobileMenu.classList.contains("open") && !mobileMenu.contains(e.target) && !menuToggle.contains(e.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && mobileMenu.classList.contains("open")) {
        toggleMenu(false);
      }
    });
  }

  highlightAll();
  bindTabs(".example-tab");
  bindTabs(".lesson-tab");
  bindLessonRun();
  bindMobileMenu();

  document.body.addEventListener("click", function (event) {
    const copyBtn = event.target.closest("#copy-install");
    if (!copyBtn) return;
    navigator.clipboard.writeText("curl -fsSL https://eiwa.dev/install.sh | sh");
    copyBtn.classList.add("copied");
    setTimeout(function () {
      copyBtn.classList.remove("copied");
    }, 900);
  });

  document.body.addEventListener("htmx:afterSwap", function (event) {
    highlightAll(event.target);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

