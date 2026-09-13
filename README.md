This was made possible by two ChatGPT Plus, six Gemini Pro accounts, and one genius brain.
To prove this was built during the hackathon, we have included proof artifacts in [Proofs Created](./Proofs%20Created/). The idea, frontend direction, marketing site, workflow structure, logos, colors, and brand identity were planned earlier over months of discussion, but college and exams kept delaying the actual build; that is why the final product looks polished while the core implementation was completed in the hackathon with the help of those subscriptions and a very clear product vision.

# IScraper

Ice Scraper is a private campaign-memory workspace for saved internet references. It turns links, exports, screenshots, captions, posts, and product inspiration into searchable workflows that help a creator or marketing team move from scattered saves to usable campaign decisions.

The product matters, but the main submission is the workflow layer: capture references, review them, enrich them, search them, cluster them, generate a brief, approve the next action, and keep a proof trail of what happened.

## What It Does

- Imports official Instagram saved-post and saved-collection exports.
- Imports Pinterest exports from ZIP, JSON, CSV, or HTML files.
- Saves manual links from Pinterest, X, TikTok, YouTube, Instagram, articles, products, and normal web pages.
- Keeps saved material in a private library with review states before indexing.
- Enriches approved saves with summaries, OCR, transcripts, topics, tags, people, brands, tools, and repository references.
- Supports searchable answers with citations from the saved library.
- Builds smart collections, visual similarity, and an Obsidian-ready knowledge graph.
- Uses a worker workflow for indexing, retries, observability, and audit-friendly processing.

## Workflow Focus

### 1. Reference Capture

A user collects campaign references from exports, links, and browser saves. Ice Scraper normalizes those inputs into one private library instead of leaving them buried across platforms.

### 2. Human Review

New items can stay in review until the user approves them for indexing. This keeps the workflow clean and human-controlled. This matters because marketing teams do not want random scraped noise mixed into their strategy base.

### 3. Enrichment Pipeline

Approved items enter the indexing worker. The worker downloads what it can, extracts metadata, creates summaries, adds tags, detects useful entities, and prepares the item for search and clustering.

### 4. Campaign Memory

The library becomes a reusable memory of hooks, creative patterns, platform references, competitors, products, formats, and visual directions.

### 5. Brief Creation

Instead of asking an AI tool from a blank prompt, the user can ask questions against their saved reference base and generate campaign briefs grounded in their own library.

### 6. Approval And Export

The system is designed for draft-first workflows: humans review outputs, approve what should be used, and can export structured knowledge for other tools.

## Demo Script

Target length: under 2 minutes.

**0:00-0:30 - Product intro**

"This is Ice Scraper. It is a private campaign-memory workspace for the useful things people save online: Instagram saves, Pinterest exports, competitor ads, product pages, hooks, landing pages, and screenshots. The product is not just a saved-link library. The important part is the workflow it creates from messy references to usable campaign decisions."

**0:30-0:55 - Capture workflow**

"First, we capture references from multiple sources. A user can import saved-post exports, upload Pinterest files, or manually save links. Everything lands in one library with source context, title, description, platform, and collections."

**0:55-1:15 - Review workflow**

"Next, the user reviews what should become part of the campaign memory. Items can wait for approval before indexing, which keeps the workflow clean and human-controlled. This matters because marketing teams do not want random scraped noise mixed into their strategy base."

**1:15-1:35 - Enrichment workflow**

"After approval, the indexing workflow enriches the item. It can summarize, tag, identify topics and brands, extract text, connect similar visuals, and prepare the save for search. The worker-based setup makes this more reliable than trying to do everything inside the UI."

**1:35-1:55 - Campaign workflow**

"Now the user can search the memory, ask cited questions, find patterns, cluster references, and turn the saved material into a campaign brief. Ice Scraper improves the workflow by making the creative process evidence-led: instead of starting from a blank prompt, teams start from the references they already collected."

**1:55-2:00 - Close**

"So the real value is the workflow: capture, review, enrich, search, brief, approve, and export."

## Why It Helps

Most creators and marketers save useful material constantly, but their saved content does not become a working system. Ice Scraper turns that passive archive into an active workflow for campaign research, creative direction, and reusable knowledge.

For judges, the strongest parts to inspect are:

- Technical execution: monorepo with React/Vite UI, Express orchestration API, worker runtime, Supabase-ready storage, migrations, and browser-extension work.
- Reliability and evaluation: tests around imports, workers, storage, search, visual similarity, billing, security checks, and route behavior.
- Usefulness: practical workflows for marketers, creators, agencies, and builders who already collect references.
- Originality: campaign memory built around saved references rather than another blank-prompt AI wrapper.
- Demo clarity: the demo is structured around the workflow, not a feature list.

## Repository Structure

- `apps/ui` - React/Vite frontend for landing, library, upload, search, graph, pricing, and account flows.
- `apps/orchestration` - Express API, import parsers, search workflows, indexing worker, stores, services, and Supabase migrations.
- `extensions/save-to-iscraper` - Manifest V3 Chromium extension for save and Lens workflows.
- `Proofs Created` - proof folder for build evidence, screenshots, logs, and other examiner-facing artifacts.

## Local Run

```bash
npm install
npm run dev:api
npm run dev:web
```

Frontend: `http://127.0.0.1:5173`

Backend: `http://127.0.0.1:3001`

Create `apps/orchestration/.env` from `apps/orchestration/.env.example` before running the API locally. Do not commit real keys or private user data.

## Checks

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

## Privacy And Safety

Ice Scraper is built around private libraries and approval-first workflows. Saved exports, downloaded media, local indexes, provider keys, extension tokens, and secrets are ignored by Git. The browser extension avoids storing the user's main Supabase login token and uses limited revokable extension-token flows for Lens work.
