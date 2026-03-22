require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSystemPrompt } = require("./uvadata");
const { getTransitData } = require("./transitData");
const { searchUVA, extractPage, getDiningMenu } = require("./tavilySearch");

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
          "Search the web for current UVA information: dining hours and menus, course listings and professors, library room availability, AFC class schedules, campus news and events, deadlines, research opportunities, and anything else that changes semester to semester. Always include 'UVA' or 'University of Virginia' in your query so results stay on-topic. Prefer sources like Lou's List (hooslist.virginia.edu or louslist.com), The Course Forum (thecourseforum.com), The Cavalier Daily (cavalierdaily.com), and official virginia.edu pages.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query — always include 'UVA' for context, e.g. 'UVA Observatory Hill dining menu today' or 'UVA CS 2000 level courses spring 2026 Lou\\'s List'",
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
      {
        name: "getDiningMenu",
        description:
          "Get the current dining menu for a UVA dining hall. Use this for any question about what food is being served, today's menu, or meal options at a specific dining location. This renders the live JavaScript page so it always reflects the current meal. Known locations: ohill (Observatory Hill), newcomb (Newcomb / Fresh Food Company), runk (Runk), lambeth (Eatery at Lambeth).",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "Dining hall name, e.g. 'ohill', 'newcomb', 'runk', or 'lambeth'",
            },
          },
          required: ["location"],
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

      let statusMsg;
      if (name === "webSearch") statusMsg = `🔍 Searching for "${args.query}"...\n\n`;
      else if (name === "getDiningMenu") statusMsg = `🍽️ Fetching ${args.location} dining menu...\n\n`;
      else statusMsg = `📄 Reading ${args.url}...\n\n`;
      res.write(statusMsg);

      let toolResult;
      try {
        if (name === "webSearch") {
          toolResult = await searchUVA(args.query);
        } else if (name === "readWebpage") {
          toolResult = await extractPage(args.url);
        } else if (name === "getDiningMenu") {
          toolResult = await getDiningMenu(args.location);
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
  const LIVE_DATA_PATTERN = new RegExp(
    [
      // News & media
      "news|article|latest|recent|cavalier daily|what('s| is) new|announcement|update",
      // Time-sensitive
      "open|hours|today|tonight|current|now|this week|this month|menu|available|closed|schedule",
      // Enrollment & registration
      "deadline|waitlist|when does|what time|register|registration|enroll|add.?drop",
      // Courses & professors
      "professor|prof\\b|instructor|who (is |are )?teaching|who teaches|which prof|taught by",
      "course|class|section|crn|credit|lecture|lab|discussion|syllabus|textbook|prereq",
      "offered|offering|semester|spring|fall|summer|next year",
      // Grades & difficulty
      "grade|gpa|grade distribution|difficulty|workload|lou.?s list|course forum|rate my",
      // Applications & admissions
      "apply|application|admission|accept|transfer",
      // Financial
      "tuition|fee|cost|price|pay|financ|scholarship|aid|grant|loan|bursar|work.?study",
      // Campus resources
      "reserv|book a room|study room|job|intern|career|handshake|recruit|opportun",
      // Events & orgs
      "event|activit|happening|going on|club|org\\b|organization|sport|intramural|greek|fraternity|sorority",
      // Rec & fitness
      "rec\\b|fitness|afc|gym|pool|class sign.?up",
      // Dining
      "dining|food|\\beat\\b|meal|swipe|cafeteria|cafe",
      // Housing & transit
      "housing|dorm|apartment|roommate|bus|route|transit|shuttle|parking|permit|transloc",
      // Health
      "health|appointment|doctor|nurse|counsel|mental|therapy|caps",
      // Research & international
      "research|lab|faculty|mentor|abroad|international|visa",
      // General how-to (almost always benefits from live search)
      "how do i|where can i|can i|do i need|how to|steps to",
      "when (is|are|does|do|can|should)|what (are|is) the",
    ].join("|"),
    "i"
  );
  const needsLiveData = LIVE_DATA_PATTERN.test(message);

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
