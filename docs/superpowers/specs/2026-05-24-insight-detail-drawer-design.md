# Insight Detail Drawer Design

## Understanding Lock

The detail drawer currently repeats the same post text across title, source description, summary, why, caption, and extracted chips. Indexed posts still feel shallow because the synthesized fields can read like copied captions instead of a practical explanation.

The drawer should make the opened save easier to understand without changing the existing color direction or adding a new database schema.

## Decision Log

- Decision: Use an insight-first drawer.
- Decision: Keep raw caption, source description, transcript, OCR, and visual text available, but move them into a collapsed original-source section.
- Decision: Reuse existing analysis fields: `summary`, `whyUseful`, `visualDescription`, `ocrText`, `transcript`, and entity arrays.
- Decision: Dedupe obvious repeated strings before rendering.
- Decision: Update the enrichment prompt so future indexed saves produce distinct summary and usefulness fields.

## Reviewed Risks

- Skeptic: If the model still returns repeated text, the UI must suppress duplicate sections. Accepted.
- Constraint Guardian: No new schema or long-running background work should be introduced for this UI fix. Accepted.
- User Advocate: The drawer must answer "what is this?", "why does it matter?", and "what should I look at?" before showing raw evidence. Accepted.

## Accepted Design

1. Header keeps platform, author, indexing badge, thumbnail, title, and original link.
2. Insight section shows:
   - What this is
   - Why it matters
   - What is shown, only when visual/OCR data adds something distinct
3. Verification note appears only for content likely to contain changeable claims such as pricing, funding, dates, launches, offers, or availability.
4. Entity chips are deduped into compact groups.
5. Original source text is collapsed by default.
