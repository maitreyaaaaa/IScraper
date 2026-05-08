# Save to IScraper Extension

Phase 1 browser extension for saving the current tab into IScraper.

## Install Locally

1. Open Chrome or Edge.
2. Go to `chrome://extensions`.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select this folder: `extensions/save-to-iscraper`.

## How It Works

The extension does not store Supabase auth tokens.

When the user clicks Save to brain, it opens IScraper with the current tab URL, title, and optional note. The logged-in web app then saves the link using the normal user session.
