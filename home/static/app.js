document.addEventListener("DOMContentLoaded", function () {
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

  highlightAll();

  bindTabs(".example-tab");
  bindTabs(".lesson-tab");

  bindLessonRun();

  document.body.addEventListener("click", function (event) {
    if (event.target.id !== "copy-install") return;
    navigator.clipboard.writeText("curl -fsSL https://eiwa.dev/install.sh | sh");
    event.target.classList.add("copied");
    setTimeout(function () {
      event.target.classList.remove("copied");
    }, 900);
  });

  document.body.addEventListener("htmx:afterSwap", function (event) {
    highlightAll(event.target);
  });
});
