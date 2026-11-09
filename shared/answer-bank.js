(() => {
  // Remembers answers SmartBook has graded, so repeat questions are answered
  // instantly without the AI. Entries live in chrome.storage.local under
  // "bank:<sha256>", keyed by question type + text + options (+ images).
  const PREFIX = "bank:";
  const EXPORT_FORMAT = "auto-mcgraw-answer-bank";
  const TRUSTED_SOURCES = new Set(["verified", "correction"]);

  function normalize(value) {
    return String(value ?? "")
      .replace(/ /g, " ")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.$/, "")
      .toLowerCase();
  }

  // Option order is shuffled between visits, so sort it. Matching prompts and
  // ordering items are sorted too: the stored answer names them explicitly.
  function optionParts(options) {
    if (Array.isArray(options)) return [options.map(normalize).sort()];
    if (options && typeof options === "object") {
      return [
        (options.prompts || []).map(normalize).sort(),
        (options.choices || []).map(normalize).sort(),
      ];
    }
    return [];
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }

  function keyFor({ type, question, options }, imageSources = []) {
    const material = JSON.stringify([
      type || "",
      normalize(question),
      ...optionParts(options),
      imageSources.map((src) => src.split(/[?#]/)[0]).sort(),
    ]);
    return sha256(material);
  }

  function isTrusted(entry) {
    return Boolean(entry) && TRUSTED_SOURCES.has(entry.source);
  }

  async function get(key) {
    const storageKey = PREFIX + key;
    const { [storageKey]: entry } = await chrome.storage.local.get(storageKey);
    return entry || null;
  }

  async function lookup(key) {
    const entry = await get(key);
    return isTrusted(entry) ? entry : null;
  }

  async function record(key, { type, question, options, answer, source }) {
    if (answer === null || answer === undefined) return null;
    const existing = await get(key);
    const now = Date.now();
    const entry = {
      key,
      type,
      question,
      options,
      answer,
      source,
      hits: existing?.hits || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await chrome.storage.local.set({ [PREFIX + key]: entry });
    return entry;
  }

  async function recordUse(key) {
    const entry = await get(key);
    if (!entry) return;
    entry.hits = (entry.hits || 0) + 1;
    entry.lastUsedAt = Date.now();
    await chrome.storage.local.set({ [PREFIX + key]: entry });
  }

  async function forget(key) {
    await chrome.storage.local.remove(PREFIX + key);
  }

  async function all() {
    const items = await chrome.storage.local.get(null);
    return Object.entries(items)
      .filter(([storageKey]) => storageKey.startsWith(PREFIX))
      .map(([, entry]) => entry);
  }

  async function stats() {
    const entries = await all();
    return {
      total: entries.length,
      trusted: entries.filter(isTrusted).length,
      hits: entries.reduce((sum, entry) => sum + (entry.hits || 0), 0),
    };
  }

  async function exportAll() {
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: await all(),
    };
  }

  // Merges an export into the bank. Trusted entries win over untrusted ones,
  // and for two trusted entries the more recently updated one wins.
  async function importAll(data) {
    const entries = Array.isArray(data) ? data : data?.entries;
    if (!Array.isArray(entries)) {
      throw new Error("That file isn't an Auto-McGraw answer bank export.");
    }

    const valid = entries.filter(
      (entry) =>
        entry &&
        typeof entry.key === "string" &&
        /^[0-9a-f]{64}$/.test(entry.key) &&
        entry.answer !== undefined &&
        TRUSTED_SOURCES.has(entry.source)
    );

    const existing = await chrome.storage.local.get(
      valid.map((entry) => PREFIX + entry.key)
    );
    const updates = {};
    valid.forEach((entry) => {
      const current = existing[PREFIX + entry.key];
      if (
        !isTrusted(current) ||
        (entry.updatedAt || 0) > (current.updatedAt || 0)
      ) {
        updates[PREFIX + entry.key] = entry;
      }
    });
    await chrome.storage.local.set(updates);
    return { imported: Object.keys(updates).length, skipped: entries.length - Object.keys(updates).length };
  }

  async function clear() {
    const entries = await all();
    await chrome.storage.local.remove(entries.map((entry) => PREFIX + entry.key));
  }

  function subscribe(listener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (Object.keys(changes).some((key) => key.startsWith(PREFIX))) {
        listener();
      }
    });
  }

  AutoMcGraw.answerBank = {
    keyFor,
    lookup,
    record,
    recordUse,
    forget,
    stats,
    exportAll,
    importAll,
    clear,
    subscribe,
  };
})();
