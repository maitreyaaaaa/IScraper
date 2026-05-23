# Saved Card Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify saved-post cards so each card is easy to scan while preserving the existing bright color identity.

**Architecture:** Keep the existing `PinCard` component in `apps/ui/src/App.jsx` and only adjust its content hierarchy and Tailwind classes. Add small local helpers near `PinCard` for selecting one topic chip and normalizing short display text; do not change backend search, ranking, or saved-item data shape.

**Tech Stack:** React 19, Vite 8, Tailwind CSS 4, lucide-react.

---

### Task 1: Simplify Card Content Helpers

**Files:**
- Modify: `apps/ui/src/App.jsx`

- [ ] **Step 1: Add card display helpers near `PIN_HEIGHTS`**

Add these helpers immediately above `function PinCard`:

```jsx
function firstUsefulCardChip(item) {
  return [item.collection, item.tags[0], item.topics[0], item.brands[0], item.tools[0]]
    .map((value) => String(value || '').trim())
    .find((value) => value && value !== 'Unsorted');
}

function shortCardText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 2: Update `PinCard` local variables**

Replace the current `highlight`, `preview`, and `cardTitle` constants with:

```jsx
  const chip = firstUsefulCardChip(item);
  const preview = shortCardText(item.sourceDescription || item.visual || item.summary || item.caption || 'Open this save to see what was captured.');
  const backdrop = PIN_BACKDROPS[index % PIN_BACKDROPS.length];
  const height = PIN_HEIGHTS[index % PIN_HEIGHTS.length];
  const cardTitle = shortCardText(item.sourceTitle || item.title || 'Saved post');
  const source = shortCardText(item.sourceAuthor || item.user || item.platform || 'Saved source');
```

- [ ] **Step 3: Run frontend lint**

Run: `npm run lint --prefix apps/ui`

Expected: exits `0`.

### Task 2: Simplify Top Color Zone

**Files:**
- Modify: `apps/ui/src/App.jsx`

- [ ] **Step 1: Reduce top-zone vertical noise**

In `PinCard`, keep the platform pill and eye icon. Replace the chip/title block with:

```jsx
        <div className="relative">
          {chip && (
            <span className="mb-3 inline-flex max-w-full rounded-full bg-black/15 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-black">
              <span className="truncate">{chip}</span>
            </span>
          )}
          <h3 className="line-clamp-3 font-display text-3xl font-bold leading-none tracking-tight md:text-[2.35rem]">{cardTitle}</h3>
        </div>
```

- [ ] **Step 2: Preserve current card colors**

Do not edit `PIN_BACKDROPS`.

- [ ] **Step 3: Run frontend build**

Run: `npm run build --prefix apps/ui`

Expected: exits `0`.

### Task 3: Simplify Bottom Black Zone

**Files:**
- Modify: `apps/ui/src/App.jsx`

- [ ] **Step 1: Replace bottom content block**

Inside the bottom `<div className="p-5">`, keep the top creator/status row but use `source`:

```jsx
          <span className="truncate font-mono text-xs text-primary">{source}</span>
```

Replace the preview paragraph and tag rows with:

```jsx
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{preview}</p>
```

Remove the entire bottom tags/brands `<div className="mt-4 flex flex-wrap gap-1.5">...</div>`.

- [ ] **Step 2: Make footer quieter**

Replace the footer text row with:

```jsx
        <div className="mt-4 flex items-center justify-end border-t border-white/10 pt-4 text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
```

- [ ] **Step 3: Run frontend lint and build**

Run:

```powershell
npm run lint --prefix apps/ui
npm run build --prefix apps/ui
```

Expected: both exit `0`.

### Task 4: Commit, Merge, Deploy

**Files:**
- Modify: `apps/ui/src/App.jsx`

- [ ] **Step 1: Commit only card changes**

Run:

```powershell
git add apps/ui/src/App.jsx docs/superpowers/plans/2026-05-23-saved-card-simplification.md
git commit -m "Simplify saved card content"
```

- [ ] **Step 2: Merge feature branch into `main`**

Run:

```powershell
git switch main
git merge --no-ff fix/saved-card-simplification -m "Merge branch 'fix/saved-card-simplification'"
```

- [ ] **Step 3: Deploy production**

Run:

```powershell
npx --yes vercel@latest --prod
```

Expected: Vercel reports production deployment and aliases `https://iscraper.vercel.app`.

- [ ] **Step 4: Smoke check production**

Run:

```powershell
$response = Invoke-WebRequest -Uri https://iscraper.vercel.app/api/credit-packages -UseBasicParsing
"$($response.StatusCode)"
```

Expected: `200`.
