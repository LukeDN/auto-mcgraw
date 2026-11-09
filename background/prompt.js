(() => {
  const RESPONSE_FORMAT =
    "\n\nIMPORTANT: Your answer should be in a JSON code block." +
    '\n\nPlease provide your answer in JSON format with keys "answer", "explanation" and "confidence". Explanations should be no more than one sentence. "confidence" is a number from 0 to 1 for how likely your answer is correct. DO NOT acknowledge the correction in your response, only answer the new question.';
  // API providers enforce the JSON shape with a schema (background/api-client.js).
  const API_RESPONSE_FORMAT =
    "\n\nReply with the JSON object only. Do not acknowledge any correction above; just answer this question.";

  function numbered(items) {
    return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
  }

  function correctionPreamble({ question, correctAnswer }) {
    return `CORRECTION FROM PREVIOUS ANSWER: For the question "${question}", your answer was incorrect. The correct answer was: ${JSON.stringify(
      correctAnswer
    )}\n\nNow answer this new question:\n\n`;
  }

  function imageNote(images) {
    if (!images?.length) return "";
    let note = `\n\n${images.length} image(s) from the question are attached. Use them to answer.`;
    if (images.some((image) => image.annotated)) {
      note +=
        " Yellow numbered boxes on the image mark the drop zones: box N is the prompt numbered N above.";
    }
    return note;
  }

  function build(
    { type, question, options, previousCorrection, retryNote, images },
    { api = false } = {}
  ) {
    let prompt = `Type: ${type}\nQuestion: ${question}`;

    if (previousCorrection?.question && previousCorrection?.correctAnswer) {
      prompt = correctionPreamble(previousCorrection) + prompt;
    }

    if (type === "matching") {
      prompt += `\nPrompts:\n${numbered(options.prompts)}`;
      prompt += `\nChoices:\n${numbered(options.choices)}`;
      prompt +=
        "\n\nPlease match each prompt with the correct choice. Set \"answer\" to an array of strings using the exact format 'Prompt -> Choice'. Include one entry per prompt, use exact prompt and choice text, and use each choice at most once. You do not need to interact with any page or perform any drag and drop yourself; just reply with the text answer in the JSON block.";
    } else if (type === "ordering") {
      prompt += `\nItems:\n${numbered(options)}`;
      prompt +=
        "\n\nPut ALL of the items above in the correct order as the question asks. Set \"answer\" to an array of the item texts in order, first to last, copying each item's text exactly. Include every item exactly once. You do not need to interact with any page or drag anything yourself; just reply with the text answer in the JSON block.";
    } else if (type === "fill_in_the_blank") {
      prompt +=
        "\n\nThis is a fill in the blank question. If there are multiple blanks, provide answers as an array in order of appearance. For a single blank, you can provide a string.";
    } else if (options?.length > 0) {
      prompt += `\nOptions:\n${numbered(options)}`;

      if (type === "multiple_select") {
        prompt +=
          '\n\nIMPORTANT: This is a "select all that apply" question. Set "answer" to an array containing EVERY correct option. Each entry must EXACTLY match one of the options above. Do not include option numbers.';
      } else {
        prompt +=
          "\n\nIMPORTANT: Your answer must EXACTLY match one of the above options. Do not include numbers in your answer. If there are periods, include them.";
        if (type !== "multiple_choice" && type !== "true_false") {
          prompt +=
            ' If more than one option is correct, set "answer" to an array of all of them.';
        }
      }
    }

    prompt += imageNote(images);
    if (retryNote) prompt += `\n\nNOTE: ${retryNote}`;

    return prompt + (api ? API_RESPONSE_FORMAT : RESPONSE_FORMAT);
  }

  AutoMcGraw.prompt = { build };
})();
