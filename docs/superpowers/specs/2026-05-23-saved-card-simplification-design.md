# Saved Card Simplification Design

## Goal

Make saved-post cards easier to scan without losing useful context. The current cards repeat tags, show too much body text, and spread important information across too many visual areas. The redesign keeps the existing masonry layout and bright card colors, but simplifies the information hierarchy.

## Approved Direction

Use the "Glance Card" approach. Each card should primarily answer: "What is this save about?"

The card should prioritize:

1. A clean, short title.
2. The creator or source.
3. One brief context line.
4. One or two useful metadata cues.
5. A small indexing/status indicator.

The card should not try to show every available tag, topic, brand, and description at once.

## Visual Structure

Each card keeps two zones:

### Top Color Zone

- Preserve the existing yellow, cyan, orange, and related color rotation.
- Keep the platform pill, such as `Instagram`.
- Show at most one topic/category chip.
- Show the title as the dominant element.
- Clamp title text to 2 or 3 lines.
- Remove repeated hashtag rows from this zone.

### Bottom Black Zone

- Show creator/source on one line.
- Show one short description/context line, clamped to 1 or 2 lines.
- Show the indexing status badge, such as `Metadata`, `Text indexed`, `Visual indexed`, or `Indexing`.
- Keep the open/external icon, but avoid extra footer copy if it adds noise.

## Content Rules

- Title: use `sourceTitle || title`, clamped to 2-3 lines.
- Creator: use `sourceAuthor || user`, truncated to one line.
- Context: use `sourceDescription || visual || summary || caption`, clamped to 1-2 lines.
- Topic chip: choose one from collection, first tag, first topic, first brand, or first tool.
- Bottom tag list: remove it for the normal card state.
- Search-match hints can be added later, but they are out of scope for this pass.

## Interaction

- The entire card remains clickable and opens the save detail drawer.
- Hover behavior may stay subtle, but should not shift layout.
- The indexing badge remains visible so users can understand whether a card is metadata-only or enriched.

## Performance Notes

- Do not add new animation or expensive layout logic.
- Keep card dimensions stable enough to avoid jarring masonry reflow.
- The previous large-board animation reduction should remain in place.

## Testing

- Run `npm run lint --prefix apps/ui`.
- Run `npm run build --prefix apps/ui`.
- Manually check the library view with a large imported Instagram library.
- Verify that cards are simpler, still useful, and keep the existing color identity.

## Non-Goals

- Do not change the card color palette.
- Do not redesign the whole library page.
- Do not change search ranking or backend search behavior.
- Do not add AI-generated card summaries in this pass.
