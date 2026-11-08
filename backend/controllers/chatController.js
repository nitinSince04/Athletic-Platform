const { GoogleGenAI } = require('@google/genai');

// const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
let ai = null;

function getAI() {
  if (!ai) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing in .env');
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

const RULES = `You are the AI coaching assistant of FieldSignal, a cricket batting analysis platform.
Answer ANY question the user asks, helpfully and correctly.
For cricket or technique questions, use the session data below when it is available.
Keep answers short and clear (under 150 words) unless the user asks for detail.
Use plain text, no markdown tables.`;

function makeContext(analysis) {
  if (!analysis) {
    return '\n\nNo video analysis is open right now. If the user asks about their session, tell them to upload or open a video first.';
  }
  const data = {
    stroke: analysis.prediction?.stroke,
    confidence: analysis.prediction?.confidence,
    scores: analysis.scores,
    feedback: analysis.feedback,
    coaching: analysis.coaching_text,
  };
  return '\n\nCurrent session data (JSON): ' + JSON.stringify(data).slice(0, 3000);
}

exports.chatWithAI = async (req, res) => {
  try {
    const { message, history, analysis } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    // old messages -> Gemini format (last 10 only)
    const contents = (Array.isArray(history) ? history : []).slice(-10).map((m) => ({
      role: m.from === 'ai' ? 'model' : 'user',
      parts: [{ text: String(m.text).slice(0, 2000) }],
    }));

    // Gemini needs the first message to be from the user
    while (contents.length > 0 && contents[0].role === 'model') contents.shift();

    contents.push({ role: 'user', parts: [{ text: message.trim().slice(0, 2000) }] });

    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: contents,
      config: { systemInstruction: RULES + makeContext(analysis) },
    });

    const reply = response.text || "Sorry, I couldn't generate an answer. Please try again.";
    res.json({ success: true, reply: reply });
  } catch (error) {
    console.error('Gemini error:', error.message);
    res.status(500).json({ success: false, message: 'AI assistant is unavailable right now. Please try again.' });
  }
};