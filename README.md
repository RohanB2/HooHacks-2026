# Wrangler — Your UVA Grounds Guide

**Live at [wrangleratuva.us](https://wrangleratuva.us/)**

Wrangler is an AI-powered campus assistant for University of Virginia students. Ask it anything about life on Grounds — dining menus, bus routes, library room availability, club sports, health resources, and more — and get a real, live answer instead of a Google rabbit hole.

Built at HooHacks 2026 (Education Track).

---

## What It Does

Wrangler runs a multi-step agentic loop powered by **Google Gemini 2.5 Flash**. Depending on your question, it can:

- **Check live dining menus** across O-Hill, Newcomb, and Runk by scraping `virginia.mydininghub.com` in real time
- **Find open study rooms** at any UVA library (Shannon, Clemons, Georges Student Center, Brown, RMC, DML, Fine Arts, Music, Scholars' Lab) with live slot availability via the LibCal API
- **Track UVA buses** with a live split-panel view showing real-time route and stop data from TransLoc GTFS
- **Search UVA resources** via Tavily web search scoped to university sources
- **Create, find, and delete Google Calendar events** — Wrangler can add a study session or campus event directly to your calendar
- **Answer general campus questions** — registration deadlines, course info, health resources, housing, recreation, and anything else on Grounds

### Key Features

- **Streaming responses** — words appear as they generate, no waiting for the full answer
- **Smart routing** — regex-based intent detection sends simple questions through a fast path and live-data questions through the full agent loop, keeping latency low
- **Google sign-in (optional)** — saves conversation history across sessions and lets Wrangler personalize responses to your school and year
- **Library room split panel** — room availability loads in a side panel with direct booking links to each room's LibCal page; supports late-night hours with midnight spillover
- **Bus tracker split panel** — real-time route/stop reference alongside the chat
- **Google Calendar integration** — connect your Google Calendar and Wrangler can create events directly from the chat

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Model | Google Gemini 2.5 Flash (`gemini-2.5-flash`) |
| Web Search | Tavily API |
| Page Extraction | Firecrawl |
| Transit Data | TransLoc GTFS (`api.transloc.com/gtfs/uva.zip`) |
| Library Availability | LibCal / Springshare API (`cal.lib.virginia.edu`) |
| Calendar | Google Calendar API (OAuth 2.0) |
| Auth | Google OAuth 2.0 + JWT |
| Database | PostgreSQL (users, conversations, messages) |
| Backend | Node.js + Express 5, deployed on Railway |
| Frontend | Next.js 15 + React 19 + Tailwind CSS, deployed on Vercel |

---

## Architecture

```
┌─────────────────────────────────────┐
│           Next.js Frontend          │
│   (Vercel — wrangleratuva.us)       │
│                                     │
│  Chat UI · Bus Tracker · LibCal     │
│  Calendar Panel · History Sidebar   │
└──────────────┬──────────────────────┘
               │ POST /chat (chunked stream)
               ▼
┌─────────────────────────────────────┐
│         Express Backend             │
│         (Railway)                   │
│                                     │
│  Intent Detection                   │
│       ↓                             │
│  Gemini Agent Loop                  │
│  ┌──────────────────────────────┐   │
│  │  webSearch    → Tavily       │   │
│  │  readWebpage  → Firecrawl    │   │
│  │  getDiningMenu→ Firecrawl    │   │
│  │  checkLibrary → LibCal API   │   │
│  │  createEvent  → Google Cal   │   │
│  │  findEvents   → Google Cal   │   │
│  │  deleteEvent  → Google Cal   │   │
│  │  updateEvent  → Google Cal   │   │
│  └──────────────────────────────┘   │
│                                     │
│  Google OAuth · JWT · PostgreSQL    │
└─────────────────────────────────────┘
```

The backend classifies each message against intent patterns before calling Gemini. Simple factual questions stream directly; questions about live data (dining, rooms, transit, events) enter the full agentic loop where Gemini can call tools in sequence and reason over the results.

Structured tool results (library room availability, calendar events) are appended as `[BOOK_ROOM:JSON]` / `[CALENDAR_EVENT:JSON]` markers *after* Gemini's text — the model never sees raw JSON in its context, preventing hallucination of structured data.

---

## Running Locally

### Prerequisites

- Node.js 20+
- A PostgreSQL database
- API keys (see Environment Variables below)

### Backend

```bash
# Install dependencies
npm install

# Copy and fill in env vars
cp .env.example .env

# Start the server
node server.js
```

### Frontend

```bash
cd client
npm install
# Set NEXT_PUBLIC_API_URL=http://localhost:3000 in client/.env.local
npm run dev
```

Frontend runs on `http://localhost:3001` (or the Next.js default port).

---

## Environment Variables

### Backend (Railway)

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key |
| `TAVILY_API_KEY` | Tavily search API key |
| `FIRECRAWL_API_KEY` | Firecrawl API key (`fc-...` format) |
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway PostgreSQL plugin) |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth 2.0 client secret |
| `JWT_SECRET` | Random 32+ character secret for signing JWTs |
| `BACKEND_URL` | Public backend URL (e.g. `https://your-app.railway.app`) |
| `FRONTEND_URL` | Public frontend URL (e.g. `https://wrangleratuva.us`) |

### Frontend (Vercel)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend URL (e.g. `https://your-app.railway.app`) |

---

## Google OAuth Setup

1. **Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application)
2. Add authorized redirect URIs:
   - `{BACKEND_URL}/auth/google/callback` — for sign-in
   - `{BACKEND_URL}/auth/google/calendar/callback` — for Calendar connection
3. Enable **Google Calendar API** in the same project
4. Copy Client ID and Client Secret to Railway env vars

---

## Supported Libraries (Live Room Availability)

| Library | Rooms | Notes |
|---|---|---|
| Shannon Library | 9 | Conference rooms + Taylor Room |
| Clemons Library | 15 | Full building including conference rooms |
| Georges Student Center | 11 | Clemons 2nd floor study rooms only |
| Brown Science & Engineering | 8 | Near SEAS |
| Robertson Media Center (RMC) | 5 | VR, audio, video studios |
| Digital Media Lab (DML) | 11 | Digitization workstations, video studio |
| Fine Arts Library | 3 | |
| Music Library | 2 | |
| Scholars' Lab | 5 | Shannon 308 |

All libraries support live slot availability via the LibCal grid API, including late-night hours with midnight spillover (e.g. Clemons open until 1:30 AM).

---

## Project Structure

```
/                        ← Backend (Node.js + Express)
├── server.js            ← Express server, Gemini agent loop, /chat endpoint
├── uvadata.js           ← System prompt, tool use rules, UVA campus context
├── bookingAgent.js      ← LibCal room availability, booking guidance
├── googleCalendar.js    ← Google Calendar CRUD via OAuth refresh tokens
├── tavilySearch.js      ← Web search (Tavily) + page extraction (Firecrawl)
├── transitData.js       ← GTFS bus data fetch + parse
├── auth.js              ← Google OAuth routes, JWT issuance
├── conversations.js     ← Conversation/message persistence routes
├── db.js                ← PostgreSQL pool + schema init
└── client/              ← Frontend (Next.js 15)
    └── pages/
        └── index.js     ← Chat UI, bus tracker, library panel, calendar panel
```
