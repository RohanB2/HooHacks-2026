# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Wrangler** — a UVA campus AI agent for HooHacks 2026 (education track). A wild-west-themed chat interface helping all UVA students find information about anything on Grounds, powered by Gemini Flash 2.5 with agentic tool use.

## Architecture

- **Backend** (`/`): Node.js + Express, deployed on Railway
- **Frontend** (`/client`): Next.js 15 + React 19 + Tailwind CSS, deployed on Vercel
- Frontend calls `NEXT_PUBLIC_API_URL/chat` (POST) and streams the chunked response word-by-word

## Running Locally

```bash
# Backend
node server.js

# Frontend
cd client && npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express server, Gemini agent loop, `/chat` POST endpoint |
| `uvadata.js` | System prompt (`getSystemPrompt`), transit data injection, TOOL USE RULES |
| `tavilySearch.js` | `searchUVA` (Tavily), `extractPage` (Firecrawl), `getDiningMenu` (Firecrawl direct) |
| `transitData.js` | Fetches static GTFS data from `api.transloc.com/gtfs/uva.zip` on startup |
| `client/pages/index.js` | Chat UI — dark `#1a1a1a` bg, amber `#D4A017` accents, UVA blue header |

## Agentic Flow

`needsLiveData` regex in `server.js` gates whether Gemini runs with tools vs. fast streaming.

The agent loop (`runAgentLoop`) supports four Gemini tools:

| Tool | Handler | Purpose |
|------|---------|---------|
| `webSearch` | `searchUVA()` | Tavily full-web search |
| `readWebpage` | `extractPage()` | Firecrawl JS-rendered page reader |
| `getDiningMenu` | `getDiningMenu()` | Direct Firecrawl scrape of `virginia.mydininghub.com` |

**Critical**: TOOL USE RULES in `uvadata.js` must explicitly name `getDiningMenu` and `getBusArrivals` — if the rules only say "call webSearch", Gemini will use that instead.

## Environment Variables

```
GEMINI_API_KEY       — Google AI Studio
TAVILY_API_KEY       — Tavily search API
FIRECRAWL_API_KEY    — Firecrawl (fc-... format, not fc_dev_...)
```

All must be set in Railway env vars (backend) and Vercel env vars (frontend only needs `NEXT_PUBLIC_API_URL`).

## Deployment

- **Railway**: backend root, `startCommand = "node server.js"`, `.railwayignore` excludes `client/`
- **Vercel**: `client/` directory, set `NEXT_PUBLIC_API_URL` to Railway backend URL

## Known Gotchas

- Firecrawl: `const { default: FirecrawlApp } = require("@mendable/firecrawl-js")` — named default export
- `needsLiveData` regex: must use `new RegExp([...].join("|"), "i")` — JS doesn't support multiline regex literals
- Next.js treats every file in `client/pages/` as a route — utility files go in `client/lib/`
- Railway detects Next.js in `client/` and tries to run it instead of `node server.js` — `.railwayignore` and `nixpacks.toml` prevent this
- Dining hub (`virginia.mydininghub.com`) is a React SPA — Firecrawl works without dropdown actions since the page auto-loads the current meal period; O-Hill sometimes has no menu posted (genuine data gap, not a scraping failure); Runk may get reCAPTCHA blocked
- TransLoc GTFS static URL: `https://api.transloc.com/gtfs/uva.zip` — still works. The TransLoc OpenAPI v1.2 on RapidAPI is dead (404). No free real-time arrivals API exists for UVA buses as of 2026.
