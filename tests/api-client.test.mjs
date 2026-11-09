// Tests for background/api-client.js against a local mock of each provider's
// HTTP API. Run: node --test tests/
//
// Live checks (real network, may cost a little):
//   LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=... node --test tests/api-client.test.mjs
//   LIVE_OLLAMA=qwen2.5vl:7b node --test tests/api-client.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadScripts, PNG_DATA_URL } from "./helpers.mjs";

const { AutoMcGraw, storage } = loadScripts([
  "shared/namespace.js",
  "shared/assistants.js",
  "shared/settings.js",
  "shared/api-providers.js",
  "shared/wait.js",
  "background/prompt.js",
  "background/api-client.js",
]);
const { apiClient, prompt } = AutoMcGraw;

const requests = [];
let respond = () => ({ status: 500, body: {} });
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const entry = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      requests.push(entry);
      const { status, body, headers = {} } = respond(entry, requests.length);
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function settingsFor(provider, overrides = {}) {
  return {
    answerSource: "api",
    apiProvider: provider,
    apiConfig: { [provider]: { baseUrl: base, ...overrides } },
  };
}

async function withKey(provider, key) {
  await AutoMcGraw.apiProviders.saveKey(provider, key);
}

const QUESTION = {
  type: "multiple_choice",
  question: "What is 2 + 2?",
  options: ["3", "4", "5"],
};
const ANSWER_JSON = JSON.stringify({
  answer: ["4"],
  explanation: "Basic arithmetic.",
  confidence: 0.97,
});

test("openai-compatible: request shape, schema and parsing", async () => {
  requests.length = 0;
  await withKey("openai", "sk-test");
  respond = () => ({
    status: 200,
    body: { choices: [{ message: { content: ANSWER_JSON } }] },
  });

  const reply = await apiClient.ask(settingsFor("openai"), {
    prompt: prompt.build(QUESTION, { api: true }),
    images: [{ dataUrl: PNG_DATA_URL, name: "a.png" }],
  });

  assert.deepEqual(reply, {
    answer: ["4"],
    explanation: "Basic arithmetic.",
    confidence: 0.97,
  });
  const [req] = requests;
  assert.equal(req.url, "/chat/completions");
  assert.equal(req.headers.authorization, "Bearer sk-test");
  assert.equal(req.body.model, "gpt-5-mini");
  assert.equal(req.body.response_format.type, "json_schema");
  assert.equal(req.body.response_format.json_schema.strict, true);
  const content = req.body.messages[1].content;
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /What is 2 \+ 2\?/);
  assert.doesNotMatch(content[0].text, /JSON code block/);
  assert.equal(content[1].image_url.url, PNG_DATA_URL);
});

test("openai-compatible: retries without response_format when rejected", async () => {
  requests.length = 0;
  respond = (_, count) =>
    count === 1
      ? {
          status: 400,
          body: { error: { message: "response_format json_schema is not supported" } },
        }
      : {
          status: 200,
          body: {
            choices: [
              {
                message: {
                  content: "<think>hmm</think>\n```json\n" + ANSWER_JSON + "\n```",
                },
              },
            ],
          },
        };

  const reply = await apiClient.ask(settingsFor("ollama"), { prompt: "Q" });
  assert.deepEqual(reply.answer, ["4"]);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].body.response_format);
  assert.equal(requests[1].body.response_format, undefined);
  assert.equal(requests[0].headers.authorization, undefined, "local: no key");
  assert.equal(requests[0].body.reasoning_effort, "none", "local: thinking off by default");
  assert.equal(requests[0].body.messages[1].content, "Q", "no images: plain string");
});

test("image questions use the separate vision model when one is set", async () => {
  requests.length = 0;
  respond = () => ({
    status: 200,
    body: { choices: [{ message: { content: ANSWER_JSON } }] },
  });
  const settings = settingsFor("ollama", {
    model: "qwen3:14b",
    visionModel: "qwen2.5vl:7b",
  });
  await apiClient.ask(settings, { prompt: "Q" });
  await apiClient.ask(settings, { prompt: "Q", images: [{ dataUrl: PNG_DATA_URL }] });
  assert.deepEqual(
    requests.map((req) => req.body.model),
    ["qwen3:14b", "qwen2.5vl:7b"]
  );
});

test("anthropic: headers, structured output, effort, fallbacks, images", async () => {
  requests.length = 0;
  await withKey("anthropic", "sk-ant-test");
  respond = () => ({
    status: 200,
    body: {
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: ANSWER_JSON },
      ],
    },
  });

  const reply = await apiClient.ask(settingsFor("anthropic"), {
    prompt: "Q",
    images: [{ dataUrl: PNG_DATA_URL }],
  });
  assert.deepEqual(reply.answer, ["4"]);

  const [req] = requests;
  assert.equal(req.url, "/messages");
  assert.equal(req.headers["x-api-key"], "sk-ant-test");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(req.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(req.body.model, "claude-opus-5-5");
  assert.equal(req.body.fallbacks, "default");
  assert.equal(req.body.output_config.effort, "medium");
  assert.equal(req.body.output_config.format.type, "json_schema");
  assert.equal(req.body.thinking, undefined, "Opus 5.5: thinking omitted");
  const [image, text] = req.body.messages[0].content;
  assert.equal(image.type, "image");
  assert.equal(image.source.type, "base64");
  assert.equal(image.source.media_type, "image/png");
  assert.equal(text.text, "Q");
});

test("anthropic: no fallbacks/effort for models that don't take them", async () => {
  requests.length = 0;
  respond = () => ({
    status: 200,
    body: { stop_reason: "end_turn", content: [{ type: "text", text: ANSWER_JSON }] },
  });
  await apiClient.ask(settingsFor("anthropic", { model: "claude-haiku-4-5" }), {
    prompt: "Q",
  });
  const [req] = requests;
  assert.equal(req.headers["anthropic-beta"], undefined);
  assert.equal(req.body.fallbacks, undefined);
  assert.equal(req.body.output_config.effort, undefined);
});

test("anthropic: refusal becomes a clear error", async () => {
  respond = () => ({ status: 200, body: { stop_reason: "refusal", content: [] } });
  await assert.rejects(
    apiClient.ask(settingsFor("anthropic"), { prompt: "Q" }),
    /declined/
  );
});

test("gemini: endpoint, key header, schema and inline images", async () => {
  requests.length = 0;
  await withKey("gemini", "AIza-test");
  respond = () => ({
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: ANSWER_JSON }] } }] },
  });
  const reply = await apiClient.ask(settingsFor("gemini"), {
    prompt: "Q",
    images: [{ dataUrl: PNG_DATA_URL }],
  });
  assert.deepEqual(reply.answer, ["4"]);
  const [req] = requests;
  assert.equal(req.url, "/models/gemini-2.5-flash:generateContent");
  assert.equal(req.headers["x-goog-api-key"], "AIza-test");
  assert.equal(req.body.generationConfig.responseMimeType, "application/json");
  assert.equal(req.body.generationConfig.responseSchema.type, "OBJECT");
  assert.equal(req.body.contents[0].parts[1].inlineData.mimeType, "image/png");
});

test("errors: bad key is fatal, 429 retries then succeeds", async () => {
  respond = () => ({ status: 401, body: { error: { message: "invalid x-api-key" } } });
  await assert.rejects(apiClient.ask(settingsFor("anthropic"), { prompt: "Q" }), (error) => {
    assert.equal(error.fatal, true);
    assert.match(error.message, /rejected the API key/);
    return true;
  });

  requests.length = 0;
  respond = (_, count) =>
    count === 1
      ? { status: 429, body: {}, headers: { "retry-after": "0" } }
      : { status: 200, body: { choices: [{ message: { content: ANSWER_JSON } }] } };
  const reply = await apiClient.ask(settingsFor("openai"), { prompt: "Q" });
  assert.deepEqual(reply.answer, ["4"]);
  assert.equal(requests.length, 2);
});

test("errors: missing key, unreachable local server, unknown model", async () => {
  await AutoMcGraw.apiProviders.saveKey("gemini", "");
  await assert.rejects(
    apiClient.ask(settingsFor("gemini"), { prompt: "Q" }),
    /No Gemini API API key|No Gemini API key|API key is saved/
  );

  await assert.rejects(
    apiClient.ask(
      { answerSource: "api", apiProvider: "ollama", apiConfig: { ollama: { baseUrl: "http://127.0.0.1:9" } } },
      { prompt: "Q" }
    ),
    (error) => error.fatal && /Is it running/.test(error.message)
  );

  respond = () => ({ status: 404, body: { error: { message: "model not found" } } });
  await assert.rejects(
    apiClient.ask(settingsFor("ollama", { model: "nope" }), { prompt: "Q" }),
    (error) => error.fatal && /couldn't find model "nope"/.test(error.message)
  );
});

test("settings: keys stay out of synced settings", async () => {
  await withKey("openai", "sk-secret");
  assert.equal(JSON.stringify(storage.sync).includes("sk-secret"), false);
  assert.equal(storage.local.apiKeys.openai, "sk-secret");
});

// ---- live checks (opt-in) -------------------------------------------------

test("LIVE anthropic", { skip: !process.env.LIVE_ANTHROPIC }, async () => {
  await withKey("anthropic", process.env.ANTHROPIC_API_KEY);
  const model = process.env.LIVE_ANTHROPIC_MODEL || "claude-opus-5-5";
  const live = {
    answerSource: "api",
    apiProvider: "anthropic",
    apiConfig: { anthropic: { model } },
  };
  const reply = await apiClient.ask(live, {
    prompt: prompt.build(QUESTION, { api: true }),
  });
  console.log("live anthropic:", model, JSON.stringify(reply));
  assert.deepEqual(reply.answer, ["4"]);
  assert.equal(typeof reply.confidence, "number");
});

test("LIVE ollama", { skip: !process.env.LIVE_OLLAMA }, async () => {
  const live = {
    answerSource: "api",
    apiProvider: "ollama",
    apiConfig: { ollama: { model: process.env.LIVE_OLLAMA } },
  };
  const started = Date.now();
  const reply = await apiClient.ask(live, {
    prompt: prompt.build(QUESTION, { api: true }),
  });
  console.log("live ollama:", JSON.stringify(reply), `${Date.now() - started}ms`);
  assert.deepEqual(reply.answer, ["4"]);
});
