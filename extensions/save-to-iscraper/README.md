# Save to IScraper Extension

Browser extension for capturing the current page URL, selected text/media, or a cropped screenshot into a private IScraper library, with a side-panel research dock.

Status: coming soon for normal users. This folder is for development and browser-store submission work only.

## Browser Support

This package targets Manifest V3 Chromium browsers:

- Chrome
- Microsoft Edge
- Brave
- Arc
- Opera and other Chromium-based browsers that support MV3

Firefox and Safari should be treated as future packages. Those browsers need store-specific signing, manifest review, and QA before we call them supported.

## Workspace Commands

From the repository root:

```bash
npm run lint:extension
npm run build:extension
```

The build output is an unpacked extension folder at `extensions/save-to-iscraper/dist`.

## Architecture

This package follows a Manifest V3 extension layout:

```text
manifest.json
popup/
content/
background/
options/
icons/
```

The popup is the daily capture surface. Signed-in users see quiet primary actions for Capture URL, Screen Capture, text/media selection capture, and Research Dock, with optional save details tucked behind a small disclosure. The side panel lets users search recent saves, save dragged links, and open saved items without leaving the current page. The options page owns the app URL and browser connection state. The background service worker owns extension-to-backend requests, saved-page status checks, badge updates, and screenshot capture. The content script owns the crop overlay, page selection/media save button, saved-page indicator, and 5-second undo toast.

## Install Locally

Normal users should install from the Chrome Web Store or Edge Add-ons once the listing is approved. Until then, the extension is coming soon.

For developer testing only:

1. Run `npm run build:extension`.
2. Open Chrome or Edge.
3. Go to `chrome://extensions` or `edge://extensions`.
4. Turn on Developer mode.
5. Click Load unpacked.
6. Select `extensions/save-to-iscraper/dist`.

## How It Works

The extension opens IScraper only for a one-time account connection. The user signs in with the same email account they use for IScraper, and the web app sends a scoped extension session back to the extension from the approved IScraper origin.

After connection, captures run in the background:

- Capture URL sends the active tab URL and page metadata directly to IScraper.
- Capture URL shows a 5-second Undo action when a new URL save is created.
- Screen Capture lets the user drag a crop area, uploads that image, and shows a bottom-right Undo action for 5 seconds.
- Select Text or Media and the always-on save icon show a small save control near selected text or hovered images/videos on normal web pages.
- Research Dock opens a Chrome side panel for library search, recent saves, drag/drop link saving, and item/source opening.
- A saved-page status check updates the extension badge when the current page is already in the user's library.

The extension does not store the user's Supabase web-app session token and does not open IScraper during normal capture actions.

## Settings

The options page keeps user-facing controls small and review-friendly:

- Account connection state, disconnect, and reset.
- Default click behavior: show menu, capture URL, or start screen capture.
- Screenshot quality: balanced or high quality.
- Default collection name for extension saves.
- Optional per-capture collection and short note from the popup.
- Always-on page save icon on/off.
- Screenshot AI analysis on/off.
- Privacy toggles for including the source page URL and page title with screenshots.
- Troubleshooting details: extension version and the latest request status/request ID.

## Chrome Web Store Review Notes

- Single purpose: capture URLs, selected text/media, selected screenshots, and research-dock library lookups into the user's private IScraper library.
- Permissions include `activeTab`, `scripting`, `sidePanel`, and `storage`.
- No broad `all_urls` host permission.
- Content scripts run on normal HTTP/HTTPS pages so the small save icon can appear when users select text or hover media.
- No background scraping, history collection, cookies, or social-account access.
- No remotely hosted extension code; JavaScript and CSS are bundled in this folder.
- Screenshot crops are explicitly user-selected and transmitted only after the user completes the crop.
- Text/media content is transmitted only after the user clicks the small save icon.
