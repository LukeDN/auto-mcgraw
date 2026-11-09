(() => {
  const KEYS = Object.freeze({
    space: { key: " ", code: "Space", keyCode: 32 },
    enter: { key: "Enter", code: "Enter", keyCode: 13 },
    escape: { key: "Escape", code: "Escape", keyCode: 27 },
    up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  });

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      let element = null;
      try {
        element = root.querySelector(selector);
      } catch {
        continue;
      }
      if (element) return element;
    }
    return null;
  }

  // True when the element is actually rendered. Chat sites keep inactive
  // conversations mounted but hidden, so "first match in the DOM" can be a
  // chat the user has already left.
  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (typeof element.checkVisibility === "function") {
      if (element.checkVisibility()) return true;
      // display: contents has no box of its own; judge it by its children.
      if (getComputedStyle(element).display === "contents") {
        return Array.from(element.children).some(isVisible);
      }
      return false;
    }
    return element.getClientRects().length > 0;
  }

  function queryAll(selector, root = document) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  // First visible match, trying selectors in order. Falls back to the first
  // match of any kind only when nothing visible matches at all.
  function queryFirstVisible(selectors, root = document) {
    for (const selector of selectors) {
      const element = queryAll(selector, root).find(isVisible);
      if (element) return element;
    }
    return queryFirst(selectors, root);
  }

  // Visible subset of nodes; the full list if none are visible, so a page
  // whose visibility can't be judged behaves as it did before.
  function visibleOnly(nodes) {
    const visible = nodes.filter(isVisible);
    return visible.length > 0 ? visible : nodes;
  }

  function isEnabled(element) {
    return (
      Boolean(element) &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true"
    );
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    )?.set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    dispatchInputEvents(input);
  }

  function keyboardEvent(type, { key, code, keyCode }) {
    const event = new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      charCode: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
    });

    try {
      Object.defineProperty(event, "keyCode", { get: () => keyCode });
      Object.defineProperty(event, "which", { get: () => keyCode });
    } catch {
      return event;
    }
    return event;
  }

  function pressKey(target, definition) {
    target.dispatchEvent(keyboardEvent("keydown", definition));
    target.dispatchEvent(keyboardEvent("keyup", definition));
  }

  AutoMcGraw.dom = {
    KEYS,
    queryFirst,
    queryAll,
    queryFirstVisible,
    isVisible,
    visibleOnly,
    isEnabled,
    dispatchInputEvents,
    setInputValue,
    pressKey,
  };
})();
