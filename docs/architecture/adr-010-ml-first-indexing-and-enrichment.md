# ADR-010: ML-First Indexing and Enrichment

## Status

Proposed

## Context

IScraper currently positions itself around a private searchable library for saved internet knowledge. The current implementation has a durable worker path, provider credentials, credits, semantic search support, and AI enrichment.

The cost risk is that large generative AI can become the default processor for captions, screenshots, videos, OCR, transcripts, tags, summaries, visual descriptions, embeddings, and final answers. That is not a scalable default for a broad consumer, student, creator, or marketer product.

The product needs a cheaper indexing architecture that still keeps search useful and trustworthy.

## Decision

Adopt an ML-first indexing contract:

- Every approved save gets basic deterministic indexing without requiring an LLM provider.
- Specialized ML/deep-learning models handle bulk extraction where practical: OCR, speech-to-text, embeddings, visual similarity, classification, clustering, and deduplication.
- LLMs are reserved for final synthesis, ambiguous cases, premium deep analysis, and user-triggered enrichment.
- Missing text AI provider should not block basic indexing.
- Expensive enrichment should have explicit internal processing-level metadata, cost tracking, and backpressure.
- Processing-level labels are internal only. The frontend must not show "Basic", "ML", or "AI enriched" as user-facing status or badges.

## Target Pipeline

1. `capture`: store raw source metadata and approval state.
2. `normalize`: canonicalize URLs, platform keys, captions, timestamps, hashtags, and source metadata.
3. `basic_index`: run deterministic extraction and make the save searchable.
4. `ml_extract`: run OCR, speech-to-text, text embeddings, image embeddings, classifiers, dedupe, and clustering where available.
5. `hybrid_rank`: combine keyword search, semantic search, visual similarity, filters, recency, and feedback.
6. `deep_ai`: use LLMs only for final answer generation or explicit high-value enrichment.

## Rationale

This keeps the strongest parts of the existing product while reducing recurring provider spend.

Basic indexing keeps the product useful even when AI capacity, billing, or provider keys are unavailable. ML extraction improves recall and ranking at a lower unit cost than multimodal LLM analysis. LLMs remain available where they are strongest: reasoning over retrieved evidence and producing user-facing answers with citations.

## Consequences

Positive:

- Lower cost per indexed save.
- Faster first searchable state.
- Better degraded behavior when providers are unavailable.
- Clearer internal processing levels for routing, billing, and analytics.
- Easier measurement of which expensive steps actually improve search success.

Negative:

- More pipeline stages and more extraction-status detail to maintain.
- OCR/transcription/image-embedding models need hosting, packaging, or managed inference decisions.
- Search quality must be evaluated by retrieval outcomes, not just whether analysis text exists.

Mitigations:

- Keep the first implementation small: basic non-LLM indexing, content hashes, and batch embeddings.
- Treat OCR, transcription, and visual embeddings as independent stages that can be added one at a time.
- Keep existing provider paths as fallback/deep enrichment rather than deleting them immediately.

## Initial Implementation Steps

1. Change worker planning so missing text AI provider does not pause basic indexing.
2. Add internal processing-level metadata: `basic`, `ml`, `ai_enriched`.
3. Add content hashes for embedding and extraction inputs. Initial internal storage, unchanged-embedding skip, and unchanged media-extraction skip implemented 2026-09-08.
4. Batch embeddings and avoid re-embedding unchanged saves.
5. Add OCR as the first specialized ML extractor for screenshots/images. Initial local extractor contract implemented 2026-09-08 through `LOCAL_ML_ENDPOINT`; worker and screenshot capture prefer it before paid multimodal analysis.
6. Add speech-to-text for reels/videos before any multimodal LLM call.
7. Add image embeddings for visual similarity. Initial internal storage and item-to-item vector ranking implemented 2026-09-08.
8. Track cost, latency, failure rate, and search success by analysis depth.

Frontend copy must describe product outcomes instead of pipeline labels: searchable, image text found, transcript ready, still processing, needs review, or improve this save.

## Local Extractor Contract

The orchestration service supports an optional local ML extractor behind `LOCAL_ML_ENDPOINT`.

- `npm.cmd run dev:ml` starts the local extractor server at `apps/orchestration/src/ml/local-extractor-server.js`.
- The extractor binds to `LOCAL_ML_HOST` and `LOCAL_ML_PORT`, defaulting to `127.0.0.1:3037`.
- `LOCAL_ML_API_KEY`, when set, is required through the `x-local-ml-api-key` header.
- `POST /v1/media/analyze` receives normalized item context and downloaded media path references.
- `POST /v1/image/analyze` receives normalized item context and a base64 screenshot image.
- The response uses the existing analysis fields and may be partial.
- The backend normalizes partial output and stores internal processing metadata as `ml`.
- The worker reuses existing transcript, OCR text, or visual description when the source-content hash still matches, avoiding repeat local extraction and paid media fallback for unchanged saves.
- If the local extractor is unavailable or returns no useful text/visual output, the worker falls back to the existing paid media-analysis path when credits and app credentials allow it.
- OCR shells out to `TESSERACT_CMD`; video transcription shells out to `WHISPER_CMD` when configured.
- Visual embeddings shell out to `VISUAL_EMBEDDING_CMD` when configured. The command receives an image path and should print a JSON array or object containing `embedding`, `visualEmbedding`, or `imageEmbedding`.

## Visual Embedding Storage

Visual embeddings are derived operational data:

- Local mode stores them in `itemVisualEmbeddings`.
- Supabase mode stores them in `item_visual_embeddings` as `double precision[]` so the MVP can support different CLIP/SigLIP-style dimensions without another migration.
- The item-to-item similar-visuals path uses cosine similarity when vectors exist and falls back to text/metadata matching when they do not.
- Visual vectors are not returned in public item payloads and are excluded from user exports.

## Non-Goals

- No custom foundation model.
- No broad fine-tuning before usage data exists.
- No autonomous external actions.
- No hidden scraping.
- No removal of review-before-indexing, credits, provider safety, or privacy controls.
