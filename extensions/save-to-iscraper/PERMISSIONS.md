# Save to IScraper Extension Permissions

This file documents the permissions requested in `manifest.json` for Chrome Web Store review.

## Single Purpose

Save to IScraper lets a user capture the current page URL or a selected screenshot into their private IScraper library.

## Requested Permissions

### `activeTab`

Used only after the user clicks the extension action. It grants temporary access to the current tab so the extension can read page metadata or capture the visible tab for a user-selected screenshot crop.

The extension does not request the broader `tabs` permission.

### `scripting`

Used to inject the bundled local `content/content.js` and `content/content.css` into the active tab when the user starts Screen Capture. The extension does not inject remote scripts.

### `storage`

Used to store:

- The configured IScraper app URL.
- A scoped extension session created after the user signs in to IScraper.
- The connected account email for display in the popup and settings.

The extension does not store the user's main web-app session token.

## Host Permissions

### `https://iscraper.vercel.app/*`

Used so the extension can call the IScraper backend for user-triggered Capture URL, Screen Capture, and Undo actions. It also allows the approved IScraper web app origin to complete the one-time extension connection.

The extension does not request `<all_urls>` or background access to arbitrary websites.

## Explicitly Not Requested

- `tabs`
- `cookies`
- `history`
- `webRequest`
- `downloads`
- `<all_urls>`
