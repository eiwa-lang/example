function initApp() {
  let currentOs = "unix"; // "unix" or "win"

  // Detect user operating system
  const ua = navigator.userAgent || "";
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  if (/Win/i.test(ua) || /Win/i.test(platform)) {
    currentOs = "win";
  }

  function highlightAll(scope) {
    const root = scope || document;
    root.querySelectorAll("pre code").forEach(function (block) {
      if (window.hljs) hljs.highlightElement(block);
    });
  }

  function setOs(os) {
    currentOs = os;

    // Update Hero install box
    const heroPrompt = document.getElementById("hero-install-prompt");
    const heroCode = document.getElementById("hero-install-code");
    const heroTabUnix = document.getElementById("tab-os-unix");
    const heroTabWin = document.getElementById("tab-os-win");

    if (heroPrompt && heroCode) {
      if (os === "win") {
        heroPrompt.textContent = "PS >";
        heroCode.textContent = "irm https://eiwa.dev/install.ps1 | iex";
      } else {
        heroPrompt.textContent = "$";
        heroCode.textContent = "curl -fsSL https://eiwa.dev/install.sh | sh";
      }
    }
    if (heroTabUnix && heroTabWin) {
      if (os === "win") {
        heroTabUnix.classList.remove("active");
        heroTabWin.classList.add("active");
      } else {
        heroTabUnix.classList.add("active");
        heroTabWin.classList.remove("active");
      }
    }

    // Update Quickstart terminal
    const terminalTabUnix = document.getElementById("terminal-tab-unix");
    const terminalTabWin = document.getElementById("terminal-tab-win");
    const unixLines = document.getElementById("terminal-unix-commands");
    const winLines = document.getElementById("terminal-win-commands");
    const cursorPrompt = document.getElementById("terminal-cursor-prompt");

    if (terminalTabUnix && terminalTabWin) {
      if (os === "win") {
        terminalTabUnix.classList.remove("active");
        terminalTabWin.classList.add("active");
      } else {
        terminalTabUnix.classList.add("active");
        terminalTabWin.classList.remove("active");
      }
    }
    if (unixLines && winLines) {
      if (os === "win") {
        unixLines.classList.add("hidden");
        winLines.classList.remove("hidden");
      } else {
        unixLines.classList.remove("hidden");
        winLines.classList.add("hidden");
      }
    }
    if (cursorPrompt) {
      cursorPrompt.textContent = os === "win" ? "PS >" : "$";
    }
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

  function bindOsSelectors() {
    document.body.addEventListener("click", function (e) {
      const target = e.target;
      if (target.id === "tab-os-unix" || target.id === "terminal-tab-unix") {
        setOs("unix");
      } else if (target.id === "tab-os-win" || target.id === "terminal-tab-win") {
        setOs("win");
      }
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

  const mcpConfigs = {
    "mcp-tab-antigravity": {
      lang: "json",
      code: '{\n  "mcpServers": {\n    "eiwa": {\n      "serverUrl": "https://eiwa.dev/mcp"\n    }\n  }\n}',
      hint: "Add to ~/.gemini/config/mcp_config.json (or project .agents/mcp_config.json)."
    },
    "mcp-tab-codex": {
      lang: "yaml",
      code: '[mcp_servers.eiwa]\nurl = "https://eiwa.dev/mcp"',
      hint: "Run 'codex mcp add eiwa --url https://eiwa.dev/mcp' or add to ~/.codex/config.toml."
    },
    "mcp-tab-cursor": {
      lang: "json",
      code: '{\n  "mcpServers": {\n    "eiwa": {\n      "url": "https://eiwa.dev/mcp"\n    }\n  }\n}',
      hint: "Add to .cursor/mcp.json or your VS Code MCP client (Cline, Roo Code)."
    },
    "mcp-tab-claude": {
      lang: "json",
      code: '{\n  "mcpServers": {\n    "eiwa": {\n      "type": "http",\n      "url": "https://eiwa.dev/mcp"\n    }\n  }\n}',
      hint: "Run 'claude mcp add --transport http eiwa https://eiwa.dev/mcp' or add to .mcp.json."
    }
  };

  function bindMcpTabs() {
    const tabs = document.querySelectorAll(".mcp-tab");
    const codeEl = document.getElementById("mcp-code-content");
    const hintEl = document.getElementById("mcp-hint-text");
    if (!tabs.length || !codeEl) return;

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        const cfg = mcpConfigs[tab.id];
        if (cfg) {
          if (hintEl) hintEl.textContent = cfg.hint;
          delete codeEl.dataset.highlighted;
          codeEl.removeAttribute("data-highlighted");
          codeEl.className = "language-" + (cfg.lang || "json");
          codeEl.textContent = cfg.code;
          if (window.hljs) {
            hljs.highlightElement(codeEl);
          }
        }
      });
    });
  }

  highlightAll();
  bindTabs(".example-tab");
  bindTabs(".lesson-tab");
  bindLessonRun();
  bindMobileMenu();
  bindOsSelectors();
  bindMcpTabs();
  setOs(currentOs);

  document.body.addEventListener("click", function (event) {
    const copyBtn = event.target.closest("#copy-install");
    if (copyBtn) {
      const textToCopy = currentOs === "win"
        ? "irm https://eiwa.dev/install.ps1 | iex"
        : "curl -fsSL https://eiwa.dev/install.sh | sh";

      navigator.clipboard.writeText(textToCopy);
      copyBtn.classList.add("copied");
      setTimeout(function () {
        copyBtn.classList.remove("copied");
      }, 900);
      return;
    }

    const copyMcpBtn = event.target.closest("#copy-mcp");
    if (copyMcpBtn) {
      const codeEl = document.getElementById("mcp-code-content");
      if (!codeEl) return;
      navigator.clipboard.writeText(codeEl.textContent.trim());
      copyMcpBtn.classList.add("copied");
      setTimeout(function () {
        copyMcpBtn.classList.remove("copied");
      }, 900);
      return;
    }
  });

  document.body.addEventListener("htmx:afterSwap", function (event) {
    highlightAll(event.target);
    setOs(currentOs);
    bindMcpTabs();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
