# Tennis booking — developer reference

Normal-Chrome Manifest V3 extension for Tower Hamlets Courtside bookings. The active source is [outputs/tennis-local/chrome-extension](outputs/tennis-local/chrome-extension/). Current source version: **0.5.5 MVP** (read-only grid readiness hardening). The readiness-panel enhancement remains separate in PR #1. This repository preserves the working source, regression tests and payment-system findings so future development can continue without repeating the investigation.

**Verified on 13 October 2026:** the extension filled Stripe's card form and submitted the authorised £2.50 Victoria Park test payment. The merchant's account purchase history showed the matching reference as **Confirmed / Paid ✔ / £2.50**. The owner subsequently cancelled the court booking manually. Cancellation does not establish a refund.

**Live evidence update:** the exported installed-extension journal confirms that purchase-history reconciliation succeeded on 13 October 2026 at 00:58:44 UTC. The first midnight release for 21 October began on time at 23:00:00.005 UTC on 13 October (00:00 London, 14 October), read the account successfully, then stopped at the first court-grid readiness timeout before selection/payment. This verifies alarm timing and live recovery, but not completed midnight booking. The v0.5.5 grid fix still needs a new live run; two-hour live payment remains unverified. Do not delete submission markers or treat an error result as proof that no charge occurred.

Read [Payment system findings](docs/payment-system.md) before changing checkout, recovery or the vault. That document contains the live evidence, failed approaches, DOM contracts and next implementation priorities.

## Development and installation

```powershell
cd outputs/tennis-local/chrome-extension
npm test
```

The extension has no npm dependencies; tests use Node's built-in test runner (verified with Node 24.18). The current suite has 59 passing tests. Load this directory as an unpacked extension in Chrome's extension manager. After changing source, reload the extension and relevant court/checkout tabs. **Reload before unlocking the card**: extension reload and browser restart clear the unlocked session.

Build the runtime ZIP with `powershell -ExecutionPolicy Bypass -File .\build.ps1` from the repository root. It checks an explicit 25-file runtime allowlist and prints the SHA256. The artifact is written under `artifacts/`, excluded from Git; release assets are published separately.

Create or unlock the encrypted card file through the extension's card setup page. Keep the downloaded file outside the repository. Card setup, passphrase entry and any bank/site authentication happen locally. See the [extension usage guide](outputs/tennis-local/chrome-extension/README.md).

## Booking rules and execution

Grid reads probe the content script even while Chrome reports the tab as loading. Each navigation gets a 20-second readiness budget, with individual read responses bounded to two seconds. A readiness timeout allows one fresh navigation (two attempts total); a signed-out/verification route, closed tab, untrusted origin or rejected layout stops immediately. Final failures retain the tab and timestamped safe route/load/read-state diagnostics, without page text, input values or private URLs. A timeout means availability is unknown; a valid grid with no eligible cells means no availability. This retry helper cannot dispatch selection or payment messages.

- The popup defaults the playing-date field to London’s current date plus eight days. This is a suggested date, not an automatic weekday adjustment; choose a Monday–Thursday date before arming. Opening the popup does not change an existing armed job.
- Playing dates: Monday–Thursday; starts at 20:00 or 21:00.
- Bethnal Green Gardens before Victoria Park; two hours before one; consecutive hours may use different courts in the same venue. Same-court options are tried first.
- Maximum £14 for two hours or £7 for one; re-verify the exact item prices and total before payment.
- One confirmed booking per playing date. Other bookings in the same week do not block a new date; there is no weekly skip rule.
- Release is London midnight seven days before the playing date, with a preflight five minutes earlier. Date conversion accounts for GMT/BST.
- Each armed job runs once. Chrome must be open and the laptop awake; Chrome alarms do not wake a sleeping laptop. A check over a minute late stops. Startup restores future alarms and stops a missed release.

An `armed` response with `mode:payment` and `paymentAutomatic:true` confirms the saved date and automatic payment mode, not a completed preflight or booking. The response's release timestamp is UTC; London midnight during BST appears as 23:00Z on the preceding date. Preflight runs five minutes before that release. Source updates take effect after extension reload; saved jobs survive, but the unlocked card session does not. Unlock again after the final reload and avoid further reloads before the run. The paid-test launch control has been removed; its historical payment journal and receipt-only recovery remain intact.

At release the service worker checks the account, reads availability, selects an exact candidate, verifies the basket, opens card checkout, verifies the provisional reference and price, fills Stripe, journals submission, clicks Pay once, and attempts receipt reconciliation. A pending checkout blocks another checkout. Human verification or bank approval can still stop an unattended run.

## Source map

| File in `chrome-extension/` | Responsibility |
| --- | --- |
| `background.js` | Alarms, orchestration, Chrome messaging, persistent state and recovery |
| `core.js`, `stage-rules.js` | London dates, candidate ordering, strict slot/basket checks |
| `content.js`, `stage-content.js` | Account/grid reads and court selection/basket inspection |
| `checkout.js`, `payment.js` | Checkout identity, durable journal and single-submission payment state machine |
| `reconciliation.js` | Historical dispatched-record validation and receipt/account fallback |
| `payment-content.js`, `checkout-content.js` | Merchant checkout and receipt DOM adapters |
| `card-content.js` | Staged card filling inside Stripe's cross-origin frame |
| `card-vault-core.js`, `card-vault.js`, `card-vault.html` | Encryption, local setup/unlock and trusted session storage |
| `link-frames.js`, `link-content.js` | Stripe frame discovery and legacy Link handling; live paid runs require local card filling |
| `navigation.js`, `retry.js`, `run-log.js` | Navigation readiness, bounded read retries and timestamped run history |
| `popup.html`, `popup.js` | Scheduling, card readiness, test and recovery controls |
| `test-*.js` | Regression fixtures; these do not prove live merchant behaviour |

Persistent Chrome local storage includes `job`, `checkoutRecords`, `checkoutResult`, availability results and timestamped `runHistory`. The unlocked card lives only in trusted Chrome session storage as `localPaymentCard`. Checkout identity binds venue, date, hourly court assignments, start, hours and exact price. Mixed slots add a courts array; legacy single-court keys remain unchanged. `paymentDispatchedAt` is persisted **before** submission and is sticky across later phases. After that point, recovery may inspect receipts but must never submit again automatically.

## Evidence and next work

| Check | Status |
| --- | --- |
| Regression suite | 59 passing tests, including worker recovery and mixed-court two-hour simulated flow |
| Live one-hour Victoria Park basket selection and cleanup | Passed on 12 October UTC / 13 October London |
| Live local-card autofill and £2.50 submission | Paid merchant purchase independently verified on 13 October |
| Test booking cancellation | Manually performed and confirmed by owner |
| Account purchase parser | Recognised the actual paid transaction using current source against live DOM |
| Installed-extension purchase reconciliation | Confirmed in exported journal on 13 October; original paid test remains manually cancelled |
| Midnight alarm/account read | Ran on time on 14 October London; first grid timed out before selection |
| Two-hour live payment; completed midnight booking; v0.5.5 live grid recovery | Not verified |

To finish live acceptance, reload the grid-readiness fix and unlock the card again. The historical paid test is already reconciled; do not charge it again. A matching purchase confirms payment but reports active booking state as unknown; cancellation and refunds remain distinct. An expired job left after the failed release will not rerun automatically; use a manual availability check for an already released playing date, or arm a future release. Keep Chrome open and awake for the release. Optional work is tracked in [the enhancement roadmap](docs/mvp-release.md). Never infer payment from an empty basket or missing upcoming booking.

## Repository boundaries

The Python files under `outputs/tennis-local/` are an earlier, blocked Playwright prototype, retained for development history. They do not implement verified payment and are not the active scheduler. Their historical notes are not the current extension specification; do not enable `adapter_verified` manually. `work/` contains earlier local verification diagnostics.

`.gitignore` uses an allowlist for source and documentation. Browser profiles, virtual environments, inspection captures, attachments, runtime ZIPs, encrypted card files, credentials and private run journals are excluded. Do not upload the entire working directory or exported Chrome storage. Runtime packages should be built from the extension's runtime files only, excluding tests, package metadata and private data.
