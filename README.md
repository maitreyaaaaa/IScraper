# IScraper

Private saved-content intelligence workspace for turning social exports and saved links into a searchable personal library.

## Overview

IScraper helps users import saved posts from Instagram, Pinterest, and saved links, then process them into a private searchable library with summaries, tags, collections, graph views, and AI-powered search.

The repo is split into a React/Vite frontend and an Express orchestration backend.

## Core Features

- Instagram and Pinterest export import flows.
- Saved-link capture and review queue.
- Upload progress and indexing status dashboard.
- Retry flow for paused or failed processing jobs.
- Private library with text search, filters, collections, platforms, and statuses.
- AI summaries, tags, topics, OCR/transcript fields, and graph metadata.
- Provider-key setup for OpenRouter/Gemini-style enrichment.
- Credits and usage messaging for the first-save allowance and future paid processing.
- Demo readiness panel showing indexing progress, key setup, saved-item count, and retry state.
- Supabase-backed auth/storage support with local development fallback paths.

## Apps

```text
apps/ui             React/Vite frontend
apps/orchestration  Express API, import parser, queue worker, stores, migrations
```

## Quick Start

Run the backend:

```bash
cd apps/orchestration
npm install
cp .env.example .env
npm run dev
```

Run the frontend:

```bash
cd apps/ui
npm install
npm run dev
```

Default local URLs:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:3001
```

## Useful Commands

Frontend:

```bash
cd apps/ui
npm run dev
npm run build
npm run lint
```

Backend:

```bash
cd apps/orchestration
npm run dev
npm run worker
npm test
```

## Privacy

Uploaded exports, downloaded media, local indexes, and API keys should stay out of Git. The product is designed for private libraries, not public scraping or reposting.

## Current Status

Demo-ready MVP. The UI build passes locally, and the product now exposes a clearer command center for upload/indexing progress, AI tag readiness, retry handling, and provider-key setup.

## Verified

```bash
cd apps/ui && npm run build
cd apps/orchestration && npm test
```
