(() => {
  const { MessageType, messaging, assistants } = AutoMcGraw;
  const NOTICE_ID = "automcgraw-notice";

  const STYLE_ID = "automcgraw-toolbar-style";
  const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

  const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  const STYLES = `
    .automcgraw-toolbar {
      display: inline-flex;
      align-items: center;
    }

    .automcgraw-toolbar svg {
      display: block;
      width: 16px;
      height: 16px;
    }

    .automcgraw-toolbar.automcgraw-toolbar--smartbook {
      display: flex;
      margin-left: 10px;
    }

    .automcgraw-toolbar.automcgraw-toolbar--smartbook > .btn.automcgraw-toolbar__main {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }

    .automcgraw-toolbar.automcgraw-toolbar--smartbook > .btn.automcgraw-toolbar__copy {
      border-radius: 0;
      border-left: 1px solid rgba(0, 0, 0, 0.2);
      padding: 6px 10px;
    }

    .automcgraw-toolbar.automcgraw-toolbar--smartbook > .btn.automcgraw-toolbar__settings {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left: 1px solid rgba(0, 0, 0, 0.2);
      padding: 6px 10px;
    }

    .automcgraw-toolbar.automcgraw-toolbar--ezto {
      margin-right: 20px;
    }

    .automcgraw-toolbar.automcgraw-toolbar--ezto > button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      background: #fff;
      border: 1px solid #ccc;
      color: #333;
      font-family: inherit;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    .automcgraw-toolbar.automcgraw-toolbar--ezto > button:hover {
      background: #f5f5f5;
    }

    .automcgraw-toolbar.automcgraw-toolbar--ezto > .automcgraw-toolbar__main {
      padding: 8px 12px;
      border-right: none;
      border-radius: 4px 0 0 4px;
    }

    .automcgraw-toolbar.automcgraw-toolbar--ezto > .automcgraw-toolbar__settings {
      padding: 8px 10px;
      border-radius: 0 4px 4px 0;
    }

    .automcgraw-notice {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      max-width: min(440px, calc(100vw - 32px));
      max-height: 60vh;
      overflow: auto;
      padding: 14px 40px 14px 16px;
      border-radius: 8px;
      border-left: 4px solid #4d6bfe;
      background: #17171a;
      color: #e7e7ea;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      white-space: pre-wrap;
    }

    .automcgraw-notice[data-tone="error"] {
      border-left-color: #f06a61;
    }

    .automcgraw-notice__close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }

    .automcgraw-notice__close:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .automcgraw-toolbar.automcgraw-toolbar--ezto svg {
      width: 14px;
      height: 14px;
    }
  `;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  function openSettings() {
    messaging
      .send({ type: MessageType.OPEN_SETTINGS })
      .catch(() =>
        notify(
          "Auto-McGraw was updated or reloaded. Refresh this page to keep using it.",
          { tone: "error" }
        )
      );
  }

  function create({ variant, onToggle, onCopyQuestion }) {
    injectStyles();

    const element = document.createElement("div");
    element.className = `automcgraw-toolbar automcgraw-toolbar--${variant}`;

    const mainButton = document.createElement("button");
    mainButton.type = "button";
    mainButton.className = "automcgraw-toolbar__main";
    mainButton.addEventListener("click", onToggle);

    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "automcgraw-toolbar__settings";
    settingsButton.title = "Auto-McGraw Settings";
    settingsButton.setAttribute("aria-label", "Auto-McGraw Settings");
    settingsButton.innerHTML = SETTINGS_ICON;
    settingsButton.addEventListener("click", openSettings);

    if (variant === "smartbook") {
      mainButton.classList.add("btn", "btn-secondary");
      settingsButton.classList.add("btn", "btn-secondary");
    }

    element.append(mainButton);
    if (onCopyQuestion) {
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "automcgraw-toolbar__copy";
      copyButton.title = "Copy this question's details (for bug reports)";
      copyButton.setAttribute("aria-label", copyButton.title);
      copyButton.innerHTML = COPY_ICON;
      copyButton.addEventListener("click", onCopyQuestion);
      if (variant === "smartbook") copyButton.classList.add("btn", "btn-secondary");
      element.append(copyButton);
    }
    element.append(settingsButton);

    function render({ running, assistantId, doubleCredit, label }) {
      const name = label || assistants.get(assistantId).name;
      mainButton.textContent = running
        ? "Stop Automation"
        : `Ask ${name}${doubleCredit ? " (2x)" : ""}`;
    }

    return { element, render, notify };
  }

  // A dismissible in-page notice. Unlike alert(), it doesn't freeze the page,
  // so automation and the user can keep working while it's shown.
  function notify(message, { tone = "info" } = {}) {
    injectStyles();
    document.getElementById(NOTICE_ID)?.remove();
    if (!message) return;

    const notice = document.createElement("div");
    notice.id = NOTICE_ID;
    notice.className = "automcgraw-notice";
    notice.dataset.tone = tone;
    notice.setAttribute("role", tone === "error" ? "alert" : "status");
    notice.textContent = message;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "automcgraw-notice__close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", () => notice.remove());
    notice.append(close);

    (document.body || document.documentElement).appendChild(notice);
  }

  function keepMounted(element, mount) {
    const ensureMounted = () => {
      if (!element.isConnected) mount(element);
    };
    new MutationObserver(ensureMounted).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    ensureMounted();
  }

  AutoMcGraw.toolbar = { create, keepMounted, notify };
})();
