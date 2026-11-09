(() => {
  const { apiProviders, wait } = AutoMcGraw;

  const REQUEST_TIMEOUT_MS = 120000;
  const MAX_ATTEMPTS = 3;
  const MAX_RETRY_WAIT_MS = 20000;
  const ANTHROPIC_VERSION = "2023-06-01";
  // Server-side refusal fallback ("default" form) is offered on these models.
  const ANTHROPIC_FALLBACK_MODELS =
    /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;
  const ANTHROPIC_EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-5/;

  const SYSTEM_PROMPT =
    "You answer McGraw Hill SmartBook study questions. Reply with JSON only. " +
    '"answer" is always an array of strings: one element for a single answer, ' +
    "one element per blank, match or item where the question says so. Copy " +
    'option text exactly as written. "explanation" is at most 12 words. ' +
    '"confidence" is a number from 0 to 1 for how likely the answer is correct.';

  const ANSWER_SCHEMA = Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["answer", "explanation", "confidence"],
    properties: {
      answer: { type: "array", items: { type: "string" } },
      explanation: { type: "string" },
      confidence: { type: "number" },
    },
  });

  // Gemini's responseSchema is an OpenAPI subset with upper-case types.
  const GEMINI_SCHEMA = Object.freeze({
    type: "OBJECT",
    required: ["answer", "explanation", "confidence"],
    properties: {
      answer: { type: "ARRAY", items: { type: "STRING" } },
      explanation: { type: "STRING" },
      confidence: { type: "NUMBER" },
    },
  });

  class ProviderError extends Error {
    constructor(message, { fatal = false, retryable = false, status = 0 } = {}) {
      super(message);
      this.fatal = fatal;
      this.retryable = retryable;
      this.status = status;
    }
  }

  function splitDataUrl(dataUrl) {
    const [header, data = ""] = String(dataUrl).split(",");
    const mediaType = header.match(/^data:([^;,]+)/)?.[1] || "image/png";
    return { mediaType, data };
  }

  function stripThinking(text) {
    return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  }

  // Structured output should already be bare JSON; local models sometimes
  // wrap it in a code fence or add prose, so fall back to the outer braces.
  function parseAnswer(text) {
    const cleaned = stripThinking(text)
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const attempts = [cleaned];
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) attempts.push(cleaned.slice(start, end + 1));

    for (const attempt of attempts) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === "object" && "answer" in parsed) {
          const confidence = Number(parsed.confidence);
          return {
            answer: parsed.answer,
            explanation: String(parsed.explanation || ""),
            confidence: Number.isFinite(confidence)
              ? Math.min(1, Math.max(0, confidence))
              : null,
          };
        }
      } catch {
        continue;
      }
    }
    throw new ProviderError(
      "The model's reply wasn't the expected JSON answer.",
      { retryable: true }
    );
  }

  function describeHttpError(status, detail, provider) {
    const where = `${provider.name}${detail ? `: ${detail}` : ""}`;
    if (status === 401 || status === 403) {
      return new ProviderError(
        `${provider.name} rejected the API key (${status}). Check it in the Auto-McGraw settings.` +
          (provider.local
            ? ` If ${provider.name} blocks the extension, start it with OLLAMA_ORIGINS="chrome-extension://*".`
            : ""),
        { fatal: true, status }
      );
    }
    if (status === 404) {
      return new ProviderError(
        `${provider.name} couldn't find model "${provider.model}" (404). Check the model name in settings.`,
        { fatal: true, status }
      );
    }
    if (status === 429 || status === 408 || status === 409 || status >= 500) {
      return new ProviderError(`${where} (HTTP ${status})`, {
        retryable: true,
        status,
      });
    }
    return new ProviderError(`${where} (HTTP ${status})`, { status });
  }

  async function errorDetail(response) {
    try {
      const body = await response.json();
      return (
        body?.error?.message ||
        body?.error?.status ||
        (typeof body?.error === "string" ? body.error : "") ||
        body?.message ||
        ""
      );
    } catch {
      return "";
    }
  }

  async function postJson(url, headers, body, provider, signal) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new ProviderError(
          `${provider.name} took longer than ${REQUEST_TIMEOUT_MS / 1000}s to answer.`,
          { retryable: true }
        );
      }
      throw new ProviderError(
        provider.local
          ? `Couldn't reach ${provider.name} at ${provider.baseUrl}. Is it running?`
          : `Couldn't reach ${provider.name} (${error.message}).`,
        { fatal: Boolean(provider.local), retryable: !provider.local }
      );
    }

    if (!response.ok) {
      const detail = await errorDetail(response);
      const error = describeHttpError(response.status, detail, provider);
      error.detail = detail;
      error.retryAfter = Number(response.headers.get("retry-after")) || 0;
      throw error;
    }
    return response.json();
  }

  // A 400 that names the structured-output field means this server or model
  // doesn't support it; the prompt still asks for JSON, so retry without it.
  function rejectsSchema(error) {
    return (
      error.status === 400 &&
      /response_format|json_schema|output_config|format|responseSchema|schema/i.test(
        error.detail || ""
      )
    );
  }

  async function callOpenAi(provider, key, { prompt, images }, signal) {
    const content = images.length
      ? [
          { type: "text", text: prompt },
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: image.dataUrl },
          })),
        ]
      : prompt;
    const body = {
      model: provider.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "smartbook_answer", strict: true, schema: ANSWER_SCHEMA },
      },
    };
    // Ollama maps this to its "think" switch; models that don't think ignore it.
    if (provider.local && !provider.thinking) body.reasoning_effort = "none";
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const url = `${provider.baseUrl}/chat/completions`;

    let data;
    for (let attempt = 0; ; attempt += 1) {
      try {
        data = await postJson(url, headers, body, provider, signal);
        break;
      } catch (error) {
        // Drop whichever optional field the server objects to, then retry.
        if (attempt < 2 && error.status === 400 && body.reasoning_effort &&
            /reasoning/i.test(error.detail || "")) {
          delete body.reasoning_effort;
        } else if (attempt < 2 && body.response_format && rejectsSchema(error)) {
          delete body.response_format;
        } else {
          throw error;
        }
      }
    }

    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) {
      throw new ProviderError(`${provider.name} declined: ${choice.message.refusal}`);
    }
    return parseAnswer(choice?.message?.content);
  }

  async function callAnthropic(provider, key, { prompt, images }, signal) {
    const headers = {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      // Requests from an extension carry a browser Origin header.
      "anthropic-dangerous-direct-browser-access": "true",
    };
    const body = {
      model: provider.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((image) => {
              const { mediaType, data } = splitDataUrl(image.dataUrl);
              return {
                type: "image",
                source: { type: "base64", media_type: mediaType, data },
              };
            }),
            { type: "text", text: prompt },
          ],
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: ANSWER_SCHEMA },
      },
    };
    if (ANTHROPIC_EFFORT_MODELS.test(provider.model)) {
      body.output_config.effort = "medium";
    }
    if (ANTHROPIC_FALLBACK_MODELS.test(provider.model)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }

    const url = `${provider.baseUrl}/messages`;
    let data;
    try {
      data = await postJson(url, headers, body, provider, signal);
    } catch (error) {
      if (!rejectsSchema(error)) throw error;
      delete body.output_config.format;
      data = await postJson(url, headers, body, provider, signal);
    }

    if (data?.stop_reason === "refusal") {
      throw new ProviderError(
        "Claude declined to answer this question. Answer it yourself, then continue."
      );
    }
    const text = (data?.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return parseAnswer(text);
  }

  async function callGemini(provider, key, { prompt, images }, signal) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...images.map((image) => {
              const { mediaType, data } = splitDataUrl(image.dataUrl);
              return { inlineData: { mimeType: mediaType, data } };
            }),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
      },
    };
    const url = `${provider.baseUrl}/models/${encodeURIComponent(
      provider.model
    )}:generateContent`;
    const headers = { "x-goog-api-key": key };

    let data;
    try {
      data = await postJson(url, headers, body, provider, signal);
    } catch (error) {
      if (!rejectsSchema(error)) throw error;
      delete body.generationConfig.responseSchema;
      data = await postJson(url, headers, body, provider, signal);
    }

    const candidate = data?.candidates?.[0];
    if (!candidate && data?.promptFeedback?.blockReason) {
      throw new ProviderError(
        `Gemini blocked this question (${data.promptFeedback.blockReason}).`
      );
    }
    if (candidate?.finishReason === "SAFETY") {
      throw new ProviderError("Gemini declined to answer this question.");
    }
    const text = (candidate?.content?.parts || [])
      .map((part) => part.text || "")
      .join("");
    return parseAnswer(text);
  }

  const CALLERS = {
    openai: callOpenAi,
    anthropic: callAnthropic,
    gemini: callGemini,
  };

  async function withTimeout(task) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await task(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask the configured provider. `request` is { prompt, images }.
   * Resolves to { answer, explanation, confidence }.
   */
  async function ask(settings, request) {
    const provider = apiProviders.resolve(settings);
    if (!provider.baseUrl) {
      throw new ProviderError(
        "No API address is set. Open Auto-McGraw settings and fill in the base URL.",
        { fatal: true }
      );
    }
    if (!provider.model) {
      throw new ProviderError(
        `No model is set for ${provider.name}. Open Auto-McGraw settings and enter one.`,
        { fatal: true }
      );
    }

    const key = await apiProviders.loadKey(provider.id);
    if (provider.needsKey && !key) {
      throw new ProviderError(
        `No ${provider.name} API key is saved. Add one in the Auto-McGraw settings.`,
        { fatal: true }
      );
    }

    const call = CALLERS[provider.kind];
    const normalized = { prompt: request.prompt, images: request.images || [] };
    const target =
      normalized.images.length && provider.visionModel
        ? { ...provider, model: provider.visionModel }
        : provider;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await withTimeout((signal) =>
          call(target, key, normalized, signal)
        );
      } catch (error) {
        const retry =
          error instanceof ProviderError &&
          error.retryable &&
          attempt < MAX_ATTEMPTS;
        if (!retry) throw error;
        const pause = Math.min(
          MAX_RETRY_WAIT_MS,
          error.retryAfter ? error.retryAfter * 1000 : 1000 * 2 ** attempt
        );
        console.warn("[Auto-McGraw]", `${error.message}; retrying in ${pause}ms`);
        await wait.delay(pause);
      }
    }
  }

  AutoMcGraw.apiClient = { ask, ProviderError, parseAnswer };
})();
