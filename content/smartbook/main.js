(() => {
  const {
    settings,
    automation,
    toolbar,
    questions,
    answers,
    doubleCredit,
    images,
    matching,
    answerBank,
    apiProviders,
  } = AutoMcGraw;

  const CONFIDENCE_LEVELS = [
    "high_confidence",
    "medium_confidence",
    "low_confidence",
  ];
  const STATE_TIMEOUT_MS = 15000;
  const NEXT_RETRY_MS = 3000;
  const SETTLE_TIMEOUT_MS = 2000;
  const FEEDBACK_TIMEOUT_MS = 1500;
  const WATCH_INTERVAL_MS = 100;
  const MANUAL_ANSWER_HINT =
    "Please answer this question yourself, then click a confidence button and Next. Automation will resume on the next question.";

  const REASK_ATTEMPTS = 1;
  const REASK_NOTE =
    "Your previous answer could not be matched to the options on the page. Reply again, copying one or more options exactly as written above.";

  let currentSettings = { ...settings.DEFAULTS };
  let pendingCorrection = null;

  // The AI's own 0-1 confidence picks the button when that setting is on.
  function levelFromConfidence(confidence) {
    if (confidence >= 0.8) return CONFIDENCE_LEVELS[0];
    if (confidence >= 0.5) return CONFIDENCE_LEVELS[1];
    return CONFIDENCE_LEVELS[2];
  }

  function confidenceSelector(confidence) {
    let level = CONFIDENCE_LEVELS[0];
    if (
      currentSettings.useModelConfidence &&
      typeof confidence === "number" &&
      Number.isFinite(confidence)
    ) {
      level = levelFromConfidence(confidence);
    } else if (currentSettings.randomConfidence) {
      level =
        CONFIDENCE_LEVELS[Math.floor(Math.random() * CONFIDENCE_LEVELS.length)];
    }
    return `[data-automation-id="confidence-buttons--${level}"]:not([disabled])`;
  }

  function findOverviewContinueButton() {
    const button = document.querySelector(
      "awd-topic-overview-button-bar .next-button, .button-bar-wrapper .next-button"
    );
    return button?.textContent.trim().toLowerCase().includes("continue")
      ? button
      : null;
  }

  function findForcedLearningReadButton() {
    if (!document.querySelector(".forced-learning .alert-error")) return null;
    return document.querySelector(
      '[data-automation-id="lr-tray_reading-button"]'
    );
  }

  function readPageState() {
    const continueButton = findOverviewContinueButton();
    if (continueButton) return { kind: "overview", button: continueButton };

    const readButton = findForcedLearningReadButton();
    if (readButton) return { kind: "forcedLearning", button: readButton };

    const container = questions.findContainer();
    if (
      container &&
      !container.querySelector(".forced-learning") &&
      questions.isAnswerable(container)
    ) {
      return { kind: "question", container };
    }

    const nextButton = document.querySelector(".next-button");
    if (nextButton) return { kind: "answered", button: nextButton };

    return { kind: "loading" };
  }

  function actionableState() {
    const state = readPageState();
    return state.kind === "answered" || state.kind === "loading" ? null : state;
  }

  // Reacts to page changes as they happen. If SmartBook sits on an answered
  // question, the Next click probably didn't register, so retry it.
  async function waitForActionableState(run) {
    const deadline = Date.now() + STATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await run.waitFor(actionableState, {
        timeout: Math.min(NEXT_RETRY_MS, deadline - Date.now()),
        interval: WATCH_INTERVAL_MS,
      });
      if (state) return state;

      const current = readPageState();
      if (current.kind === "answered") current.button.click();
    }
    return null;
  }

  // After a click, wait until the page leaves the state it was in so the next
  // step doesn't act on the old screen (e.g. click Continue twice).
  async function clickAndSettle(run, button, leaving) {
    button.click();
    await run.waitFor(
      () => !button.isConnected || readPageState().kind !== leaving,
      { timeout: SETTLE_TIMEOUT_MS, interval: WATCH_INTERVAL_MS }
    );
  }

  function gradeOf(marker) {
    if (!marker) return null;
    if (marker.classList.contains("incorrect")) return false;
    if (marker.classList.contains("correct")) return true;
    return null;
  }

  // The grade and correct answer render with SmartBook's feedback, which can
  // lag the Next button. Wait for them instead of guessing, or they're lost.
  async function readOutcome(run) {
    const marker = await run.waitFor(
      () => questions.findContainer()?.querySelector(".awd-probe-correctness"),
      { timeout: FEEDBACK_TIMEOUT_MS, interval: WATCH_INTERVAL_MS }
    );
    const correct = gradeOf(marker);
    if (correct !== false) return { correct, correction: null };

    const found = await run.waitFor(
      () =>
        questions.extractCorrection(questions.findContainer(), { quiet: true }),
      { timeout: FEEDBACK_TIMEOUT_MS, interval: WATCH_INTERVAL_MS }
    );
    return {
      correct,
      correction:
        found || questions.extractCorrection(questions.findContainer()),
    };
  }

  function probeId(container) {
    return (
      container?.querySelector("[data-probe-id]")?.getAttribute("data-probe-id") ||
      ""
    );
  }

  // While the user answers by hand, keep an eye on the feedback so a revealed
  // correct answer still makes it into the answer bank.
  function watchOutcome(container) {
    const id = probeId(container);
    const signature = questions.signature(container);
    const outcome = { correct: null, correction: null };

    function check() {
      const current = questions.findContainer();
      if (!current) return;
      const same = id
        ? probeId(current) === id
        : questions.signature(current) === signature;
      if (!same) return;

      const correct = gradeOf(current.querySelector(".awd-probe-correctness"));
      if (correct === null) return;
      outcome.correct = correct;
      if (correct === false && !outcome.correction) {
        outcome.correction = questions.extractCorrection(current, {
          quiet: true,
        });
      }
    }

    return { check, outcome };
  }

  function hasMovedOn(signature, watcher) {
    let leftQuestion = false;
    return () => {
      watcher?.check();
      const state = readPageState();
      if (state.kind === "overview" || state.kind === "forcedLearning") {
        return true;
      }
      if (state.kind !== "question") {
        leftQuestion = true;
        return false;
      }
      return leftQuestion || questions.signature(state.container) !== signature;
    };
  }

  async function completeForcedLearning(run, readButton) {
    const failure =
      "Couldn't get through the required reading section. Please return to the questions manually, then start automation again.";

    readButton.click();
    const toQuestionsButton = await run.waitFor(
      () =>
        document.querySelector(
          '[data-automation-id="reading-questions-button"]'
        ),
      { timeout: 10000 }
    );
    if (!toQuestionsButton) {
      run.stop(failure);
      return;
    }

    toQuestionsButton.click();
    const nextButton = await run.waitFor(
      () => document.querySelector(".next-button"),
      { timeout: 10000 }
    );
    if (!nextButton) {
      run.stop(failure);
      return;
    }

    await clickAndSettle(run, nextButton, "answered");
  }

  async function submit(run, lines, isDone, confidence) {
    const unknown = { correct: null, correction: null };
    const selector = confidenceSelector(confidence);
    const confidenceButton = await run.waitFor(
      () => document.querySelector(selector),
      { timeout: 5000 }
    );
    if (!confidenceButton) {
      await run.pauseForManualAnswer(
        "The answer was filled in, but SmartBook didn't accept it.",
        lines,
        MANUAL_ANSWER_HINT,
        isDone
      );
      return unknown;
    }

    confidenceButton.click();
    const nextButton = await run.waitFor(
      () => document.querySelector(".next-button"),
      { timeout: 10000, interval: WATCH_INTERVAL_MS }
    );
    if (!nextButton) {
      run.stop(
        "Couldn't find SmartBook's Next button after submitting the answer."
      );
      return unknown;
    }

    const outcome = await readOutcome(run);
    pendingCorrection = outcome.correction;
    await clickAndSettle(run, nextButton, "answered");
    return outcome;
  }

  async function bankKeyFor(parsed, container) {
    if (!currentSettings.answerBank || !parsed.type) return null;
    try {
      const sources = Array.from(
        container.querySelectorAll("img"),
        (image) => image.currentSrc || image.src
      ).filter(Boolean);
      return await answerBank.keyFor(parsed, sources);
    } catch (error) {
      console.warn("[Auto-McGraw] Answer bank unavailable:", error);
      return null;
    }
  }

  async function answerFromBank(key, signature) {
    if (!key) return null;
    const entry = await answerBank.lookup(key).catch(() => null);
    if (!entry) return null;

    const current = questions.findContainer();
    if (
      !current ||
      questions.signature(current) !== signature ||
      !questions.isAnswerable(current)
    ) {
      return null;
    }

    const result = await answers.apply(current, entry.answer);
    if (!result.applied) {
      console.warn(
        "[Auto-McGraw] Saved answer didn't fit this question; asking the AI.",
        entry.answer
      );
      return null;
    }

    console.info(
      `[Auto-McGraw] Answered from the answer bank (${entry.source}).`
    );
    answerBank.recordUse(key).catch(() => null);
    return { reply: { answer: entry.answer }, result, current };
  }

  // Save what SmartBook's grading taught us: our answer when it was right,
  // the revealed correct answer when it was wrong.
  async function learn(key, parsed, answer, outcome) {
    if (!key || !outcome) return;
    const base = {
      type: parsed.type,
      question: parsed.question,
      options: parsed.options,
    };
    try {
      if (outcome.correct === true && answer !== undefined) {
        await answerBank.record(key, { ...base, answer, source: "verified" });
      } else if (outcome.correct === false) {
        const correct = outcome.correction?.correctAnswer;
        if (correct !== null && correct !== undefined) {
          await answerBank.record(key, {
            ...base,
            answer: correct,
            source: "correction",
          });
        } else {
          // Graded wrong with no readable correction: drop any saved answer.
          await answerBank.forget(key);
        }
      }
    } catch (error) {
      console.warn("[Auto-McGraw] Couldn't update the answer bank:", error);
    }
  }

  async function answerQuestion(run, container) {
    const signature = questions.signature(container);
    const parsed = questions.parse(container, pendingCorrection);
    pendingCorrection = null;
    const bankKey = await bankKeyFor(parsed, container);
    run.checkpoint();

    let reply = null;
    let current = null;
    let result = null;

    const banked = await answerFromBank(bankKey, signature);
    run.checkpoint();
    if (banked) {
      ({ reply, result, current } = banked);
    } else {
      ({ reply, result, current } = await askAssistant(
        run,
        container,
        parsed,
        signature
      ));
      if (!result) return;
    }

    const watcher = bankKey ? watchOutcome(current) : null;
    const isDone = hasMovedOn(signature, watcher);
    if (!result.applied) {
      await run.pauseForManualAnswer(
        result.heading,
        result.lines,
        MANUAL_ANSWER_HINT,
        isDone
      );
      await learn(bankKey, parsed, undefined, watcher?.outcome);
      return;
    }

    if (currentSettings.doubleCreditMode) {
      await doubleCredit.submitInDuplicate(
        run,
        reply.answer,
        questions.questionKey(current)
      );
    }

    if (currentSettings.pauseBeforeSubmit) {
      await run.waitForUser(isDone);
      // The user may have changed the answer, so only trust a correction.
      await learn(bankKey, parsed, undefined, watcher?.outcome);
      return;
    }

    // Answers from the bank were graded correct before, so they get High.
    const confidence = banked ? 1 : Number(reply?.confidence);
    const outcome = await submit(run, result.lines, isDone, confidence);
    await learn(bankKey, parsed, reply?.answer, outcome);
  }

  async function askAssistant(run, container, parsed, signature) {
    try {
      parsed.images = await images.collect(container, {
        markers:
          parsed.type === "matching" ? matching.dropZoneMarkers(container) : [],
      });
    } catch (error) {
      console.warn("[Auto-McGraw] Couldn't collect question images:", error);
      parsed.images = [];
    }
    run.checkpoint();

    let reply = null;
    let current = null;
    let result = null;
    // Matching failures are drag problems, so re-asking only helps other types.
    const attempts = parsed.type === "matching" ? 1 : 1 + REASK_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const question =
        attempt === 0 ? parsed : { ...parsed, retryNote: REASK_NOTE };
      reply = await run.ask(question);

      current = questions.findContainer();
      if (
        !current ||
        questions.signature(current) !== signature ||
        !questions.isAnswerable(current)
      ) {
        console.warn(
          "[Auto-McGraw] The question changed before the answer arrived."
        );
        return { reply, result: null, current };
      }

      result = await answers.apply(current, reply?.answer);
      run.checkpoint();
      if (result.applied) break;
      console.warn("[Auto-McGraw] Couldn't apply the answer:", reply?.answer);
    }

    return { reply, result, current };
  }

  async function step(run) {
    const state = await waitForActionableState(run);
    if (!state) {
      run.stop(
        "No new question appeared. If the assignment is complete you're done; otherwise go to the next question and start automation again."
      );
      return;
    }

    if (state.kind === "overview") {
      await clickAndSettle(run, state.button, "overview");
      return;
    }

    if (state.kind === "forcedLearning") {
      await completeForcedLearning(run, state.button);
      return;
    }

    await answerQuestion(run, state.container);
  }

  function questionReport() {
    const container = questions.findContainer();
    if (!container) return null;

    const clone = container.cloneNode(true);
    clone.querySelectorAll('img[src^="data:"]').forEach((image) => {
      image.setAttribute("src", "data:trimmed");
    });
    clone.querySelectorAll("svg").forEach((svg) => {
      svg.innerHTML = "";
    });

    const info = {
      url: location.href,
      detectedType: questions.detectType(container) || "(unsupported)",
      answerable: questions.isAnswerable(container),
      probeClasses: Array.from(
        container.querySelectorAll(
          '[class*="awd-probe-type-"], [class*="awd-probe-mode-"]'
        ),
        (element) => element.className
      ),
      draggables: container.querySelectorAll('[draggable="true"]').length,
      dropTargets: container.querySelectorAll("[data-drop-target-for-element]")
        .length,
      nextButton: Boolean(document.querySelector(".next-button")),
      parsed: questions.parse(container, null),
    };
    return `INFO:\n${JSON.stringify(info, null, 1)}\n\nHTML:\n${clone.outerHTML.slice(
      0,
      30000
    )}`;
  }

  function copyToClipboard(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }

  async function copyQuestion() {
    const report = questionReport();
    if (!report) {
      toolbar.notify("Auto-McGraw: no question found on this page.", {
        tone: "error",
      });
      return;
    }
    console.log("[Auto-McGraw] Question report:\n" + report);
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      if (!copyToClipboard(report)) {
        toolbar.notify(
          "Auto-McGraw: couldn't copy to the clipboard. The report was printed to the console instead.",
          { tone: "error" }
        );
        return;
      }
    }
    toolbar.notify(
      `Auto-McGraw: copied this question's details (${report.length} characters). Paste them into your bug report.`
    );
  }

  const session = automation.create({
    step,
    onStateChange: render,
    notify: (message, options) => toolbar.notify(message, options),
  });
  const bar = toolbar.create({
    variant: "smartbook",
    onToggle: toggle,
    onCopyQuestion: copyQuestion,
  });

  function render() {
    bar.render({
      running: session.isRunning(),
      assistantId: currentSettings.aiModel,
      label: apiProviders.label(currentSettings),
      doubleCredit: currentSettings.doubleCreditMode,
    });
  }

  function toggle() {
    if (session.isRunning()) {
      session.stop();
      return;
    }

    const modeText = currentSettings.doubleCreditMode
      ? " Double credit mode is enabled."
      : "";
    if (
      confirm(
        `Start automated answering?${modeText} Click OK to begin, or Cancel to stop.`
      )
    ) {
      session.start();
    }
  }

  async function init() {
    render();
    toolbar.keepMounted(bar.element, (element) => {
      document
        .querySelector("awd-header .header__navigation")
        ?.appendChild(element);
    });

    settings.subscribe((values) => {
      currentSettings = values;
      render();
    });
    currentSettings = await settings.load();
    render();

    const job = await doubleCredit.claim();
    if (job) await doubleCredit.answerAsDuplicate(job, confidenceSelector());
  }

  init().catch((error) => console.error("[Auto-McGraw]", error));
})();
