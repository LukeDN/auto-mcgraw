(() => {
  // Direct API / local-model providers. "kind" picks the wire format in
  // background/api-client.js; everything else is a user-editable default.
  const PROVIDERS = Object.freeze({
    openai: Object.freeze({
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      needsKey: true,
      keyPlaceholder: "sk-...",
    }),
    anthropic: Object.freeze({
      name: "Claude",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-opus-5-5",
      needsKey: true,
      keyPlaceholder: "sk-ant-...",
    }),
    gemini: Object.freeze({
      name: "Gemini API",
      kind: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      needsKey: true,
      keyPlaceholder: "AIza...",
    }),
    ollama: Object.freeze({
      name: "Ollama",
      kind: "openai",
      baseUrl: "http://localhost:11434/v1",
      // qwen3:14b answered 8/8 on a SmartBook-style test (~10 s/question,
      // thinking off) on a 16 GB M4; it can't see images, so those go to the
      // smaller vision model.
      model: "qwen3:14b",
      visionModel: "qwen2.5vl:7b",
      needsKey: false,
      local: true,
    }),
    lmstudio: Object.freeze({
      name: "LM Studio",
      kind: "openai",
      baseUrl: "http://localhost:1234/v1",
      model: "",
      needsKey: false,
      local: true,
    }),
    custom: Object.freeze({
      name: "OpenAI-compatible",
      kind: "openai",
      baseUrl: "",
      model: "",
      needsKey: false,
      keyPlaceholder: "Optional",
    }),
  });

  const DEFAULT_ID = "openai";
  const KEYS_STORAGE = "apiKeys";

  function get(id) {
    return PROVIDERS[id] || PROVIDERS[DEFAULT_ID];
  }

  function idOf(id) {
    return PROVIDERS[id] ? id : DEFAULT_ID;
  }

  // Merge the preset with the user's overrides from settings.apiConfig.
  function resolve(settings) {
    const id = idOf(settings.apiProvider);
    const preset = get(id);
    const overrides = settings.apiConfig?.[id] || {};
    return {
      id,
      ...preset,
      baseUrl: (overrides.baseUrl || preset.baseUrl || "").replace(/\/+$/, ""),
      model: overrides.model || preset.model || "",
      // Optional second model for questions with images, so a stronger
      // text-only local model can handle everything else.
      visionModel: overrides.visionModel || preset.visionModel || "",
      // Local "thinking" models (e.g. qwen3) reason before answering: more
      // accurate on hard questions but ~20x slower. Off unless turned on.
      thinking: Boolean(overrides.thinking),
    };
  }

  function usesApi(settings) {
    return settings?.answerSource === "api";
  }

  // What the toolbar button says: "Ask ChatGPT" or "Ask Claude (API)".
  function label(settings) {
    if (!usesApi(settings)) {
      return AutoMcGraw.assistants.get(settings?.aiModel).name;
    }
    const provider = resolve(settings);
    return provider.local ? provider.name : `${provider.name} (API)`;
  }

  // API keys stay on this device (storage.local), never in synced settings.
  async function loadKey(id) {
    const { [KEYS_STORAGE]: keys } = await chrome.storage.local.get(
      KEYS_STORAGE
    );
    return keys?.[id] || "";
  }

  async function saveKey(id, key) {
    const { [KEYS_STORAGE]: keys = {} } = await chrome.storage.local.get(
      KEYS_STORAGE
    );
    const next = { ...keys };
    if (key) next[id] = key;
    else delete next[id];
    await chrome.storage.local.set({ [KEYS_STORAGE]: next });
  }

  AutoMcGraw.apiProviders = {
    list: PROVIDERS,
    DEFAULT_ID,
    get,
    resolve,
    usesApi,
    label,
    loadKey,
    saveKey,
  };
})();
