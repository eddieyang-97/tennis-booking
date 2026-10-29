# Tennis booking

A Manifest V3 Chrome extension that checks and attempts to book tennis courts on [Tower Hamlets Courtside](https://tennistowerhamlets.com/) at the London midnight release, with configurable preferences, strict basket/payment verification, a local encrypted card file and recovery of uncertain payments.

**Active implementation:** [`outputs/tennis-local/chrome-extension/`](outputs/tennis-local/chrome-extension/) · **Version:** [`0.9.9`](outputs/tennis-local/chrome-extension/manifest.json), contextual recovery controls (29 October 2026). This branch is not a merged release claim.

**Release status:** In active development, **not yet verified for unattended end-to-end midnight payment**. A real £2.50 one-hour card payment and its subsequent account-purchase reconciliation were verified on 13 October. Live two-hour basket selection was verified, but an automated two-hour Pay and a complete unattended midnight booking have not been established. See [release notes and live-evidence limits](docs/release-notes.md).

## Quick start

The live implementation runs as an unpacked extension in **normal Chrome**, using the owner's signed-in Courtside session. The older Python/Playwright prototype is not the active runner.

1. Open `chrome://extensions`, enable **Developer mode**, and load [`outputs/tennis-local/chrome-extension/`](outputs/tennis-local/chrome-extension/) with **Load unpacked**.
2. Sign in to Courtside in that Chrome profile. Use **Set up or unlock card file** in the extension to create or unlock the locally encrypted card file. Keep the file outside this repository.
3. Choose a **future playing date**, set venue/time/duration/cost preferences, and click **Arm midnight booking and payment**. The release is London midnight **seven days before play**; preflight begins five minutes earlier.
4. Keep Chrome running and the computer **awake**, with the card still unlocked. Chrome alarms cannot wake a sleeping computer; human verification or bank approval may require intervention.

**Updating the extension:** Reload it at `chrome://extensions` after source changes, and reload relevant open merchant tabs so content scripts match. **Unlock the card after the final reload**; extension reload/browser restart clears the unlocked session, though saved jobs/journals remain.

See the [extension usage guide](outputs/tennis-local/chrome-extension/README.md) for unpaid testing, recovery controls and troubleshooting. **An armed job or preflight success is not evidence of a reservation or payment.**

## Default booking policy

All preferences below are configurable in the popup. The saved job's settings snapshot is immutable; later popup edits do not change an already armed job or pending checkout.

| Setting | Default / behavior |
| --- | --- |
| Playing date | Any day of the week; explicitly armed before its seven-day-early release |
| Venues | Bethnal Green Gardens → St Johns Park → Victoria Park; second/third choices are optional |
| Time | Whole-hour starts, default window **20:00–22:00 London**; every booked hour must fit within the selected window |
| Duration | Prefer **2 hours**, accept **1 hour** by default; configurable minimum |
| Courts | Prefer consecutive hours on the same court; allow different courts at the same venue when enabled |
| Price authorization | **£14 total** by default, with **£7 one-hour cap**; caps check gross price before any optional discount |
| Duplication | A previously confirmed booking for the same playing date or unresolved checkout blocks a conflicting new checkout |

Candidate priority is **venue → duration → earliest eligible start time → court configuration** (same court first for a given start). A valid candidate at a higher-ranked venue can take priority over a longer booking at a fallback venue.

A scheduled two-hour selection may be treated as a one-hour booking **only** when the observed basket contains precisely one intended, authorized hour and the saved minimum duration, time and one-hour cap allow it. No extra click is issued to manufacture a fallback.

Supported configuration is limited to **whole-hour, same-day London windows** and **one- or two-hour** durations. Reversed/empty/overnight/fractional ranges, unsupported venues, invalid/nonpositive caps and duplicate/unsupported preferences are rejected. Totals are compared in integer pence. A blank discount code follows ordinary checkout; a provided code is applied at most once and must be verified against every basket item, gross subtotal, explicit discount and net payable. A fully discounted basket uses a separate one-shot free-booking completion, never card checkout. Legacy pending journals require manual review. These acceptance requirements are covered in the [testing plan](docs/test-improvement.md#settings-and-discount-regression-contract-carried-forward-from-v080-requirements).

The popup initially suggests London today + 8 days; it does not automatically change an already armed date. Nightly runs are one-shot, not a recurring weekly subscription.

## Execution and safety model

For component ownership, the scheduled sequence, persistent state and a checkout lifecycle diagram, see the [architecture and state guide](docs/architecture.md). Detailed merchant recovery rules remain in the [payment-system reference](docs/payment-system.md).

1. Five-minute preflight checks account/card readiness. At the release, the service worker checks the account, reads eligible court grids, and chooses an authorized candidate.
2. It checks the basket, records selection intent, dispatches hourly selection **sequentially**, and validates stable basket contents: venue, playing date, each hour/court, original prices, totals and payment boundary.
3. If requested, it applies and verifies a discount once. It opens card checkout only from a verified basket, then checks the net amount and provisional merchant reference before attempting Pay.
4. It **persists a payment dispatch marker before clicking Pay once**. An uncertain or interrupted payment is receipt/account-reconciliation-only, never an automatic second charge.

The scheduled flow retains its selected availability grid for a fresh read before selection, rather than loading the grid twice. A separate initial basket read still verifies emptiness. After selection, the retained tab loads the basket to verify the selected items and refreshes it from the merchant before payment preparation; checkout opening freshly checks that same tab's stable DOM. The pre-payment server refresh detects basket changes that another tab could make without updating the old DOM. These tab handoffs exist only within the uninterrupted release invocation, carry no cached basket authorization, and are not restored after a restart. Navigation savings are tested offline; live checkout latency and merchant acceptance remain unverified.

**Paying is not the same as holding an active booking.** Matching merchant purchase history establishes paid transaction status; `bookingState` can still be `unknown` if a reservation was cancelled. Cancellation also does not prove a refund.

Read-only navigation uses bounded readiness/retry policies. An unknown grid, unauthenticated page, unexpected basket, changed price/reference, merchant error, or unresolved prior intent stops rather than guessing or repeating a mutation. These safeguards prioritize avoiding unintended bookings and duplicate charges over automatic success.

After a journaled discount attempt, unclassified message failures on the same trusted, loading basket tab may be observed again within the remaining discount budget. This does not navigate or reapply the code. Closed/denied/invalidated contexts, changed routes and returned basket rejection still stop. Retry counts and elapsed/remaining time are sanitized; a loading tab is permission for another read, not evidence of discount success. See the [22 October incident evidence](docs/payment-system.md#22-october-release-post-discount-basket-read-failure).

Selection acknowledgement shares one elapsed-time budget across both hours (60 seconds scheduled, 15 seconds manual). A suspended/throttled tab checks the deadline when it runs again; it cannot guarantee callback delivery at exactly the deadline. Diagnostics retain per-hour dispatch timestamps, elapsed time, checkbox reversion, badge counts and safe page/alert categories. Optional same-origin fetch/XHR status observations cover the selection window only; they do not identify the add-to-basket request or prove rejection. Raw URLs, headers, response bodies and alert text are excluded. An empty basket or HTTP error does not automatically authorize switching courts; the uncertain journal stays held. Exact authorized one-hour basket fallback remains supported without another selection click.

Manual availability checks and verification resumes are paused while a release job is armed, so they cannot occupy its queue. Cancel the job before checking manually. Read-only recovery assessment remains independent; Cancel does not preempt a queued or running release.

**Do not delete or reset `checkoutRecords` / `paymentDispatchedAt` / `manualPaymentReportedAt` to clear a stopped run.** Use the extension's guarded reconciliation controls. For recovery instructions, see the [usage guide](outputs/tennis-local/chrome-extension/README.md).

## Development and validation

Run the maintained Node test suite (Node's built-in `node:test`; no npm package installation required):

~~~powershell
cd outputs/tennis-local/chrome-extension
npm test
~~~

To build a reviewed runtime ZIP from the repository root (PowerShell required):

~~~powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
~~~

The build uses an explicit runtime file allowlist, creates an archive under ignored `artifacts/`, checks its contents and outputs a SHA-256 hash. The archive deliberately omits test sources and private local data.

**Validation boundaries:** The [Reliability gate](.github/workflows/reliability.yml) checks PRs targeting `main` and pushes to `main` (with optional manual dispatch). Its deterministic job runs the maintained Node suite, named/worker regressions and exact-package verification under both PowerShell 7 and Windows PowerShell 5.1. A separate pinned Chromium job runs fake-merchant integration, worker/process-restart scenarios and network-denial checks without duplicating the deterministic suite or package build. Superseded PR runs are canceled; `main` runs are retained. Local simulation and CI passes are not unattended merchant/payment acceptance.

For focused local debugging, run the relevant suite; `npm run test:ci` remains the optional full local gate after installing the pinned test browser (see [browser test instructions](outputs/tennis-local/chrome-extension/test/browser/README.md)). The browser harness substitutes only loopback merchant, fake card/clock and controlled alarm behavior into an isolated test bundle; the production ZIP retains the original runtime. These tests do not establish live midnight delivery, Stripe compatibility or unattended paid bookings.

### Code orientation

The [architecture and state guide](docs/architecture.md#components-and-ownership) maps the active source modules to their responsibilities, storage lifetimes and external boundaries. For the extension's operational controls, use the [extension guide](outputs/tennis-local/chrome-extension/README.md).

Keep owner checkout journals and exported diagnostics private: exports redact known card/password/discount fields but can retain potentially sensitive booking references.

## Documentation

- [Merchant observation and REA evaluation](docs/merchant-observation.md) — isolated request/initiator comparisons, tool limits and remaining live-evidence gaps
- [Architecture and state diagrams](docs/architecture.md) — component map, checkout lifecycle and restart boundaries
- [Extension setup, testing and recovery](outputs/tennis-local/chrome-extension/README.md) — **current operating instructions**
- [Release notes](docs/release-notes.md) — version history and dated live acceptance evidence
- [Payment-system investigation](docs/payment-system.md) — merchant DOM contracts, failures and historical technical findings; earlier hypotheses may be superseded
- [Test improvement proposal](docs/test-improvement.md) — prioritized reliability/testing work and acceptance gates
- [Distribution flow](docs/distribution-flow.md) — friend beta, gated on proven unattended booking, and optional later Chrome Web Store rollout
- [Historical MVP and settings releases](docs/release-notes.md) — retained v0.5.0/v0.8.0 release evidence; current booking rules are described above

## Repository boundaries

The Python files directly under `outputs/tennis-local/` are a retired/blocked prototype, **not** the working extension or payment scheduler; do not enable `adapter_verified` as a workaround. `work/` holds earlier verification experiments. Do not commit Chrome profiles, site/account dumps, exported private journals, credentials, encrypted card files or runtime artifacts. Consult the [.gitignore](.gitignore) and runtime build allowlist.

St Johns support (v0.9.7): existing saved preferences and armed jobs are preserved. To include St Johns in an existing setup, choose BGG first, St Johns second and Victoria third, save preferences, then arm a new job. The public venue slug is verified; its grid currently redirects unauthenticated requests to human verification, so venue DOM compatibility remains tested with synthetic fixtures rather than live acceptance.
