(() => {
  const { settings, apiProviders, MessageType } = AutoMcGraw;

  const SAVE_DEBOUNCE_MS = 400;
  const SETTINGS_WINDOW = { width: 440, height: 720 };
  const HINTS = {
    openai:
      "Get a key at platform.openai.com/api-keys. Any chat model name works.",
    anthropic:
      "Get a key at console.anthropic.com. claude-opus-5-5 is the most capable; claude-haiku-5-5 is much faster and cheaper.",
    gemini: "Get a key at aistudio.google.com/apikey.",
    ollama:
      'Install Ollama, run "ollama pull qwen3:14b" (main model) and "ollama pull qwen2.5vl:7b" (reads question images), and keep Ollama running. If the test gets a 403, start it with OLLAMA_ORIGINS="chrome-extension://*".',
    lmstudio:
      "Load a model in LM Studio, start its local server (Developer tab), and enter the model's identifier here.",
    custom:
      "Any OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1 or https://api.groq.com/openai/v1.",
  };
  // Origins already granted in manifest.json host_permissions.
  const BUILT_IN_ORIGINS = [
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://generativelanguage.googleapis.com",
    "http://localhost",
    "http://127.0.0.1",
  ];

  const sourceInputs = Array.from(
    document.querySelectorAll('input[name="answer-source"]')
  );
  const panel = document.getElementById("api-panel");
  const assistantSection = document
    .getElementById("assistant-heading")
    .closest("section");
  const providerSelect = document.getElementById("api-provider");
  const modelInput = document.getElementById("api-model");
  const thinkingField = document.getElementById("api-thinking-field");
  const thinkingInput = document.getElementById("api-thinking");
  const visionField = document.getElementById("api-vision-field");
  const visionInput = document.getElementById("api-vision-model");
  const baseUrlField = document.getElementById("api-base-field");
  const baseUrlInput = document.getElementById("api-base-url");
  const keyField = document.getElementById("api-key-field");
  const keyInput = document.getElementById("api-key");
  const hint = document.getElementById("api-hint");
  const status = document.getElementById("api-status");
  const testButton = document.getElementById("api-test");

  const timers = {};

  function logError(error) {
    console.error("[Auto-McGraw]", error);
  }

  function debounce(name, task) {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => task().catch(logError), SAVE_DEBOUNCE_MS);
  }

  function setStatus(state, message) {
    status.dataset.state = state;
    status.textContent = message;
  }

  async function render() {
    const values = await settings.load();
    const api = apiProviders.usesApi(values);
    sourceInputs.forEach((input) => {
      input.checked = input.value === (api ? "api" : "web");
    });
    panel.hidden = !api;
    assistantSection.dataset.dimmed = String(api);

    const provider = apiProviders.resolve(values);
    const preset = apiProviders.get(provider.id);
    const overrides = values.apiConfig?.[provider.id] || {};
    providerSelect.value = provider.id;

    // Leave inputs the user is typing in alone.
    if (document.activeElement !== modelInput) {
      modelInput.value = overrides.model || "";
    }
    modelInput.placeholder = preset.model || "Model name";

    const editableUrl = preset.local || provider.id === "custom";
    // Hosted models read images themselves; local setups often pair a
    // strong text model with a smaller vision model.
    visionField.hidden = !editableUrl;
    thinkingField.hidden = !preset.local;
    thinkingInput.checked = Boolean(overrides.thinking);
    if (document.activeElement !== visionInput) {
      visionInput.value = overrides.visionModel || "";
    }
    visionInput.placeholder =
      preset.visionModel || "Same as the main model";
    baseUrlField.hidden = !editableUrl;
    if (document.activeElement !== baseUrlInput) {
      baseUrlInput.value = overrides.baseUrl || "";
    }
    baseUrlInput.placeholder = preset.baseUrl || "https://…/v1";

    keyField.hidden = Boolean(preset.local);
    keyInput.placeholder = preset.keyPlaceholder || "";
    if (document.activeElement !== keyInput) {
      keyInput.value = await apiProviders.loadKey(provider.id);
    }

    hint.textContent = HINTS[provider.id] || "";
  }

  async function saveOverride(field, value) {
    const values = await settings.load();
    const id = values.apiProvider;
    const apiConfig = { ...(values.apiConfig || {}) };
    const entry = { ...(apiConfig[id] || {}) };
    if (value) entry[field] = value;
    else delete entry[field];
    apiConfig[id] = entry;
    await settings.save({ apiConfig });
  }

  function isToolbarPopup() {
    try {
      return chrome.extension.getViews({ type: "popup" }).includes(window);
    } catch {
      return false;
    }
  }

  // Custom endpoints need a host permission, granted from a user click.
  async function ensureAccess(baseUrl) {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error("The base URL isn't a valid web address.");
    }
    const origin = `${url.protocol}//${url.hostname}`;
    if (BUILT_IN_ORIGINS.includes(origin)) return true;

    const pattern = `${origin}/*`;
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;

    // Chrome closes the toolbar popup when the permission prompt opens.
    if (isToolbarPopup()) {
      await chrome.windows.create({
        url: chrome.runtime.getURL("popup/settings.html?api=test"),
        type: "popup",
        ...SETTINGS_WINDOW,
      });
      window.close();
      return false;
    }

    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      throw new Error(`Auto-McGraw needs permission to reach ${origin}.`);
    }
    return true;
  }

  async function testConnection() {
    testButton.disabled = true;
    setStatus("checking", "Testing…");
    try {
      const provider = apiProviders.resolve(await settings.load());
      if (provider.baseUrl && !(await ensureAccess(provider.baseUrl))) return;

      const result = await chrome.runtime.sendMessage({
        type: MessageType.TEST_PROVIDER,
      });
      if (result?.ok) {
        const answer = [].concat(result.answer).join(", ");
        setStatus(
          "current",
          `Working. ${provider.name} answered "${answer}" in ${(
            result.ms / 1000
          ).toFixed(1)}s.`
        );
      } else {
        setStatus("error", result?.error || "The test failed.");
      }
    } catch (error) {
      setStatus("error", error.message || String(error));
    } finally {
      testButton.disabled = false;
    }
  }

  sourceInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        settings.save({ answerSource: input.value }).catch(logError);
      }
    });
  });

  providerSelect.addEventListener("change", () => {
    setStatus("checking", "");
    settings.save({ apiProvider: providerSelect.value }).catch(logError);
  });

  modelInput.addEventListener("input", () => {
    debounce("model", () => saveOverride("model", modelInput.value.trim()));
  });

  thinkingInput.addEventListener("change", () => {
    saveOverride("thinking", thinkingInput.checked).catch(logError);
  });

  visionInput.addEventListener("input", () => {
    debounce("visionModel", () =>
      saveOverride("visionModel", visionInput.value.trim())
    );
  });

  baseUrlInput.addEventListener("input", () => {
    debounce("baseUrl", () =>
      saveOverride("baseUrl", baseUrlInput.value.trim())
    );
  });

  keyInput.addEventListener("input", () => {
    const id = providerSelect.value;
    debounce("key", () => apiProviders.saveKey(id, keyInput.value.trim()));
  });

  testButton.addEventListener("click", () => {
    // Flush pending edits so the test uses what's on screen.
    Object.values(timers).forEach(clearTimeout);
    Promise.all([
      saveOverride("model", modelInput.value.trim()),
      saveOverride("visionModel", visionInput.value.trim()),
      saveOverride("baseUrl", baseUrlInput.value.trim()),
      apiProviders.saveKey(providerSelect.value, keyInput.value.trim()),
    ])
      .then(testConnection)
      .catch((error) => setStatus("error", error.message || String(error)));
  });

  if (new URLSearchParams(location.search).get("api") === "test") {
    setStatus("available", "Click Test Connection to grant access and test.");
  }

  settings.subscribe(() => render().catch(logError));
  render().catch(logError);
})();
