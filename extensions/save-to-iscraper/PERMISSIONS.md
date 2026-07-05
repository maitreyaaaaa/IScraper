# Save to IScraper Extension Permissions

This file documents the permissions requested in `manifest.json` for Chrome Web Store review.

## Single Purpose

Save to IScraper lets a user capture the current page URL, selected text/media, selected screenshots, and use a side-panel research dock for their private IScraper library.

## Requested Permissions

### `activeTab`

Used after the user clicks extension actions. It grants temporary access to the current tab so the extension can read page metadata or capture the visible tab for a user-selected screenshot crop.

The extension does not request the broader `tabs` permission.

### `scripting`

Used to inject the bundled local `content/content.js` and `content/content.css` into the active tab when the user starts Screen Capture or Select Text or Media. The extension does not inject remote scripts.

### `sidePanel`

Used to show the IScraper Research Dock in Chrome's side panel. The dock lets the connected user search recent saves, save dragged links, and open saved items while browsing.

### `storage`

Used to store:

- The configured IScraper app URL.
- A scoped extension session created after the user signs in to IScraper.
- The connected account email for display in the popup and settings.

The extension does not store the user's main web-app session token.

## Host Permissions

### `https://iscraper.vercel.app/*`

Used so the extension can call the IScraper backend for user-triggered Capture URL, Screen Capture, Select Text or Media, Research Dock, saved-page status, and Undo actions. It also allows the approved IScraper web app origin to complete the one-time extension connection.

The extension does not request `<all_urls>` in `host_permissions`, but it does register content scripts for `http://*/*` and `https://*/*` so the small save icon and saved-page indicator can work on normal web pages.

## Explicitly Not Requested

- `tabs`
- `cookies`
- `history`
- `webRequest`
- `downloads`
- `<all_urls>`
