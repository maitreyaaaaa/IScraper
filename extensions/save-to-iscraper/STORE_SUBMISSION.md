# Chrome Web Store Submission Notes

## Listing Draft

Name: Save to IScraper

Short description: Capture URLs, text, media, screenshots, and search your private IScraper library.

Single purpose: Capture and retrieve private IScraper library items from the browser.

Detailed description:

Save to IScraper is a lightweight companion for the IScraper web app. Use it to capture the current page URL with page metadata, save selected text or media references, drag a screenshot crop into your private library, and search recent saves from a Chrome side-panel research dock. New URL, text/media, and screenshot saves include a short Undo action.

The extension shows a small save icon on normal web pages after connection so users can save selected text and visible media references. It does not scrape pages in the background, collect browsing history, access cookies, or store your main IScraper web-app login token. IScraper opens only for one-time sign-in and extension connection.

## Category

Productivity

## Data Usage Disclosure

Data collected or processed:

- Website content: current page metadata, user-selected text/media references, and user-selected screenshot crops.
- Website URLs: current page URL for saved-page status checks.
- Authentication information: a scoped IScraper extension session stored in local extension storage.
- User activity: current user-triggered capture, library search, link save, status check, or undo action.

Data is used only to provide the extension's visible features: Capture URL, Screen Capture, Select Text or Media, Research Dock, saved-page status, and Undo.

Data is not sold, used for advertising, or transferred to data brokers.

## Permission Justifications

Use `PERMISSIONS.md` as the source for Chrome Web Store permission justification text.

## Privacy Policy

Use `PRIVACY.md` as the source for the hosted privacy policy page. Before public store submission, publish equivalent privacy-policy text on an IScraper-owned HTTPS URL and put that URL in the Chrome Web Store developer dashboard.

## Review Notes

- Manifest V3 extension.
- No remotely hosted JavaScript.
- No inline script tags.
- No `eval`, `new Function`, or dynamic remote-code execution.
- No broad host permission such as `<all_urls>`.
- Static content scripts run on normal HTTP/HTTPS pages for the save icon and saved-page indicator.
- No background scraping, cookie access, social-session access, or hidden page import.
- No automatic browsing-history collection.
- No main web-app auth token is stored by the extension.

## Manual QA Before Upload

1. Run `npm run lint:extension`.
2. Run `npm run build:extension`.
3. Load `extensions/save-to-iscraper/dist` as an unpacked extension in Chrome.
4. Open extension settings and confirm the default app URL is `https://iscraper.vercel.app`.
5. Click Sign in to IScraper and confirm the web app connects the extension.
6. Click Capture URL on a normal HTTPS page and confirm no IScraper tab opens during save.
7. Confirm URL Undo appears for 5 seconds and removes the new URL save when clicked.
8. Click Screen Capture, drag a crop, and confirm the image is saved.
9. Confirm the bottom-right Undo action appears for 5 seconds and removes the image save when clicked.
10. Click Select Text or Media, select text on a normal HTTPS page, and confirm the small save icon creates a library item.
11. Hover an image/video during Select Text or Media and confirm the small save icon creates a media-reference item.
12. Reload a normal HTTPS page while connected and confirm the small save icon appears after selecting text or hovering images/videos without opening the popup.
13. Open Research Dock and confirm recent saves, search, drag/drop link save, item open, and source open work.
14. Confirm the extension badge shows `SAVED` on a page already in the library.
15. Confirm restricted browser pages such as `chrome://extensions` fail gracefully.
16. Disconnect this browser from settings and confirm capture actions ask for sign-in again.
17. Zip the contents of `extensions/save-to-iscraper/dist`, not the parent source folder.
