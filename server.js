require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSystemPrompt } = require("./uvadata");
const { getTransitData } = require("./transitData");
const { searchUVA, extractPage } = require("./tavilySearch");

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = "gemini-2.5-flash";

// Fetch live GTFS transit data on startup, refresh every hour
let transitCache = { routes: {}, stops: {} };
getTransitData().then((data) => { transitCache = data; });
setInterval(() => { getTransitData().then((data) => { transitCache = data; }); }, 60 * 60 * 1000);

// ─── Gemini function declarations for Tavily tools ───────────────────────────
const UVA_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "webSearch",
        description:
          "Search UVA websites for current information: dining hours and menus, library room availability, AFC class schedules, event listings, deadlines, course offerings, and any other information that may have changed recently.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query, e.g. 'Observatory Hill dining hours today'",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "readWebpage",
        description:
          "Read the full content of a specific UVA webpage URL. Use this after webSearch to get complete details from a promising result.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Full URL of the UVA webpage to read",
            },
          },
          required: ["url"],
        },
      },
    ],
  },
];

// MCP TOOLS PLACEHOLDER
// Future tools: libraryRoomReservation, afcClassBooking,
// mealSwipeDonation, sisEnrollmentLookup
// Each tool will follow the Gemini function calling format:
// { name, description, parameters: { type, properties, required } }

// ─── Agent loop ──────────────────────────────────────────────────────────────
// Runs Gemini with Tavily tools. Streams status updates while tools run,
// then writes the final answer. Max 6 steps to prevent runaway loops.
async function runAgentLoop(model, message, history, res, maxSteps = 6) {
  const contents = [
    ...history,
    { role: "user", parts: [{ text: message }] },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const result = await model.generateContent({ contents });
    const candidate = result.response.candidates[0];
    const modelContent = candidate.content;
    contents.push(modelContent);

    const functionCalls = modelContent.parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      // No more tool calls — write the final answer
      const text = modelContent.parts.map((p) => p.text || "").join("");
      res.write(text);
      return;
    }

    // Execute each tool call and stream a status line
    const functionResponseParts = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;

      const statusMsg =
        name === "webSearch"
          ? `🔍 Searching for "${args.query}"...\n\n`
          : `📄 Reading ${args.url}...\n\n`;
      res.write(statusMsg);

      let toolResult;
      try {
        if (name === "webSearch") {
          toolResult = await searchUVA(args.query);
        } else if (name === "readWebpage") {
          toolResult = await extractPage(args.url);
        } else {
          toolResult = `Unknown tool: ${name}`;
        }
      } catch (e) {
        toolResult = `Tool error: ${e.message}`;
      }

      functionResponseParts.push({
        functionResponse: { name, response: { result: toolResult } },
      });
    }

    contents.push({ role: "user", parts: functionResponseParts });
  }

  res.write(
    "I searched several UVA sources but couldn't find a definitive answer. Try checking virginia.edu directly."
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  // Only use Tavily when the query needs live / time-sensitive data
  const needsLiveData =
    /open|hours|today|tonight|current|now|this week|menu|available|closed|schedule|deadline|waitlist|when does|what time|register/i.test(
      message
    );

  const history = conversationHistory.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  try {
    if (needsLiveData && process.env.TAVILY_API_KEY) {
      // Agentic path — Gemini decides when/what to search
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: getSystemPrompt(transitCache),
        tools: UVA_TOOLS,
      });
      await runAgentLoop(model, message, history, res);
    } else {
      // Fast path — simple streaming, no tool calls
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: getSystemPrompt(transitCache),
      });
      const chat = model.startChat({ history });
      const result = await chat.sendMessageStream(message);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) res.write(text);
      }
    }
  } catch (err) {
    console.error("Chat error:", err);
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
