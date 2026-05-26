# Library Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-hand AI chat panel that opens from library search and lets users ask grounded follow-up questions about their saved items.

**Architecture:** Reuse the existing search retrieval and app OpenRouter answer path, then add a small chat-specific prompt and API endpoint. The UI keeps the main library results visible while a read-only AI panel manages conversation messages and citations.

**Tech Stack:** React 19, Vite, Express 5, Node test runner, existing OpenRouter JSON response flow.

---

### Task 1: Backend Chat Answer Helper

**Files:**
- Modify: `apps/orchestration/src/services/aiSearch.js`
- Test: `apps/orchestration/test/aiSearch.test.js`

- [x] Add `buildOpenRouterLibraryChatRequest` and `createOpenRouterLibraryChatAnswer` using the existing snippet normalization.
- [x] Keep output JSON-only with `answer`, `citations`, and `suggestions`.
- [x] Add tests for prompt shape and citation filtering.

### Task 2: Backend Chat Endpoint

**Files:**
- Modify: `apps/orchestration/src/server.js`

- [x] Add `runLibraryChatAnswer` that searches the user's library, limits context, calls the chat helper, and preserves rate limits.
- [x] Add `POST /api/library-chat`.
- [x] Capture a workflow event for successful chat answers and failures.

### Task 3: Frontend API Client

**Files:**
- Modify: `apps/ui/src/api.js`

- [x] Add `askLibraryChat(question, messages, options)` that posts to `/library-chat`.

### Task 4: Right-Hand Chat Panel

**Files:**
- Modify: `apps/ui/src/App.jsx`

- [x] Add chat state for panel open/closed, message list, loading, and error.
- [x] Open the panel after a text search and seed it with the first AI answer.
- [x] Add follow-up submit handling that calls `askLibraryChat`.
- [x] Render a desktop right panel and mobile sheet with citations and suggestions.

### Task 5: Verification

**Files:**
- Run checks only.

- [x] Run `npm.cmd --workspace @iscraper/orchestration test -- aiSearch.test.js`.
- [x] Run `npm.cmd --workspace @iscraper/orchestration test`.
- [x] Run `npm.cmd --workspace @iscraper/ui run lint`.
- [x] Run `npm.cmd run build`.
