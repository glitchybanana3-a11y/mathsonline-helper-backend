import express from "express";
import cors from "cors";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = "mistral-small-latest";
const PORT = process.env.PORT || 8787;

if (!MISTRAL_API_KEY) {
  console.error("Missing MISTRAL_API_KEY environment variable. Set it before starting the server.");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // screenshots need more headroom than plain text

const SYSTEM_PROMPT = `You are a patient maths tutor helping a student understand how to
solve a problem from their MathsOnline coursework. Given the question text, respond with:
1. A short restatement of what's being asked.
2. A numbered, step-by-step method showing the working — explain WHY each step happens, not
   just the calculation, as if teaching the method to someone seeing it for the first time.
3. The final answer clearly labelled at the end.
Keep it concise and use plain text (no markdown symbols like ** or #). If the question text is
garbled or ambiguous, say so and explain your best interpretation before solving.`;

const SYSTEM_PROMPT_IMAGE = `You are a patient maths tutor looking at a screenshot of a
MathsOnline exercise page. Some questions there use interactive widgets (digit boxes, drag
targets, diagrams) instead of plain text, so you must read the problem visually. Respond with:
1. A short restatement of what the problem is (identify it from the screenshot; ignore
   navigation bars, sidebars, and unrelated UI chrome).
2. A numbered, step-by-step method showing the working — explain WHY each step happens.
3. The final answer clearly labelled at the end.
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
  const { imageDataUrl } = req.body || {};

  if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "imageDataUrl (a data:image/... URL) is required" });
  }
  if (imageDataUrl.length > 8_000_000) {
    return res.status(400).json({ error: "Screenshot is too large." });
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
          { role: "system", content: SYSTEM_PROMPT_IMAGE },
          {
            role: "user",
            content: [
              { type: "text", text: "Solve the maths problem shown in this screenshot." },
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
