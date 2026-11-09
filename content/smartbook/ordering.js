(() => {
  const { text, wait, dom } = AutoMcGraw;
  const { KEYS, pressKey } = dom;

  // SmartBook "sortable" (ordering) questions: a vertical list of
  // .choice-item elements. Each is draggable and also a Pragmatic drop target.
  // The page's keyboard help: SPACE picks up/drops, UP/DOWN move, ESC cancels.
  const ITEM = ".sortable-component .choice-item, .vertical-list .choice-item";
  const MAX_PASSES = 3;
  const LOG_PREFIX = "[Auto-McGraw]";

  function items(container) {
    return Array.from(container.querySelectorAll(ITEM));
  }

  function itemText(item) {
    const content = item.querySelector(".content") || item;
    return text.normalizeChoiceText(text.readableText(content));
  }

  function readItems(container) {
    return items(container).map(itemText).filter(Boolean);
  }

  function currentOrder(container) {
    return items(container).map(itemText);
  }

  // A single-string answer may list items separated by newlines, ";" or
  // "->". Items can contain ";" themselves, so try the splits from least to
  // most aggressive and keep the first that accounts for every item.
  function candidateLists(values) {
    if (values.length !== 1) return [values];
    const split = (pattern) =>
      values[0]
        .split(pattern)
        .map((part) => part.trim())
        .filter(Boolean);
    return [values, split(/\n/), split(/\s*->\s*/), split(/\n|;/)];
  }

  function orderFrom(choices, values) {
    const order = [];

    values.forEach((value) => {
      const index = text.findChoiceIndex(choices, value);
      if (index !== -1 && !order.includes(index)) order.push(index);
    });

    // One item left out is unambiguous: it goes last.
    if (
      choices.length > 2 &&
      values.length >= choices.length - 1 &&
      order.length === choices.length - 1
    ) {
      order.push(choices.findIndex((_, index) => !order.includes(index)));
    }
    if (order.length !== choices.length) return null;
    return order.map((index) => choices[index]);
  }

  // Resolve the AI's answer to a full ordering of the current item texts.
  function resolveOrder(container, raw) {
    const choices = readItems(container);
    for (const values of candidateLists(text.flattenAnswerValues(raw))) {
      const order = orderFrom(choices, values);
      if (order) return order;
    }
    return null;
  }

  function describe(container, raw) {
    const order = resolveOrder(container, raw);
    if (order) return order.map((choice, index) => `${index + 1}. ${choice}`);
    return text.dedupeAnswers(text.flattenAnswerValues(raw));
  }

  function positionOf(container, target) {
    return currentOrder(container).findIndex((choice) =>
      text.isAnswerMatch(choice, target)
    );
  }

  function landedAt(container, target, position, pace) {
    return wait.waitFor(() => positionOf(container, target) === position, {
      timeout: 1500 * pace,
      interval: 50,
    });
  }

  // Keys go to whatever holds focus once the item is picked up, in case the
  // page moves focus or re-renders the item mid-move.
  function keyTarget(fallback) {
    const active = document.activeElement;
    return active && active !== document.body ? active : fallback;
  }

  async function moveWithKeyboard(container, target, position, pace) {
    const from = positionOf(container, target);
    if (from === -1) return false;
    if (from === position) return true;

    const item = items(container)[from];
    item.focus({ preventScroll: true });
    await wait.delay(50 * pace);

    pressKey(item, KEYS.space);
    await wait.delay(120 * pace);

    const direction = from > position ? KEYS.up : KEYS.down;
    for (let step = 0; step < Math.abs(from - position); step += 1) {
      pressKey(keyTarget(item), direction);
      await wait.delay(120 * pace);
    }

    pressKey(keyTarget(item), KEYS.space);
    if (await landedAt(container, target, position, pace)) return true;

    pressKey(keyTarget(item), KEYS.escape);
    await wait.delay(100 * pace);
    return false;
  }

  function center(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function dragEvent(type, point, dataTransfer) {
    return new DragEvent(type, {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
    });
  }

  // Fallback: native drag events (Pragmatic drag and drop). Dropping near the
  // top edge of the item currently at `position` inserts before it; near the
  // bottom edge inserts after it.
  async function moveWithDrag(container, target, position, pace) {
    const from = positionOf(container, target);
    if (from === -1) return false;
    if (from === position) return true;

    const list = items(container);
    const source = list[from];
    const anchor = list[position];
    const rect = anchor.getBoundingClientRect();
    const to = {
      x: rect.left + rect.width / 2,
      y: from > position ? rect.top + 2 : rect.bottom - 2,
    };

    let dataTransfer;
    try {
      dataTransfer = new DataTransfer();
    } catch {
      return false;
    }

    source.dispatchEvent(dragEvent("dragstart", center(source), dataTransfer));
    await wait.delay(120 * pace);
    anchor.dispatchEvent(dragEvent("dragenter", to, dataTransfer));
    for (let step = 0; step < 3; step += 1) {
      await wait.delay(50 * pace);
      anchor.dispatchEvent(dragEvent("dragover", to, dataTransfer));
    }
    await wait.delay(50 * pace);
    anchor.dispatchEvent(dragEvent("drop", to, dataTransfer));
    source.dispatchEvent(dragEvent("dragend", to, dataTransfer));

    return Boolean(await landedAt(container, target, position, pace));
  }

  function isOrdered(container, order) {
    const current = currentOrder(container);
    return (
      current.length === order.length &&
      order.every((choice, index) => text.isAnswerMatch(current[index], choice))
    );
  }

  async function apply(container, raw) {
    const order = resolveOrder(container, raw);
    if (!order) {
      console.warn(LOG_PREFIX, "Ordering answer was incomplete:", raw, {
        items: readItems(container),
      });
      return false;
    }

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      if (isOrdered(container, order)) return true;
      const pace = 1 + pass * 0.75;

      // Fill positions top-down; items above `position` are already final.
      for (let position = 0; position < order.length; position += 1) {
        const target = order[position];
        if (positionOf(container, target) === position) continue;

        const moved =
          (await moveWithKeyboard(container, target, position, pace)) ||
          (await moveWithDrag(container, target, position, pace));
        if (!moved) {
          console.warn(LOG_PREFIX, "Ordering move may not have completed:", {
            target,
            position,
            current: currentOrder(container),
          });
        }
      }
    }

    const ordered = isOrdered(container, order);
    if (!ordered) {
      console.warn(LOG_PREFIX, "Ordering diagnostics", {
        wanted: order,
        current: currentOrder(container),
      });
    }
    return ordered;
  }

  AutoMcGraw.ordering = { readItems, describe, apply };
})();
