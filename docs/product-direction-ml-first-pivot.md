# IScraper Product Direction: ML-First Memory Engine

## Status

Current product direction draft, created 2026-09-04.

## One-Line Direction

IScraper should move from an LLM-heavy saved-content app to a private ML-first memory engine where deterministic extraction, specialized deep-learning models, and hybrid retrieval do most of the work, while LLMs are used only for final synthesis, ambiguous cases, and user-requested deep analysis.

## Why This Pivot Matters

The current product promise is right: users need a private searchable library for useful internet material they save across social platforms and the web.

The cost structure needs to change. Running large generative AI over most saved items is too expensive for a broad consumer and creator product. The scalable version indexes most saves with cheaper computer-vision, speech, NLP, and retrieval models, then spends LLM tokens only when the user asks for a higher-level answer.

## Current Context

The current repository already supports:

- Official Instagram and Pinterest import flows.
- Manual link capture and notes.
- Review-before-indexing states.
- Processing jobs drained by a worker.
- AI enrichment for summaries, OCR, transcripts, topics, tags, people, brands, tools, repositories, and visual descriptions.
- Keyword search, semantic search, AI answers with citations, Lens search, visual similarity, Smart Collections, and graph export.
- Supabase, pgvector, worker leases, provider credentials, credits, and operational backpressure.

The pivot does not throw this away. It changes which layer is responsible for most intelligence.

## New Product Positioning

Old framing:

- Private AI memory library for saved internet knowledge.

Sharper framing:

- Private ML-powered memory engine for saved internet knowledge, with AI answers only when useful.

User-facing language should stay simple:

- Save from anywhere.
- IScraper reads captions, screenshots, images, and videos.
- Search everything later with evidence.
- Ask questions when you need a deeper answer.

Avoid over-positioning the product as:

- A generic AI wrapper.
- A scraping tool.
- A pure chatbot.
- A fully autonomous agent platform.
- A product that must deeply understand every save before it becomes useful.

## Core Architecture Direction

The indexing pipeline should become tiered:

1. Capture and normalize
   - Store URL, platform, creator, caption, hashtags, source title, source description, thumbnail, content type, collections, and user approval state.

2. Deterministic extraction
   - Extract hashtags, handles, URLs, repo names, obvious brands/tools, dates, domains, and lightweight topics through rules and dictionaries.
   - This should run for every approved save without requiring an LLM provider.

3. Specialized ML and deep-learning extraction
   - OCR for images and screenshots.
   - Speech-to-text for reels and videos.
   - Text embeddings for semantic retrieval.
   - Image embeddings for visual similarity.
   - Small classifiers for topic/category prediction.
   - Deduplication and clustering through similarity scores and content hashes.

4. Hybrid retrieval
   - Combine keyword/BM25-style search, pgvector semantic search, tags/entities, visual similarity, filters, recency, and user feedback.

5. LLM synthesis
   - Use an LLM only after retrieval, normally over the top few results.
   - The LLM should explain, compare, summarize, and cite existing saved evidence.
   - It should not be the default worker for every saved item.

## What Should Become Non-LLM

| Capability | Current expensive instinct | ML-first replacement |
| --- | --- | --- |
| Caption cleanup | LLM rewrite or summary | deterministic cleanup plus extractive summary |
| Hashtags and mentions | LLM extraction | regex and platform parser |
| Brands/tools/repos | LLM extraction | dictionary, pattern matching, NER, optional small classifier |
| Screenshot text | multimodal LLM | OCR pipeline |
| Video transcript | multimodal LLM | speech-to-text model |
| Visual similarity | visual LLM description | CLIP/SigLIP-style image embeddings |
| Semantic search | hosted embedding API only | local or batch embedding model, pgvector |
| Topic tags | LLM-generated tags | supervised or zero-shot classifier plus user feedback |
| Duplicate detection | LLM judgment | content hashes, URL canonicalization, vector similarity |
| Search answer | LLM over broad context | LLM only over top retrieved items |

## What Should Stay LLM

LLMs still matter, but they should be a premium or targeted layer:

- Final answer generation with citations.
- "Why is this useful?" when the user requests deep analysis.
- Comparing multiple saved ideas.
- Turning a retrieved set into a research brief.
- Handling ambiguous, mixed, or low-confidence extractions.
- Backfilling high-value saves selected by the user.

## First Implementation Steps

1. Make non-LLM indexing a first-class path.
   - Approved saves should become searchable through deterministic metadata analysis even when no text AI provider is configured.
   - Missing provider should block only deep enrichment, not basic indexing.

2. Add explicit analysis depth.
   - Store internal processing levels such as `basic`, `ml`, and `ai_enriched`.
   - Never expose the labels "Basic", "ML", or "AI enriched" directly in the frontend.
   - Basic means deterministic metadata is indexed.
   - ML means OCR/transcript/embeddings/classifiers ran.
   - AI enriched means LLM enrichment ran.

3. Add content hashes. Initial internal storage, unchanged-embedding skip, and unchanged media-extraction skip implemented 2026-09-08.
   - Hash normalized caption, OCR text, transcript, visual frame references, and embedding content.
   - Do not re-run embeddings or ML extraction if the source content did not change.

4. Move embeddings to batch-first behavior.
   - Generate embeddings after basic indexing, in worker batches.
   - Treat embedding failure as degraded search quality, not an indexing failure.

5. Add OCR before visual LLM.
   - Initial local ML extractor contract implemented 2026-09-08 through `LOCAL_ML_ENDPOINT`.
   - The worker and screenshot capture now try local OCR/media extraction before paid multimodal analysis.
   - The worker reuses existing media-derived OCR/transcript/visual fields when the source-content hash has not changed.
   - Run OCR for screenshots and images.
   - Use OCR output in search immediately.
   - Call a multimodal LLM only when OCR/confidence is weak or user asks for deep analysis.

6. Add video audio transcription before video LLM.
   - Extract audio from videos.
   - Run speech-to-text.
   - Use transcript for search, topics, and summaries.
   - Avoid sending full videos to multimodal LLMs by default.

7. Add visual embeddings. Initial internal visual-embedding storage and item-to-item vector ranking implemented 2026-09-08.
   - Sample thumbnails/key frames.
   - Generate image embeddings.
   - Store vectors or compact signatures for visual similarity. The first implementation stores internal visual vectors returned by the local extractor and uses them for similar-visual ranking when available.
   - Use LLM visual descriptions only as optional deep enrichment.

8. Add retrieval evaluation and cost tracking.
   - Track cost per indexed save, cost per successful search, and LLM calls avoided.
   - Track search success feedback by analysis depth.

## Product UX Changes

Keep this understandable for non-technical users:

- "Search ready" instead of "Basic search ready" or "deterministic metadata indexed."
- "Image text found" instead of "OCR complete."
- "Video transcript ready" instead of "ASR complete."
- "Improve this save" instead of "AI enriched" or making AI feel mandatory.
- "Improve this save" as the user action that triggers expensive analysis.

Internal processing labels are for routing, billing, analytics, and debugging only. The frontend should communicate outcomes: searchable, image text found, transcript ready, still processing, needs review, or could be improved.

The user should always know:

- What was saved.
- What is searchable now.
- What is still processing.
- What failed.
- What needs a key, credits, or approval.

## Success Metrics

Cost:

- Cost per approved save.
- LLM calls per 100 saves.
- Percentage of saves searchable without LLM.
- Percentage of LLM calls triggered by explicit user action.

Quality:

- Search success feedback ratio.
- Search click/open rate.
- Query reformulation rate.
- Retrieval quality by analysis depth.
- OCR/transcript extraction success rate.

Activation and retention:

- Time to first searchable item.
- Percentage of users with five searchable saves.
- First successful retrieval.
- Second retrieval within seven days.

## Non-Goals

- Do not build a custom foundation model.
- Do not fine-tune models before there is usage data.
- Do not make every saved item go through expensive deep analysis.
- Do not remove review-before-indexing or privacy controls.
- Do not expose provider keys or secret model infrastructure to the frontend.
- Do not make autonomous external actions part of this pivot.

## Implementation Principle

The product should be useful at `basic`, better at `ml`, and excellent at `ai_enriched`.

If `ai_enriched` is required for the product to feel useful, the cost model is still broken.

## Local ML Extractor Contract

The orchestration service can call an optional local extraction service through `LOCAL_ML_ENDPOINT`.

Initial Node service entrypoint implemented 2026-09-08:

- Start locally with `npm.cmd run dev:ml`.
- Default bind address is `127.0.0.1:3037`.
- Set `LOCAL_ML_ENDPOINT=http://127.0.0.1:3037` for the orchestration worker/API.
- Set the same `LOCAL_ML_API_KEY` on both the orchestration process and the local extractor process when an auth key is required.

This service should expose:

- `POST /v1/media/analyze` for downloaded image/video paths available to the worker.
- `POST /v1/image/analyze` for browser screenshot buffers.

Expected response fields match the existing analysis shape:

- `title`
- `summary`
- `transcript`
- `ocrText`
- `visualDescription`
- `brandsMentioned`
- `toolsMentioned`
- `reposMentioned`
- `peopleMentioned`
- `topics`
- `tags`
- `whyUseful`

The first practical implementation should run OCR for screenshots/images and ASR for videos. The orchestration layer already normalizes partial responses, so the service can start by returning only `ocrText`, `transcript`, and `visualDescription`.

Current extractor behavior:

- OCR uses `TESSERACT_CMD` and defaults to `tesseract`.
- ASR uses `WHISPER_CMD` when configured and writes `.txt` transcripts with `WHISPER_MODEL`, defaulting to `base`.
- Visual image embeddings use `VISUAL_EMBEDDING_CMD` when configured. The command receives an image path and should print a JSON array or object containing `embedding`, `visualEmbedding`, or `imageEmbedding`.
- Missing OCR/ASR binaries make extraction fail or return empty output; the orchestration layer can then fall back to paid multimodal analysis when credits allow it.
- Worker media extraction is skipped when the current source-content hash matches existing internal analysis metadata and the existing analysis already has transcript, OCR text, or visual description.

## Visual Embeddings

Initial backend support is implemented:

- Local extractor responses may include `visualEmbedding`, `imageEmbedding`, or snake-case equivalents.
- The worker stores valid finite numeric vectors internally, separate from public item analysis.
- Local mode stores visual vectors in `itemVisualEmbeddings`; Supabase mode stores them in `item_visual_embeddings`.
- The item-to-item similar-visuals endpoint uses vector cosine similarity when both saves have visual embeddings, then falls back to text/metadata similarity.
- Visual vectors are derived operational data and are excluded from user-facing item payloads and privacy exports.
