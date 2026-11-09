(() => {
  const RESPONSE_TIMEOUT_MS = 180000;
  const SETTLE_MS = 5000;
  // Streaming fires a mutation per token; checking that often re-reads the
  // whole reply each time and slows long chats down.
  const CHECK_THROTTLE_MS = 200;

  function parseObject(candidate) {
    for (const attempt of [candidate, candidate.replace(/\n\s*/g, " ")]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function findClosingBrace(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }

    return -1;
  }

  function hasUsableAnswer(parsed) {
    if (!parsed || !("answer" in parsed)) return false;
    const { answer } = parsed;
    if (answer === null || answer === undefined) return false;
    if (typeof answer === "string") return answer.trim() !== "";
    if (Array.isArray(answer)) return answer.length > 0;
    return true;
  }

  function findAnswerJson(text) {
    if (typeof text !== "string" || !text.includes("{")) return null;

    const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
    for (
      let start = cleaned.indexOf("{");
      start !== -1;
      start = cleaned.indexOf("{", start + 1)
    ) {
      const end = findClosingBrace(cleaned, start);
      if (end === -1) continue;

      const parsed = parseObject(cleaned.slice(start, end + 1));
      if (hasUsableAnswer(parsed)) return JSON.stringify(parsed);
    }

    return null;
  }

  function extractAnswer(node) {
    const blocks = Array.from(node.querySelectorAll("pre code, pre"));
    const isJsonBlock = (block) => /json/i.test(block.className);
    blocks.sort((a, b) => Number(isJsonBlock(b)) - Number(isJsonBlock(a)));

    for (const block of blocks) {
      const answer = findAnswerJson(block.textContent);
      if (answer) return answer;
    }

    return findAnswerJson(node.textContent);
  }

  function snapshot(nodes, getNodeId, userMessageCount = 0) {
    const last = nodes[nodes.length - 1] || null;
    return {
      nodes: new WeakSet(nodes),
      ids: new Set(nodes.map((node) => getNodeId(node)).filter(Boolean)),
      lastText: last ? last.textContent : null,
      userMessageCount,
    };
  }

  function isNewResponse(taken, node, getNodeId) {
    const id = getNodeId(node);
    if (id) return !taken.ids.has(id);
    if (taken.nodes.has(node)) return false;
    return taken.lastText === null || node.textContent !== taken.lastText;
  }

  function scrollToBottom(node) {
    node.scrollIntoView?.({ block: "end" });
    for (
      let element = node.parentElement;
      element && element !== document.documentElement;
      element = element.parentElement
    ) {
      const { overflowY } = getComputedStyle(element);
      if (
        /(auto|scroll)/.test(overflowY) &&
        element.scrollHeight > element.clientHeight
      ) {
        element.scrollTop = element.scrollHeight;
      }
    }
  }

  // Where the response sits relative to the question we just sent: a reply
  // after it is ours, one before it is an old answer. "unknown" when the
  // site's user messages can't be found or wrap the reply.
  function positionAfterPrompt(taken, node, getUserMessages) {
    const users = getUserMessages?.() || [];
    if (users.length <= taken.userMessageCount) return "unknown";
    const sent = users[users.length - 1];
    const position = sent.compareDocumentPosition(node);
    if (position & Node.DOCUMENT_POSITION_CONTAINS) return "unknown";
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return "after";
    return "before";
  }

  function isAnswerCandidate(taken, node, getNodeId, getUserMessages) {
    const position = positionAfterPrompt(taken, node, getUserMessages);
    if (position !== "unknown") return position === "after";
    return isNewResponse(taken, node, getNodeId);
  }

  function watch({
    snapshot: taken,
    getResponses,
    getUserMessages,
    getNodeId,
    isGenerating,
    onAnswer,
    onTimeout,
  }) {
    const startedAt = Date.now();
    let finished = false;
    let candidate = null;
    let candidateSince = 0;
    let lastCheck = 0;
    let scheduled = null;

    const observer = new MutationObserver(schedule);
    const intervalId = setInterval(tick, 1000);

    function schedule() {
      if (finished || scheduled) return;
      const pause = Math.max(0, lastCheck + CHECK_THROTTLE_MS - Date.now());
      scheduled = setTimeout(() => {
        scheduled = null;
        check();
      }, pause);
    }

    function tick() {
      const nodes = getResponses();
      if (nodes.length > 0) scrollToBottom(nodes[nodes.length - 1]);
      check();
    }

    function stop() {
      finished = true;
      observer.disconnect();
      clearInterval(intervalId);
      clearTimeout(scheduled);
    }

    function check() {
      if (finished) return;
      lastCheck = Date.now();

      const nodes = getResponses();
      const latest = nodes[nodes.length - 1];
      if (
        latest &&
        isAnswerCandidate(taken, latest, getNodeId, getUserMessages)
      ) {
        const answer = extractAnswer(latest);
        if (answer) {
          if (answer !== candidate) {
            candidate = answer;
            candidateSince = Date.now();
          }
          if (
            !isGenerating(latest) ||
            Date.now() - candidateSince > SETTLE_MS
          ) {
            stop();
            onAnswer(JSON.parse(answer));
            return;
          }
        }
      }

      if (Date.now() - startedAt > RESPONSE_TIMEOUT_MS) {
        stop();
        onTimeout();
      }
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    check();

    return { stop };
  }

  AutoMcGraw.assistantResponse = { snapshot, watch };
})();
