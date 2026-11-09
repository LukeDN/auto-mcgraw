# Plan: answer bank + direct AI providers (API keys / local AI)

Goal: answer faster and more reliably by (1) never asking the AI a question we
already know the answer to, and (2) calling models directly instead of driving
the ChatGPT website. The current website mode stays as a fallback.

Build in the order below — each phase is useful on its own.

---

## Phase 0 — Fixtures and a test harness (do first) — 🟡 started 2026-10-19

Done: the toolbar copy button (question HTML + parsed info to the clipboard)
and `tests/` (Node test runner; `node --test tests/*.test.mjs`) covering the
API client against a mock server, with opt-in live checks. Still to do: move
the headless-Chrome fixture pages for matching / ordering / answer bank into
`tests/` so they run from one command.

Every breakage so far (matching) came from McGraw changing its markup, and we
only found out from a live run. Fix that before building more.

- **"Save question" button** in the toolbar (or a console helper) that copies
  the current `.probe-container` outerHTML to a file. Collect one fixture per
  question type: multiple choice, true/false, multiple select, fill in the
  blank, select text, matching (text and image), plus the review/feedback state
  of each (needed for correction parsing).
- **Headless Chrome test runner** (`tests/run.mjs`) that loads each fixture
  with the extension's content scripts and checks:
  - `questions.parse()` reads the expected prompt and options
  - `answers.apply()` fills in a known answer
  - `questions.extractCorrection()` reads the correct answer from the feedback state
  - matching uses the real Pragmatic drag-and-drop library (as the manual test did)
- When McGraw changes something, a new fixture plus a failing test pinpoints it.

## Phase 1 — Answer bank (seen-answer cache) — ✅ implemented 2026-10-19

Shipped in `shared/answer-bank.js` (storage + keys), `content/smartbook/main.js`
(lookup before asking, learn from grading, watch manual answers) and
`popup/answer-bank.js` (toggle, stats, export/import/clear). Storage ended up
as `chrome.storage.local` + `unlimitedStorage` (content scripts and the popup
read it directly; no background messaging needed). Still open: matching and
ordering corrections (needs a fixture of their feedback screen).

SmartBook repeats questions (especially missed ones), and the extension already
reads the correct answer after a miss. Store it.

**Key.** `type` + normalized question text + sorted normalized options
(prompts and choices for matching), hashed (SHA-256 via `crypto.subtle`). The
options matter: the same question stem can come with different choices.

**Entry.**
```js
{ key, type, question, options, answer, source: "correction" | "verified" | "ai",
  hits, createdAt, updatedAt }
```
- `correction`: read from SmartBook feedback after a wrong answer (trusted)
- `verified`: our answer, which SmartBook marked correct (trusted)
- `ai`: answered but not yet graded (not reused)

**Flow** (`content/smartbook/main.js`).
1. Before asking: look up the key. On a trusted hit, apply it directly — no AI
   call. If it doesn't apply (options changed), drop the entry and ask the AI.
2. After submitting: if the feedback marker is `correct`, save the answer as
   `verified`; if `incorrect`, save `extractCorrection()`'s answer as
   `correction`.

**Storage.** IndexedDB in the background service worker (unlimited, indexed),
with content scripts reaching it through messages (`BANK_LOOKUP`, `BANK_SAVE`).
`chrome.storage.local` is simpler but capped at 10 MB without
`unlimitedStorage`.

**Gaps to close.**
- `readCorrectAnswer` returns null for matching, so wrong matching answers
  aren't learned. Needs a fixture of the matching feedback state.
- Fill-in-the-blank corrections with alternatives ("x or y"): keep all of them.

**Settings UI.** Toggle, count of stored answers, export/import JSON, clear.

**Ideas for later.** Shared/imported banks per textbook; fuzzy matching on
question text for minor wording differences (risky — only with identical options).

## Phase 2 — Provider layer (API keys + local AI) — ✅ implemented 2026-10-19

Shipped: `shared/api-providers.js` (presets, key storage), `background/api-client.js`
(OpenAI-compatible incl. Ollama / LM Studio, Anthropic, Gemini; structured
JSON output, images, retries, error mapping), relay branch in
`background/relay.js`, and the "Answer Source" section in the popup with a
Test Connection button. The ChatGPT website mode stays the default. Current
focus (per the user): the **local** path (Ollama); cloud API keys are optional
and untested live.

Local results (16 GB M4, 8-question SmartBook-style test incl. the real
matching/ordering questions): qwen2.5vl:7b 5.75/8 at ~4 s; qwen3:14b with
thinking 8/8 at ~44 s; **qwen3:14b with thinking off 8/8 at ~10 s** (now the
Ollama default, with qwen2.5vl:7b as the image model). Answering matching /
ordering by option number was faster (~8 s) but less accurate, so reverted.

Replace "always drive a website tab" with a provider interface in the
background worker:

```js
// background/providers/<name>.js
async function answer({ system, prompt, images, schema, signal }) → { answer, explanation, confidence }
```

**Providers.**

| Provider | Covers | Notes |
|---|---|---|
| `openai-compatible` | OpenAI, OpenRouter, Groq, **Ollama** (`http://localhost:11434/v1`), **LM Studio** (`http://localhost:1234/v1`) | One implementation, configurable base URL + model + key. Structured output via `response_format: { type: "json_schema" }`; Ollama/LM Studio support this too. |
| `anthropic` | Claude | Messages API from the worker; requires the `anthropic-dangerous-direct-browser-access: true` header. Structured output via a tool with an input schema. |
| `gemini` | Gemini API | `responseSchema` for JSON. |
| `web` | Current ChatGPT/Gemini/DeepSeek tab mode | Fallback, no key needed. Existing `relay.js` + `content/assistant/*`. |

**Changes.**
- `background/relay.js`: branch on `settings.provider`. API providers skip tab
  lookup, focus switching and script injection entirely.
- `background/prompt.js`: split into a system prompt (format rules) and a user
  message (question). Answer shape enforced by schema, not prose — most of the
  answer parsing in `matching.js` and `text.js` stops mattering (keep it as a
  safety net).
- Images go in as base64 image parts. Settings flag whether the chosen model
  supports vision; if not, warn on image questions.
- Errors: map 401 (bad key), 429 (rate limit → back off and retry), network
  failure (local server not running → clear message).

**Permissions.** Add API hosts and `http://localhost/*` / `http://127.0.0.1/*` as
`optional_host_permissions`, requested from the settings popup when the user
picks a provider (needs a click, so it must happen there).

**Secrets.** Store API keys in `chrome.storage.local`, never `storage.sync`.
Never send them anywhere except their provider.

**Settings UI.** Provider dropdown, base URL (prefilled per provider), model,
API key, "Test connection" button that sends a trivial prompt.

**Local AI setup notes** (document in README/settings help).
- Ollama: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`, or it rejects
  the extension's requests.
- Model size vs accuracy: 7–14B text models (Qwen, Llama) run well on Apple
  Silicon but are less accurate than frontier models on textbook questions.
  Image questions need a vision model (Qwen2.5-VL, Gemma 3).
- The answer bank (Phase 1) offsets weaker local models: corrections make
  repeats right regardless.

## Phase 3 — Smaller improvements — ✅ mostly done 2026-10-19

Done: model confidence → High/Medium/Low ("Use the AI's Confidence" toggle),
double-credit fixed pause → wait for feedback, `alert()` → in-page notice.
Not done: low-confidence escalation to a second model.

- **Confidence from the model.** Ask for a 0–1 confidence in the schema and map
  it to SmartBook's high/medium/low buttons instead of always-high or random.
- **Low-confidence escalation.** Optional: if a local model's confidence is low,
  re-ask a stronger API model.
- **Remaining fixed pauses** in `content/smartbook/double-credit.js` (500 ms,
  800 ms) → wait-for-element, like `main.js` now does.
- **Replace `alert()`** with an in-page banner on the toolbar so errors don't
  block the page.

## Open decisions

1. Which API providers to support first (OpenAI-compatible covers the most,
   including local).
2. IndexedDB vs `chrome.storage.local` + `unlimitedStorage` for the bank.
3. Whether the bank should be exportable/shareable between devices.
