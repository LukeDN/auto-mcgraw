(() => {
  const { wait } = AutoMcGraw;

  async function send(
    tabId,
    message,
    { attempts = 3, retryDelay = 1000 } = {}
  ) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (error) {
        if (attempt >= attempts) throw error;
        await wait.delay(retryDelay);
      }
    }
  }

  async function get(tabId) {
    if (typeof tabId !== "number") return null;
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  async function activate(tabId) {
    try {
      await chrome.tabs.update(tabId, { active: true });
      return true;
    } catch {
      return false;
    }
  }

  async function close(tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      return;
    }
  }

  // Waits for a tab to finish loading, reloading it first if Chrome's memory
  // saver discarded it. Returns false if it never becomes ready.
  async function ensureLoaded(tabId, { timeout = 20000 } = {}) {
    let tab = await get(tabId);
    if (!tab) return false;
    if (tab.discarded) {
      try {
        await chrome.tabs.reload(tabId);
      } catch {
        return false;
      }
    }

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      tab = await get(tabId);
      if (!tab) return false;
      if (tab.status === "complete" && !tab.discarded) return true;
      await wait.delay(250);
    }
    return false;
  }

  async function findByMatch(match) {
    const found = await chrome.tabs.query({ url: match });
    found.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return found[0] || null;
  }

  AutoMcGraw.tabs = { send, get, activate, close, ensureLoaded, findByMatch };
})();
