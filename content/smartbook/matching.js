(() => {
  const { text, wait, dom } = AutoMcGraw;
  const { KEYS, pressKey } = dom;

  // ".choice-item-wrapper" is the older react-beautiful-dnd markup;
  // ".draggableItem" is the Pragmatic drag-and-drop markup SmartBook uses now.
  const ALL_CHOICES = [
    '.choice-item-wrapper:not(.-placeholder)[id^="choices:"]',
    '.choice-item-wrapper:not(.-placeholder)[id^="response:"]',
    ".draggableItem",
  ].join(", ");
  const POOL_CHOICES = [
    '.choices-container .choice-item-wrapper:not(.-placeholder)[id^="choices:"]',
    ".choices-container .draggableItem",
  ].join(", ");
  const ROW_CHOICE = [
    '.match-single-response-wrapper .choice-item-wrapper:not(.-placeholder)[id^="choices:"]',
    '.match-single-response-wrapper .choice-item-wrapper:not(.-placeholder)[id^="response:"]',
    ".match-single-response-wrapper .draggableItem",
  ].join(", ");
  const DROP_TARGET = "[data-drop-target-for-element]";
  const LOOSE_CHOICE = ".choice-item-wrapper:not(.-placeholder)";
  const DRAG_HANDLE = [
    "[data-react-beautiful-dnd-drag-handle]",
    "[data-rbd-drag-handle-draggable-id]",
    "[data-rfd-drag-handle-draggable-id]",
    '[aria-roledescription*="drag" i]',
  ].join(", ");
  const MAX_PASSES = 4;
  const LOG_PREFIX = "[Auto-McGraw]";

  const LIFT_KEYS = [KEYS.space, KEYS.enter];

  function component(container) {
    return container?.querySelector(".matching-component") || container || null;
  }

  function rows(container) {
    const root = component(container);
    if (!root) return [];
    const strict = root.querySelectorAll(".responses-container .match-row");
    return Array.from(strict.length ? strict : root.querySelectorAll(".match-row"));
  }

  function choiceItems(container, selector) {
    const root = component(container);
    return root ? Array.from(root.querySelectorAll(selector)) : [];
  }

  // Strict selectors first; if SmartBook's markup changed, fall back to
  // looser ones so the choices still reach the AI.
  function allChoiceItems(container) {
    for (const selector of [ALL_CHOICES, LOOSE_CHOICE, DRAG_HANDLE]) {
      const items = choiceItems(container, selector);
      if (items.length) return items;
    }
    return [];
  }

  function poolItems(container) {
    const strict = choiceItems(container, POOL_CHOICES);
    if (strict.length) return strict;
    return allChoiceItems(container).filter((item) => !item.closest(".match-row"));
  }

  function promptText(row, index) {
    const content =
      row.querySelector(".match-prompt .content") ||
      row.querySelector(".match-prompt");
    const value = content
      ? text.normalizeChoiceText(text.readableText(content))
      : "";
    // Image-only drop zones have no text; number them so the AI can refer to
    // them (the same numbers are drawn onto the attached image).
    return value || `Item ${index + 1}`;
  }

  function choiceText(item) {
    if (!item) return "";
    const content =
      item.querySelector(".dragItemContent") ||
      item.querySelector(".content") ||
      item.querySelector("p");
    return (
      text.normalizeChoiceText(text.readableText(content || item)) ||
      text.normalizeChoiceText(
        item.getAttribute("aria-label") || item.getAttribute("title") || ""
      )
    );
  }

  function rowChoice(row) {
    return (
      row.querySelector(ROW_CHOICE) ||
      row.querySelector(`.match-single-response-wrapper ${LOOSE_CHOICE}`) ||
      row.querySelector(LOOSE_CHOICE)
    );
  }

  function dropZone(row) {
    const wrapper = row.querySelector(".match-single-response-wrapper") || row;
    return wrapper.querySelector(DROP_TARGET) || wrapper;
  }

  // Pragmatic drag and drop runs on native HTML5 drag events, so the
  // react-beautiful-dnd keyboard and mouse tricks don't apply to it.
  function usesNativeDnd(container) {
    return Boolean(component(container)?.querySelector(DROP_TARGET));
  }

  function dropZoneMarkers(container) {
    return rows(container).map((row, index) => ({
      element: dropZone(row),
      label: String(index + 1),
    }));
  }

  function dragHandle(item) {
    if (item.matches(DRAG_HANDLE)) return item;
    // The handle may wrap the choice rather than sit inside it.
    return (
      item.querySelector(DRAG_HANDLE) ||
      item.closest(DRAG_HANDLE) ||
      item.querySelector('[draggable="true"]') ||
      item.closest('[draggable="true"]') ||
      item
    );
  }

  function locateChoice(container, target) {
    const matchRows = rows(container);
    for (let rowIndex = 0; rowIndex < matchRows.length; rowIndex += 1) {
      const item = rowChoice(matchRows[rowIndex]);
      if (item && text.isAnswerMatch(choiceText(item), target)) {
        return { area: "row", rowIndex, poolIndex: -1, item };
      }
    }

    const pool = poolItems(container);
    for (let poolIndex = 0; poolIndex < pool.length; poolIndex += 1) {
      if (text.isAnswerMatch(choiceText(pool[poolIndex]), target)) {
        return { area: "pool", rowIndex: -1, poolIndex, item: pool[poolIndex] };
      }
    }

    return null;
  }

  function readPrompts(container) {
    return rows(container).map((row, index) => promptText(row, index));
  }

  function readChoices(container) {
    return text.dedupeAnswers(
      allChoiceItems(container)
        .map((item) => choiceText(item))
        .filter(Boolean)
    );
  }

  function readOptions(container) {
    return {
      prompts: readPrompts(container),
      choices: readChoices(container),
    };
  }

  function numericReference(value, candidates) {
    const match = value.match(/^#?(\d+)$/);
    if (!match) return "";
    const index = Number(match[1]) - 1;
    return index >= 0 && index < candidates.length ? candidates[index] : "";
  }

  function resolveReference(reference, candidates, kind) {
    if (!candidates.length) return "";

    const normalized = text.normalizeChoiceText(String(reference || ""));
    if (!normalized) return "";

    const numbered = numericReference(normalized, candidates);
    if (numbered) return numbered;

    const prefix =
      kind === "prompt"
        ? /^(?:prompt|row|left)\s*#?\s*/i
        : /^(?:choice|option|item|right|match)\s*#?\s*/i;
    const stripped = normalized.replace(prefix, "").trim();

    const strippedNumbered = numericReference(stripped, candidates);
    if (strippedNumbered) return strippedNumbered;

    const variants = text
      .dedupeAnswers([stripped, text.stripWrappingQuotes(stripped)])
      .filter(Boolean);

    for (const variant of variants) {
      const exact = candidates.find((candidate) =>
        text.isAnswerMatch(candidate, variant)
      );
      if (exact) return exact;
    }

    for (const variant of variants) {
      const target = text.normalizeChoiceText(variant).toLowerCase();
      if (!target) continue;

      const lowered = candidates.map((candidate) =>
        text.normalizeChoiceText(candidate).toLowerCase()
      );

      const sameIndex = lowered.indexOf(target);
      if (sameIndex !== -1) return candidates[sameIndex];

      // Several candidates can share a prefix ("All the continents were
      // joined; ..."), so take the one closest in length, not the first.
      let partialIndex = -1;
      let bestGap = Infinity;
      lowered.forEach((candidate, index) => {
        if (!candidate) return;
        if (!candidate.includes(target) && !target.includes(candidate)) return;
        const gap = Math.abs(candidate.length - target.length);
        if (gap < bestGap) {
          bestGap = gap;
          partialIndex = index;
        }
      });
      if (partialIndex !== -1) return candidates[partialIndex];
    }

    return "";
  }

  const PAIR_DELIMITER = /->|=>/;

  // Choices often contain semicolons ("...joined; existed from 250 Ma"), so a
  // line is only split on ";" when every piece is its own "A -> B" pair.
  function splitLine(line) {
    const parts = line
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 1 && parts.every((part) => PAIR_DELIMITER.test(part))
      ? parts
      : [line];
  }

  function splitSegments(answerText) {
    const segments = [];

    answerText
      .split("\n")
      .flatMap(splitLine)
      .map((segment) => segment.trim().replace(text.LIST_MARKER, "").trim())
      .filter(Boolean)
      .forEach((segment) => {
        const delimiters = (segment.match(/->|=>|:/g) || []).length;
        if (segment.includes(",") && delimiters > 1) {
          segment
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => segments.push(part));
        } else {
          segments.push(segment);
        }
      });

    return segments;
  }

  function parsePair(segment) {
    let cleaned = segment.trim().replace(text.LIST_MARKER, "").trim();
    if (!/(?:->|=>|:)/.test(cleaned)) {
      cleaned = cleaned.replace(/^\d+[.)]\s+/, "").trim();
    }
    if (!cleaned) return null;

    const match =
      cleaned.match(/^(.*?)\s*(?:->|=>)\s*(.+)$/) ||
      cleaned.match(/^(.*?)\s*:\s*(.+)$/);
    return match
      ? { promptRef: match[1].trim(), choiceRef: match[2].trim() }
      : null;
  }

  function addLoose(output, value) {
    const cleaned = text.normalizeChoiceText(value);
    if (cleaned) output.loose.push(cleaned);
  }

  function collectEntries(raw, output) {
    if (raw === null || raw === undefined) return;

    if (Array.isArray(raw)) {
      raw.forEach((entry) => collectEntries(entry, output));
      return;
    }

    if (typeof raw === "object") {
      const promptRef =
        raw.prompt ?? raw.left ?? raw.source ?? raw.from ?? raw.key;
      const choiceRef =
        raw.choice ??
        raw.match ??
        raw.right ??
        raw.target ??
        raw.to ??
        raw.answer ??
        raw.value;

      if (promptRef !== undefined && choiceRef !== undefined) {
        output.pairs.push({
          promptRef: String(promptRef),
          choiceRef: String(choiceRef),
        });
        return;
      }

      Object.entries(raw).forEach(([key, value]) => {
        output.pairs.push({ promptRef: String(key), choiceRef: String(value) });
      });
      return;
    }

    if (typeof raw === "string") {
      const parsed = text.parseArrayString(raw);
      if (parsed) {
        collectEntries(parsed, output);
        return;
      }

      const segments = splitSegments(raw);
      if (!segments.length) {
        addLoose(output, raw);
        return;
      }

      segments.forEach((segment) => {
        const pair = parsePair(segment);
        if (pair) {
          output.pairs.push(pair);
        } else {
          addLoose(output, segment);
        }
      });
      return;
    }

    addLoose(output, String(raw));
  }

  function collect(raw) {
    const output = { pairs: [], loose: [] };
    collectEntries(raw, output);
    return output;
  }

  function resolveTargets(container, raw) {
    const prompts = readPrompts(container);
    const choices = readChoices(container);
    if (!prompts.length || !choices.length) return [];

    const { pairs, loose } = collect(raw);
    const targets = new Map();

    pairs.forEach(({ promptRef, choiceRef }) => {
      const prompt = resolveReference(promptRef, prompts, "prompt");
      const choice = resolveReference(choiceRef, choices, "choice");
      if (!prompt || !choice) return;

      const rowIndex = prompts.findIndex((candidate) =>
        text.isAnswerMatch(candidate, prompt)
      );
      if (rowIndex < 0 || targets.has(rowIndex)) return;
      // A choice can only sit in one row; a duplicate can never be satisfied.
      const taken = Array.from(targets.values()).some((used) =>
        text.isAnswerMatch(used, choice)
      );
      if (taken) return;
      targets.set(rowIndex, choice);
    });

    if (targets.size === 0 && loose.length === prompts.length) {
      const ordered = loose
        .map((reference) => resolveReference(reference, choices, "choice"))
        .filter(Boolean);
      if (ordered.length === prompts.length) {
        ordered.forEach((choice, rowIndex) => targets.set(rowIndex, choice));
      }
    }

    return prompts.map((prompt, rowIndex) => ({
      rowIndex,
      promptText: prompt,
      choiceText: targets.get(rowIndex) || "",
    }));
  }

  function describe(container, raw) {
    const resolved = resolveTargets(container, raw)
      .filter((target) => target.choiceText)
      .map((target) => `${target.promptText} -> ${target.choiceText}`);
    if (resolved.length) return resolved;

    const { pairs, loose } = collect(raw);
    const pairLines = pairs
      .map(({ promptRef, choiceRef }) => {
        const prompt = text.normalizeChoiceText(promptRef);
        const choice = text.normalizeChoiceText(choiceRef);
        return prompt && choice ? `${prompt} -> ${choice}` : "";
      })
      .filter(Boolean);

    return text.dedupeAnswers([...pairLines, ...loose]);
  }

  function snapshot(container) {
    return rows(container).map(
      (row, index) =>
        `${promptText(row, index)} -> ${choiceText(rowChoice(row))}`
    );
  }

  function isAligned(container, targets) {
    const matchRows = rows(container);
    if (!targets.length || matchRows.length !== targets.length) return false;

    return targets.every(
      (target, rowIndex) =>
        Boolean(target.choiceText) &&
        text.isAnswerMatch(
          choiceText(rowChoice(matchRows[rowIndex])),
          target.choiceText
        )
    );
  }

  // Once a drag starts, react-beautiful-dnd listens on window, and React may
  // re-mount the dragged element when it crosses lists. Keys sent to the
  // original handle can then land on a detached node, so they go to window.
  function pressDragKey(definition) {
    pressKey(window, definition);
  }

  function isLifted(item) {
    try {
      return getComputedStyle(item).position === "fixed";
    } catch {
      return false;
    }
  }

  async function cancelDrag(pace) {
    pressDragKey(KEYS.escape);
    await wait.delay(100 * pace);
  }

  async function moveChoice(container, target, targetRow, liftKey, pace) {
    const origin = locateChoice(container, target);
    if (!origin) return false;
    if (origin.rowIndex === targetRow) return true;

    // Clear any drag a previous attempt left half-finished.
    await cancelDrag(pace);

    const rowCount = rows(container).length;
    const handle = dragHandle(origin.item);
    try {
      handle.focus({ preventScroll: true });
    } catch {
      handle.focus();
    }
    await wait.delay(60 * pace);

    pressKey(handle, liftKey);
    // Best effort: dnd marks the lifted item position:fixed. If that signal
    // isn't present, fall through and rely on the timed delay.
    await wait.waitFor(() => isLifted(origin.item), {
      timeout: 400 * pace,
      interval: 30,
    });
    await wait.delay(80 * pace);

    // The DOM doesn't update mid-drag, so arrow presses are counted up front.
    let direction = KEYS.up;
    let steps;
    if (origin.area === "row") {
      const delta = targetRow - origin.rowIndex;
      steps = Math.abs(delta);
      if (delta > 0) direction = KEYS.down;
    } else {
      steps = origin.poolIndex + (rowCount - targetRow);
    }

    for (let step = 0; step < steps; step += 1) {
      pressDragKey(direction);
      await wait.delay(80 * pace);
    }

    pressDragKey(liftKey);
    const landed = await wait.waitFor(
      () => locateChoice(container, target)?.rowIndex === targetRow,
      { timeout: 1500 * pace, interval: 50 }
    );
    if (!landed) {
      await cancelDrag(pace);
      return false;
    }
    return true;
  }

  function center(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function mouseEvent(type, { x, y }, buttons) {
    return new MouseEvent(type, {
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    });
  }

  // Fallback for when keyboard dragging doesn't register: press on the
  // handle, move the pointer in small steps to the row, then release.
  async function moveChoiceWithMouse(container, target, targetRow, pace) {
    const origin = locateChoice(container, target);
    if (!origin) return false;
    if (origin.rowIndex === targetRow) return true;

    const row = rows(container)[targetRow];
    if (!row) return false;
    const zone = dropZone(row);

    await cancelDrag(pace);
    const handle = dragHandle(origin.item);
    handle.scrollIntoView?.({ block: "center" });
    await wait.delay(150 * pace);

    const from = center(handle);
    const to = center(zone);
    handle.dispatchEvent(mouseEvent("mousedown", from, 1));
    await wait.delay(60 * pace);

    const steps = 20;
    for (let step = 1; step <= steps; step += 1) {
      const point = {
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      };
      const under = document.elementFromPoint(point.x, point.y) || window;
      under.dispatchEvent(mouseEvent("mousemove", point, 1));
      window.dispatchEvent(mouseEvent("mousemove", point, 1));
      await wait.delay(20 * pace);
    }

    await wait.delay(80 * pace);
    window.dispatchEvent(mouseEvent("mouseup", to, 0));

    const landed = await wait.waitFor(
      () => locateChoice(container, target)?.rowIndex === targetRow,
      { timeout: 1500 * pace, interval: 50 }
    );
    if (!landed) await cancelDrag(pace);
    return Boolean(landed);
  }

  function dragEvent(type, point, dataTransfer) {
    let event;
    try {
      event = new DragEvent(type, {
        clientX: point.x,
        clientY: point.y,
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer,
      });
    } catch {
      event = new Event(type, { bubbles: true, cancelable: true });
    }
    if (!event.dataTransfer) {
      try {
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      } catch {
        return event;
      }
    }
    return event;
  }

  // Last resort for pages that use native HTML5 drag and drop.
  async function moveChoiceNative(container, target, targetRow, pace) {
    const origin = locateChoice(container, target);
    if (!origin) return false;
    if (origin.rowIndex === targetRow) return true;

    const row = rows(container)[targetRow];
    if (!row) return false;
    const dropTarget = dropZone(row);
    const source = dragHandle(origin.item);

    let dataTransfer;
    try {
      dataTransfer = new DataTransfer();
    } catch {
      return false;
    }

    source.scrollIntoView?.({ block: "nearest" });
    dropTarget.scrollIntoView?.({ block: "nearest" });
    await wait.delay(100 * pace);
    const from = center(source);
    const to = center(dropTarget);

    source.dispatchEvent(dragEvent("dragstart", from, dataTransfer));
    // Pragmatic starts the drag on the next animation frame.
    await wait.delay(120 * pace);
    source.dispatchEvent(dragEvent("drag", from, dataTransfer));
    dropTarget.dispatchEvent(dragEvent("dragenter", to, dataTransfer));
    for (let step = 0; step < 3; step += 1) {
      await wait.delay(50 * pace);
      dropTarget.dispatchEvent(dragEvent("dragover", to, dataTransfer));
    }
    await wait.delay(50 * pace);
    dropTarget.dispatchEvent(dragEvent("drop", to, dataTransfer));
    source.dispatchEvent(dragEvent("dragend", to, dataTransfer));

    return Boolean(
      await wait.waitFor(
        () => locateChoice(container, target)?.rowIndex === targetRow,
        { timeout: 1500 * pace, interval: 50 }
      )
    );
  }

  // Accessible fallback: the choices are role="button" with aria-pressed, so
  // the page supports select-then-place. Click the choice, then the zone.
  async function moveChoiceByClick(container, target, targetRow, pace) {
    const origin = locateChoice(container, target);
    if (!origin) return false;
    if (origin.rowIndex === targetRow) return true;

    const row = rows(container)[targetRow];
    if (!row) return false;
    const item = dragHandle(origin.item);
    const zone = dropZone(row);

    item.focus?.();
    item.click();
    await wait.delay(150 * pace);
    if (item.getAttribute("aria-pressed") !== "true") {
      pressKey(item, KEYS.enter);
      await wait.delay(150 * pace);
    }
    zone.click();

    const landed = await wait.waitFor(
      () => locateChoice(container, target)?.rowIndex === targetRow,
      { timeout: 1000 * pace, interval: 50 }
    );
    if (!landed && item.isConnected && item.getAttribute("aria-pressed") === "true") {
      pressKey(item, KEYS.escape);
    }
    return Boolean(landed);
  }

  async function placeTarget(container, target, pace) {
    if (usesNativeDnd(container)) {
      return (
        (await moveChoiceNative(
          container,
          target.choiceText,
          target.rowIndex,
          pace
        )) ||
        moveChoiceByClick(container, target.choiceText, target.rowIndex, pace)
      );
    }

    for (const liftKey of LIFT_KEYS) {
      const location = locateChoice(container, target.choiceText);
      if (!location) return false;
      if (location.rowIndex === target.rowIndex) return true;

      if (
        await moveChoice(
          container,
          target.choiceText,
          target.rowIndex,
          liftKey,
          pace
        )
      ) {
        return true;
      }
    }

    const location = locateChoice(container, target.choiceText);
    if (!location) return false;
    if (location.rowIndex === target.rowIndex) return true;
    if (
      await moveChoiceWithMouse(
        container,
        target.choiceText,
        target.rowIndex,
        pace
      )
    ) {
      return true;
    }
    return moveChoiceNative(container, target.choiceText, target.rowIndex, pace);
  }

  function dumpDiagnostics(container) {
    const root = component(container);
    console.warn(LOG_PREFIX, "Matching diagnostics", {
      foundComponent: Boolean(root),
      rows: rows(container).length,
      poolChoices: poolItems(container).length,
      allChoices: allChoiceItems(container).length,
      dragHandles: root ? root.querySelectorAll(DRAG_HANDLE).length : 0,
      dndMarkers: {
        rbdLegacy: document.querySelectorAll(
          "[data-react-beautiful-dnd-drag-handle]"
        ).length,
        rbd: document.querySelectorAll("[data-rbd-drag-handle-draggable-id]")
          .length,
        helloPangea: document.querySelectorAll(
          "[data-rfd-drag-handle-draggable-id]"
        ).length,
        nativeDraggable: document.querySelectorAll('[draggable="true"]')
          .length,
        pragmaticDropTargets: document.querySelectorAll(DROP_TARGET).length,
      },
      probeTypes: Array.from(
        container.querySelectorAll('[class*="awd-probe-type-"]'),
        (element) => element.className
      ),
      prompts: readPrompts(container),
      choices: readChoices(container),
      snapshot: snapshot(container),
    });
    const html = (root || container)?.outerHTML || "";
    console.warn(
      LOG_PREFIX,
      "Matching HTML (first 8000 chars):\n" + html.slice(0, 8000)
    );
  }

  async function apply(container, raw) {
    const targets = resolveTargets(container, raw);
    if (!targets.length || targets.some((target) => !target.choiceText)) {
      console.warn(LOG_PREFIX, "Matching answer was incomplete", targets);
      dumpDiagnostics(container);
      return false;
    }

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      if (isAligned(container, targets)) return true;
      // Slow down on each retry in case the page is lagging behind the keys.
      const pace = 1 + pass * 0.75;

      for (const target of targets) {
        if (!locateChoice(container, target.choiceText)) {
          console.warn(
            LOG_PREFIX,
            "Could not find matching choice:",
            target.choiceText,
            snapshot(container)
          );
          continue;
        }

        if (!(await placeTarget(container, target, pace))) {
          console.warn(
            LOG_PREFIX,
            "Matching move may not have completed:",
            `${target.promptText} -> ${target.choiceText}`,
            snapshot(container)
          );
        }
      }
    }

    await cancelDrag(1);
    const aligned = isAligned(container, targets);
    if (!aligned) dumpDiagnostics(container);
    return aligned;
  }

  AutoMcGraw.matching = { readOptions, describe, apply, dropZoneMarkers };
})();
