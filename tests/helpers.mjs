// Loads the extension's plain scripts into this Node process with a small
// in-memory stand-in for the chrome.* APIs they use.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1x1 transparent PNG.
export const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function storageArea(data, name, listeners) {
  return {
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = Array.isArray(keys) || typeof keys === "string" ? {} : { ...keys };
      list.forEach((key) => {
        if (key in data) out[key] = structuredClone(data[key]);
      });
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { newValue: value };
        data[key] = structuredClone(value);
      }
      listeners.forEach((listener) => listener(changes, name));
    },
    async remove(keys) {
      [].concat(keys).forEach((key) => delete data[key]);
    },
  };
}

export function loadScripts(files) {
  const storage = { local: {}, sync: {} };
  const listeners = [];
  globalThis.chrome = {
    runtime: { id: "test", onMessage: { addListener() {} }, getManifest: () => ({ version: "test" }) },
    storage: {
      local: storageArea(storage.local, "local", listeners),
      sync: storageArea(storage.sync, "sync", listeners),
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
  };
  for (const file of files) {
    vm.runInThisContext(readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
  }
  return { AutoMcGraw: globalThis.AutoMcGraw, storage };
}
