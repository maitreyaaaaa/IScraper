# IScraper

Private searchable library for the posts, links, exports, and references you save across the web.

IScraper helps creators and builders stop losing useful internet material. Import official exports, save links manually, approve what should become searchable, enrich it with AI, search it with citations, and export a knowledge graph when you want to work with the library elsewhere.

## Available Now

- Import official Instagram saved-post and saved-collection exports.
- Import Pinterest export ZIP, JSON, CSV, or HTML files.
- Save manual links from Pinterest, X, TikTok, YouTube, Instagram, articles, products, or any normal web page.
- Send user-triggered saves directly into the private library and indexing queue.
- Search approved saves from metadata immediately.
- Enrich saves with summaries, OCR, transcripts, topics, tags, people, brands, tools, and repositories.
- Show why a search result matched and collect result feedback.
- Generate AI answers with citations from saved items.
- Run Lens search with selected text or a user-selected screenshot crop from the browser extension development build.
- Export an Obsidian-ready graph of indexed saves and concepts.
- Run with local JSON storage for development or Supabase for production.

## Coming Soon

- Browser-store release for the Save to IScraper extension.
- One-click extension capture for screenshots, selected text, images, and videos.
- Broader extension install support after browser-store review and QA.

## Monorepo

This repository is an npm workspace monorepo. The website, backend, and browser extension are separate packages with separate build/release paths.

- `apps/orchestration` (`@iscraper/orchestration`): Express API, import parsers, search, Lens, queue worker, stores, and Supabase migrations.
- `apps/ui` (`@iscraper/ui`): React/Vite frontend, landing page, saved library, upload flow, graph, account settings, and help pages.
- `extensions/save-to-iscraper` (`@iscraper/save-to-iscraper`): Manifest V3 Chromium extension for saving pages and running Lens search during development/store-submission work.

## Local Run

```bash
npm install
npm run dev:api
```

```bash
npm run dev:web
```

Frontend: `http://127.0.0.1:5173`

Backend: `http://127.0.0.1:3001`

Create `apps/orchestration/.env` from `apps/orchestration/.env.example` before running the API locally.

## Workspace Commands

```bash
npm run lint
npm run test
npm run build
npm run check
```

Focused commands:

```bash
npm run build:web
npm run test:api
npm run lint:extension
npm run build:extension
```

The extension build writes an unpacked browser extension to `extensions/save-to-iscraper/dist`. Load that folder in Chrome or Edge during development.

## Privacy

Saved exports, downloaded media, local indexes, provider keys, extension tokens, and other secrets are intentionally ignored by Git. The browser extension does not store the user's main Supabase login token; Lens uses a limited revokable extension token.
