# Chrome Web Store Submission Notes

## Listing Draft

Name: Save to IScraper

Short description: Capture URLs and screenshots into your private IScraper library.

Single purpose: Capture the current page URL or a selected screenshot into the user's private IScraper library.

Detailed description:

Save to IScraper is a lightweight companion for the IScraper web app. Use it to capture the current page URL with page metadata, or drag a screenshot crop and save that image directly to your private library. New URL and screenshot saves include a short Undo action.

The extension is user-triggered. It does not scrape pages in the background, collect browsing history, or store your main IScraper web-app login token. IScraper opens only for one-time sign-in and extension connection.

## Category

Productivity

## Data Usage Disclosure

Data collected or processed:

- Website content: current page metadata and user-selected screenshot crops.
- Authentication information: a scoped IScraper extension session stored in local extension storage.
- User activity: only the current user-triggered capture or undo action.

Data is used only to provide the extension's visible features: Capture URL, Screen Capture, and Undo.

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
- No background scraping.
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
10. Confirm restricted browser pages such as `chrome://extensions` fail gracefully.
11. Disconnect this browser from settings and confirm capture actions ask for sign-in again.
12. Zip the contents of `extensions/save-to-iscraper/dist`, not the parent source folder.
