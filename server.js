require("dotenv").config();
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSystemPrompt } = require("./uvadata");
const { getTransitData } = require("./transitData");
const { searchUVA, extractPage, getDiningMenu } = require("./tavilySearch");
const { createCalendarEvent } = require("./googleCalendar");
const { initDb } = require("./db");
const { router: authRouter } = require("./auth");
const conversationsRouter = require("./conversations");

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3001",
  credentials: true,
}));
app.use(express.json());
app.use(passport.initialize());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = "gemini-2.5-flash";

// Fetch live GTFS transit data on startup, refresh every hour
let transitCache = { routes: {}, stops: {} };
getTransitData()
  .then((data) => {
    transitCache = data;
    return initDb();
  })
  .catch((err) => console.error("Startup error:", err));

setInterval(() => { getTransitData().then((data) => { transitCache = data; }); }, 60 * 60 * 1000);

// Mount auth and conversations routers
app.use("/auth", authRouter);
app.use("/conversations", conversationsRouter);

// ─── Gemini function declarations for Tavily tools ───────────────────────────
const UVA_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "webSearch",
        description:
          "Search the web for current UVA information: course listings and professors, library room availability, AFC class schedules, campus news and events, deadlines, research opportunities, and anything else that changes semester to semester. Do NOT use this for dining menus — use getDiningMenu instead. Always include 'UVA' or 'University of Virginia' in your query so results stay on-topic. Prefer sources like Lou's List (hooslist.virginia.edu or louslist.com), The Course Forum (thecourseforum.com), The Cavalier Daily (cavalierdaily.com), and official virginia.edu pages.",
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
          "Fetch the dining menu for a UVA dining hall. ALWAYS call this for any dining question. Supports today and tomorrow only — if the student asks for anything further ahead, do NOT call this tool; instead tell them only today/tomorrow lookups are supported and direct them to hd.virginia.edu. Known locations: ohill, newcomb, runk, lambeth, greenberry, daily dose, zaatar.",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "Dining hall name, e.g. 'ohill', 'newcomb', 'runk', or 'lambeth'",
            },
            date: {
              type: "string",
              enum: ["today", "tomorrow"],
              description: "Which day to fetch. Defaults to 'today'.",
            },
            mealPeriod: {
              type: "string",
              enum: ["breakfast", "brunch", "lunch", "dinner", "late night"],
              description: "Optional. Which meal period to show. If omitted, returns all available meals for that day.",
            },
          },
          required: ["location"],
        },
      },
    ],
  },
];

const CALENDAR_TOOL_DECL = {
  name: "createCalendarEvent",
  description:
    "Create an event on the signed-in user's Google Calendar. Use this when the user explicitly wants to add, schedule, or save a personal event with a specific date/time. Parse dates relative to TODAY'S CONTEXT and default to America/New_York unless the user specifies otherwise. If you don't have a time, ask the user before calling.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title" },
      startDateTime: { type: "string", description: "ISO 8601 start, e.g. 2026-03-27T14:00:00" },
      endDateTime: { type: "string", description: "ISO 8601 end, e.g. 2026-03-27T15:00:00" },
      location: { type: "string", description: "Optional location" },
      description: { type: "string", description: "Optional description" },
      timeZone: { type: "string", description: "IANA time zone, default America/New_York" },
    },
    required: ["title", "startDateTime", "endDateTime"],
  },
};

// Full tool list: web search + dining + calendar
const FULL_TOOLS = [
  { functionDeclarations: [...UVA_TOOLS[0].functionDeclarations, CALENDAR_TOOL_DECL] },
];

// Calendar-only tool list (used when Tavily is absent but user wants calendar)
const CALENDAR_ONLY_TOOLS = [
  { functionDeclarations: [CALENDAR_TOOL_DECL] },
];

const CALENDAR_INTENT_PATTERN = new RegExp(
  [
    "add.{0,20}calendar",
    "google calendar",
    "put.{0,15}(on|in) my calendar",
    "create.{0,10}event",
    "schedule.{0,10}(a |an |the |my )?",
    "add.{0,10}event",
    "save.{0,15}calendar",
  ].join("|"),
  "i"
);

// ─── Agent loop ──────────────────────────────────────────────────────────────
// Runs Gemini with Tavily tools. Streams status updates while tools run,
// then writes the final answer. Max 6 steps to prevent runaway loops.
async function runAgentLoop(model, message, history, res, userId = null, maxSteps = 6) {
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
      else if (name === "createCalendarEvent") statusMsg = `📅 Adding "${args.title}" to your calendar...\n\n`;
      else statusMsg = `📄 Reading ${args.url}...\n\n`;
      res.write(statusMsg);

      let toolResult;
      try {
        if (name === "webSearch") {
          toolResult = await searchUVA(args.query);
        } else if (name === "readWebpage") {
          toolResult = await extractPage(args.url);
        } else if (name === "getDiningMenu") {
          toolResult = await getDiningMenu(args.location, args.date, args.mealPeriod);
        } else if (name === "createCalendarEvent") {
          if (!userId) {
            toolResult = "The user is not signed in. They need to sign in and connect Google Calendar first.";
          } else {
            toolResult = await createCalendarEvent(userId, args);
          }
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

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-prod";

app.post("/chat", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  // Optionally extract user from JWT for personalization
  let chatUser = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      chatUser = jwt.verify(authHeader.slice(7), JWT_SECRET);
    } catch {
      // Invalid token — proceed as guest
    }
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
  const calendarIntent = CALENDAR_INTENT_PATTERN.test(message);
  const hasTavily = !!process.env.TAVILY_API_KEY;
  const useAgentTools = (needsLiveData && hasTavily) || calendarIntent;

  const history = conversationHistory.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  try {
    if (useAgentTools) {
      // Pick the right tool set based on what APIs are available
      let tools;
      if (hasTavily) tools = FULL_TOOLS;        // web + dining + calendar
      else           tools = CALENDAR_ONLY_TOOLS; // calendar only

      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: getSystemPrompt(transitCache, chatUser),
        tools,
      });
      await runAgentLoop(model, message, history, res, chatUser?.userId);
    } else {
      // Fast path — simple streaming, no tool calls
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: getSystemPrompt(transitCache, chatUser),
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
