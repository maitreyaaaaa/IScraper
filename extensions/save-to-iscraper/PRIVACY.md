# Save to IScraper Extension Privacy Policy

The Save to IScraper extension is a companion to the IScraper web app for capturing the current page URL, selected text/media, or a selected screenshot into the user's private IScraper library. It can also show a small save icon on normal web pages and a Chrome side-panel research dock.

## Data Processed

The extension may process:

- Current page URL, title, Open Graph metadata, author, and thumbnail URL when the user clicks Capture URL.
- Current page URL for saved-page status checks when the extension is connected.
- A screenshot crop when the user explicitly clicks Screen Capture and drags an area on the page.
- Selected text or an image/video URL when the user explicitly starts Select Text or Media and clicks the small save icon.
- Optional collection and note text entered by the user in the popup.
- Library search queries entered in the side panel.
- A scoped IScraper extension session stored in Chrome extension local storage after the user signs in to IScraper.
- The connected account email, stored only to show account state in the extension UI.
- The configured IScraper app URL, stored in Chrome sync storage.

It does not:

- Store the user's Google or Supabase web-app login token.
- Scrape pages in the background.
- Automatically scan browsing history.
- Access cookies, passwords, or social-platform sessions.
- Execute remotely hosted JavaScript.
- Sell user data or use user data for ads, credit decisions, or unrelated analytics.

## How Data Is Used

Saved page metadata, screenshot crops, selected text, media URLs, collection names, notes, status-check URLs, and side-panel search queries are sent to the configured IScraper app URL so the signed-in user can add and retrieve items from their private IScraper library. The extension uses page data only for the user-facing features described in the extension UI and Chrome Web Store listing: Capture URL, Screen Capture, Select Text or Media, Research Dock, saved-page status, and Undo.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Sharing

The extension sends data only to the configured IScraper app URL for the user's requested capture or undo action. IScraper does not sell extension data and does not transfer it to advertising platforms, data brokers, or information resellers.

## Storage And Retention

The extension stores only configuration needed to operate:

- The IScraper app URL in Chrome sync storage.
- A scoped extension session in Chrome local extension storage.
- The connected account email in Chrome local extension storage.

Page metadata, screenshot crops, selected text, media URLs, collection names, notes, and side-panel search queries are transmitted only when the user triggers the related feature. Current page URLs may be checked while browsing so the extension can show whether a page is already saved. Screenshot crops are not retained by the extension after the request completes. Users can disable the page save icon in settings, disconnect the browser from extension settings, or remove the extension to clear local extension data.

## Security

All extension requests require HTTPS. The extension uses Manifest V3, bundles JavaScript and CSS locally, and does not load or execute remotely hosted code. The extension opens IScraper only for one-time account connection; normal capture actions run in the background.
