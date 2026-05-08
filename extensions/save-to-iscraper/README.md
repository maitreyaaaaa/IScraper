# Save to IScraper Extension

Browser extension for saving the current tab and running IScraper Lens search.

Status: coming soon for normal users. This folder is for development and browser-store submission work only.

## Browser Support

This package targets Manifest V3 Chromium browsers:

- Chrome
- Microsoft Edge
- Brave
- Arc
- Opera and other Chromium-based browsers that support MV3

Firefox and Safari should be treated as future packages. The extension logic is portable, but those browsers need store-specific signing, manifest review, and QA before we call them supported.

## Install Locally

Normal users should install from the Chrome Web Store or Edge Add-ons once the listing is approved. Until then, the extension is coming soon.

For developer testing only:

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select this folder: `extensions/save-to-iscraper`.

## How It Works

The extension does not store Supabase auth tokens.

When the user clicks Save to brain, it opens IScraper with the current tab URL, title, platform, Open Graph description, thumbnail, author, and optional note. The logged-in web app then saves the link using the normal user session.

For Lens search, create a Lens token in IScraper Settings, paste it into the extension, then click Lens search this page. If text is selected, IScraper searches that text across the user's brain. If no text is selected, the user can drag around an object or text inside an image.

Full IScraper pages always open in a new tab. Lens stores only a limited extension token, not the user's main login session.

## Chrome Web Store Review Notes

- Single purpose: save pages to IScraper and search the user's IScraper library from the active tab.
- Permissions are intentionally narrow: `activeTab`, `scripting`, and `storage`.
- No broad `all_urls` host permission.
- No background scraping and no automatic page scanning.
- No remotely hosted extension code; JavaScript and CSS are bundled in this folder.
- Screenshot crops are user-selected, size-limited by the backend, and not stored by default.
- Full dashboard/open item actions always use a new browser tab.
