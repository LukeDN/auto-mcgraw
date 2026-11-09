(() => {
  const { MessageType, messaging, wait, dom, assistants, assistantResponse } =
    AutoMcGraw;

  const IDLE_TIMEOUT_MS = 120000;
  const INPUT_TIMEOUT_MS = 10000;
  const SEND_BUTTON_TIMEOUT_MS = 3000;
  const SEND_CONFIRM_MS = 5000;
  const SEND_ATTEMPTS = 2;
  const UPLOAD_START_MS = 1500;
  const UPLOAD_TIMEOUT_MS = 45000;
  const UNSAFE_BUTTON_LABEL = /voice|dictat|speech|microphone|stop|cancel/i;
  const LOG_PREFIX = "[Auto-McGraw]";

  function isSendButton(button) {
    if (!dom.isEnabled(button)) return false;
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.textContent,
    ].join(" ");
    return !UNSAFE_BUTTON_LABEL.test(label);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toParagraphHtml(value) {
    return String(value)
      .split("\n")
      .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
      .join("");
  }

  function setComposerText(input, value) {
    input.focus();

    if (
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLInputElement
    ) {
      dom.setInputValue(input, value);
      return true;
    }

    if (input.isContentEditable) {
      input.innerHTML = toParagraphHtml(value);
      dom.dispatchInputEvents(input);
      return true;
    }

    return false;
  }

  function dataUrlToFile({ dataUrl, name }) {
    const [header, body = ""] = dataUrl.split(",");
    const type = header.match(/^data:([^;,]+)/)?.[1] || "image/png";
    let bytes;
    if (header.includes(";base64")) {
      const binary = atob(body);
      bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(body));
    }
    return new File([bytes], name || "image.png", { type });
  }

  // The composer that owns the message box, so buttons and file inputs come
  // from the chat on screen rather than one kept mounted in the background.
  function composerOf(input) {
    return input?.closest("form") || null;
  }

  function findFileInput(selectors, scope) {
    const fromRoot = (root) =>
      selectors.flatMap((selector) => dom.queryAll(selector, root));
    const scoped = scope ? fromRoot(scope) : [];
    const inputs = scoped.length > 0 ? scoped : fromRoot(document);
    return (
      inputs.find((input) => /image/i.test(input.accept || "")) ||
      inputs.find((input) => !input.accept) ||
      inputs[0] ||
      null
    );
  }

  // Prefer the composer's hidden file input; fall back to pasting, which
  // ChatGPT, Gemini and DeepSeek all accept for images.
  function attachFiles(composer, files, fileInputSelectors) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));

    const input = findFileInput(fileInputSelectors, composerOf(composer));
    if (input) {
      try {
        input.files = transfer.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return "file input";
      } catch (error) {
        console.warn(LOG_PREFIX, "File input attach failed:", error);
      }
    }

    composer.focus();
    composer.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      })
    );
    return "paste";
  }

  function getComposerText(input) {
    return typeof input.value === "string"
      ? input.value
      : input.textContent || "";
  }

  function register(id, adapter) {
    const { name } = assistants.get(id);
    const getMessageId = adapter.getMessageId || (() => null);
    const getResponses = () => dom.visibleOnly(adapter.getResponses());
    const isBusy = adapter.isBusy || (() => false);
    const isGenerating = adapter.isGenerating || (() => isBusy());
    const fileInputSelectors = adapter.fileInputSelectors || [
      'input[type="file"]',
    ];

    let generation = 0;
    let activeWatcher = null;
    let retired = false;

    // The relay re-injects these scripts when a ping fails. If an older copy
    // is still listening, both would send the question, so retire the old one.
    const live = (globalThis.__autoMcGrawBridges ||= {});
    live[id]?.retire();
    live[id] = {
      retire() {
        retired = true;
        generation += 1;
        activeWatcher?.stop();
        activeWatcher = null;
      },
    };

    // Only ever click a visible send button: a hidden one belongs to a chat
    // the user has left, and clicking it posts the question there.
    function findSendButton(input) {
      const usable = (button) => isSendButton(button) && dom.isVisible(button);
      const scope = composerOf(input);
      for (const root of scope ? [scope, document] : [document]) {
        for (const selector of adapter.sendSelectors) {
          const button = dom.queryAll(selector, root).find(usable);
          if (button) return button;
        }
      }

      const fallback = adapter.findFallbackSendButton?.();
      return usable(fallback) ? fallback : null;
    }

    function getUserMessages() {
      if (!adapter.userMessageSelector) return [];
      return dom.queryAll(adapter.userMessageSelector).filter(dom.isVisible);
    }

    function waitUntilSent(input, userMessages) {
      return wait.waitFor(
        () =>
          !getComposerText(input).trim() ||
          isBusy() ||
          getUserMessages().length > userMessages,
        { timeout: SEND_CONFIRM_MS }
      );
    }

    async function attachImages(input, images) {
      const files = images.map(dataUrlToFile);
      const method = attachFiles(input, files, fileInputSelectors);
      console.info(
        LOG_PREFIX,
        `Attached ${files.length} image(s) to ${name} via ${method}.`
      );
      // The send button is disabled while uploads are in flight; give the
      // upload a moment to start before trusting it.
      await wait.delay(UPLOAD_START_MS);
      const ready = await wait.waitFor(() => findSendButton(input), {
        timeout: UPLOAD_TIMEOUT_MS,
        interval: 300,
      });
      if (!ready) {
        console.warn(LOG_PREFIX, `${name} image upload didn't finish in time.`);
      }
    }

    async function sendPrompt(prompt, images = []) {
      const idle = await wait.waitFor(() => !isBusy(), {
        timeout: IDLE_TIMEOUT_MS,
        interval: 500,
      });
      if (!idle) {
        console.warn(LOG_PREFIX, `${name} still looks busy, sending anyway.`);
      }

      for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
        const input = await wait.waitFor(
          () => dom.queryFirstVisible(adapter.inputSelectors),
          { timeout: INPUT_TIMEOUT_MS }
        );
        if (!input) {
          throw new Error(`Could not find the ${name} message box.`);
        }

        const userMessages = getUserMessages().length;
        const taken = assistantResponse.snapshot(
          getResponses(),
          getMessageId,
          userMessages
        );

        if (!setComposerText(input, prompt)) {
          throw new Error(`Could not type into the ${name} message box.`);
        }
        // A failed send leaves attachments in the composer, so only attach once.
        if (attempt === 1 && images.length) {
          await attachImages(input, images);
        }

        const sendButton = await wait.waitFor(() => findSendButton(input), {
          timeout: SEND_BUTTON_TIMEOUT_MS,
        });
        if (sendButton) {
          sendButton.click();
        } else {
          dom.pressKey(input, dom.KEYS.enter);
        }

        let sent = await waitUntilSent(input, userMessages);
        if (!sent && sendButton) {
          dom.pressKey(input, dom.KEYS.enter);
          sent = await waitUntilSent(input, userMessages);
        }
        if (sent) return taken;
      }

      throw new Error(`${name} did not accept the message.`);
    }

    messaging.handle(MessageType.PING, () => ({ ok: true }));

    messaging.handle(
      MessageType.PROMPT_ASSISTANT,
      ({ prompt, images, requestId, replyTo }) => {
        if (retired) return;
        generation += 1;
        const current = generation;
        activeWatcher?.stop();
        activeWatcher = null;

        const reply = (message) =>
          messaging
            .send({ ...message, requestId, replyTo })
            .catch((error) =>
              console.error(LOG_PREFIX, "Could not reach the extension:", error)
            );

        sendPrompt(prompt, images || [])
          .then((taken) => {
            if (current !== generation) return;
            activeWatcher = assistantResponse.watch({
              snapshot: taken,
              getResponses,
              getUserMessages,
              getNodeId: getMessageId,
              isGenerating,
              onAnswer: (answer) => {
                activeWatcher = null;
                reply({ type: MessageType.ASSISTANT_ANSWER, answer });
              },
              onTimeout: () => {
                activeWatcher = null;
                reply({
                  type: MessageType.ASSISTANT_ERROR,
                  error: `No answer was detected from ${name} within 3 minutes.`,
                });
              },
            });
          })
          .catch((error) => {
            console.error(LOG_PREFIX, "Failed to send question:", error);
            reply({
              type: MessageType.ASSISTANT_ERROR,
              error: messaging.errorMessage(error),
            });
          });
      }
    );
  }

  AutoMcGraw.assistantBridge = { register };
})();
