# Account Requests Settings

## Goal
Give users a clear place to request account/data deletion without implementing destructive self-serve deletion in this no-migration pass.

## Architecture
Frontend-only. Reuse the existing support email and legal copy. The action opens a prefilled mailto request from the user's account email and does not call any deletion API.

## UI
Add an **Account Requests** tab in Account settings. It explains export-first behavior, what the request covers, and provides a prefilled email action for deletion or privacy help.

## Safety
No records are deleted. Self-serve deletion remains deferred because it needs explicit product/security review, audit logging, and careful data-retention handling.

## Testing
Run frontend lint and build.
