# IScraper

Private searchable library for the posts, links, exports, and references you save across the web.

IScraper helps creators and builders stop losing useful internet material. Import official exports, save links manually, approve what should become searchable, enrich it with AI, search it with citations, and export a knowledge graph when you want to work with the library elsewhere.

## Available Now

- Import official Instagram saved-post and saved-collection exports.
- Import Pinterest export ZIP, JSON, CSV, or HTML files.
- Save manual links from Pinterest, X, TikTok, YouTube, Instagram, articles, products, or any normal web page.
- Review new saves before they become searchable.
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

## Apps

- `apps/orchestration`: Express API, import parsers, search, Lens, queue worker, stores, and Supabase migrations.
- `apps/ui`: React/Vite frontend, landing page, saved library, upload flow, graph, account settings, and help pages.
- `extensions/save-to-iscraper`: Manifest V3 Chromium extension for saving pages and running Lens search during development/store-submission work.

## Local Run

```bash
cd apps/orchestration
npm install
copy .env.example .env
npm run dev
```

```bash
cd apps/ui
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`

Backend: `http://127.0.0.1:3001`

## Privacy

Saved exports, downloaded media, local indexes, provider keys, extension tokens, and other secrets are intentionally ignored by Git. The browser extension does not store the user's main Supabase login token; Lens uses a limited revokable extension token.
