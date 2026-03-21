# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Wrangler is a UVA campus AI agent (HooHacks 2026, education track). A Next.js chat frontend streams responses from an Express/Gemini backend. Students ask anything about UVA — dining, buses, classes, health, libraries, housing — and get authoritative answers backed by a comprehensive UVA knowledge base.

## Commands

### Backend (repo root)
```bash
npm install          # install backend deps
npm start            # run server (node server.js) — needs .env with GEMINI_API_KEY
```

### Frontend (client/)
```bash
cd client
npm install
npm run dev          # dev server at localhost:3001
npm run build        # production build
```

Set `NEXT_PUBLIC_API_URL` in `client/.env.local` (or Vercel env vars) to point at the backend.

## Architecture

```
/
├── server.js        Express server — streaming /chat, /health
├── uvadata.js       Full UVA system prompt (all schools, dining, transit, etc.)
├── railway.toml     Railway deployment config
└── client/          Next.js 15 Pages Router app
    ├── pages/
    │   ├── _app.js
    │   └── index.js  Single-page chat UI (streaming, suggested chips)
    ├── styles/globals.css  Tailwind + custom animations
    ├── tailwind.config.js  Custom colors: wrangler-amber, uva-blue, dark-bg
    └── next.config.js      NEXT_PUBLIC_API_URL env passthrough
```

**Streaming flow:** `POST /chat` accepts `{ message, conversationHistory[] }` and returns a plain-text chunked stream. The frontend reads it via `response.body.getReader()` and appends chunks to the last message in state.

**Model:** `gemini-2.5-flash-preview-04-17` via `@google/generative-ai`. Conversation history is mapped to Gemini's `{ role: "user"|"model", parts: [{ text }] }` format and passed to `model.startChat({ history })`.

**MCP readiness:** `tools = []` array in `server.js` is the placeholder for Phase 3 Gemini function calling tools (library room reservations, AFC bookings, SIS lookups, etc.).

**Theme:** Dark `#1a1a1a` bg, amber `#D4A017` accents, UVA blue `#232D4B` header.

## Deployment

- **Backend → Railway:** Set `GEMINI_API_KEY` env var. `railway.toml` handles start command and health check.
- **Frontend → Vercel:** Set `NEXT_PUBLIC_API_URL` to the Railway backend URL (e.g. `https://your-app.railway.app`). Root directory in Vercel settings: `client`.

## Key files

- `uvadata.js` — edit this to update UVA facts. Shannon Library (2024) is the main library; Alderman no longer exists.
- `server.js:MODEL` — change the Gemini model string here.
