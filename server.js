require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSystemPrompt } = require("./uvadata");
const { getTransitData } = require("./transitData");

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = "gemini-2.5-flash";

// Fetch live GTFS transit data on startup, refresh every hour
let transitCache = { routes: {}, stops: {} };
getTransitData().then((data) => { transitCache = data; });
setInterval(() => { getTransitData().then((data) => { transitCache = data; }); }, 60 * 60 * 1000);

// MCP TOOLS PLACEHOLDER
// Future tools: libraryRoomReservation, afcClassBooking,
// mealSwipeDonation, sisEnrollmentLookup
// Each tool will follow the Gemini function calling format:
// { name, description, parameters: { type, properties, required } }
const tools = [];

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  // Stream plain text back so the frontend can read chunks word-by-word
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering on Railway

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: getSystemPrompt(transitCache),
      ...(tools.length > 0 && { tools }),
    });

    // Map frontend history format → Gemini format
    const history = conversationHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(message);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(text);
    }
  } catch (err) {
    console.error("Gemini error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate response" });
      return;
    }
    res.write("\n\nSorry, something went wrong on the trail. Please try again.");
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Wrangler backend running on port ${PORT}`));
