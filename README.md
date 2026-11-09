# Auto-McGraw

A Chrome extension that reads McGraw Hill **SmartBook** (and **Connect / ezTO**)
questions, gets an answer from an AI, and fills it in for you.

You can get answers three ways:

- **AI website tab**: types each question into ChatGPT, Gemini or DeepSeek in
  another tab. Free, no API key needed.
- **API key**: calls OpenAI, Claude (Anthropic), Gemini, OpenRouter, Groq or
  any OpenAI-compatible API directly. Faster, with no tab switching.
- **Local model**: runs on your own computer through Ollama or LM Studio.
  Free and private once it's set up.

> Based on [GooglyBlox/auto-mcgraw](https://github.com/GooglyBlox/auto-mcgraw)
> (MIT). This version adds API and local-model answering, an answer bank that
> remembers graded answers, model-reported confidence, Pause Before Submit, and
> fixes for matching and ordering questions.

---

## Contents

1. [What it can do](#what-it-can-do)
2. [Install the extension](#install-the-extension)
3. [Choose where answers come from](#choose-where-answers-come-from)
   - [Option A: AI website tab (easiest)](#option-a-ai-website-tab-easiest)
   - [Option B: API key](#option-b-api-key)
   - [Option C: Local model with Ollama](#option-c-local-model-with-ollama)
   - [Option D: Local model with LM Studio](#option-d-local-model-with-lm-studio)
4. [Using it](#using-it)
5. [Settings reference](#settings-reference)
6. [Answer bank](#answer-bank)
7. [Updating](#updating)
8. [Troubleshooting](#troubleshooting)
9. [Privacy](#privacy)
10. [For developers](#for-developers)
11. [Credits and license](#credits-and-license)

---

## What it can do

**SmartBook** (`learning.mheducation.com`) question types:

| Type | Supported |
|---|---|
| Multiple choice | ✅ |
| True / false | ✅ |
| Multiple select | ✅ |
| Fill in the blank | ✅ |
| Select text | ✅ |
| Matching (drag and drop) | ✅ |
| Ordering (drag to sort) | ✅ |
| Questions with images | ✅ (website tab, or an API/local model that supports images) |

It also gets through SmartBook's required-reading prompts and picks a
confidence level (High / Medium / Low) for each answer.

**Connect / ezTO** (`ezto.mheducation.com`): multiple choice, true/false and
fill in the blank. When it reaches a question type it can't handle, it asks you
to answer that one yourself and carries on from the next question.

---

## Install the extension

The extension isn't on the Chrome Web Store, so you load it yourself. It takes
about two minutes. It works in **Chrome, Edge, Brave, Arc** and other
Chromium browsers (not Firefox or Safari).

### 1. Download it

**Easiest:** go to the [Releases page](https://github.com/LukeDN/auto-mcgraw/releases/latest)
and download `auto-mcgraw-vX.Y.zip`.

**Or:** on the main repo page click the green **Code** button, then
**Download ZIP**.

**Or, with git:**

```bash
git clone https://github.com/LukeDN/auto-mcgraw.git
```

### 2. Unzip it somewhere permanent

Unzip the file and move the folder somewhere you won't delete it, such as
your Documents folder. Chrome loads the extension from this folder every
time it starts, so if you delete or move the folder, the extension stops
working.

Check that the folder you'll select has `manifest.json` directly inside it
(not inside another subfolder).

### 3. Load it into Chrome

1. Open a new tab and go to **`chrome://extensions`**
   (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode** (toggle in the top-right corner; in Edge it's in
   the left sidebar).
3. Click **Load unpacked**.
4. Select the unzipped `auto-mcgraw` folder (the one containing
   `manifest.json`).
5. **Auto-McGraw Smartbook** now appears in your list of extensions.

### 4. Pin it (optional but handy)

Click the puzzle-piece icon in Chrome's toolbar and click the pin next to
**Auto-McGraw Smartbook**. Clicking its icon opens the settings.

> Chrome may sometimes show a "Disable developer mode extensions" warning
> when it starts. Click the X or **Keep**. It's normal for extensions loaded
> this way.

---

## Choose where answers come from

Open the settings by clicking the extension's icon, or the ⚙️ button next to
**Ask …** on a SmartBook page. Under **Answer Source**, choose one of the
options below.

### Option A: AI website tab (easiest)

No setup beyond an account on the AI site.

1. In settings, under **Answer Source**, choose **AI website tab**.
2. Under **Assistant**, pick **ChatGPT**, **Gemini** or **DeepSeek**.
3. Open that site in another tab and **log in**:
   - ChatGPT: <https://chatgpt.com>
   - Gemini: <https://gemini.google.com>
   - DeepSeek: <https://chat.deepseek.com>
4. Leave that tab open. The settings page shows a green **Ready to use** next
   to the assistant once it finds the tab.

While it runs, the extension briefly switches to the AI tab to type each
question and read the reply, then switches back. Let it do this and don't
type in the AI tab while it's running.

### Option B: API key

Faster and more reliable than the website tab, but providers charge per use
(usually fractions of a cent per question).

1. In settings, choose **API or local model**.
2. Pick a **Provider**, then paste your **API key**:

   | Provider | Where to get a key | Default model |
   |---|---|---|
   | OpenAI | <https://platform.openai.com/api-keys> | `gpt-5-mini` |
   | Claude (Anthropic) | <https://console.anthropic.com> | `claude-opus-5-5` (`claude-haiku-5-5` is faster and cheaper) |
   | Gemini API (Google) | <https://aistudio.google.com/apikey> | `gemini-2.5-flash` |
   | Other OpenAI-compatible | e.g. OpenRouter (`https://openrouter.ai/api/v1`), Groq (`https://api.groq.com/openai/v1`) | enter one |

3. You can change the **Model** field to any model name your provider
   offers.
4. Click **Test Connection**. It sends a small test question and shows
   whether it worked.

For **Other OpenAI-compatible**, also fill in the **Base URL**. Chrome will
ask permission for the extension to reach that address. Click **Allow**.

Your key is saved only in this browser on this computer (see
[Privacy](#privacy)).

### Option C: Local model with Ollama

Free and runs entirely on your computer. You need a reasonably recent
computer: an Apple Silicon Mac with 16 GB of memory, or a PC with a
comparable GPU, runs the default models well.

**1. Install Ollama** from <https://ollama.com/download> and open it.

**2. Download the models.** Open Terminal (Mac) or Command Prompt / PowerShell
(Windows) and run:

```bash
ollama pull qwen3:14b      # main model (about 9 GB)
ollama pull qwen2.5vl:7b   # reads questions that contain images (about 6 GB)
```

**3. Allow the extension to talk to Ollama.** Ollama blocks requests from
browser extensions unless you tell it not to. Do this once:

- **Mac (Ollama app):**
  ```bash
  launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
  ```
  Then quit Ollama from the menu bar (llama icon → Quit) and open it again.
  You need to run this again after restarting your Mac. To avoid that, use
  the next option instead.
- **Mac or Linux (from Terminal):** quit the Ollama app, then run the
  following and leave the window open:
  ```bash
  OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  ```
- **Windows:** open *Start → "Edit the system environment variables" →
  Environment Variables*, add a new user variable named `OLLAMA_ORIGINS` with
  value `chrome-extension://*`, then quit Ollama from the system tray and
  start it again.

**4. Set up the extension.** In settings, choose **API or local model** →
Provider **Ollama (local)**. The model fields fill in with `qwen3:14b` and
`qwen2.5vl:7b`. Click **Test Connection**.

**Speed and accuracy:** with **Let the model think first** off (the
default), `qwen3:14b` takes about 10 seconds per question on a 16 GB M4 Mac
and got 8/8 on a test set of SmartBook questions. Turning thinking on makes it
more careful on matching and ordering but several times slower. On a less
powerful computer, try a smaller model such as `qwen3:8b` (pull it, then type
it into **Model**).

### Option D: Local model with LM Studio

1. Install LM Studio from <https://lmstudio.ai> and download a model (a
   Qwen3 or Llama model around 7–14B parameters works well).
2. In LM Studio, open the **Developer** tab, load the model and click
   **Start Server**.
3. In the extension settings, choose **API or local model** → Provider
   **LM Studio (local)**, and type the model's identifier (shown in LM
   Studio's Developer tab) into **Model**.
4. Click **Test Connection**.

---

## Using it

### SmartBook

1. If you're using the website-tab option, make sure the AI site is open and
   logged in (see [Option A](#option-a-ai-website-tab-easiest)).
2. Open your SmartBook assignment and go to the questions.
3. A new **Ask ChatGPT** button (or **Ask Claude (API)**, **Ask Ollama**,
   etc.) appears in SmartBook's top bar, next to a 📋 copy button and a ⚙️
   settings button.
4. Click **Ask …**. The extension reads the question, gets an answer, fills
   it in, picks a confidence level, submits, and moves to the next question.
   It keeps going until the assignment ends.
5. Click **Stop Automation** (the same button) at any time to stop.

Messages (errors, or "please answer this one yourself") appear as a small
box in the top-right corner of the page. They don't block the page; close
them with the ×.

**Want to check answers before they're submitted?** Turn on **Pause Before
Submit**. The extension fills in each answer and waits. You review it,
submit it and click Next yourself, and it carries on with the next question.

### Connect / ezTO quizzes

Open the quiz and click the **Ask …** button that appears in the quiz's
header. It answers multiple choice, true/false and fill-in-the-blank
questions. On anything else it asks you to answer that question yourself and
picks up again on the next one.

---

## Settings reference

| Setting | What it does |
|---|---|
| **Answer Source** | *AI website tab* (ChatGPT/Gemini/DeepSeek in a tab) or *API or local model*. |
| **Assistant** | Which AI website to use in website-tab mode. |
| **Provider / Model / API key / Base URL** | Settings for API and local mode. Each provider keeps its own model and key. |
| **Image model (optional)** | A second model that handles questions containing images, so you can use a stronger text-only model for everything else. |
| **Let the model think first** | For "thinking" models like qwen3: more accurate on matching and ordering, but much slower. |
| **Double Credit Mode** | Answers each question twice, once in a duplicate tab it opens and closes automatically, so each question counts twice toward your progress. The button shows **(2x)** when this is on. |
| **Randomize Confidence** | Picks High, Medium or Low confidence at random instead of always High. |
| **Use the AI's Confidence** | Picks the confidence level based on how sure the AI says it is. Overrides Randomize Confidence. |
| **Pause Before Submit** | Fills in each answer, then waits for you to submit it and go to the next question. |
| **Remember Graded Answers** | Turns the [answer bank](#answer-bank) on or off. On by default. |

Settings sync across Chrome browsers signed into the same Google account. API
keys don't sync.

---

## Answer bank

SmartBook repeats questions, especially ones you got wrong. When
**Remember Graded Answers** is on, the extension saves:

- answers SmartBook marked **correct**, and
- the **correct answer** SmartBook shows after a wrong answer.

The next time the same question appears (same wording and same choices), it
uses the saved answer immediately, without asking the AI. This makes repeat
questions faster and more accurate, even with a weaker local model.

In the **Answer Bank** section of settings you can see how many answers are
saved and how often they've been reused, and you can:

- **Export** the bank to a `.json` file (as a backup, or to give to a
  classmate using the same textbook),
- **Import** a `.json` file (merged with what you already have),
- **Clear** the bank.

---

## Updating

The **Updates** section of settings shows whether a newer version is
available on this repo's Releases page.

To update:

1. Download the new release zip and unzip it.
2. Replace the contents of your existing `auto-mcgraw` folder with the new
   files (keep the same folder location).
3. Go to `chrome://extensions` and click the ↻ reload icon on
   **Auto-McGraw Smartbook**.
4. Refresh any open SmartBook or AI tabs.

If you used `git clone`, run `git pull` in the folder instead of steps 1–2.

Your settings, API keys and answer bank are kept when you update this way.
(If you **remove** the extension and load it again, they're deleted. Export
your answer bank first.)

---

## Troubleshooting

**The "Ask …" button doesn't appear.**
Refresh the SmartBook page. The button appears on the question screen, not
the assignment list. If you just installed or reloaded the extension, any
page that was already open needs a refresh.

**"Auto-McGraw was updated or reloaded. Refresh this page…"**
The extension was reloaded while the page was open. Refresh the page.

**Website mode: "Open ChatGPT in another tab to use it"** (or it never gets
an answer)
Open the AI site in a tab, make sure you're logged in and not on a captcha or
"verify you're human" screen, then try again. Don't use that tab while
automation is running. If the site changed its layout recently, try a
different assistant or API mode.

**Test Connection: 401 / invalid key**
The key is wrong, expired, or the account has no credit. Generate a new key
and check your billing on the provider's site.

**Test Connection: 429 / rate limit**
You're sending requests too fast for your plan. The extension retries
automatically. If it keeps happening, wait a bit or check your plan's limits.

**Ollama: 403 Forbidden**
Ollama is blocking the extension. Redo
[step 3 of the Ollama setup](#option-c-local-model-with-ollama) and make sure
you restarted Ollama afterwards.

**Ollama: "can't connect" / network error**
Ollama isn't running. Open the Ollama app, or run `ollama serve`. Check that
the model name in settings exactly matches one shown by `ollama list`.

**Local model is very slow**
Turn off **Let the model think first**, or use a smaller model
(`qwen3:8b`). Closing other heavy apps helps too.

**It answered a question wrong or got stuck on one**
Click the 📋 button next to **Ask …**. This copies the question's details
to your clipboard. Open an [issue](https://github.com/LukeDN/auto-mcgraw/issues)
and paste them in. McGraw Hill sometimes changes its page layout, and this is
the quickest way to get it fixed.

---

## Privacy

- **API keys** are stored only in this browser on this computer
  (`chrome.storage.local`). They're never synced and never sent anywhere
  except the provider they belong to.
- **Questions** are sent only to the AI you picked: the website you chose, the
  API provider, or your own computer in local mode.
- **Settings** (not keys) sync through your Chrome account like any other
  extension's settings.
- The only other request the extension makes is the update check, which
  reads this repo's latest release from the GitHub API.

---

## For developers

No build step: the extension is plain JavaScript (Manifest V3). Edit the
files, then click ↻ on `chrome://extensions` and refresh the page.

```
manifest.json        extension manifest
background/          service worker: relays questions to the AI tab or API,
                     double-credit tab handling, prompt building
content/smartbook/   SmartBook question parsing, answering, matching, ordering
content/ezto/        Connect / ezTO quizzes
content/mhe/         shared McGraw page helpers and the in-page toolbar
content/assistant/   drives the ChatGPT / Gemini / DeepSeek websites
shared/              settings, provider presets, answer bank, messaging, DOM utils
popup/               settings page
tests/               Node tests (API client against a mock server)
docs/PLAN.md         design notes and roadmap
```

Run the tests (Node 20+):

```bash
node --test tests/*.test.mjs
```

Optional live tests against real providers:

```bash
LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=sk-ant-... node --test tests/api-client.test.mjs
LIVE_OLLAMA=qwen2.5vl:7b node --test tests/api-client.test.mjs
```

To publish a new version, bump `"version"` in `manifest.json` and create a
GitHub release tagged `vX.Y` with a zip of the extension. The settings page's
update check compares against the latest release tag.

---

## Credits and license

Originally created by [GooglyBlox](https://github.com/GooglyBlox/auto-mcgraw).
Released under the [MIT License](LICENSE).

This project isn't affiliated with or endorsed by McGraw Hill, OpenAI,
Google, Anthropic or DeepSeek. Using automation may break your school's
academic integrity policy or McGraw Hill's terms of service. You're
responsible for how you use it.
