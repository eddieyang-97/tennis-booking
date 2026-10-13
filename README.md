# Tennis booking — developer reference

Normal-Chrome Manifest V3 extension for Tower Hamlets Courtside bookings. The active source is [outputs/tennis-local/chrome-extension](outputs/tennis-local/chrome-extension/). Current version: **0.4.6**. This repository preserves the working source, regression tests and payment-system findings so future development can continue without repeating the investigation.

**Verified on 13 October 2026:** the extension filled Stripe's card form and submitted the authorised £2.50 Victoria Park test payment. The merchant's account purchase history showed the matching reference as **Confirmed / Paid ✔ / £2.50**. The owner subsequently cancelled the court booking manually. Cancellation does not establish a refund.

**Remaining gap:** the extension reported `payment-uncertain` because its receipt parser did not recognise the merchant's result. Its durable submission marker correctly prevents another charge. Automatic receipt reconciliation and unattended midnight completion are not yet verified. Do not delete that marker or treat `paid:false` in a stopped result as proof that no charge occurred.

Read [Payment system findings](docs/payment-system.md) before changing checkout, recovery or the vault. That document contains the live evidence, failed approaches, DOM contracts and next implementation priorities.

## Development and installation

```powershell
cd outputs/tennis-local/chrome-extension
npm test
```

The extension has no npm dependencies; tests use Node's built-in test runner (verified with Node 24.18). The current suite has 43 passing tests. Load this directory as an unpacked extension in Chrome's extension manager. After changing source, reload the extension and relevant court/checkout tabs. **Reload before unlocking the card**: extension reload and browser restart clear the unlocked session.

Create or unlock the encrypted card file through the extension's card setup page. Keep the downloaded file outside the repository. Card setup, passphrase entry and any bank/site authentication happen locally. See the [extension usage guide](outputs/tennis-local/chrome-extension/README.md).

## Booking rules and execution

- Playing dates: Monday–Thursday; starts at 20:00 or 21:00.
- Bethnal Green Gardens before Victoria Park; two hours before one; consecutive hours on the same court.
- Maximum £14 for two hours or £7 for one; re-verify the exact item prices and total before payment.
- One confirmed booking per playing date. Other bookings in the same week do not block a new date; there is no weekly skip rule.
- Release is London midnight seven days before the playing date, with a preflight five minutes earlier. Date conversion accounts for GMT/BST.
- Each armed job runs once. Chrome must be open and the laptop awake; Chrome alarms do not wake a sleeping laptop. A check over a minute late stops. Startup restores future alarms and stops a missed release.

At release the service worker checks the account, reads availability, selects an exact candidate, verifies the basket, opens card checkout, verifies the provisional reference and price, fills Stripe, journals submission, clicks Pay once, and attempts receipt reconciliation. A pending checkout blocks another checkout. Human verification or bank approval can still stop an unattended run.

## Source map

| File in `chrome-extension/` | Responsibility |
| --- | --- |
| `background.js` | Alarms, orchestration, Chrome messaging, persistent state and recovery |
| `core.js`, `stage-rules.js` | London dates, candidate ordering, strict slot/basket checks |
| `content.js`, `stage-content.js` | Account/grid reads and court selection/basket inspection |
| `checkout.js`, `payment.js` | Checkout identity, durable journal and single-submission payment state machine |
| `payment-content.js`, `checkout-content.js` | Merchant checkout and receipt DOM adapters |
| `card-content.js` | Staged card filling inside Stripe's cross-origin frame |
| `card-vault-core.js`, `card-vault.js`, `card-vault.html` | Encryption, local setup/unlock and trusted session storage |
| `link-frames.js`, `link-content.js` | Stripe frame discovery and legacy Link handling; live paid runs require local card filling |
| `navigation.js`, `retry.js`, `run-log.js` | Navigation readiness, bounded read retries and timestamped run history |
| `popup.html`, `popup.js` | Scheduling, card readiness, test and recovery controls |
| `test-*.js` | Regression fixtures; these do not prove live merchant behaviour |

Persistent Chrome local storage includes `job`, `checkoutRecords`, `checkoutResult`, availability results and timestamped `runHistory`. The unlocked card lives only in trusted Chrome session storage as `localPaymentCard`. Checkout identity binds venue, date, court, start, hours and exact price. `paymentDispatchedAt` is persisted **before** submission and is sticky across later phases. After that point, recovery may inspect receipts but must never submit again automatically.

## Evidence and next work

| Check | Status |
| --- | --- |
| Regression suite | 43 passing tests |
| Live one-hour Victoria Park basket selection and cleanup | Passed on 12 October UTC / 13 October London |
| Live local-card autofill and £2.50 submission | Paid merchant purchase independently verified on 13 October |
| Test booking cancellation | Manually performed and confirmed by owner |
| Automatic paid-receipt recognition | Failed; pending journal remains unresolved |
| Two-hour live payment; midnight end-to-end run | Not verified |

Next work should reconcile the dispatched test through the account purchase history, normalise the `PT` reference prefix, handle stale tab IDs, and preserve separate transaction and active-booking/cancellation states. Strengthen stored basket evidence before adding an account fallback: a purchase row supplies reference, amount and paid state, but can lose the court details after cancellation. Never infer payment from an empty basket or missing upcoming booking. See the detailed [recovery requirements](docs/payment-system.md#next-implementation-work).

## Repository boundaries

The Python files under `outputs/tennis-local/` are an earlier, blocked Playwright prototype, retained for development history. They do not implement verified payment and are not the active scheduler. Their historical notes are not the current extension specification; do not enable `adapter_verified` manually. `work/` contains earlier local verification diagnostics.

`.gitignore` uses an allowlist for source and documentation. Browser profiles, virtual environments, inspection captures, attachments, runtime ZIPs, encrypted card files, credentials and private run journals are excluded. Do not upload the entire working directory or exported Chrome storage. Runtime packages should be built from the extension's runtime files only, excluding tests, package metadata and private data.
