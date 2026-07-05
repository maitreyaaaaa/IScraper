# IScraper Android App Build Brief for z.ai

Generated for: z.ai Android implementation  
Repo source: `D:\IScraper-main\IScraper-main`  
Product: IScraper, a private AI memory library for saved content  
Scope: Native Android app only. No landing page. No browser extension.

## 1. Goal

Build a native Android app that gives users the same core product flow as the current IScraper web dashboard:

- Sign in and complete profile/onboarding.
- Save links, notes, images, and import supported social export files.
- Review saved/imported items before indexing where the backend requires review.
- Start indexing and monitor indexing progress.
- Search the private library with metadata, AI context, match reasons, visual search, and AI answers with citations.
- Browse saved library items, smart collections, library checkups, graph view, settings, privacy, exports, and account controls.
- Keep technical/advanced features reachable but not visually dominant for normal users.

The Android app should feel like a focused product app, not a marketing website. The first signed-in screen should be the dashboard/library experience.

## 2. Skills And Research Used

This brief was created using these explicit skills:

- `android-clean-architecture`: clean module boundaries, domain/data/presentation separation, repository/use-case pattern, local data model guidance.
- `android-jetpack-compose-expert`: Compose Material 3 UI structure, state hoisting, ViewModel + StateFlow UI state, type-safe navigation, performance practices.
- `architecture`: requirements-first architecture, explicit trade-offs, simple MVP-first design, validation criteria.

Official Android and platform research references:

- Android app architecture: https://developer.android.com/topic/architecture
- Android UI layer guidance: https://developer.android.com/topic/architecture/ui-layer
- Android data layer guidance: https://developer.android.com/topic/architecture/data-layer
- Android domain layer guidance: https://developer.android.com/topic/architecture/domain-layer
- Offline-first data layer: https://developer.android.com/topic/architecture/data-layer/offline-first
- Jetpack Compose state: https://developer.android.com/develop/ui/compose/state
- Compose state hoisting: https://developer.android.com/develop/ui/compose/state-hoisting
- Navigation with Compose: https://developer.android.com/develop/ui/compose/navigation
- Adaptive layouts and window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/window-size-classes
- Material 3 in Compose: https://developer.android.com/develop/ui/compose/designsystems/material3
- Material Design color roles: https://m3.material.io/styles/color/roles
- Room persistence library: https://developer.android.com/training/data-storage/room
- DataStore: https://developer.android.com/topic/libraries/architecture/datastore
- WorkManager: https://developer.android.com/topic/libraries/architecture/workmanager
- Android Photo Picker: https://developer.android.com/training/data-storage/shared/photopicker
- Android Storage Access Framework: https://developer.android.com/guide/topics/providers/document-provider
- Android security best practices: https://developer.android.com/privacy-and-security/security-best-practices
- Supabase Kotlin reference: https://supabase.com/docs/reference/kotlin/introduction

## 3. Product Boundaries

### Must build

The Android app must include the core dashboard flow:

- Authenticated app shell.
- Saved Library.
- Smart Collections.
- Add Saves and Quick Add.
- Item detail view.
- Search, AI search, and visual search.
- Indexing status and item state labels.
- Library Checkup.
- Settings, privacy, profile, AI keys, agent access, API health, data export, and deletion request flows.
- Graph View or a practical mobile graph/export version.

### Must not build

Do not build these into the Android app:

- Marketing landing page.
- Browser extension.
- Browser-specific Lens capture from webpages.
- Auto-scraping flows that run without user action.
- Public publishing or auto-posting.
- Direct database writes from the client.
- Any service-role admin behavior in the app.
- Any secret-bearing backend-only operation in the app.

### Product safety rules

The app must preserve the existing IScraper safety model:

- The user decides what to save.
- The user can review imported or pending items before indexing.
- The user can approve indexing actions where required.
- Destructive account actions require explicit confirmation.
- External/power-user integrations stay behind Settings or Advanced options.
- Provider keys are entered by the user and sent to the backend over TLS. They must not be stored locally as plaintext.
- The app must never contain Supabase service-role keys, AI provider keys, encryption keys, Stripe secrets, worker tokens, or PostHog secrets.

## 4. Current IScraper Product Model

Current product promise from the repo:

> Save from anywhere. Review before indexing. Search everything later with context.

Target users:

- Creators with saved content spread across Instagram, Pinterest, X, notes, and links.
- Builders and founders collecting references, ideas, tools, workflows, and competitors.
- Researchers who need searchable context instead of scattered bookmarks.
- Operators who want a private AI memory library they control.

Core content sources:

- Manual link saves.
- Notes with optional links and images.
- Image attachments.
- Instagram export/import files.
- Pinterest export/import files.
- X bookmark export-style files.
- Existing web/extension saves from the backend.

Core AI capabilities:

- Summaries.
- OCR.
- Transcription.
- Tags.
- People, brand, tool, repository, and topic extraction.
- Visual analysis.
- Embeddings.
- Match reasons.
- AI answers with source citations.
- Similar visual results.

Core privacy model:

- User-owned private library.
- Supabase authentication.
- User-specific rows protected by backend authentication and RLS.
- Private Supabase storage buckets.
- Encrypted provider credentials on the backend.
- Read-only agent access tokens.
- Data export and account deletion request flows.

## 5. Recommended Android Architecture

Use a native Kotlin Android app with Jetpack Compose and Material 3.

Recommended stack:

- Kotlin.
- Jetpack Compose.
- Material 3.
- Single-activity app.
- Navigation Compose with typed routes.
- ViewModel + StateFlow for UI state.
- Kotlin coroutines and Flow.
- Hilt for dependency injection.
- Retrofit + OkHttp or Ktor client for the existing Express API.
- Supabase Kotlin Auth for auth session handling, or a thin wrapper that uses Supabase auth endpoints and passes the Supabase JWT to IScraper API.
- Room for local cached library/search/detail data.
- DataStore for small preferences and non-secret app settings.
- WorkManager for resilient background uploads/import polling/sync.
- Coil for authenticated or signed image loading.
- Kotlin Serialization for DTOs.
- MockWebServer for API tests.

Do not bypass the existing backend. The Android app should call the existing `/api/*` routes with the user's Supabase access token.

### Module layout

For the first Android version, z.ai can implement a multi-module project. If z.ai needs to start smaller, keep the same package boundaries inside a single app module and split into modules later.

Recommended Gradle module layout:

```text
iscraper-android/
  app/
  core/
    common/
    network/
    database/
    datastore/
    designsystem/
    auth/
  domain/
  data/
  feature/
    auth/
    onboarding/
    library/
    addsave/
    itemdetail/
    smartcollections/
    care/
    graph/
    settings/
```

Dependency rules:

- `app` depends on feature modules, domain, data, and core modules.
- `feature:*` depends on domain, core common, and design system.
- `domain` has pure Kotlin models, repository interfaces, and use cases. It must not depend on Android UI or networking.
- `data` implements domain repositories using remote API clients, Room DAOs, and DataStore.
- `core:network` owns OkHttp interceptors, auth header attachment, request IDs, error parsing, and DTO serialization.
- `core:database` owns Room entities, DAOs, and migrations.
- `core:designsystem` owns colors, typography, reusable components, icons, spacing, and theme.
- `core:auth` owns session state, token refresh, and authenticated user state.

### Runtime data flow

Use unidirectional data flow:

```text
Composable screen
  -> ViewModel event
  -> UseCase
  -> Repository
  -> Remote API / Room / DataStore
  -> Repository result
  -> ViewModel UI state
  -> Composable screen
```

The app should:

- Show cached data quickly when available.
- Refresh from network when online.
- Mark cached data as stale when needed.
- Keep write flows explicit and user-triggered.
- Persist local drafts for notes/links/uploads if the user leaves the screen.
- Use WorkManager for long uploads and sync retry where appropriate.

### Architectural trade-off

The existing product already has a backend with auth, rate limits, privacy controls, processing jobs, provider credential encryption, imports, search, AI, and account flows. The Android app should not recreate that logic locally. The app should be a polished mobile client over the existing backend, with local cache and offline-friendly UX where useful.

## 6. Backend Integration Rules

All API requests should use:

- `Authorization: Bearer <supabase_access_token>`
- `X-Request-ID: <uuid>`
- `X-Correlation-ID: <same uuid unless parent correlation exists>`
- `X-IScraper-Client-Action: <screen.action name>`

The existing web API client already sends these headers. Android should do the same.

Recommended OkHttp interceptors:

- Auth interceptor: attaches Bearer token.
- Request ID interceptor: generates request/correlation IDs.
- Client action interceptor: attaches a screen/action value when available.
- Error interceptor/parser: extracts backend error messages and reference IDs.
- Logging interceptor only in debug builds, with redaction for tokens, email addresses, provider keys, and request bodies that contain user content.

### API base URL

Use a build config value:

```text
ISCRAPER_API_BASE_URL=https://<production-domain>/api
```

For local/dev builds, use a separate debug configuration. Do not hardcode production secrets or local machine URLs.

### Auth

Use Supabase auth. The app should persist the user's session securely using the Supabase Kotlin client or an equivalent secure auth store. The app must refresh tokens before expiry and clear local user state on sign out.

Supported auth flows for Android MVP:

- Email magic link or email/password if enabled in the current Supabase project.
- Google sign-in if the project has OAuth configured.

Auth states:

- Signed out.
- Signing in.
- Signed in, profile missing.
- Signed in, ready.
- Token refresh failed.
- Signed out due to revoked/expired session.

### Profile completion gate

Several backend routes require a completed user profile. The Android app must check profile/onboarding state after sign-in and send incomplete users to onboarding before allowing import, visual search, or indexing actions.

## 7. API Feature Map

The Android app should call the existing backend API. Exact field names should be confirmed from the current API DTOs while implementing.

| Feature | Android screen | Backend route family | Notes |
|---|---|---|---|
| Current user/profile | Auth, Onboarding, Settings | `/api/profile`, `/api/onboarding`, account routes | Gate save/import/index actions until profile complete. |
| Library list | Saved Library | `/api/items` | Support pagination, filters, sort, cached results. |
| Item detail | Item Detail | `/api/items/:id` | Show assets, analysis, page archive, status, reminders. |
| Manual link save | Quick Add, Add Saves | `/api/saves/link` | User-triggered only. |
| Note save/update/delete | Quick Add, Add Saves, Item Detail | `/api/notes`, item/library routes | Support optional links and up to 5 images. |
| Import files | Add Saves | `/api/imports`, storage/chunk routes | Use SAF file picker and WorkManager for large uploads. |
| Pending review | Add Saves, Item Detail | review routes | User approves before adding/indexing where required. |
| Indexing start | Add Saves, Library | `/api/indexing/start`, `/api/indexing/summary` | Show progress and item states. |
| Search | Library | search routes | Saved search and web search modes. |
| AI chat/search | Library | library chat route | Show citations and reference IDs on error. |
| Visual search | Library | visual-search route | Image picker, size limits, provider setup warning. |
| Search feedback | Library search result | feedback route | Helpful/not helpful. |
| Smart collections | Smart Collections | smart collection routes | List, refresh, detail, rename, pin, hide, remove. |
| Library care | Library Checkup | library-care routes | Duplicates, stale links, reminders, old saves. |
| Graph export/view | Graph | graph/export routes | Native graph view or export-first mobile fallback. |
| Provider credentials | Settings | provider credential routes | Send to backend only. Do not keep raw key locally. |
| Agent access tokens | Settings | agent token routes | Read-only tokens. Show once, allow revoke. |
| Extension tokens | Settings advanced | extension token routes | Android should not need these by default. Keep hidden. |
| Data export | Settings privacy | data export routes | Create/list/download export requests. |
| Account deletion | Settings privacy | account deletion routes | Explicit confirmation and state display. |
| API health | Settings | health/status route if available | Show user-friendly status, not raw debug dumps. |

## 8. Domain Models

Use domain models separate from network DTOs and Room entities.

### Core models

```kotlin
data class SavedItem(
    val id: String,
    val userId: String,
    val url: String?,
    val title: String?,
    val description: String?,
    val source: SourcePlatform?,
    val contentType: ContentType,
    val status: ItemStatus,
    val collectionId: String?,
    val collectionName: String?,
    val thumbnailUrl: String?,
    val savedAt: Instant,
    val updatedAt: Instant?,
    val reviewState: ReviewState?,
    val indexing: IndexingState,
    val tags: List<String>,
    val topics: List<String>,
    val people: List<String>,
    val brands: List<String>,
    val tools: List<String>
)
```

```kotlin
data class ItemDetail(
    val item: SavedItem,
    val assets: List<ItemAsset>,
    val analysis: ItemAnalysis?,
    val pageArchive: PageArchive?,
    val reminders: List<ItemReminder>,
    val similarVisuals: List<SimilarVisualItem>,
    val originalText: String?
)
```

```kotlin
enum class ContentType {
    Uploaded,
    Link,
    Screenshot,
    VoiceNote,
    Note,
    Reel,
    Post,
    Pin,
    Unknown
}
```

```kotlin
enum class ItemStatus {
    Queued,
    Downloading,
    Analyzing,
    Done,
    Failed,
    Searchable,
    NeedsReview
}
```

```kotlin
data class IndexingState(
    val stage: IndexingStage,
    val label: String,
    val progressPercent: Int?,
    val errorMessage: String?
)
```

Current indexing display labels from the web app:

- `metadata_ready` -> `Metadata`
- `text_indexed` -> `Text indexed`
- `visual_indexing` -> `Indexing`
- `visual_indexed` -> `Visual indexed`
- `deep_indexed` -> `Transcript ready`
- `index_failed` -> `Metadata` with destructive/error styling

### Import progress states

Use these visible import stages:

| Stage | Percent | Label |
|---|---:|---|
| `checking` | 8 | Checking files |
| `uploading` | 32 | Uploading files |
| `reading` | 56 | Reading export |
| `adding` | 78 | Adding saves |
| `indexing` | 92 | Queueing indexing |
| `done` | 100 | Done |

### Smart collection model

```kotlin
data class SmartCollection(
    val id: String,
    val name: String,
    val group: SmartCollectionGroup,
    val itemCount: Int,
    val previewImages: List<String>,
    val signals: List<String>,
    val pinned: Boolean,
    val hidden: Boolean,
    val confidence: Double?,
    val reason: String?
)
```

Collection groups:

- Source.
- Capture.
- Tool.
- Brand.
- Topic.
- Default.

### Library care model

```kotlin
data class LibraryCareSummary(
    val possibleDuplicates: List<CareItem>,
    val linksThatMayNotOpen: List<CareItem>,
    val remindersReady: List<ItemReminder>,
    val oldSaves: List<SavedItem>
)
```

### Provider credential model

Do not keep provider raw keys in local app state after submission.

```kotlin
data class ProviderCredentialSummary(
    val provider: AiProvider,
    val purpose: ProviderPurpose,
    val label: String?,
    val createdAt: Instant,
    val lastUsedAt: Instant?,
    val status: CredentialStatus
)
```

Provider options from the current web settings:

- OpenRouter, recommended for text/media/embedding.
- Gemini.
- OpenAI.
- Anthropic.
- DeepSeek.
- GLM/Z.ai.
- OpenAI-compatible.

## 9. Android App Navigation

### Root app states

```text
AppRoot
  SignedOut
    AuthScreen
  SignedInProfileMissing
    OnboardingScreen
  SignedInReady
    DashboardShell
```

### Main navigation

Use bottom navigation on phones. Use navigation rail or drawer on tablets/foldables.

Primary tabs:

1. Saved Library
2. Smart Collections
3. Add Saves
4. Settings

Keep these reachable from Settings or an Advanced section:

- Library Checkup.
- Graph View.
- AI Keys.
- Agent Access.
- Privacy and data.
- API Health.

Use a floating `+` action button on Library, Smart Collections, and Library Checkup screens. The `+` opens Quick Add as a modal bottom sheet or full-screen dialog on small devices.

### Route list

```text
/auth
/onboarding
/library
/library/search
/library/item/{itemId}
/library/item/{itemId}/reminder
/smart
/smart/{collectionId}
/add
/add/link
/add/note
/add/upload
/add/review/{itemId}
/settings
/settings/profile
/settings/privacy
/settings/data-export
/settings/delete-account
/settings/ai-keys
/settings/agent-access
/settings/api-health
/settings/library-checkup
/settings/graph
```

## 10. Screen Specifications

### 10.1 Auth screen

Purpose:

- Let users sign in without showing a marketing landing page.

Required UI:

- IScraper logo/name.
- Email sign-in field.
- Magic link or password flow depending on backend/auth configuration.
- Google sign-in button if configured.
- Short privacy line: "Your library stays private to your account."
- Loading and error states.

Rules:

- Do not expose backend secrets.
- Do not show raw auth errors when they contain implementation details.
- On successful sign-in, fetch profile/onboarding state.

### 10.2 Onboarding/profile screen

Purpose:

- Collect required profile info so backend-gated actions work.

Required UI:

- User role/use case.
- Main sources they save from.
- Optional personalization preferences.
- Clear continue button.

Rules:

- Keep copy simple and non-technical.
- Do not block basic library viewing if backend allows it, but block imports/indexing if profile completion is required.

### 10.3 Dashboard shell

Purpose:

- Provide the signed-in app frame.

Phone layout:

- Top app bar with current tab title, search shortcut where useful, account/avatar menu.
- Bottom navigation with four tabs.
- Floating `+` button on relevant screens.
- Modal bottom sheet for Quick Add.

Tablet layout:

- Navigation rail or drawer.
- Content area with max readable width for detail panels.
- Detail screens can use a two-pane layout where practical.

Advanced options:

- Hide technical tools under Settings/Advanced.
- Keep Settings reachable.
- Do not show graph/keys/privacy as first-level tabs for normal users.

### 10.4 Saved Library screen

Purpose:

- Let users find and open saved content quickly.

Required UI:

- Search bar at top.
- Segmented search mode:
  - Saved library.
  - Web search, if backend supports current user flow.
- Visual search action using Android Photo Picker.
- Filter chips:
  - All.
  - Uploaded.
  - Links.
  - Screenshots.
  - Voice notes.
  - Notes.
- Status filter:
  - All.
  - Searchable.
  - Failed.
- Sort:
  - Newest.
  - Oldest.
- Layout toggle:
  - List.
  - Gallery.
  - Compact grid on tablets.
- Infinite scroll or paged load.
- Indexing progress card.
- Empty states for no saves, no search results, provider missing for visual search, and offline cached view.

Card content:

- Thumbnail when available.
- Title.
- Source platform.
- Saved date.
- Short description or AI summary.
- Status badge.
- Collection chips.
- Match reason when showing search results.
- Quick actions:
  - Open detail.
  - Open original URL.
  - Remind me.
  - More menu.

Search result feedback:

- Helpful.
- Not helpful.

Rules:

- Search queries should respect backend limits, such as 240 character query cap where currently enforced.
- Use debounced search input.
- Show backend reference ID on errors in a user-friendly way: "Something went wrong. Reference: <id>".
- Avoid hiding failed indexing states. Failed items should be visible and understandable.

### 10.5 Quick Add modal

Purpose:

- Make adding new saves obvious and fast.

Trigger:

- Floating `+` action button.

Presentation:

- Material 3 modal bottom sheet on phones.
- Full-screen dialog if the content becomes too tall.
- On tablets, centered dialog or side sheet.

Choices:

- Paste link.
- Write note.
- Upload file.

Paste link fields:

- URL, required.
- Title, optional.
- Note, optional.
- Source auto-detection.
- Save button.

Write note fields:

- Title, optional.
- Body, required.
- Optional links.
- Optional images.
- Image limit: 5.
- Image file size limit: 5 MB each.
- Supported note image types:
  - PNG.
  - JPEG.
  - WebP.
  - GIF.

Upload file:

- Opens Android Storage Access Framework file picker.
- Supports Instagram, Pinterest, and X export-style files.
- Shows source detection where possible.
- Gives a clear fallback if unsupported.

Rules:

- Reuse existing backend flows for note, link, and import.
- Do not create a separate mobile-only backend flow unless necessary.
- Close only after confirmed success.
- Preserve draft text while the modal is open.
- If upload/indexing continues in background, show a persistent progress item.

### 10.6 Add Saves screen

Purpose:

- Full save/import workspace for deliberate adding and review.

Modes:

- Paste link.
- Write note.
- Upload files.

Source options:

- Choose for me.
- Instagram.
- Pinterest.
- X.

Upload accepted sources:

- Instagram ZIP/HTML/JSON.
- Pinterest ZIP/JSON/CSV.
- X bookmark ZIP/JS/JSON/CSV/TXT.

Required UI:

- Source selector.
- File picker button.
- Upload progress using the import progress stages.
- Pending review section.
- "Add all to Library" approval action when relevant.
- Review cards with:
  - Clean title.
  - Source.
  - Description.
  - Collection.
  - Preview.
  - Approve/add action.

Rules:

- Do not automatically index items that backend marks for review.
- Keep review and approval copy human-readable.
- Show what is being added and why the user is asked to approve it.
- Use WorkManager for long upload/import operations so progress survives app backgrounding.

### 10.7 Item detail screen

Purpose:

- Show full context for a saved item.

Required sections:

- Header image/media preview.
- Title.
- Source platform and saved date.
- Status/indexing state.
- Open original URL.
- Page backup/readable copy when available.
- Reminder controls.
- Add to Library action for review/pending items.
- Note/image preview for note items.
- Indexing error section when failed.
- AI image analysis.
- Insights:
  - What this is.
  - Why it matters.
  - What is shown.
- Check-before-using warning for changing facts such as prices, dates, availability, or current policies.
- Similar visuals.
- People/brands/tools/topics chips.
- Original source text.

Rules:

- Detail can be a full-screen route on phones.
- On tablets, use a detail pane if the user opens from a list.
- Long AI analysis should be collapsible.
- Keep raw metadata accessible but not dominant.

### 10.8 Smart Collections screen

Purpose:

- Show automatic folders built from saved content.

Required UI:

- Header: "Personal folders from your saves."
- Metrics:
  - Folders.
  - Groups.
  - Matched saves.
- Group filters:
  - Source.
  - Capture.
  - Tool.
  - Brand.
  - Topic.
  - Default.
- Folder tiles:
  - Name.
  - Preview images.
  - Signals.
  - Item count.
  - Pinned/hidden state.
- Actions:
  - Refresh collections.
  - Rename.
  - Pin/unpin.
  - Hide.
  - Remove item from folder.

Rules:

- Renaming should use a dialog.
- Hiding/removing should ask for confirmation if the action changes user organization state.
- Refresh should show progress and last updated time.

### 10.9 Library Checkup screen

Purpose:

- Help users clean and rediscover their library.

Required UI:

- "Clean up and rediscover" title.
- Check my library action.
- Possible duplicates.
- Links that may not open.
- Reminders ready.
- Rediscover old saves.
- Surprise old save.
- Weekly old saves.

Rules:

- Do not auto-delete or auto-archive.
- Any cleanup action needs explicit confirmation.
- Broken link status should be phrased carefully. Use "may not open" instead of "dead" unless verified.

### 10.10 Graph View screen

Purpose:

- Provide a mobile version of the knowledge graph.

Current web graph node colors:

- Item: `#F4F4EF`
- Topic: `#A5FF18`
- Tag: `#22D3EE`
- Brand: `#60A5FA`
- Tool: `#94A3B8`
- Person: `#F472B6`
- Collection: `#C084FC`

Recommended Android approach:

- Phase 1: Graph summary, export to Obsidian, copy AI prompt, and focused related-node lists.
- Phase 2: Native interactive graph using Compose Canvas with pan/zoom.

Native graph constraints:

- Cap visible nodes around 240.
- Cap visible links around 420.
- Provide zoom, pan, reset.
- Node detail bottom sheet.
- Filters by node type.
- Use stable colors and labels.

Rules:

- If the native graph is not ready in the first Android release, keep export/copy functions available in Advanced Settings.
- Do not block the core app on graph perfection.

### 10.11 Settings screen

Purpose:

- Keep account, privacy, AI, and advanced tools clear without overwhelming normal users.

Top sections:

- Account.
- Profile.
- Personalization.
- Privacy.
- Data export.
- API health.
- Requests.

Advanced sections:

- AI keys.
- Agent access.
- Telegram bot link code.
- Graph view.
- Extension tokens, if included at all, should be hidden and clearly marked as web/extension-only.

AI keys:

- Provider list:
  - OpenRouter.
  - Gemini.
  - OpenAI.
  - Anthropic.
  - DeepSeek.
  - GLM/Z.ai.
  - OpenAI-compatible.
- Show provider purpose and saved credential summaries.
- Add key form submits to backend only.
- After submission, clear the raw key from UI memory.
- Show privacy notice: keys are encrypted after saving, shown later only as metadata, and used only for the selected processing purpose.

Agent access:

- Read-only tokens only.
- Token shown once.
- Copy button.
- Revoke button.
- Explain that agents can query/read, not mutate, unless backend explicitly supports otherwise.

Privacy:

- Account data summary.
- AI processing notice.
- Data export requests.
- Account deletion request.
- Deletion request requires explicit confirmation and should freeze risky activity according to backend state.

Data export:

- Create export request.
- List current export requests.
- Download available export.
- Show status and timestamps.

API Health:

- Show plain-language health:
  - Connected.
  - Auth issue.
  - Upload issue.
  - Search issue.
  - Provider setup needed.
- Avoid dumping raw logs.

## 11. Design System

The app should use the current IScraper dashboard visual identity:

- Dark-first interface.
- Acid lime primary color.
- Orange accent for the quick-add/FAB emphasis.
- High-contrast off-white text.
- Translucent borders.
- Simple business-owner-friendly labels.
- Technical features hidden under Advanced or Settings.

### Color tokens

Use these HEX values as the Android design system source of truth.

| Token | HEX | Usage |
|---|---|---|
| `Background` | `#000000` | App background, main screen background. |
| `OnBackground` | `#FAFAFA` | Primary text on black. |
| `Surface` | `#0B0D10` | Top bars, nav rail, main dark surfaces. |
| `SurfaceAlt` | `#10141A` | Secondary panels and large sections. |
| `SurfaceVariant` | `#151A22` | Cards, list rows, input backgrounds. |
| `SurfaceRaised` | `#1E1E1E` | Modal sheets, elevated controls. |
| `Outline` | `#252C38` | Borders, dividers, inactive outlines. |
| `OutlineStrong` | `#303846` | Focused or selected dark outlines. |
| `Primary` | `#A5FF18` | Main positive CTA, selected tabs, active states, topic graph nodes. |
| `OnPrimary` | `#000000` | Text/icons on primary lime. |
| `PrimarySoft` | `#D6FF24` | Highlights, progress accents, empty-state illustration accents. |
| `Accent` | `#FF6900` | Floating `+`, upload emphasis, important secondary action. |
| `AccentHover` | `#FF7F24` | Pressed/hover equivalent for orange action. |
| `OnAccent` | `#000000` | Text/icons on orange. |
| `MutedText` | `#999999` | Secondary text, helper text. |
| `SubtleText` | `#93A0B3` | Metadata, timestamps, labels. |
| `Success` | `#86EFAC` | Completed indexing, success messages. |
| `SuccessSoft` | `#BBF7D0` | Success badge backgrounds where readable. |
| `Info` | `#7DD3FC` | Informational badges, API health info. |
| `Cyan` | `#22D3EE` | Tag graph nodes, visual-search accent. |
| `Blue` | `#60A5FA` | Brand graph nodes, links. |
| `Slate` | `#94A3B8` | Tool graph nodes, secondary chips. |
| `Pink` | `#F472B6` | Person graph nodes. |
| `Purple` | `#C084FC` | Collection graph nodes. |
| `Error` | `#EF4444` | Destructive actions, failed states. |
| `Warning` | `#F59E0B` | Provider missing, incomplete setup. |
| `White08` | `#14FFFFFF` | Hairline borders over dark surfaces. |
| `White12` | `#1FFFFFFF` | Input borders, stronger dividers. |
| `Black60` | `#99000000` | Scrims and modal backdrop. |

Material 3 role mapping:

```kotlin
private val IScraperDarkColorScheme = darkColorScheme(
    primary = Color(0xFFA5FF18),
    onPrimary = Color(0xFF000000),
    secondary = Color(0xFF1E1E1E),
    onSecondary = Color(0xFFFAFAFA),
    tertiary = Color(0xFFFF6900),
    onTertiary = Color(0xFF000000),
    background = Color(0xFF000000),
    onBackground = Color(0xFFFAFAFA),
    surface = Color(0xFF0B0D10),
    onSurface = Color(0xFFFAFAFA),
    surfaceVariant = Color(0xFF151A22),
    onSurfaceVariant = Color(0xFF93A0B3),
    outline = Color(0xFF252C38),
    error = Color(0xFFEF4444),
    onError = Color(0xFFFFFFFF)
)
```

### Platform colors

Use these platform colors only for source badges and icon accents:

| Platform | HEX |
|---|---|
| X | `#FFFFFF` |
| Facebook | `#1877F2` |
| Pinterest | `#E60023` |
| Reddit | `#FF4500` |
| LinkedIn | `#0A66C2` |
| TikTok | `#000000` with white outline on dark UI |
| YouTube | `#FF0033` |
| Substack | `#FF6719` |
| Instagram | Use a small gradient only inside icon/avatar if needed, not as a screen theme. |

### Color placement rules

- Use black as the dominant background.
- Use `Surface` and `SurfaceVariant` for cards, rows, modal sheets, and input areas.
- Use lime for selected states and primary CTAs.
- Use orange for Quick Add/FAB and high-emphasis "add/import" moments.
- Do not make every button lime. Secondary actions should be dark outlined or text buttons.
- Use red only for destructive actions and hard failures.
- Use warning amber for missing provider setup or incomplete profile warnings.
- Use platform colors only as small badges, not large panels.
- Keep borders subtle with `White08` or `Outline`.
- Do not use gradient-orb backgrounds or decorative blobs.

### Typography

Current web uses Space Grotesk as the main visual voice. Android should use:

- Primary font: Space Grotesk, bundled as downloadable/font resource if licensing and implementation allow.
- Fallback: Android system sans.
- Metadata font: JetBrains Mono or Android monospace for compact labels, IDs, and reference labels.

Recommended type scale:

| Token | Size | Line height | Weight | Usage |
|---|---:|---:|---:|---|
| Display | 32sp | 40sp | 700 | Rare screen-level empty states only. |
| TitleLarge | 24sp | 32sp | 700 | Main screen title. |
| TitleMedium | 20sp | 28sp | 650 | Section title. |
| TitleSmall | 16sp | 24sp | 650 | Card titles. |
| BodyLarge | 16sp | 24sp | 400 | Primary body text. |
| BodyMedium | 14sp | 20sp | 400 | Lists, descriptions. |
| BodySmall | 12sp | 18sp | 400 | Helper text. |
| Label | 12sp | 16sp | 650 | Buttons and chips. |
| Metadata | 11sp | 16sp | 500 | Source, status, timestamps. |

Rules:

- Do not use viewport-scaled font sizes.
- Do not use negative letter spacing.
- Keep button text short enough to fit on small screens.
- Use truncation for titles only after at least two lines are available.
- Prefer readable labels over technical vocabulary.

### Shape and spacing

Use an 8dp grid.

Recommended:

- Screen padding: 16dp on phones, 24dp on tablets.
- Card radius: 8dp.
- Chips: 8dp.
- Buttons: 8dp.
- Bottom sheets/dialogs: 12dp to 16dp top corners.
- Touch targets: minimum 48dp.
- List item min height: 64dp.
- FAB: standard Material 3 FAB size.

Rules:

- Do not put cards inside cards.
- Do not style every section as a floating card.
- Repeated items can be cards.
- Tool surfaces can be framed.
- Page sections should feel like full app surfaces, not nested marketing panels.

### Icons

Use Material Icons or an equivalent Android icon set:

- Library: folder/bookmark.
- Smart Collections: folder/spark.
- Add Saves: plus/upload.
- Settings: settings gear.
- Search: magnifier.
- Visual search: image/search.
- Upload: upload.
- Link: link.
- Note: note/edit.
- Filter: tune/sliders.
- Graph: account tree/share nodes.
- Privacy: shield/lock.
- Export: download.
- Delete: trash/warning.

Rules:

- Use icon buttons for common actions.
- Add accessible labels/content descriptions.
- Use text buttons for destructive confirmations and major commands.
- Tooltips are useful on tablets; on phones use clear labels or long-press descriptions where supported.

### Component inventory

Create these reusable Compose components in `core:designsystem`:

- `IScraperTheme`.
- `IScraperTopBar`.
- `IScraperBottomNav`.
- `IScraperNavigationRail`.
- `IScraperButton`.
- `IScraperIconButton`.
- `IScraperFab`.
- `IScraperTextField`.
- `IScraperSearchBar`.
- `IScraperSegmentedControl`.
- `IScraperFilterChip`.
- `IScraperStatusBadge`.
- `IScraperSourceBadge`.
- `IScraperItemCard`.
- `IScraperItemRow`.
- `IScraperEmptyState`.
- `IScraperLoadingSkeleton`.
- `IScraperErrorBanner`.
- `IScraperReferenceIdError`.
- `IScraperModalSheet`.
- `IScraperConfirmDialog`.
- `IScraperProgressStepper`.
- `IScraperImagePicker`.

## 12. Mobile UX Rules

### General UX

- The dashboard should be useful immediately after sign-in.
- Do not show a landing page to signed-in users.
- Do not make users understand indexing internals to add saves.
- Keep "Advanced" tools available but visually secondary.
- Put the most common actions within one tap:
  - Search.
  - Quick Add.
  - Open item.
  - Filter.
  - Settings.

### Empty states

Use direct empty-state copy:

- Library empty: "Start your library with a link, note, image, or export file."
- Search empty: "No matching saves yet."
- Provider missing: "Visual search needs an AI provider key first."
- Upload empty: "Choose files from Instagram, Pinterest, or X exports."
- Offline cached: "Showing saved offline results. Connect to refresh."

### Error states

Error display should include:

- Plain explanation.
- Next action.
- Backend reference ID when available.

Examples:

- "Upload failed. Try again or choose a smaller file. Reference: abc123."
- "Your AI key is not set up for visual search yet."
- "You need to finish your profile before importing files."

### Approval gates

Require explicit confirmation for:

- Approving pending review items.
- Adding all review items to Library.
- Starting expensive indexing batches where backend requires it.
- Revoking agent tokens.
- Requesting account deletion.
- Cancelling account deletion.
- Removing items from smart collections if it changes user organization state.

Never auto-send, auto-publish, auto-delete, or update external customer data.

## 13. File And Upload Rules

### Note images

- Supported MIME types:
  - `image/png`
  - `image/jpeg`
  - `image/webp`
  - `image/gif`
- Max images: 5.
- Max size per image: 5 MB.
- Use Android Photo Picker for images.

### Visual search image

- Supported MIME types:
  - `image/png`
  - `image/jpeg`
  - `image/webp`
- Max source size: 8 MB.
- If converting to data URL, keep under the backend limit currently represented by 700 KB in the web code.
- Use resize/compress client-side only when it does not destroy the user's intended visual search query.

### Import files

Use Android Storage Access Framework for document/import files.

Sources:

- Instagram ZIP/HTML/JSON.
- Pinterest ZIP/JSON/CSV.
- X bookmark ZIP/JS/JSON/CSV/TXT.

Backend upload constraints from current server:

- Default import upload file size limit: 25 MB.
- Max file count: 20.
- Large/chunk/storage upload paths must remain user-scoped and backend-validated.

Android implementation:

- Validate file type before upload where possible.
- Show selected files and sizes before sending.
- Use WorkManager for upload/import jobs that may continue in the background.
- Poll or refresh import/job status after upload.
- Keep the user informed with the import progress stages.

## 14. Offline And Sync Behavior

The app should be offline-friendly, not fully offline-first for every write.

Offline-capable:

- View cached library list.
- View cached item detail.
- View cached smart collections.
- Draft a note locally.
- Draft a link save locally.
- Queue uploads only after confirming the selected URI is still available.

Network-required:

- Auth.
- New imports.
- Indexing.
- Search.
- AI answers.
- Visual search.
- Provider credential changes.
- Data export/deletion requests.

Sync rules:

- Cache successful library pages in Room.
- Cache item details when opened.
- Use local timestamps to mark stale data.
- Use retry with backoff for safe uploads.
- Do not retry destructive account actions automatically.
- Do not duplicate saves on retry. Use backend idempotency if available or client-generated request IDs if backend supports them.

## 15. Security And Privacy Requirements

### Secrets

Never include these in Android source, resources, assets, Gradle files, or BuildConfig:

- Supabase service-role key.
- `CREDENTIAL_ENCRYPTION_KEY`.
- AI provider API keys.
- Stripe secret keys.
- Worker secret.
- Telegram bot token.
- PostHog personal/API secrets.
- Any admin token.

Allowed client config:

- Public Supabase URL.
- Public Supabase anon key, if needed for Supabase Auth.
- Public API base URL.
- Public PostHog project key only if PostHog mobile analytics is intentionally enabled.

### Local storage

- Store auth session using the Supabase Kotlin client or encrypted secure storage.
- Store only non-secret settings in DataStore.
- Store cached item/library data in Room.
- Do not store raw AI provider keys locally after submit.
- Do not log URLs, note bodies, emails, provider keys, tokens, or user content in production.

### Network

- Use HTTPS only for production.
- Attach auth token to API calls only for the configured IScraper backend.
- Redact sensitive headers in logs.
- Show reference IDs for debugging without exposing sensitive payloads.

### Privacy controls

Settings must include:

- Account data summary.
- AI processing notice.
- Provider key privacy notice.
- Data export request.
- Account deletion request.
- Deletion request status/cancel flow if supported by backend.

### Agent access

Agent access tokens must remain read-only unless the backend explicitly supports a stronger scope with approval. Android should label them as read-only and show revoke controls.

## 16. Analytics And Observability

If analytics are enabled:

- Track app events, not private content.
- Do not send note text, URLs, search queries, item titles, emails, provider keys, or raw file names.
- Use anonymous/user IDs according to the backend privacy policy.
- Keep analytics optional/configurable if required.

Recommended mobile events:

- `app_opened`
- `auth_started`
- `auth_completed`
- `library_opened`
- `search_started`
- `quick_add_opened`
- `link_save_started`
- `link_save_completed`
- `note_save_started`
- `note_save_completed`
- `import_started`
- `import_completed`
- `review_item_approved`
- `indexing_started`
- `settings_opened`
- `data_export_requested`

Include request/correlation IDs in backend-facing events only when safe.

## 17. Implementation Phases

### Phase 0: Project setup

Deliverables:

- Kotlin Android project.
- Compose Material 3 theme.
- Design system tokens.
- Navigation scaffold.
- Hilt setup.
- Network client with auth/request ID interceptors.
- BuildConfig values for API base URL and Supabase public config.
- Room/DataStore setup.

Acceptance criteria:

- App builds.
- Dark theme matches the color tokens.
- No hardcoded secrets.
- Navigation works between placeholder screens.

### Phase 1: Auth, onboarding, and shell

Deliverables:

- Sign-in flow.
- Session persistence and sign out.
- Profile/onboarding fetch and completion flow.
- Dashboard shell with bottom nav and Settings.

Acceptance criteria:

- Signed-out users see auth only.
- Signed-in incomplete users see onboarding.
- Signed-in complete users see dashboard.
- Token refresh works.
- API requests include auth and request ID headers.

### Phase 2: Library, search, and item detail

Deliverables:

- Library list with paging.
- Filters, sort, layout toggle.
- Search.
- Item detail screen.
- Error/reference ID display.
- Room cache for library/detail.

Acceptance criteria:

- User can browse and open existing saves.
- Search results show match reason when backend returns it.
- Cached library appears after app restart.
- Failed indexing state is visible.

### Phase 3: Quick Add and Add Saves

Deliverables:

- Floating `+` Quick Add.
- Save link.
- Save note with images.
- Full Add Saves screen.
- File picker import flow.
- Upload progress.
- Pending review list and approval action.

Acceptance criteria:

- User can save a link.
- User can save a note with valid image attachments.
- User can upload supported export files.
- User can approve pending review items.
- Unsupported file types show a clear message.
- Long upload continues or resumes via WorkManager where appropriate.

### Phase 4: Smart Collections, care, and settings

Deliverables:

- Smart Collections list/detail.
- Refresh, rename, pin, hide, remove.
- Library Checkup.
- Provider credential settings.
- Privacy/data export/deletion request settings.
- Agent access token list/create/revoke.

Acceptance criteria:

- User can browse and manage smart collections.
- Cleanup suggestions never auto-delete.
- Provider key form clears raw key after submit.
- Data export and deletion flows require explicit confirmation.
- Agent tokens are clearly read-only and revocable.

### Phase 5: Graph and polish

Deliverables:

- Graph summary/export/copy prompt.
- Native graph view if feasible.
- Adaptive tablet layout.
- Accessibility pass.
- Loading skeletons.
- Compose UI tests.
- Network and mapper tests.

Acceptance criteria:

- Graph tools are reachable under Advanced/Settings.
- App works on phone, foldable, and tablet layouts.
- Main screens meet accessibility touch target and contrast expectations.
- Tests pass.

## 18. Testing Requirements

### Unit tests

Test:

- DTO to domain mappers.
- Use cases.
- Repository cache/network behavior.
- Import progress mapping.
- Item status/indexing label mapping.
- File validation.
- Provider key form validation.
- Deletion/export confirmation validation.

### API tests

Use MockWebServer or equivalent to test:

- Auth header attached.
- Request IDs attached.
- Error reference IDs parsed.
- Pagination parsing.
- Search result parsing.
- Upload error handling.
- Token refresh retry.

### Compose UI tests

Test:

- Signed-out to signed-in navigation.
- Profile missing gate.
- Bottom navigation.
- Quick Add modal.
- Link save form validation.
- Note image limit.
- Library filters.
- Item detail expansion.
- Settings destructive confirmation.

### Manual QA checklist

- Fresh install.
- Sign in.
- Complete onboarding.
- Browse library.
- Search.
- Visual search with valid image.
- Visual search with provider missing.
- Save link.
- Save note with images.
- Upload each supported import type.
- Approve review item.
- Start indexing.
- Open item detail.
- Create reminder.
- Refresh smart collections.
- Run library checkup.
- Add provider key.
- Revoke agent token.
- Request data export.
- Start and cancel account deletion if supported.
- Rotate device.
- Test offline cached library.

## 19. Accessibility Requirements

- Minimum 48dp touch targets.
- Content descriptions for icons and images that matter.
- Decorative images should not be read by screen readers.
- All primary flows should work with TalkBack.
- Use semantic headings where Compose supports it.
- Maintain high contrast on dark background.
- Do not rely only on color for status. Pair color with text labels.
- Support dynamic type without text overlap.
- Buttons and chips must not truncate into unreadable labels.
- Modal sheets must trap focus correctly and dismiss predictably.

## 20. z.ai Build Instructions

Use this as the direct implementation instruction:

```text
Build a native Android app for IScraper using Kotlin, Jetpack Compose, Material 3, Hilt, Navigation Compose, Coroutines/Flow, Room, DataStore, WorkManager, and Supabase Auth.

The app is a mobile dashboard, not a landing page. Signed-out users see Auth. Signed-in users see the IScraper dashboard with Saved Library, Smart Collections, Add Saves, and Settings. Include a floating + Quick Add action for paste link, write note, and upload file.

Use the existing IScraper backend API under /api. Do not write directly to Supabase tables from the app except through Supabase Auth/session handling if needed. Every backend request must include Authorization: Bearer <supabase access token>, X-Request-ID, X-Correlation-ID, and X-IScraper-Client-Action.

Use clean architecture. Keep domain models and use cases independent from Android UI and network DTOs. Keep provider keys, service-role keys, encryption keys, worker secrets, and API secrets out of the Android app. Provider keys entered by the user are submitted to the backend only and cleared from local UI state after submit.

Implement the screens and UX in this brief. Use the exact color tokens and Material 3 role mapping. Keep technical tools under Settings/Advanced. Preserve explicit approval gates for review, indexing, export, deletion, token revocation, and cleanup actions.

Mock data is allowed only behind debug/demo flags. Production app flows must use the backend API client.
```

## 21. Files In Current Repo Used As Source

Important source files in the current IScraper repo:

- `README.md`
- `docs/product-brief.md`
- `docs/scalability-readiness.md`
- `docs/worker-operations.md`
- `apps/ui/src/dashboard/Dashboard.jsx`
- `apps/ui/src/dashboard/LibraryTab.jsx`
- `apps/ui/src/dashboard/UploadTab.jsx`
- `apps/ui/src/dashboard/QuickAddModal.jsx`
- `apps/ui/src/dashboard/DetailDrawer.jsx`
- `apps/ui/src/dashboard/SettingsTab.jsx`
- `apps/ui/src/dashboard/AccountSettingsModal.jsx`
- `apps/ui/src/dashboard/LibraryCheckupTab.jsx`
- `apps/ui/src/dashboard/GraphTab.jsx`
- `apps/ui/src/components/SmartCollectionsView.jsx`
- `apps/ui/src/AppShared.jsx`
- `apps/ui/src/api.js`
- `apps/ui/src/styles.css`
- `apps/orchestration/src/server.js`
- `apps/orchestration/src/routes/importRoutes.js`
- `apps/orchestration/src/routes/libraryRoutes.js`
- `apps/orchestration/src/routes/searchPrivateRoutes.js`
- `apps/orchestration/src/routes/accountRoutes.js`
- `apps/orchestration/src/routes/dataExportRoutes.js`
- `apps/orchestration/.env.example`
- `supabase/migrations/*.sql`

## 22. Final Product Standard

The Android app should feel like a private command center for saved knowledge:

- Fast to add.
- Easy to search.
- Clear about what AI is doing.
- Honest about indexing status and errors.
- Respectful of privacy.
- Simple for non-technical users.
- Powerful for advanced users without forcing advanced tools into the main flow.

