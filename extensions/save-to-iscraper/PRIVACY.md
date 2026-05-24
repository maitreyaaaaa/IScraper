# Save to IScraper Extension Privacy Policy

The Save to IScraper extension is designed to run only after a user clicks it. It is a companion to the IScraper web app for capturing the current page URL or a selected screenshot into the user's private IScraper library.

## Data Processed

The extension may process:

- Current page URL, title, Open Graph metadata, author, and thumbnail URL when the user clicks Capture URL.
- A screenshot crop when the user explicitly clicks Screen Capture and drags an area on the page.
- A scoped IScraper extension session stored in Chrome extension local storage after the user signs in to IScraper.
- The connected account email, stored only to show account state in the extension UI.
- The configured IScraper app URL, stored in Chrome sync storage.

It does not:

- Store the user's Google or Supabase web-app login token.
- Scrape pages in the background.
- Automatically scan browsing history.
- Execute remotely hosted JavaScript.
- Sell user data or use user data for ads, credit decisions, or unrelated analytics.

## How Data Is Used

Saved page metadata and screenshot crops are sent to the configured IScraper app URL so the signed-in user can add that item to their private IScraper library. The extension uses page data only for the user-facing features described in the extension UI and Chrome Web Store listing: Capture URL, Screen Capture, and Undo.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Sharing

The extension sends data only to the configured IScraper app URL for the user's requested capture or undo action. IScraper does not sell extension data and does not transfer it to advertising platforms, data brokers, or information resellers.

## Storage And Retention

The extension stores only configuration needed to operate:

- The IScraper app URL in Chrome sync storage.
- A scoped extension session in Chrome local extension storage.
- The connected account email in Chrome local extension storage.

Page metadata and screenshot crops are transmitted only when the user triggers a capture. Screenshot crops are not retained by the extension after the request completes. Users can disconnect the browser from the extension settings or remove the extension to clear local extension data.

## Security

All extension requests require HTTPS. The extension uses Manifest V3, bundles JavaScript and CSS locally, and does not load or execute remotely hosted code. The extension opens IScraper only for one-time account connection; normal capture actions run in the background.
