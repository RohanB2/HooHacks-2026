require("dotenv").config();
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSystemPrompt } = require("./uvadata");
const { getTransitData } = require("./transitData");
const { searchUVA, extractPage, getDiningMenu } = require("./tavilySearch");
const { createCalendarEvent, findCalendarEvents, deleteCalendarEvent, updateCalendarEvent } = require("./googleCalendar");
const { getCampusBookingGuide, checkLibraryAvailability } = require("./bookingAgent");
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
      attendees: { type: "array", items: { type: "string" }, description: "Optional list of attendee email addresses to invite" },
      createMeet: { type: "boolean", description: "Set true to generate a Google Meet video link for this event" },
    },
    required: ["title", "startDateTime", "endDateTime"],
  },
};

const FIND_EVENTS_TOOL_DECL = {
  name: "findCalendarEvents",
  description:
    "Search the user's Google Calendar for events by title keyword and/or time range. Use this before deleting or updating an event to get the event ID. Returns event IDs, titles, start times, and attendees. When searching for an event to delete, omit timeMin and timeMax to search the default window (past 7 days through next 14 days), which covers both future and already-started events.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional keyword to search event titles, e.g. 'study session'" },
      timeMin: { type: "string", description: "Optional ISO 8601 lower bound for event start time" },
      timeMax: { type: "string", description: "Optional ISO 8601 upper bound for event start time" },
      maxResults: { type: "integer", description: "Max events to return, default 5" },
    },
    required: [],
  },
};

const DELETE_EVENT_TOOL_DECL = {
  name: "deleteCalendarEvent",
  description:
    "Delete an event from the user's Google Calendar by event ID. Always call findCalendarEvents first to get the event ID. Notifies attendees of cancellation automatically.",
  parameters: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "The Google Calendar event ID (from findCalendarEvents)" },
    },
    required: ["eventId"],
  },
};

const UPDATE_EVENT_TOOL_DECL = {
  name: "updateCalendarEvent",
  description:
    "Update an existing event on the user's Google Calendar. Always call findCalendarEvents first to get the event ID. Can add attendees (sends invite emails), set/update a location, and/or add a Google Meet video link.",
  parameters: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "The Google Calendar event ID (from findCalendarEvents)" },
      attendeeEmails: { type: "array", items: { type: "string" }, description: "Email addresses to invite as attendees" },
      location: { type: "string", description: "Location to set on the event" },
      createMeet: { type: "boolean", description: "Set true to add a Google Meet video link to the event" },
    },
    required: ["eventId"],
  },
};

const BOOKING_TOOL_DECL = {
  name: "getCampusBookingGuide",
  description:
    "Get official booking instructions, URLs, and step-by-step guidance for reserving non-library campus spaces: AFC/RecSports fitness classes, makerspaces (RMC, DML, Shannon Makerspace), and meeting/event spaces (25Live). Do NOT use this for library study rooms — use checkLibraryAvailability instead.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["rec_fitness_class", "makerspace", "meeting_space"],
        description: "Type of campus booking: rec_fitness_class, makerspace, or meeting_space",
      },
      venueHint: {
        type: "string",
        description: "Optional: specific venue name (e.g. 'AFC', 'RMC')",
      },
      dateHint: {
        type: "string",
        description: "Optional: when they want to book (e.g. 'tomorrow', 'Friday afternoon')",
      },
    },
    required: ["category"],
  },
};

const CHECK_LIBRARY_AVAILABILITY_TOOL_DECL = {
  name: "checkLibraryAvailability",
  description:
    "Check real-time study room availability at a UVA library. ALWAYS call this when a student asks about available rooms, open study spaces, or wants to book a room at any UVA library. Returns live available rooms with capacity and bookable time slots. Supported libraries: Shannon, Brown (Brown Science & Engineering Library, near SEAS), Clemons (full library including conference rooms), Georges Student Center / Clem 2 / Clemons 2nd floor (2nd floor study rooms only — NOT RMC), RMC (Robertson Media Center, in Clemons basement), DML (Digital Media Lab), Fine Arts, Music, Scholars' Lab.",
  parameters: {
    type: "object",
    properties: {
      library: {
        type: "string",
        description: "Library name. Use 'Georges Student Center' or 'Clem 2' for the Clemons 2nd floor study rooms (NOT the same as full 'Clemons' or 'RMC'). Other options: 'Shannon', 'Clemons', 'Brown', 'RMC', 'DML', 'Fine Arts', 'Music', 'Scholars Lab'.",
      },
      date: {
        type: "string",
        description: "Which day to check. Pass 'today', 'tomorrow', or an ISO date (YYYY-MM-DD) for up to 2 weeks out. ALWAYS pass 'tomorrow' if the user says tomorrow. ALWAYS pass an ISO date if the user names a specific day.",
      },
      time: {
        type: "string",
        description: "Optional preferred time, e.g. '2pm', '14:00', '3:30 PM'. Returns rooms available around that time.",
      },
    },
    required: ["library"],
  },
};

const ALL_CALENDAR_DECLS = [CALENDAR_TOOL_DECL, FIND_EVENTS_TOOL_DECL, DELETE_EVENT_TOOL_DECL, UPDATE_EVENT_TOOL_DECL];
const ALL_BOOKING_DECLS = [BOOKING_TOOL_DECL, CHECK_LIBRARY_AVAILABILITY_TOOL_DECL];

// Full tool list: web search + dining + calendar + booking
const FULL_TOOLS = [
  { functionDeclarations: [...UVA_TOOLS[0].functionDeclarations, ...ALL_CALENDAR_DECLS, ...ALL_BOOKING_DECLS] },
];

// Calendar-only tool list (used when Tavily is absent but user wants calendar)
const CALENDAR_ONLY_TOOLS = [
  { functionDeclarations: ALL_CALENDAR_DECLS },
];

// Booking-only tool list (reservation guidance without Tavily)
const BOOKING_ONLY_TOOLS = [
  { functionDeclarations: ALL_BOOKING_DECLS },
];

// Calendar + booking (no Tavily)
const CALENDAR_BOOKING_TOOLS = [
  { functionDeclarations: [...ALL_CALENDAR_DECLS, ...ALL_BOOKING_DECLS] },
];

const CALENDAR_INTENT_PATTERN = new RegExp(
  [
    "add.{0,20}calendar",
    "google calendar",
    "put.{0,15}(on|in) my calendar",
    "create.{0,10}(calendar.{0,5})?event",
    "make.{0,10}(calendar.{0,5})?event",
    "set.{0,5}up.{0,10}(calendar.{0,5})?event",
    "schedule.{0,10}(a |an |the |my )?",
    "add.{0,10}event",
    "save.{0,15}calendar",
    "remind me.{0,20}(at|on|to)",
    "calendar reminder",
    // deletion
    "delete.{0,20}(event|meeting|session|appointment|calendar)",
    "remove.{0,20}(event|meeting|session|appointment|calendar)",
    "cancel.{0,15}(event|meeting|session|appointment)",
    // inviting
    "invite.{0,30}(to|for).{0,20}(event|meeting|session)",
    "add.{0,20}(attendee|guest|invit)",
    "@.{0,40}(event|meeting|session|calendar)",
  ].join("|"),
  "i"
);

const RESERVATION_INTENT_PATTERN = new RegExp(
  [
    "reserv",
    "book.{0,10}(a |the |my )?(study |library |group )?room",
    "study room",
    "group room",
    "lib\\.virginia\\.edu/spaces",
    "libcal",
    "recording studio",
    "makerspace",
    "maker space",
    "3d print",
    "laser cut",
    "book.{0,10}(a |the |my )?(fitness |afc |gym )?class",
    "sign.?up.{0,10}(for )?(a )?(fitness|afc|gym|yoga|cycle|zumba)",
    "book.{0,10}(a |the )?meeting.?(room|space)",
    "25live",
    "event space",
    // Library availability queries
    "available.{0,20}room",
    "open.{0,10}room",
    "(what|which|any).{0,20}room.{0,20}(available|open|free)",
    "(what|which|any).{0,20}(study|library).{0,20}(available|open|free)",
    "room.{0,20}available",
    "is there.{0,15}room",
    "find.{0,10}(a |the )?(study|library|group)?.{0,5}room",
    // library name before keyword: "Clemons rooms", "Shannon availability"
    "(shannon|clemons|clem|rmc|dml|brown|fine art|music|scholar|georges).{0,40}(room|available|open|space|book|reserv)",
    // keyword before library name: "rooms at Clemons", "available in Shannon"
    "(room|study|available|space|open|book|reserv).{0,30}(at |in |for |at the )?(shannon|clemons|clem|rmc|dml|brown|fine art|music|scholar|georges)",
    "(available|open|free).{0,20}(shannon|clemons|clem|rmc|dml|brown|fine art|music|scholar|georges)",
  ].join("|"),
  "i"
);

// ─── Marker helpers ───────────────────────────────────────────────────────────
// Calendar and library-room tool results are intercepted: the agent loop stores
// the data, passes a plain-text summary to Gemini, then appends the marker
// AFTER Gemini's final text so the model never sees or mangles the JSON.
const CALENDAR_TOOLS_SET = new Set(["createCalendarEvent", "deleteCalendarEvent", "updateCalendarEvent"]);
const BOOK_ROOM_TOOLS_SET = new Set(["checkLibraryAvailability"]);

function wrapCalendarResult(toolName, data) {
  if (!CALENDAR_TOOLS_SET.has(toolName) || typeof data !== "object" || data === null) return null;
  return data; // caller will stringify when appending
}

// ─── Agent loop ──────────────────────────────────────────────────────────────
async function runAgentLoop(model, message, history, res, userId = null, maxSteps = 6) {
  const contents = [
    ...history,
    { role: "user", parts: [{ text: message }] },
  ];
  let pendingCalendarEvent = null;
  let pendingBookRoom = null;

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
      if (pendingCalendarEvent) {
        res.write(`\n\n[CALENDAR_EVENT:${JSON.stringify(pendingCalendarEvent)}]`);
      }
      if (pendingBookRoom) {
        res.write(`\n\n[BOOK_ROOM:${JSON.stringify(pendingBookRoom)}]`);
      }
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
      else if (name === "findCalendarEvents") statusMsg = `📅 Searching your calendar...\n\n`;
      else if (name === "deleteCalendarEvent") statusMsg = `🗑️ Deleting event from your calendar...\n\n`;
      else if (name === "updateCalendarEvent") statusMsg = `📨 Updating event...\n\n`;
      else if (name === "checkLibraryAvailability") statusMsg = `📚 Checking room availability at ${args.library || "the library"}...\n\n`;
      else if (name === "getCampusBookingGuide") statusMsg = `🏛️ Looking up ${args.category?.replace(/_/g, " ")} booking info...\n\n`;
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
        } else if (name === "findCalendarEvents") {
          if (!userId) {
            toolResult = "The user is not signed in.";
          } else {
            toolResult = await findCalendarEvents(userId, args);
          }
        } else if (name === "deleteCalendarEvent") {
          if (!userId) {
            toolResult = "The user is not signed in.";
          } else {
            toolResult = await deleteCalendarEvent(userId, args);
          }
        } else if (name === "updateCalendarEvent") {
          if (!userId) {
            toolResult = "The user is not signed in.";
          } else {
            toolResult = await updateCalendarEvent(userId, args);
          }
        } else if (name === "checkLibraryAvailability") {
          toolResult = await checkLibraryAvailability(args);
        } else if (name === "getCampusBookingGuide") {
          toolResult = await getCampusBookingGuide(args);
        } else {
          toolResult = `Unknown tool: ${name}`;
        }
      } catch (e) {
        toolResult = `Tool error: ${e.message}`;
      }

      // Intercept calendar mutation results: store event data, give Gemini plain text
      if (CALENDAR_TOOLS_SET.has(name) && typeof toolResult === "object" && toolResult !== null) {
        pendingCalendarEvent = { ...toolResult, _action: name };
        const evt = toolResult;
        if (evt.deleted) {
          toolResult = `Successfully deleted event "${evt.title}" (was scheduled for ${evt.start}).${evt.location ? ` Location was: ${evt.location}.` : ""}`;
        } else {
          const parts = [`Successfully ${name === "createCalendarEvent" ? "created" : "updated"} event "${evt.title}".`];
          parts.push(`Scheduled: ${evt.start} to ${evt.end} (${evt.timeZone}).`);
          if (evt.location) parts.push(`Location: ${evt.location}.`);
          if (evt.meetLink) parts.push(`Google Meet: ${evt.meetLink}`);
          if (evt.attendees?.length) parts.push(`Attendees: ${evt.attendees.join(", ")}.`);
          toolResult = parts.join(" ");
        }
      }

      // Intercept library availability results: store for frontend panel, pass summary to Gemini
      if (BOOK_ROOM_TOOLS_SET.has(name) && typeof toolResult === "object" && toolResult !== null) {
        pendingBookRoom = toolResult;
        const d = toolResult;
        if (d.type === "too_far") {
          pendingBookRoom = null; // don't show panel for this case
          toolResult = d.message;
        } else if (d.type === "rooms_available") {
          if (d.availableRooms?.length === 0) {
            toolResult = `No rooms available at ${d.library} on ${d.date}${d.timeHint ? ` around ${d.timeHint}` : ""}. The panel shows the full availability calendar link so the student can check other times.`;
          } else {
            const lines = d.availableRooms.map(
              (r) => `${r.name} (cap. ${r.capacity}): ${r.availableRanges.join(", ")}`
            );
            toolResult = `Available rooms at ${d.library} on ${d.date}:\n${lines.join("\n")}`;
          }
        } else if (d.type === "rooms_static") {
          const lines = d.rooms.map((r) => `${r.name} (cap. ${r.capacity})`);
          toolResult = `Rooms at ${d.library}: ${lines.join("; ")}. Booking link: ${d.bookingUrl}`;
        } else if (d.type === "library_list") {
          pendingBookRoom = null; // library list is text-only, no panel needed
          toolResult = d.libraries.map((l) => `${l.name} — ${l.roomCount} rooms`).join("; ");
        } else {
          toolResult = JSON.stringify(d);
        }
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
  if (pendingCalendarEvent) {
    res.write(`\n\n[CALENDAR_EVENT:${JSON.stringify(pendingCalendarEvent)}]`);
  }
  if (pendingBookRoom) {
    res.write(`\n\n[BOOK_ROOM:${JSON.stringify(pendingBookRoom)}]`);
  }
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
  const reservationIntent = RESERVATION_INTENT_PATTERN.test(message);
  const hasTavily = !!process.env.TAVILY_API_KEY;
  const useAgentTools = (needsLiveData && hasTavily) || calendarIntent || reservationIntent;

  const history = conversationHistory.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  try {
    if (useAgentTools) {
      // Pick the right tool set based on what APIs are available
      let tools;
      if (hasTavily) {
        tools = FULL_TOOLS;
      } else if (calendarIntent && reservationIntent) {
        tools = CALENDAR_BOOKING_TOOLS;
      } else if (calendarIntent) {
        tools = CALENDAR_ONLY_TOOLS;
      } else if (reservationIntent) {
        tools = BOOKING_ONLY_TOOLS;
      } else {
        tools = CALENDAR_ONLY_TOOLS;
      }

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
