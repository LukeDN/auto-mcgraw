(() => {
  const { answerBank } = AutoMcGraw;

  const SETTINGS_WINDOW = { width: 440, height: 720 };

  const totalElement = document.getElementById("bank-total");
  const hitsElement = document.getElementById("bank-hits");
  const statusElement = document.getElementById("bank-status");
  const exportButton = document.getElementById("bank-export");
  const importButton = document.getElementById("bank-import");
  const clearButton = document.getElementById("bank-clear");
  const fileInput = document.getElementById("bank-file");

  function logError(error) {
    console.error("[Auto-McGraw]", error);
  }

  function setStatus(state, message) {
    statusElement.dataset.state = state;
    statusElement.textContent = message;
  }

  async function renderStats() {
    const { total, hits } = await answerBank.stats();
    totalElement.textContent = String(total);
    hitsElement.textContent = String(hits);
    exportButton.disabled = total === 0;
    clearButton.disabled = total === 0;
  }

  // Chrome closes the toolbar popup when a file dialog opens, which would
  // drop the import. Move to a standalone settings window first.
  function isToolbarPopup() {
    try {
      return chrome.extension.getViews({ type: "popup" }).includes(window);
    } catch {
      return false;
    }
  }

  async function exportBank() {
    const data = await answerBank.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `auto-mcgraw-answers-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    setStatus("current", `Exported ${data.entries.length} answers.`);
  }

  async function importBank(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("That file isn't valid JSON.");
    }
    const { imported, skipped } = await answerBank.importAll(data);
    setStatus(
      "current",
      `Imported ${imported} answer${imported === 1 ? "" : "s"}` +
        (skipped ? ` (${skipped} skipped as older or invalid).` : ".")
    );
  }

  exportButton.addEventListener("click", () => {
    exportBank().catch((error) => {
      logError(error);
      setStatus("error", "Export failed.");
    });
  });

  importButton.addEventListener("click", () => {
    if (isToolbarPopup()) {
      chrome.windows
        .create({
          url: chrome.runtime.getURL("popup/settings.html?bank=import"),
          type: "popup",
          ...SETTINGS_WINDOW,
        })
        .then(() => window.close())
        .catch(logError);
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    fileInput.value = "";
    if (!file) return;
    importBank(file).catch((error) => {
      logError(error);
      setStatus("error", error.message || "Import failed.");
    });
  });

  clearButton.addEventListener("click", () => {
    if (
      !confirm(
        "Delete every saved answer? Export first if you want to keep them."
      )
    ) {
      return;
    }
    answerBank
      .clear()
      .then(() => setStatus("current", "Answer bank cleared."))
      .catch((error) => {
        logError(error);
        setStatus("error", "Couldn't clear the answer bank.");
      });
  });

  if (new URLSearchParams(location.search).get("bank") === "import") {
    setStatus("available", "Click Import to choose your answer bank file.");
    document.getElementById("bank-heading").scrollIntoView();
  }

  answerBank.subscribe(() => renderStats().catch(logError));
  renderStats().catch(logError);
})();
