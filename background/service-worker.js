importScripts(
  "../shared/namespace.js",
  "../shared/assistants.js",
  "../shared/settings.js",
  "../shared/api-providers.js",
  "../shared/messaging.js",
  "../shared/wait.js",
  "api-client.js",
  "tabs.js",
  "prompt.js",
  "relay.js",
  "double-credit.js"
);

(() => {
  const { MessageType, messaging, relay, doubleCredit, settings, apiClient } =
    AutoMcGraw;

  const SETTINGS_WINDOW = { width: 440, height: 720 };
  const IMAGE_SOURCE_TAB = /^https:\/\/[^/]*\.mheducation\.com\//;
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function logError(error) {
    console.error("[Auto-McGraw]", error);
  }

  function inBackground(task) {
    task.catch(logError);
  }

  messaging.handle(MessageType.ASK_QUESTION, (message, sender) => {
    if (!sender.tab) {
      return { ok: false, error: "Questions must come from a tab." };
    }
    inBackground(relay.enqueueQuestion(message, sender.tab));
  });

  messaging.handle(MessageType.ASSISTANT_ANSWER, (message, sender) => {
    inBackground(relay.forwardAnswer(message, sender.tab));
  });

  messaging.handle(MessageType.ASSISTANT_ERROR, (message, sender) => {
    inBackground(relay.forwardError(message, sender.tab));
  });

  // Question images often live on a CDN the page can't fetch with CORS; the
  // worker's host permissions can. Only McGraw Hill tabs may ask.
  messaging.handle(MessageType.FETCH_IMAGE, async ({ url }, sender) => {
    if (!IMAGE_SOURCE_TAB.test(sender.tab?.url || "")) {
      return { ok: false, error: "Image requests must come from McGraw Hill." };
    }
    if (!/^https?:\/\//.test(url || "")) {
      return { ok: false, error: `Unsupported image URL: ${url}` };
    }

    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      return { ok: false, error: `Image fetch failed (${response.status}): ${url}` };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Image too large to attach: ${url}` };
    }
    const type = response.headers.get("content-type") || "image/png";
    return { ok: true, dataUrl: `data:${type};base64,${toBase64(buffer)}` };
  });

  // Settings popup "Test" button: one tiny question through the chosen API.
  messaging.handle(MessageType.TEST_PROVIDER, async (message, sender) => {
    if (sender.tab) return { ok: false, error: "Not available from a tab." };
    const started = Date.now();
    try {
      const reply = await apiClient.ask(await settings.load(), {
        prompt:
          'Type: multiple_choice\nQuestion: What is 2 + 2?\nOptions:\n1. 3\n2. 4\n3. 5\n\nYour answer must EXACTLY match one of the above options.\n\nReply with the JSON object only.',
      });
      return { ok: true, answer: reply.answer, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  messaging.handle(MessageType.OPEN_SETTINGS, async () => {
    await chrome.windows.create({
      url: chrome.runtime.getURL("popup/settings.html"),
      type: "popup",
      ...SETTINGS_WINDOW,
    });
  });

  messaging.handle(MessageType.OPEN_DUPLICATE, (message, sender) =>
    doubleCredit.open(message, sender.tab)
  );

  messaging.handle(MessageType.CLAIM_DUPLICATE, (message, sender) =>
    doubleCredit.claim(sender.tab)
  );

  messaging.handle(MessageType.DUPLICATE_FINISHED, (message, sender) => {
    inBackground(doubleCredit.finish(message, sender.tab));
  });

  messaging.handle(MessageType.CANCEL_DUPLICATE, () => doubleCredit.cancel());

  chrome.tabs.onRemoved.addListener((tabId) => {
    inBackground(doubleCredit.handleTabRemoved(tabId));
  });
})();
