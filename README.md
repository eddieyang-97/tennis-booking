# Tennis booking — developer reference

**v0.8.7:** **Check and recover → Download diagnostic log** saves a timestamped JSON snapshot for support. It preserves checkout references/phases and run history while excluding card fields, passphrases and discount-code values. Exports remain local until the owner attaches them in chat; keep them out of the public repository.

**v0.8.5:** changing an unpaid test's discount code or checked date/preferences now automatically cleans up the prior verified test and restarts. The explicit **Clear unfinished unpaid test** button uses the same guarded cleanup. Exact test items and accounting are checked before each removal; opened checkouts require positive unpaid account evidence. Paid/uncertain purchases and ordinary payment journals remain protected. Cleanup steps and the archived test remain available for debugging. See [payment findings](docs/payment-system.md) for the evidence and limitations.

**v0.8.3:** adds a dedicated unpaid discount/checkout-opening test. See the [extension test instructions](outputs/tennis-local/chrome-extension/README.md). The test journals its mode before selecting, verifies exact basket identity and net amount, opens checkout once, and blocks automatic card/payment access. Interrupted opening is reconciled without repeating its click. Reference-bearing test cleanup requires explicit confirmation that the owner did not submit payment; actual payment journals remain protected. The configurable mixed-court basket path was verified live by the owner; automated discount checkout and unattended midnight payment still require live acceptance. Popup controls are smaller and the encrypted-file passphrase minimum is six characters.

Full-release UI requirements are tracked in [release settings](docs/release-settings.md): venue preference, London time range, desired/minimum hours, payment caps and an optional per-job discount code. All listed settings and the readiness panel are implemented in v0.8.0; unattended live acceptance remains pending.

Normal-Chrome Manifest V3 extension for Tower Hamlets Courtside bookings. The active source is [outputs/tennis-local/chrome-extension](outputs/tennis-local/chrome-extension/). Current source version: **0.8.8 MVP** (read-only grid readiness hardening). The readiness panel is incorporated in v0.8.0; draft PR #1 is superseded. This repository preserves the working source, regression tests and payment-system findings so future development can continue without repeating the investigation.

**Verified on 13 October 2026:** the extension filled Stripe's card form and submitted the authorised £2.50 Victoria Park test payment. The merchant's account purchase history showed the matching reference as **Confirmed / Paid ✔ / £2.50**. The owner subsequently cancelled the court booking manually. Cancellation does not establish a refund.

**Live evidence update:** the exported installed-extension journal confirms that purchase-history reconciliation succeeded on 13 October 2026 at 00:58:44 UTC. The first midnight release for 21 October began on time at 23:00:00.005 UTC on 13 October (00:00 London, 14 October), read the account successfully, then stopped at the first court-grid readiness timeout before selection/payment. This verifies alarm timing and live recovery, but not completed midnight booking. The v0.5.5 grid fix still needs a new live run; two-hour live payment remains unverified. Do not delete submission markers or treat an error result as proof that no charge occurred.

Read [Payment system findings](docs/payment-system.md) before changing checkout, recovery or the vault. That document contains the live evidence, failed approaches, DOM contracts and next implementation priorities.

**15 October update:** the v0.5.9 midnight search succeeded and found Bethnal Green Gardens court 4, 20:00–22:00 on 22 October, £14. Checkout stopped after selection because the basket item count differed from the expected two; no payment was attempted. The owner observed one selected hour becoming unselected. Overlapping per-hour basket updates are a plausible cause, reproduced in a regression fixture, but not yet verified against the site's implementation. v0.6.0 selects each hour once, waits for stable acknowledgement, resolves fresh grid nodes and validates the next hour before clicking. It also stabilises basket reads and stores safe expected/actual item diagnostics. Live two-hour acceptance remains blocked by site human verification in the inspection session.

## Development and installation

```powershell
cd outputs/tennis-local/chrome-extension
npm test
```

The extension has no npm dependencies; tests use Node's built-in test runner (verified with Node 24.18). The current suite has 72 passing tests. Load this directory as an unpacked extension in Chrome's extension manager. After changing source, reload the extension and relevant court/checkout tabs. **Reload before unlocking the card**: extension reload and browser restart clear the unlocked session.

Build the runtime ZIP with `powershell -ExecutionPolicy Bypass -File .\build.ps1` from the repository root. It checks an explicit 26-file runtime allowlist and prints the SHA256. The artifact is written under `artifacts/`, excluded from Git; release assets are published separately.

Create or unlock the encrypted card file through the extension's card setup page. Keep the downloaded file outside the repository. Card setup, passphrase entry and any bank/site authentication happen locally. See the [extension usage guide](outputs/tennis-local/chrome-extension/README.md).

## Booking rules and execution

Grid reads probe the content script even while Chrome reports the tab as loading. Manual checks get 20 seconds per navigation and a 500 ms retry pause. Scheduled release checks and their pre-selection grid read get 60 seconds per navigation and a five-second pause before one retry (two attempts total, approximately 125 seconds of readiness/retry waiting per grid, plus Chrome overhead). Individual read responses remain bounded to two seconds. Local DOM probing does not reload the page or poll the server. A signed-out/verification route, closed tab, untrusted origin or rejected layout stops immediately. Final failures retain the tab and timestamped safe route/load/read-state diagnostics, including the active timeout policy, without page text, input values or private URLs. A timeout means availability is unknown; a valid grid with no eligible cells means no availability. This retry helper cannot dispatch selection or payment messages.

The scheduled availability scan proceeds as soon as the preferred venue has an eligible candidate within the price cap; it does not delay that candidate to inspect the fallback venue. Manual availability checks still inspect both venues. The one-minute late-release guard applies when the scheduled check starts, not to time spent waiting for a slow grid after an on-time start.

v0.5.9 also allows 60 seconds for scheduled account, basket and purchase-history page reads, including preflight and pending-payment recovery. Manual reads retain 15 seconds. These read-only adapters can acknowledge a ready DOM while the tab is loading, use a single navigation, bound individual responses to two seconds and retain failed tabs with safe diagnostics. A blank, still-loading account is treated as not ready; a real sign-in/verification requirement still stops. Scheduled card-page and post-fill readiness waits also allow 60 seconds; unknown/closed destinations or changed amount/reference stop. Card filling, checkout-opening and Pay are dispatched once and never replayed by these wait helpers. Status exports include the installed version. No surge-traffic or midnight success is claimed from simulated tests.

- The popup defaults the playing-date field to London’s current date plus eight days. This is a suggested date, not an automatic weekday adjustment; choose the desired playing date before arming. Opening the popup does not change an existing armed job.
- Playing dates: any day; starts at 20:00 or 21:00.
- Bethnal Green Gardens before Victoria Park; two hours before one; consecutive hours may use different courts in the same venue. Same-court options are tried first.
- Maximum £14 for two hours or £7 for one; re-verify the exact item prices and total before payment.
- One confirmed booking per playing date. Other bookings in the same week do not block a new date; there is no weekly skip rule.
- Release is London midnight seven days before the playing date, with a preflight five minutes earlier. Date conversion accounts for GMT/BST.
- Each armed job runs once. Chrome must be open and the laptop awake; Chrome alarms do not wake a sleeping laptop. A check over a minute late stops. Startup restores future alarms and stops a missed release.

For multiple hours, all cells and prices are checked before the first click. Then each hour is selected once and its checkbox/basket-count acknowledgement must remain consistent across three 250 ms observations before the next hour is resolved afresh. Prior acknowledgement loss, an unavailable next cell or timeout stops without replay. After navigation to the basket, three consistent snapshots are required; the HTML parser must have finished. Exact per-hour venue/court/date/time and the complete price remain mandatory before payment.

Failed selection records intentionally stay pending and are marked `recoveryRequired`, with the last error, retained tab and safe basket/selection evidence. Do not erase these automatically. To abandon an unpaid partial or prepared basket, remove its items manually on the site, then use **Reconcile cleared selection**. This checks a stable empty basket, permits only pre-checkout phases without any provisional reference or payment dispatch marker, and archives the intent in `abandonedCheckouts`. Submitted payment journals cannot be cleared by this control.

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
| Regression suite | 72 passing tests, including worker recovery and mixed-court two-hour simulated flow |
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

### v0.6.1: unpaid morning acceptance test

Use **Check and recover → Test 09:00–11:00 basket (no payment)** with a released playing date (today through seven days ahead, including weekends). It searches BGG then Victoria Park for exactly two hours, allows different courts, caps the total at £14, and uses the same serialized selection and strict basket validation as the evening flow. It does not change evening availability results, recurring preferences or the armed job. Success is `basket-test-ready`, `basketVerified: true`, `paymentBlocked: true`; this proves basket preparation only, not paid booking. Inspect both hourly items, remove them manually, and use **Reconcile cleared selection** before another run. A durable `basketOnly` record blocks payment at both background and payment-module boundaries, including after reload. Partial selection stays pending for inspection/reconciliation. Live acceptance is still required.

### v0.6.2: closed selection-tab recovery

If a stored preparation tab has been closed, reopen only the read-only basket for an unsubmitted `selection-dispatched` or `awaiting-payment` journal with no provisional reference or payment dispatch marker. Keep the intent and reconcile the actual basket; never replay its selection. A matching basket resumes preparation, while an empty/partial basket remains stopped for explicit clearing and reconciliation. Referenced or payment-stage records continue to require receipt verification. Read-only page diagnostics are included in checkout failures. The follow-up journal confirms the morning test succeeded at 02:13:31 London on 15 October: BGG court 1, 22 October, 09:00–11:00, both clicks dispatched and acknowledged, two £5 items, exact £10 basket total. The later resume attempt stopped before a new basket read because its stored tab had been closed. This verifies live two-hour basket preparation, not midnight performance or payment for this slot. The test record still needs manual basket clearing and reconciliation. Card storage was locked in the export; unlock before arming an actual paid run.

### v0.6.3: read-only connection recovery and diagnostics

Basket reading reported `PAGE_TAB_ERROR` while the expected page was still loading; the old log hid the underlying error, so its precise cause is unconfirmed. Read-only polling now tolerates Chrome's asynchronous message-channel closure and removed-frame errors within the existing deadline, without reloading or repeating selection/payment. Failures identify the operation (`navigation`, `tab-state`, `message-read`) and an allowlisted reason (closed tab, channel, frame, missing receiver, access denied, invalidated extension context or unclassified). Raw error messages/URLs are excluded. Closed tabs and access errors stop immediately. Eighty tests pass, including transient and persistent disconnects and diagnostic redaction. Reload v0.6.3, ensure the test basket is manually empty, then use **Reconcile cleared selection**; this rechecks the empty basket without another selection. Live resolution of the reported read failure is still required.

### v0.6.4: prioritize one verified hour and preserve debugging context

Scheduled checkout can now downgrade an intended two-hour selection to one hour only when the stable basket contains exactly one of its intended venue/date/hour/court items, with an approved 20:00 or 21:00 start, exact item/total price at most £7, and the known payment boundary. No extra selection/removal is sent. The journal must still be `selection-dispatched`, without a provisional reference or payment dispatch marker; other pending/confirmed-date guards remain. An unrelated item, wrong total, 22:00 start, uncertain read, or extra item stops the flow. Manual preparation and daytime/legacy paid tests do not enable this policy. Payment re-reads and validates the downgraded basket before opening checkout, so a late second item causes a stop rather than an unwanted purchase.

The converted journal retains `fallbackFrom` (original slot/key, expected/actual basket evidence, timestamp); the new one-hour identity is committed before proceeding and survives restart. Runs now record extension version, retain 100 runs of up to 100 timestamped steps each, and checkout journals include `preparationRunId` for correlation with payment runs. This is bounded local logging, not remote monitoring or an indefinite audit archive; copy the status JSON after a failure before many later checks rotate it out. Logs omit card fields, passphrases and page HTML. The one-hour fallback has regression coverage including mixed courts, either intended hour, unsafe/overpriced baskets, no repeated selection and protected payment journals; live fallback remains unverified.

Remaining robustness limits: only the first eligible candidate is prepared; automatic safe re-search before any selection dispatch is a future improvement. A human verification page, expired session, locked card, bank challenge, closed Chrome or sleeping laptop can still stop unattended operation. Paid receipt recovery establishes payment and does not necessarily prove an active reservation (the account purchase table can still show a canceled purchase). Do not retry Pay after an uncertain submission. A successful real midnight run is still outstanding.

### v0.6.5: explicitly armed dates can be any weekday

Removed the Monday–Thursday restriction for normal availability checks, arming, candidate selection, checkout and payment recovery. Friday, Saturday and Sunday now use the same 20:00/21:00 start preferences, duration/court rules and £14/£7 limits. Each job remains explicitly armed for one playing date and runs once at London midnight seven days before play; the popup still defaults to today plus eight days. Date validity, booking-window checks, future release requirement, pending journals and duplicate-date protection remain in force. Historical weekday-limited policy descriptions earlier in these notes are superseded by this update.

### 16 October midnight run / v0.6.6 checkout-opening follow-up

The v0.6.5 export shows preflight passed at 23:55:01 London on 15 October. Release started at 00:00:00.038 London on 16 October for Friday 23 October; preferred BGG availability was ready at 00:00:11.841. Court 1, 20:00–22:00, £14 was selected; both clicks/checkboxes and a basket count of two were acknowledged at 00:00:40.567. The stable basket read at 00:00:42.628 contained exactly the two intended £7 hourly items and a £14 total. Preparation succeeded; one-hour fallback was unnecessary.

Automatic payment loaded the unlocked card and reverified the basket, but stopped at 00:00:48.125 with `Not the verified basket`, phase `checkout-opening`. That exact message comes from the payment-open handler when its receiving document is not `/basket`. No provisional reference or payment-dispatch marker was recorded; no card-filling/submit step occurred. The owner reports completing payment manually afterward; that transaction is not verified by this export and the extension journal still says pending. Never replay this checkout or clear the record as an unpaid selection. Receipt/account evidence must reconcile the manual payment, which currently lacks a stored merchant reference and automated dispatch marker.

The old opener checked the retained tab URL, read a separate temporary basket tab, then sent payment-open back to the retained tab. Its receiving route was not logged, so the cause of the route change (including any manual navigation) is unknown. v0.6.6 instead reads and validates the exact retained basket tab without navigation or creating another tab immediately before the one opening command; the content handler still checks route and exact basket equality before clicking. Read failures stop; no checkout mutation is retried. Logs now include the checkout-tab basket evidence and safe route category on a rejected opening command. This closes a validation/dispatch gap; it is not a claim that the precise observed race has been reproduced or that unattended payment now succeeds live.

### v0.7.0: optional discount code at arming

The popup now accepts an optional code (the observed merchant field permits at most 10 characters). A successful arm saves the trimmed code in that one-shot job and then in its checkout journal. Editing the popup later cannot change that job. Blank keeps the existing full-price flow; existing armed jobs are not retroactively changed. Owner codes are never hardcoded in the source or public fixtures; run logs record presence/accounting, not the code itself. Status exports do contain the locally saved job/checkout code and should remain private.

The merchant's actual `/basket/discount` POST form and `#checkout-discount` field were inspected in Chrome. A manual non-payment check accepted the owner's code, displayed an explicit -£2.50 discount and reduced the existing £12 basket to £9.50. The test discount was removed afterwards; the owner's padel item was retained. This verifies merchant acceptance and DOM accounting only, not automated tennis discount/payment execution.

Scheduled payment applies the saved code only after normal tennis basket preparation (including any approved one-hour fallback), with the exact intended items and gross price verified first. It writes `discountDispatchedAt` before sending the form once and then reads/reconciles the response within the page budget. Lost replies and worker restarts cannot repeat the code submission. Existing discounts are rejected before sending a new one. Invalid/expired codes, inconsistent totals, changed/extra items, zero-cost totals and unverified results stop before payment. Zero-cost checkout needs a separate flow and is not supported. Remove unrelated items and previously applied discounts before arming.

Gross court prices remain in `slot.totalGBP`; the journal separately stores `discount` with exact subtotal, deduction and positive net amount. Basket guards, Stripe amount checks, Pay and receipt/account recovery all use the verified net amount without weakening item identity or the original gross spending cap. Unknown payment outcomes still reconcile without resubmission. A failed discount submission is deliberately retained; after manually emptying its unpaid basket, **Reconcile cleared selection** can archive a `discount-dispatched` record only if it has no reference or payment marker. Daytime basket tests do not apply codes. A manually completed earlier payment still requires separate journal reconciliation; this release does not mark it paid automatically.

All 93 regression tests pass, including immutable arm settings, delayed/invalid discount responses, no repeated submission, changed-basket rejection, parser accounting, net payment identity and recovery. Full unattended execution of the discounted tennis flow remains unverified. Full-release venue/time/duration/payment settings remain tracked in docs/release-settings.md.

### v0.8.0: configurable booking settings and readiness

The popup now supports first-choice and optional fallback venue (BGG/VP), whole-hour earliest start/latest finish in London, desired and minimum duration (one or two hours), court switching, a total GBP cap, a separate one-hour cap, and the optional per-job discount code. Defaults for new settings are 20:00–22:00, prefer two hours/accept one, both venues in BGG-first order, court switching enabled, £14 total and £7 for one hour. Both caps conservatively apply to gross court prices before discount; net payment must match the separately verified discount. Desired duration is preferred within the first eligible venue. Same-court candidates precede mixed-court candidates.

**Save preferences** stores defaults without arming or changing an existing job. **Check availability now** uses current form preferences; preparation uses the preferences saved with that result. **Arm** saves an immutable settings snapshot in the one-shot job, which passes through scanning and into the checkout journal. Later form edits, preference saves or different settings supplied while resuming cannot change that journal. Legacy jobs/journals without settings retain their original evening time/cap rules. Hourly item identity, caps, minimum duration and court-switch policy are enforced again at checkout and payment; receipt recovery uses saved policy independently of the current booking window. A one-hour partial fallback is rejected when minimum duration is two or the saved one-hour cap/time/venue does not permit it. Overnight ranges, fractional hours, more than two hours, duplicate/unsupported venues and invalid money are rejected. Daytime basket-test controls retain their explicit fixed test policy.

The readiness panel shows version/card lock, pending checkout/payment, London release, preflight and saved duration/time/cap summary; it does not claim a booking succeeded. Actions refresh status without replacing their result or overwriting form edits. **Show diagnostic JSON** exports the private local status when needed. The readiness concept from draft PR #1 is now incorporated directly on current main; that PR is superseded, not merged.

All 99 tests pass, including settings validation, candidate filtering, immutable job/result/journal authorization, custom-price payment and historical recovery, partial fallback, popup behavior, readiness, and an unpaid simulated scheduled run that preserves VP daytime £18 settings despite later saved BGG defaults. The popup was rendered and exercised in Chrome against a localhost preview using simulated extension status; save and invalid-range rejection were observed. No real job was armed, card accessed or merchant payment made during this work. Unattended live configurable/discounted payment remains unverified; existing manually paid pending records still require reconciliation before another paid arm.

### v0.8.1: reconcile a manually completed payment

A payment completed by the owner after automation stopped before acquiring its provisional reference cannot use the automated dispatch-only recovery path. The existing record correctly remains pending, but arming previously reported the opaque `Invalid recovery reference or key`. The popup now provides **Manually paid booking reference → Verify manual payment** under Check and recover. The readiness panel displays the pending slot so the owner can bind the correct confirmation to it.

This path validates the existing normal checkout identity, saved authorization and explicit numeric booking reference, then writes a distinct `manualPaymentReportedAt` hold before reading any receipt/account evidence. It does not invent an automated payment-dispatch timestamp or mark a transaction paid just because it was reported. Exact paid purchase reference/state/net amount must match before confirmation. Account purchase evidence still yields `bookingState: unknown`; it is not proof an active reservation has not been canceled. Test-only records, mismatched keys/references and submitted payments cannot be rewritten by this control.

Every payment entry point and card-access/preparation guard treats a manual report as reconciliation-only. Failed verification preserves the hold and prevents card filling, checkout opening or another payment. Confirmation preserves the original slot and history. Existing Verify paid receipt handles subsequent retries of the same manual report. Before a manual reference is supplied, verification now explains which control to use; recovery/arming errors return unknown payment state instead of incorrectly implying that a manual payment never happened.

All 102 tests pass, including a mocked endpoint that confirms manual payment via account history with card access forbidden, wrong/invalid reference rejection, read-only retries, distinct journal provenance and no repeated payment. The owner's actual pending extension state still needs the new UI action after reload; source/build changes do not reconcile browser storage automatically. Never publish owner references or raw private journals in this repository.

### v0.8.2: distinguish future arming from older checkout recovery

Arm is intentionally for a playing date whose London release is still in the future. The reported recovery error came from an earlier pending checkout, not from the new date being unreleased. The popup now previews the selected date's release in London, displays the earlier checkout blocker beside Arm, and uses a recovery-specific readiness heading. Arming failures identify both the valid selected date and the older unresolved date/time, with the correct manual-payment or paid-receipt action; the structured response includes `UNRESOLVED_CHECKOUT` and `attemptedDay`. Action failures display their explanation rather than a generic JSON error. No pending payment guard is bypassed and a failed arm leaves saved jobs/alarms unchanged. All 103 tests pass, including a future-date arm blocked by an older checkout before any card access, and London release guidance.
