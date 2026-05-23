# Extension Access Settings

## Goal
Let users manage browser-extension access tokens from Account settings without new tables, migrations, or extension runtime changes.

## Architecture
Reuse the existing extension token API:

- `GET /api/extension-tokens`
- `POST /api/extension-tokens`
- `DELETE /api/extension-tokens/:id`

The frontend stores only the one-time token secret returned after creation in component state. Existing listed tokens remain masked because the backend only returns public token metadata.

## UI
Add an **Extension Access** tab in Account settings. It shows token counts, active token rows, revoked/expired state, last-used and expiry timestamps, a create action, copy for the one-time secret, and revoke for active tokens.

## Security
Do not expose token hashes, user IDs, emails, or raw token secrets from listed records. Make revocation explicit and user-scoped through the existing backend route.

## Testing
Run frontend lint and build. Backend token routes already have coverage through extension-token search/revoke tests.
