# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HooHacks-2026 is a Node.js/Express backend that proxies chat messages to the Google Gemini API.

## Commands

```bash
npm install       # install dependencies
npm start         # run server (node server.js)
```

Set `GEMINI_API_KEY` in a `.env` file before running.

## Architecture

Single-file server (`server.js`) using Express + `@google/generative-ai`. All chat requests hit Gemini via `POST /chat` with `{ message }` body; responses return `{ reply, model }`. Deployed to Railway via `railway.toml`.
