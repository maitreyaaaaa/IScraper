# Instagram Brain

Searchable brain for Instagram saved reels, posts, and collections.

## What It Does

- Imports Instagram `saved_posts.html` and `saved_collections.html`.
- Parses every saved item, not just a small batch.
- Queues processing with resumable job states.
- Enriches saved items with transcript/OCR/metadata fields.
- Searches captions, transcripts, brands, tools, repos, people, topics, and tags.
- Supports local JSON storage for development and Supabase for production.
- Uses DeepSeek through OpenRouter for structured text analysis by default.

## Apps

- `apps/orchestration`: Express API, parser, queue worker, stores, Supabase migrations.
- `apps/ui`: React/Vite frontend.

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

Instagram exports, downloaded media, local indexes, and API keys are intentionally ignored by Git.
