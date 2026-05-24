# Save to IScraper Extension Privacy Notes

The extension is designed to run only after a user clicks it.

It may process:

- Current page URL, title, Open Graph metadata, and an optional note when saving a page.
- Selected text when the user starts Lens search with text selected.
- A small screenshot crop when the user drags an area for Lens image search.
- A limited IScraper Lens token stored in browser local extension storage.

It does not:

- Store the user's Google/Supabase login token.
- Scrape pages in the background.
- Automatically scan browsing history.
- Store screenshot crops by default.
- Execute remotely hosted JavaScript.

Lens requests are sent to the configured IScraper app URL. Image Lens uses the user's own connected media AI key on the backend.

Planned one-click saving for screenshots, selected text, images, and videos must keep the same user-initiated model: no background scraping, no automatic browsing-history collection, and no storage of the user's main login token.
