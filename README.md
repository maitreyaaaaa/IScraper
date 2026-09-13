This was made possible by two ChatGPT Plus, six Gemini Pro accounts, and one genius brain.
To prove this was built during the hackathon, we have included proof artifacts in [Proofs Created](./Proofs%20Created/). The idea, frontend direction, marketing site, workflow structure, logos, colors, and brand identity were planned earlier over months of discussion, but college and exams kept delaying the actual build; that is why the final product looks polished while the core implementation was completed in the hackathon with the help of those subscriptions and a very clear product vision.

# Ice Scraper

Ice Scraper is a private campaign-memory and workflow engine for saved internet references. It turns links, exports, screenshots, captions, posts, reels, and product inspiration into searchable workflows that help a creator or marketing team turn saved references into new marketing posts.

The product matters, but the main submission is the workflow layer: capture references, review them, enrich them, select saved posts as creative inputs, generate post/reel/carousel plans, create captions and hashtags, schedule the output, approve the next action, and keep a proof trail of what happened.

## Submission Links

- Live demo: [https://iscraper.vercel.app](https://iscraper.vercel.app)
- Demo video: [Google Drive demo video](https://drive.google.com/file/d/1U7ISjK09FKoINHVDLmvfyHnzZLvPZDmb/view?usp=sharing)
- Proof artifacts: [Proofs Created](./Proofs%20Created/)

## What It Does

- Imports official Instagram saved-post and saved-collection exports.
- Imports Pinterest exports from ZIP, JSON, CSV, or HTML files.
- Saves manual links from Pinterest, X, TikTok, YouTube, Instagram, articles, products, and normal web pages.
- Keeps saved material in a private library with review states before indexing.
- Enriches approved saves with summaries, OCR, transcripts, topics, tags, people, brands, tools, and repository references.
- Supports searchable answers with citations from the saved library.
- Builds smart collections, visual similarity, and an Obsidian-ready knowledge graph.
- Uses a worker workflow for indexing, retries, observability, and audit-friendly processing.
- Adds a Workflows tab where an AI agent can turn selected saved references into marketing content plans, media prompts, captions, hashtags, schedules, and approval-gated publish actions.

## Workflow Focus

### 1. Reference Capture

A user collects campaign references from exports, links, and browser saves. Ice Scraper normalizes those inputs into one private library instead of leaving them buried across platforms.

### 2. Human Review

New items can stay in review until the user approves them for indexing. This keeps the workflow clean and human-controlled. This matters because marketing teams do not want random scraped noise mixed into their strategy base.

### 3. Enrichment Pipeline

Approved items enter the indexing worker. The worker downloads what it can, extracts metadata, creates summaries, adds tags, detects useful entities, and prepares the item for search and clustering.

### 4. Campaign Memory

The library becomes a reusable memory of hooks, creative patterns, platform references, competitors, products, formats, and visual directions.

### 5. Marketing Workflow Creation

Instead of asking an AI tool from a blank prompt, the user can select saved reels, images, captions, or competitor references and ask the workflow agent to create a new post, reel, carousel, or campaign sequence grounded in those references.

### 6. Approval And Export

The system is designed for draft-first workflows: humans review generated media prompts, captions, hashtags, schedules, and publishing actions before anything is sent to Instagram or other channels.

## Demo Script

Target length: under 2 minutes.

**0:00-0:35 - Product intro**

"This is Ice Scraper. It is a private campaign-memory workspace for the useful things people save online: Instagram saves, Pinterest exports, competitor ads, product pages, hooks, landing pages, reels, and screenshots. In simple terms, it takes the content you already saved and makes it searchable, organized, and ready to use. But the main thing we are pitching is not just the library. It is the workflow engine built on top of that library."

**0:35-0:55 - Reference-to-workflow input**

"The user opens the Workflows tab and selects saved posts, reels, images, or campaign references from their Ice Scraper library. These become the creative inputs for the agent, so the workflow starts from real references instead of a blank prompt."

**0:55-1:20 - Agent planning**

"The user tells the agent what they want: for example, make an Instagram carousel from these two saved reels, create a product post in this style, or turn these references into a week of content. The agent understands the references, extracts the hook, format, tone, audience, and visual direction, then creates a step-by-step marketing workflow."

**1:20-1:40 - Content generation workflow**

"That workflow can generate a media prompt for an image or video model, draft the carousel structure, write captions, create hashtags, choose the format, and prepare the schedule. The point is that saved content becomes a reusable creative engine, not just an archive."

**1:40-1:55 - Approval and publishing**

"Before anything goes live, the human reviews and approves it. After approval, the workflow can dispatch through integrations like Composio to Instagram, and later the same system can extend to LinkedIn ghostwriting, carousels, and other channels."

**1:55-2:00 - Close**

"So the value is simple: Ice Scraper turns saved posts into marketing workflows that create new posts."

## Why It Helps

Most creators and marketers save useful material constantly, but their saved content does not become a working system. Ice Scraper turns that passive archive into an active workflow for campaign research, creative direction, generated marketing assets, scheduling, and approval-gated publishing.

For judges, the strongest parts to inspect are:

- Technical execution: monorepo with React/Vite UI, Express orchestration API, worker runtime, Supabase-ready storage, migrations, and browser-extension work.
- Reliability and evaluation: tests around imports, workers, storage, search, visual similarity, billing, security checks, and route behavior.
- Usefulness: practical workflows for marketers, creators, agencies, and builders who already collect references and need to turn them into publishable posts.
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
