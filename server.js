import express from "express";
import cors from "cors";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = "mistral-small-latest";
// Reading a diagram/screenshot correctly (numbers, which side is which, etc.)
// is harder than parsing plain text, so the image path gets Mistral's
// stronger reasoning+vision model instead of the fast/small one.
const MODEL_IMAGE = "mistral-medium-latest";
const PORT = process.env.PORT || 8787;

if (!MISTRAL_API_KEY) {
  console.error("Missing MISTRAL_API_KEY environment variable. Set it before starting the server.");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // screenshots need more headroom than plain text

const CURRICULUM_SCOPE = `"Maths problem" includes anything from a school maths curriculum, not
just compute-an-answer arithmetic/algebra. That covers: numeric calculations, word problems,
geometry, and just as much, conceptual and multiple-choice questions — e.g. classifying data as
categorical/numerical, identifying sampling techniques, naming a shape's properties, choosing
which statistical measure applies, true/false statements about a maths concept, etc. For
multiple-choice or classification questions, state which option is correct and explain the
reasoning/definition behind it, the same way you'd show working for a calculation. Only say you
can't find a maths question if the content is genuinely unrelated to maths (e.g. a nav bar, an
unrelated subject, a blank page) — a conceptual or multiple-choice question is still a maths
question and should always be answered.`;

const SYSTEM_PROMPT = `You are a patient maths tutor helping a student understand how to
solve a problem from their MathsOnline coursework. ${CURRICULUM_SCOPE} Given the question text,
respond with:
1. A short restatement of what's being asked.
2. A numbered, step-by-step method showing the working — explain WHY each step happens, not
   just the calculation, as if teaching the method to someone seeing it for the first time.
3. The final answer clearly labelled at the end.
Keep it concise and use plain text (no markdown symbols like ** or #). If the question text is
garbled or ambiguous, say so and explain your best interpretation before solving.`;

const SYSTEM_PROMPT_IMAGE = `You are a patient maths tutor looking at a screenshot of a
MathsOnline exercise page. Some questions there use interactive widgets (digit boxes, drag
targets, diagrams, multiple-choice buttons) instead of plain text, so you must read the problem
visually — read every label and number in the diagram carefully before doing anything else, since
misreading a value (e.g. mixing up which side of a triangle a number belongs to) is the most
common way this goes wrong. ${CURRICULUM_SCOPE} Respond with:
1. A short restatement of what the problem is, including the exact values/labels you read from
   the image (identify it from the screenshot; ignore navigation bars, sidebars, and unrelated UI
   chrome).
2. A numbered, step-by-step method showing the working — explain WHY each step happens.
3. Before giving the final answer, silently re-derive it a second way (or re-check the arithmetic)
   and only proceed once both attempts agree — if they don't agree, redo the reading of the image
   rather than guessing.
4. The final answer clearly labelled at the end.
Keep it concise and use plain text (no markdown symbols like ** or #). If you can't clearly make
out a maths question in the screenshot, say so plainly instead of guessing.`;

app.post("/solve", async (req, res) => {
  const { problemText } = req.body || {};

  if (!problemText || typeof problemText !== "string" || !problemText.trim()) {
    return res.status(400).json({ error: "problemText is required" });
  }
  if (problemText.length > 4000) {
    return res.status(400).json({ error: "problemText is too long" });
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: problemText }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Mistral API error:", response.status, errText);
      return res.status(502).json({ error: "Solver service error, try again shortly." });
    }

    const data = await response.json();
    const solution =
      data?.choices?.[0]?.message?.content ||
      "No solution returned — try rephrasing or re-selecting the question text.";

    res.json({ solution });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unexpected server error." });
  }
});

app.post("/solve-image", async (req, res) => {
  const { imageDataUrl, hint } = req.body || {};

  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "imageDataUrl (a data:image/... URL) is required" });
  }
  if (imageDataUrl.length > 8_000_000) {
    return res.status(400).json({ error: "Screenshot is too large." });
  }
  if (hint && (typeof hint !== "string" || hint.length > 300)) {
    return res.status(400).json({ error: "hint must be a short string." });
  }

  const promptText =
    hint && hint.trim()
      ? `Solve the maths problem shown in this screenshot. The student specifically says ` +
        `they're trying to: "${hint.trim()}" — a diagram can be asked about in more than one ` +
        `way (e.g. a triangle screenshot might be asked for a side length OR an angle), so ` +
        `treat what the student wrote as the authoritative answer to "what is being asked," ` +
        `even if the image alone looks like it could be interpreted differently.`
      : "Solve the maths problem shown in this screenshot.";

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL_IMAGE,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_IMAGE },
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Mistral API error:", response.status, errText);
      return res.status(502).json({ error: "Solver service error, try again shortly." });
    }

    const data = await response.json();
    const solution =
      data?.choices?.[0]?.message?.content ||
      "No solution returned — try again or crop closer to the question.";

    res.json({ solution });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unexpected server error." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`MathsOnline Helper backend listening on port ${PORT}`);
});
