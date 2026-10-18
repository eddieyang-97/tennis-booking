# Tennis booking: reliability and test improvement proposal

**Status:** The observability milestone (GitHub PR #2) merged on 18 October 2026. The stateful-worker milestone (GitHub PR #3) now includes the reviewed main-branch fixes and is being validated separately. Browser integration remains the following milestone.
**Reviewed source:** `main` at `5aa63506a000d4adf05a7e8b8e635cab1b513dbd` (16 October 2026), extension v0.8.9  
**Scope:** Chrome extension in `outputs/tennis-local/chrome-extension/`  
**Evidence update:** Four private diagnostic exports from 16 October 2026, spanning installed versions v0.8.7–v0.8.9. Only sanitized findings are included here; original logs must not be committed.
**Review update (17 October 2026):** Added existing-purchase-page recovery, P0 restart/concurrency coverage, an explicit receipt-source decision contract, baseline CI from PR 1 and enforceable browser network/package isolation. These remain proposed requirements, not implemented or live-verified behavior.

## Executive summary

### Implementation progress (17 October 2026)

**18 October update:** PR #2 merged with all three review findings resolved and CI passing. PR #3 preserves its structured classification, action metadata ordering, accurate alarm outcomes and Windows PowerShell build fixes. Review fixes stop uncertain card-fill recovery before Pay or refill, hold recognized same-reference receipt contradictions through the content-script/worker boundary, and keep bounded read-only assessment outside the mutation queue. Regressions include enabled cards of unknown provenance, contradictory receipts, hung tab reads overlapping alarms, changed journal snapshots and existing-purchase identity checks. VM faults are caught simulation exceptions; they do not establish behavior under hard process termination or live merchant conditions.

The next PR #3 review round scopes receipt dates/times to recognized booking details, excludes processing metadata, and covers explicitly conflicting single starts through worker reconciliation. Armed-job admission rejects manual checks/resumes before reads; tests preserve release timing across worker recreation and permit checks after cancellation. These are offline regressions, not live receipt-layout or Chromium lifecycle acceptance.

- **PR 1 implemented, simulated locally:** fixed failure classifications, latest action status separate from historical checkout results, archived-test evidence provenance, current-journal-bound owner attestation, seven named offline module reproductions, a local log comparison tool, production package/configuration checks and baseline CI configuration. No live mutation or payment acceptance was performed. CI execution is a separate gate from local passes.
- **PR 2 implemented, simulated locally:** a stateful merchant model and isolated actual-worker VM harness exercise intent persistence, dispatch, acknowledgement-following writes, restarts, repeated recovery and concurrent popup/alarm operations. Regression tests reproduced and fixed stale preflight overwriting re-arm, and added a durable card-fill marker. Receipt-source conflict policy and existing-purchase read-only assessment are implemented. VM interruption exceptions are not a hard Chromium-process kill; the browser layer must cover real lifecycle behavior.
- **Remaining:** fixture-backed browser adapter coverage, isolated real-extension browser execution and its network gate. Existing direct-module/VM reproductions do not satisfy those stronger layers. S14–S15 remain backed by the existing pure settings/date tests until the browser layer is added.

Commands currently available: `npm test`, `npm run test:quick`, `npm run test:scenarios`, `npm run repro -- --scenario <name>` and `npm run analyze:logs -- <local-export.json> [...]`. Run them from the extension directory. Analyzer output is observed evidence and a proposed scenario, never a full merchant replay; it retains local run IDs and must remain private.

The current extension already has substantial defensive logic: exact slot and basket verification, durable payment-dispatch journaling, receipt reconciliation, strict spending limits, and bounded read retries. Keep those safeguards. The recurring problem is **test fidelity and recovery ergonomics**, not simply a shortage of unit tests.

Recent fixes have been driven by live browser failures, manual extension reloads, midnight runs, and exported logs. That loop is too slow and places too much of the test burden on the owner. Some tests exercise business rules and simulated dependencies successfully while missing interactions between the real content scripts, the Chrome service worker, delayed merchant DOM updates, tab navigation, and checkout.

**Proposed change:** Make failure reproduction predominantly offline and deterministic. Every observed production failure should become an executable scenario with recorded, sanitized evidence. Add stateful merchant simulation, real DOM fixture tests, deterministic interruption/restart testing, and a browser integration gate. Limit real merchant interaction to small, deliberate acceptance checks.

**Do not weaken payment safety to improve apparent success rates.** An uncertain Pay submission must remain reconciliation-only; an unacknowledged basket mutation must not be blindly repeated.

## 1. Evidence and current architecture

### Verified source behavior

- `background.js` coordinates alarms, Chrome tabs/messages, checkout, recovery and persistent status; `checkout.js` and `payment.js` enforce many durable lifecycle guards.
- `payment.js` persists `paymentDispatchedAt` *before* attempting Pay. A dispatched or uncertain payment is reconciled, not automatically resubmitted.
- `reconciliation.js` validates historical journal identity and uses a trusted receipt with account purchase history as fallback. The account purchase row verifies payment but does **not** by itself verify an active reservation, cancellation or refund.
- `stage-rules.js` already requires exactly `slot.hours` hourly basket items and validates each venue, court, date, hour and price. The October two-hour basket failure therefore **was not caused by the validator assuming a two-hour booking was one item**.
- `stage-content.js` now serializes per-hour selection, waits for basket badge/checkbox acknowledgement and verifies stable basket snapshots. `page-read.js` and `grid-read.js` probe read-only content before full page load and apply bounded readiness policies.
- Existing `node:test` files cover many rules, mocked worker operations and selected content-script behaviors. The npm test script references 15 test files (117 declared `test(...)` calls at the reviewed revision, by static inspection). This count is **not** an executed test result. Some README test counts are historical.
- No GitHub Actions workflow or recorded Actions runs were found during review. The existing `npm test` command is useful but not yet a continuous release gate.

### Failures motivating this plan

| Date / case | Observed failure | What it establishes |
| --- | --- | --- |
| 14 Oct release for 21 Oct | First court grid did not become ready before the old timeout | Availability was unknown; cannot infer all courts were unavailable |
| 15 Oct release for 22 Oct | Preferred two-hour BGG candidate found, but checkout stopped at unexpected basket item count | Selection/basket integration did not match assumptions; no Pay was dispatched |
| 15 Oct follow-up | Owner saw one of two selected hours become unselected | Overlapping basket updates are a plausible hypothesis, **not a proven cause** |
| 16 Oct release for 23 Oct | Two intended hourly items verified; checkout opening failed with `Not the verified basket` | The retained tab/route and validation/dispatch boundary needed tighter coordination |
| 16 Oct discount checkout test | Checkout open was acknowledged, but card-page readiness timed out; merchant error observed | Opening outcome can be ambiguous even without any Pay attempt |
| Earlier £2.50 paid test | Pay outcome initially uncertain; account history subsequently verified paid | Durable dispatch protection worked, but receipt recovery is essential |

Sources: [README](../README.md), [payment system findings](payment-system.md), and [release history](release-notes.md). Live and simulated evidence are deliberately distinguished in those documents.

### Follow-up: four installed-extension diagnostic exports (16 October 2026)

These are **successive snapshots of one persisted browser history**, not four independent acceptance runs. Each `runHistory` entry includes the extension **version when the run happened**; a later export's top-level `version` only identifies the currently installed build. In particular, v0.8.9 contains the earlier v0.8.8 checkout timeout; **no v0.8.9 checkout-opening retest is evidenced**.

| Observed UTC time / source version | Evidence from journal and run steps | Testing and diagnosis gap |
| --- | --- | --- |
| 08:53–09:03, v0.8.7–v0.8.8 | **Six** `unpaid-test-cleanup` runs stopped after a `test-purchase-state` read returned `ok:false` (first with tab loading; later reads reported complete). No actual row-match/error detail appears in the run step. | Distinguish transient loading, missing/ambiguous reference, changed merchant layout, and unsafe paid state. Report the exact sanitized blocker rather than only `cleanup-stopped`. |
| 09:04, v0.8.8 | The previously reference-bearing unpaid test was archived as `selection-cleared` after the repeated cleanup stops; its archived record does not contain `cleanupUnpaidVerifiedAt`. | Test **positive merchant-unpaid verification vs explicit owner-attested/manual abandonment** as different provenance, without claiming that an empty basket proves unpaid. |
| 09:05, v0.8.8 | After `discount-dispatched`, a same-tab basket read failed with `PAGE_TAB_ERROR`, `operation:message-read`, `readState:unclassified-tab-error`, while the tab route remained the requested basket and load state was `loading`. | Inject post-discount navigation/message failure, require no duplicate discount POST, and test bounded read-only observation and accurate reason reporting. Underlying Chrome error is unknown. |
| 09:06, v0.8.8 | Two correct BGG hourly items (£10 gross) and a verified £7 discount (£3 payable) were observed. Checkout-opening command returned `ok:true`, but **15-second** card readiness timed out. Journal stayed `checkout-test-opening` without a reference; no Pay dispatch. | Separate **opening command acknowledged** from **card page ready**; test late appearance, merchant-error page, missing provisional reference, and recovery without repeating the click. |
| 09:15, v0.8.9 | Another unpaid-test cleanup stopped within the same second with only `started`, `cleanup-stopped` and `finished`. The earlier v0.8.8 timeout remained in `checkoutResult`. | Preserve a failure reason and actionable recovery status for every command, including failure before any merchant read. Prevent an older success/failure result from masquerading as the most recent action. |

The logs **do not establish** the cause of the missing purchase row, the precise Chrome message failure, whether the acknowledged checkout actually reached a usable card page later, or whether the archived test's purchase was merchant-verified unpaid. Do not encode any of those hypotheses as facts or publish the original account references.


## 2. Main gaps

### A. Tests often bypass the integration boundary that fails in practice

For example, `test-mvp.js` calls `prepareCheckout` and `payCheckout` with simulated dependencies. That is useful for business logic, but it does not prove that Chrome alarm delivery, tab routing, content-script messaging, async basket updates, and checkout DOM behavior work together. Individual DOM tests are also often hand-built JavaScript stubs rather than representative merchant HTML.

**Direction:** Retain fast unit tests; add higher-fidelity layers instead of replacing them.

### B. Recovery is safe but operationally expensive

A failed selection, unknown checkout opening or payment can leave a durable pending record. That is intentional protection against duplicate action. However, recovering often requires the owner to inspect the page, supply a reference, clear a basket, or export a large diagnostic log. Some errors are collapsed into broad stopped/unknown states, hiding which evidence is missing.

**Direction:** Model actionable recovery states, attach precise safe evidence, and provide a read-only diagnostic/recovery assessment before requesting manual work.

### C. Test scenarios are curated rather than systematically generated

The suite covers many named edge cases, but a new incident often produces another narrowly targeted test. There is no single matrix ensuring every mutation boundary is tested against worker restart, lost acknowledgement, delayed merchant update and conflicting observed state.

**Direction:** Enumerate all mutation boundaries and generate fault-injection permutations against shared invariants.

### D. The owner is effectively part of the test harness

Repeated extension reloads, card unlocks, midnight waiting, live site verification, and manual test-basket cleanup should not be routine regression steps.

**Direction:** Make quick, scenario and browser tests runnable locally or in CI without real site credentials, court reservations or payments.

### E. Stale results and missing root causes obscure recovery

A test may finish with a success result, followed by several failed cleanup actions while `checkoutResult` still shows the earlier result. Runs may contain `page-read: ok:false` or `cleanup-stopped` without the source error, even when the tab load is complete. A version upgrade can also be mistaken for proof the prior failure was retested.

**Direction:** Track **latest action result**, **current unresolved journal**, and **historical run result** separately. Propagate stable redacted failure codes and first failing operation into the run trace, retaining run-time code version. Add diagnostic-export comparison tooling that deduplicates runs by `runId` and displays which installed version actually executed each case.

### F. Manual abandonment needs explicit evidence provenance

The logs include a reference-bearing unpaid test archived under `selection-cleared` without a stored merchant-unpaid-verification timestamp. This does not establish that the purchase was paid; it establishes that the archive cannot be presented as merchant-verified unpaid. The existing manual attestation path is a different evidence standard from observing a unique Pending / Pay row.

**Direction:** Model and test those recovery methods separately: `merchant-unpaid-verified`, `owner-attested-no-payment` and `unresolved`. Record the basis for any archive, prevent stale/incorrect attestations, and never silently convert a merchant-unknown outcome into confirmed unpaid. Keep actual payment and manual-payment holds non-clearable by test-only controls.

## 3. Testing philosophy and safeguards

1. **Reproduce before patching.** Turn each significant live failure into a deterministic failing test. The test must fail against the relevant pre-fix behavior when practical and pass with the fix.
2. **Test observable contracts, not implementation-shaped mocks.** The fake merchant must have its own state and delayed updates; fixture expectations should come from sanitized site observations, not from the parser's output.
3. **Separate pure rules, adapters, orchestration and live acceptance.** Passing one tier never implies a stronger tier has been validated.
4. **Assert side effects as well as return values.** Verify how many selections, removals, discount applications, checkout opens and Pay dispatches occurred, including after restart.
5. **Make interruptions first-class inputs.** Inject failures before/after persistence, dispatch, acknowledgement and verification.
6. **Never equate missing evidence with a negative outcome.** `booked:false` or `paid:false` in a stopped pre-payment flow may be safe; after possible payment dispatch use explicit unknown semantics until independently resolved.
7. **No real payments in CI.** Tests use fake card/payment adapters and local merchant state. Actual payment acceptance is separately authorized.
8. **Do not silently relax fail-closed behavior.** Any permitted automatic recovery must have an explicit evidence predicate and tests for adversarial/ambiguous cases.

### Core invariants

| Invariant | Required assertion |
| --- | --- |
| Exact authorization | Every selected/charged slot conforms to the saved job policy, hourly identities and gross/net caps |
| Conservative payment | A given journal never performs another Pay dispatch after a durable payment or manual-payment hold |
| No blind mutation replay | Lost acknowledgements cannot cause duplicate selection, checkout-open, discount or cleanup actions |
| Recoverability | Interrupted runs retain durable intent, phase, reference (when available), and safe evidence |
| Receipt integrity | Confirmation requires unique matching reference, expected net amount and paid state |
| Distinct outcome axes | Payment status does not imply active booking, cancellation or refund status |
| Isolation | Unrelated basket items and other checkout records cannot be mutated or cleared |
| Privacy | Logs and fixtures contain no card data, passphrases, secrets, full private DOM or unrelated purchase history |

Client-side commit-before-dispatch is **not** a distributed exactly-once guarantee. Without merchant-supported idempotency keys, preserve the weaker but enforceable guarantee: **at most one authorized dispatch by this client journal, and conservative reconciliation thereafter**.

## 4. Target test architecture

### Layer 1 — fast pure/module tests

Keep `node:test` for dates/DST, candidate ordering, settings, basket and pricing rules, journal identity, discount accounting, parser decisions and recovery predicates. Add table-driven and property-based tests where useful, especially around slot identity, pence arithmetic, historic recovery and dates across DST boundaries.

### Layer 2 — production DOM adapters + sanitized HTML fixtures

Run the actual content-script parsers and handlers against realistic, independent fixture pages. Include:

- Available, booked, disabled and mixed-court grids; label differences between BGG and Victoria Park.
- Empty, one-hour, two-hour, partially updated, extra-item and discounted baskets.
- Checkout opening/loading, provisional reference changes, disabled/enabled Pay, unsupported route and merchant errors.
- Purchase history with one exact paid row, pending row, missing row, duplicate references, mismatched amount and cancelled-but-paid purchase.
- Sign-in, human-verification and missing/changed DOM markers.
- The separate **existing-purchase payment page** reached through Recent purchases → Pay: a `Booking ref: PT…` label, amount due and no visible basket-cancellation control. Test recognition separately from the basket's provisional-booking checkout; do not assume their routes, reference text or cancellation behavior are interchangeable.

Keep the fixture set small but representative. Scrub names, references, account information and tokens. Any screenshot/DOM evidence gathered during live inspection should remain private until specifically reduced and reviewed for inclusion.

### Layer 3 — deterministic stateful merchant simulator

Create an in-process/local fake merchant that implements just the site-visible contract:

- Court inventory and candidate selection.
- Asynchronous per-hour basket writes (including delayed/overwriting updates).
- Basket DOM, totals, discounts and the payment boundary.
- Checkout-opening state, provisional booking reference and card-page readiness.
- Fake Pay dispatch and account purchase history.
- Optional authentication, human-check route and merchant error state.
- Purchase-history page which is still loading, fully loaded with **zero** matching references, duplicated matches, exact Pending / Pay match, or unexpected layout.
- After a discount POST, temporary navigation/loading and lost content-script messages on the **same retained tab**; the merchant may have applied the code despite the read failure.
- Checkout-opening command acknowledged before a delayed card page, merchant error, abandoned navigation, or provisional-reference appearance.
- An existing pending purchase reopened from account history while the basket is empty, with no verified merchant cancellation action. Basket cleanup and local journal archival must not be represented as cancellation of that purchase.

The simulator must be configurable with event timelines, side-effect counters and injectable failures. Example scenario:

~~~yaml
name: basket-hour-overwritten
given:
  slot: "BGG court 4, 20:00-22:00, two hours"
merchant:
  first_hour_ack_delay_ms: 750
  second_hour_update: overwrite_previous_selection
expect:
  pay_dispatches: 0
  no_duplicate_hour_clicks: true
  outcome: stopped_or_authorized_single_hour_fallback
  durable_recovery_record: true
~~~

This schema is illustrative; implement only the fields needed by the first real scenarios. Do not attempt to clone the entire merchant site.

### Layer 4 — worker lifecycle and fault-injection harness

Exercise the **actual** background orchestrator with injectable `chrome.tabs`, `chrome.storage`, `chrome.alarms`, clock, timers and merchant observations. Restart the worker with the same persisted storage to simulate MV3 suspension, browser restart or lost responses.

For each mutation boundary (hour selection, discount apply, checkout opening, unpaid-test removal and Pay), test:

1. Before intent is persisted.
2. After intent persistence, before dispatch.
3. After dispatch but before response.
4. After response but before the next durable state update.
5. During reconciliation.
6. After recovery followed by a second attempted invocation.

Consider concurrent popup/alarm entry points and interrupted writes. Assert phase transitions, durable journal contents, allowed next actions and counts of external mutations. Avoid relying only on `status === "stopped"`.

Concurrency is a P0 safety contract. Start overlapping popup/alarm commands against the same saved authorization and simulate competing read/modify/write operations, including before a journal has been created. Test lost storage updates, creation of two journals for one booking intent, immutable authorization and retention of payment holds across restart. Assert aggregate mutation counts across all journals and invocations for that intent, not only one counter per journal. The harness must expose conflicts rather than serializing them away accidentally. This remains a client-side safety property, not merchant-supported distributed exactly-once execution.

For cleanup and checkout-opening specifically, test recovery across **multiple attempts and extension upgrades** with the same journal: repeated read failures must not mutate or erase the record; a later merchant observation may permit a safe next step; a failed cleanup must not leave the UI displaying an earlier test success as its last action. Drive scenarios with a fake clock so that 15-second vs 60-second readiness policies and a late card-page arrival are deterministic, rather than sleeping in real time.

### Layer 5 — real-extension browser integration

Use Playwright/Chromium to load the unpacked MV3 extension against the local simulator and exercise the true service worker, messaging, tabs, alarms and page adapters. Run release logic with an injected clock or explicit test-only alarm trigger; do not wait for midnight.

**Origin and payment boundary requirement:** The production extension restricts trusted hosts to the real merchant/Stripe. Testing a localhost merchant needs an isolated test build or controlled routing layer that keeps the same production modules while substituting only the test origin and fake payment boundary. Never broaden production host permissions, copy live credentials, or call real Stripe Pay in automated tests.

**Executable network isolation gate:** Deny network egress by default and allow only the local simulator and explicitly required local test resources. Cover requests from pages, service workers, redirects and child frames; serve fake Stripe scripts/frames locally without real payment keys. If controlled routing retains production-looking URLs, interception is mandatory and a missed route must fail closed without contacting the real host. An unexpected external request must fail the test and produce a sanitized destination category, even if the scenario otherwise passes. Include negative tests that attempt merchant/Stripe traffic and verify the isolation gate blocks it. Browser request interception alone is not the isolation guarantee; enforce the boundary for service-worker traffic as well.

Test the packaged artifacts too: the production ZIP must contain neither test-origin overrides, fake payment adapters nor widened host permissions; test-only bundles must be identifiable and excluded from release artifacts. Run the packaged production-source checks in PR 1, and the browser/network-isolation checks when PR 3 introduces the browser harness.

## 5. Required scenario matrix

| ID | Scenario | Expected outcome | Priority |
| --- | --- | --- | --- |
| S01 | Midnight grid DOM usable while tab remains loading | Read eligible grid without unnecessary reload/selection retry | P0 |
| S02 | Grid never ready, login required, or layout unknown | Explicit distinct reason; availability unknown; no mutation | P0 |
| S03 | Concurrent-looking two-hour updates overwrite first hour | Detect mismatch; no repeat click; fallback only if policy/evidence permit | P0 |
| S04 | Basket exposes one then two items during rendering | Wait for a stable, matching snapshot rather than accepting a transient one | P0 |
| S05 | Basket contains extra/unrelated item or incorrect price | Stop before opening/payment; preserve diagnostics | P0 |
| S06 | Retained checkout tab navigates or changes between validation and command | No unsafe opening; preserve state and trusted-tab evidence | P0 |
| S07 | Checkout click acknowledged, card page delayed/merchant error | Bounded observation; never re-click opening blindly | P0 |
| S08 | Worker interrupted immediately before/after Pay dispatch | No second Pay; reconcile account/receipt after restart | P0 |
| S09 | Manual payment after extension stopped before recording reference | Explicit reference report + unique paid account verification; never invent dispatch | P0 |
| S10 | Missing, ambiguous or contradictory receipt/account evidence | Remain uncertain; retain reason and journal; no repeat charge | P0 |
| S11 | Discount applied, then same retained tab loads/disconnects or read throws an unclassified error | One discount dispatch; classify observed/unknown state; bounded read-only recovery; never resubmit | P0 |
| S12 | Six consecutive purchase-history cleanup rejections, then manual empty-basket reconciliation | No unsafe removals or false unpaid confirmation; explicit audit provenance and preserved history | P0 |
| S13 | Service worker restarts with stale/closed tab | Read-only recovery; preserve payment guards and references | P0 |
| S14 | Saved settings edited after arming or during pending checkout | Original authorization remains immutable | P1 |
| S15 | DST boundary, missed alarm and late release | Correct London release; no unsafe late booking | P1 |
| S16 | Overlapping popup/alarm invocations, competing journal creation/storage writes, or older pending checkout | No conflicting journals for one intent, lost update/hold, authorization change or duplicate mutation; assert aggregate counts across invocations and journals | P0 |
| S17 | Account purchase page still loading, complete with zero matching reference, duplicated row or malformed state | Distinct blocker/diagnostic, no premature removal or inferred unpaid status | P0 |
| S18 | Checkout open acknowledged, but card page appears after the old 15-second limit or shows a merchant error | Configured 60-second bounded readiness for both test and scheduled flows; one opening click; never assume completion | P0 |
| S19 | Cleanup stops before its first merchant read while journal has no provisional reference | Precise logged reason and prescribed read-only/manual next action; no journal loss | P0 |
| S20 | New export/build contains prior run's failure and a stale earlier `checkoutResult` | Attribute each run to its own version; deduplicate snapshots; show latest action separately from unresolved record | P0 |
| S21 | Manual empty-basket reconciliation archives an opened, reference-bearing unpaid test | Record owner attestation distinctly from confirmed merchant-unpaid evidence; never imply paid/unpaid verification without supporting evidence | P0 |
| S22 | Existing pending purchase reopened through Recent purchases → Pay, with an empty basket or no visible cancellation control | Recognize its separate page contract; bind a reference through existing durable identity, explicit owner report or independently verified correlation, never price alone; default to read-only/manual recovery, and do not claim that basket cleanup or journal archival cancels the merchant purchase | P0 |

Every scenario should verify the *observable mutation trace*, recovery decision and expected durable state. Explicitly label cases proven only by simulation versus reproduced against the real merchant.

### Settings and discount regression contract (carried forward from v0.8.0 requirements)

These checks apply across pure rules, adapter fixtures, journal/restart tests and paid/receipt simulation. They are **requirements**, not evidence that all cases already pass:

| Area | Required checks |
| --- | --- |
| Venues | Supported BGG/VP values only; deterministic priority and optional fallback; no unrestricted URL input; exact venue and per-hour court identity |
| London time | Whole-hour, same-day start/finish; reject reversed, empty, overnight, fractional and out-of-window intervals; DST/release correctness |
| Duration and court selection | Prefer two hours, optionally accept one according to saved minimum; allow/reject a mixed-court sequence per the saved policy; never add or remove an hour to manufacture fallback |
| Authorization | Strict positive money input in integer pence; original gross cap and separate one-hour cap; reject an unexpected item/price; never infer authorization solely from a cheaper net price |
| Immutable settings | Arm snapshots cannot change after popup edits or saved-preference updates; pending checkout, old journals and historical receipts retain their original policy, slot key and amount |
| Discount | Empty code uses normal checkout; invalid, expired, previously applied or unavailable code stops safely; dispatch at most once and observe delayed/lost responses without replay |
| Discount accounting | Independently verify every original item, subtotal, explicit discount and net total; reject mismatched or extra items, code/discount changes after checkout opening and ambiguous totals |
| Special payment paths | Zero-cost checkout requires a separately designed **non-card** flow; never silently enter the Pay/card path. One-hour fallback and resumed/reloaded checkout must preserve gross/net and exact receipt identity |

No discounts, codes, card data or private merchant references belong in committed test fixtures.

## 6. Recovery and observability improvements

### Structured result and evidence model

Keep existing journal protections, but normalize recovery classification. Suggested fields:

~~~json
{
  "runId": "<local-run-id>",
  "phase": "selection-dispatched",
  "outcome": "stopped",
  "reasonCode": "BASKET_PARTIAL",
  "mutationDispatch": "selection",
  "mutationAcknowledgement": "uncertain",
  "observed": { "expectedItems": 2, "actualItems": 1 },
  "recovery": {
    "mode": "read-only-observation-or-manual-review",
    "automaticReplayAllowed": false
  }
}
~~~

These are **proposed** fields, not a description of today's stored schema. Diagnostics should include expected/actual sanitized slot identities, relative timings, route category, loading state, reference presence (not raw tokens), whether a mutation was dispatched, and exact reason that safe recovery did/did not proceed. For every `cleanup-stopped`, `page-read: ok:false`, or early handler rejection, persist an allowlisted reason code (e.g. purchase-row-missing vs account-loading vs reference-unavailable), not a raw merchant response. Include an explicit **evidence provenance** field for archived tests: uniquely verified unpaid purchase vs owner attestation. Keep historical `checkoutResult` separate from latest action status and unresolved journal status.

### Separate recovery outcomes

Treat these as different statuses in code and UI:

- **Ready to resume:** read-only evidence establishes that the desired state exists and the next authorized step is safe.
- **Needs observation:** merchant update may still settle; only bounded read-only checks permitted.
- **Needs user action:** e.g. authenticated sign-in, manual payment reference, removal of an existing basket.
- **Payment unknown:** Pay may have been submitted; receipt-only reconciliation.
- **Terminal safe failure:** no authorized recovery path for that journal.

Do not automatically convert uncertain to failed, paid to booked, or cancelled to refunded.

### Specific source follow-ups

- `reconciliation.js` currently catches any error from current receipt inspection before trying account history. Preserve the fallback, but record whether the first source was absent, transiently unavailable, malformed or contradictory; independently validate the account evidence.
- `background.js` combines worker orchestration, Chrome wiring, storage, alarms and presentation. Extract injectable dependencies incrementally to support worker-level tests; avoid a speculative rewrite.
- `checkout.js` and `payment.js` should expose a clear transition/recovery contract, including legal next actions for each phase and preconditions for state changes.
- `stage-content.js` needs fixture-level testing against the actual parser plus delayed merchant behavior, not just box/label stubs.
- `run-log.js` and `diagnostics.js` should produce easy-to-read stage-level failure and recovery summaries while maintaining safe redaction and bounded retention.

### Receipt-source decision contract

Before changing the existing fallback, make the following proposed policy executable. Classify the source before discarding an error: an unrelated page is different from positively conflicting evidence about the saved transaction. Use stable reason codes and sanitized observations rather than raw receipt text.

| Current receipt observation | Independent account observation | Required decision |
| --- | --- | --- |
| Missing, closed, transiently unreadable or unsupported layout; no independently established contradictory claim | Unique exact-reference paid row at the saved net amount | Account evidence may reconcile payment; record the first source's failure category and account provenance |
| Receipt clearly belongs to a different transaction | Unique exact-reference paid row at the saved net amount | Treat the current tab as unrelated, preserve its identity-mismatch diagnostic, and reconcile only the saved transaction from account evidence |
| Provisional/awaiting-payment page without an explicit contradictory paid claim | Unique exact-reference paid row at the saved net amount | Account evidence may reconcile payment; the old page may be stale and is not by itself a contradiction |
| Positively identified saved transaction with conflicting paid amount or other contradictory transaction facts | A different source appears to confirm the expected payment | Preserve the hold and classify conflicting evidence for manual investigation; do not silently choose whichever source permits success |
| Independently verified exact paid receipt | Account source missing or temporarily unavailable, with no positive contradictory claim | Receipt evidence may reconcile payment under the existing trusted-receipt contract; absence alone does not invalidate positive evidence |
| No independently verified exact paid source, or missing/duplicate/mismatched account rows | None sufficient | Remain unknown, preserve the journal and reason, and never repeat Pay |

Test both permitted fallback and conflicting-evidence holds. A parser exception alone is not proof of contradiction, and a paid purchase still does not establish active reservation, cancellation or refund. S22 adds recognition and recovery assessment for the existing-purchase page; it does not authorize automatic payment through that page or invent a merchant cancellation action.

Consider a **read-only recovery assessment** button that reports the next permitted action without clearing state, selecting a court or touching payment. Existing controls should remain guarded.

**Log-to-regression workflow:** Add a local analyzer that accepts multiple sanitized exports, deduplicates `runHistory` by `runId`, compares journals chronologically, and emits a **proposed scenario skeleton** identifying source version, observed phases, missing evidence and mutation counts. Do not treat JSON run logs as a full behavioral replay: reproducing merchant state, exact DOM, and unknown network outcomes still requires independently constructed fake-merchant/HTML fixtures. All real booking references and private dumps stay outside Git.

## 7. Developer experience and CI

Proposed commands (not yet implemented):

~~~bash
npm run test:quick       # Pure/unit + DOM fixture tests
npm run test:scenarios   # Stateful merchant + worker faults
npm run test:browser     # Real extension against local fake merchant
npm run test:ci          # Entire deterministic release gate
npm run repro -- --scenario basket-hour-overwritten
~~~

A failed scenario should emit a compact report: scenario/seed, exact expected and observed states, mutation counts, first broken invariant, run/phase correlation and a sanitized trace. Browser failures may attach local fake-site screenshots/Playwright traces; never retain card or account secrets.

Add baseline GitHub Actions in PR 1: run the maintained suite plus each newly introduced scenario on every PR, and verify the runtime package allowlist and production configuration boundaries. Extend that same gate in PR 2 as the fault harness grows; do not defer all continuous verification until the browser harness exists. PR 3 adds browser integration, network isolation and the complete release gate against the exact packaged extension source. Pin Node/Chromium versions, use controlled clocks, and avoid flaky wall-clock sleeps in simulated tests.

Maintain a small `test/fixtures` and `test/scenarios` catalog with readable names, linked back to the failure that introduced each scenario. Avoid a huge general-purpose test framework; favor simple interfaces and deterministic scheduling.

## 8. Delivery plan

### PR 1 — Make failures reproducible and diagnosable (P0)

**Scope**
- Introduce stable safe error codes and recovery classifications, especially for cleanup and account-purchase response failures.
- Capture expected/actual basket and checkout evidence at existing stop boundaries; distinguish latest action result from historical success and unresolved journal.
- Record the provenance of cleanup/abandonment (merchant-unpaid evidence versus explicit user attestation), particularly for reference-bearing tests.
- Create sanitized fixtures/reproductions for the 14–16 October failures.
- Add a scenario command and concise failure report, even if the initial scenarios use direct module testing.
- Add baseline CI for the existing maintained suite and initial scenarios, plus package/configuration checks; retain this gate throughout subsequent PRs.

**Done when**
- A checkout/basket failure reports exactly which identity or lifecycle invariant failed.
- Known failures, including repeated reference-lookup cleanup failures, post-discount same-tab read loss and checkout-open acknowledgement without card readiness, have named offline reproductions.
- Existing payment guards and tests remain unchanged in semantics.
- No sensitive DOM, card details or private tokens enter committed fixtures.
- CI runs the maintained suite and new scenario reproductions on every PR; production-package checks reject leaked test configuration or widened permissions.

### PR 2 — Stateful fault and reconciliation coverage (P0)

**Scope**
- Implement the minimal merchant model and worker restart harness.
- Add every P0 scenario in the matrix: S01–S13 and S16–S22, including restart, concurrent journal creation/storage writes and existing-purchase-page recovery. Inject failures at every relevant persistence/dispatch boundary; move any non-critical coverage into P1 only by explicit decision.
- Assert per-journal mutation counts and no-repeat guarantees.
- Assert aggregate counts across overlapping invocations and conflicting journals for the same authorization; make the receipt-source decision table executable and extend PR 1's CI gate.
- Document legal recovery transitions and clarify missing vs conflicting evidence.

**Done when**
- All P0 failures are reproduced deterministically, including a sequence of repeated recovery attempts over the same journal and version change.
- Every payment dispatch interruption retains the no-second-Pay invariant.
- The simulated happy path reaches paid-evidence reconciliation.
- Test runs require no credentials, owner interaction or real court availability.
- Competing invocations cannot erase a hold, create duplicate conflicting checkout work, or bypass saved authorization; existing-purchase recovery never equates empty basket with cancellation.

### PR 3 — Browser integration and continuous release gate (P1)

**Scope**
- Test the real unpacked extension against the fake merchant in Chromium.
- Add the remaining P1 scenarios S14–S15 and browser-level versions of the P0 discount, unpaid-cleanup, concurrency and recovery scenarios.
- Extend the existing CI with browser integration, test artifact retention and a one-command release check.
- Exercise the exact runtime package with a test-only configuration boundary.
- Enforce deny-by-default network isolation and test missed routes, worker/frame requests, and attempts to reach real merchant or Stripe endpoints.

**Done when**
- Browser tests cover alarm → account/grid → selection → basket → checkout → fake payment/reconciliation.
- Worker/extension restart and delayed content scripts are covered.
- CI prevents releasing regressions in the core safety contracts.
- Setup instructions are sufficient for a developer to reproduce a failure locally.
- An unexpected external request fails the browser gate; production ZIPs contain no test overrides, fake adapters or widened host permissions.

**Order:** PR 1 → PR 2 before additional behavior/features; PR 3 is the final release-confidence layer. This sequencing is more valuable than immediately adding new retries or widening payment recovery.

## 9. Acceptance criteria and live validation

**Automated release gate**
- All known October failures have deterministic scenarios, including the six-stop cleanup loop, lost post-discount read response, and ambiguous acknowledged checkout opening.
- Every stopped run emits an actionable sanitized failure reason; exported build version is not conflated with each historical run's recorded version.
- Reference-bearing test archives distinguish merchant-confirmed unpaid evidence from explicit user attestation, and never equate empty basket with proof of unpaid state.
- All relevant mutation boundaries have crash/lost-response coverage.
- Zero duplicate Pay dispatches or unauthorized basket/removal mutations in the test suite.
- Exact slot and gross/net payment authorization across all tested flows.
- Aggregate mutation counts and journal integrity hold under competing popup/alarm operations and worker restarts.
- Receipt-source decisions distinguish stale/unrelated pages from positively conflicting transaction evidence.
- Existing-purchase payment recovery is covered separately from basket checkout; local cleanup never claims merchant cancellation.
- Sanitized merchant DOM fixtures detect unsupported layout changes.
- Real-extension local browser integration covers the complete release-to-reconciliation path.
- Browser tests cannot reach real merchant/Stripe services, and the production package excludes test-only configuration and payment adapters.
- Full tests run with one command and with no real credentials or payments.

**Live acceptance, deliberately limited**
1. Perform an inspection-only account/grid/readiness check where useful.
2. Run a supervised **unpaid two-hour** real-site preparation/check-out-opening test on a released date, and positively verify cleanup.
3. Only with explicit authorization, perform a paid acceptance run and confirm the payment through merchant receipt/account evidence.
4. Independently inspect whether the reservation is active; do not infer this from a paid purchase row.
5. Record exactly what live behavior was proved, and which claims are still simulated.

Real merchant checks may still be necessary for Cloudflare/human-verification, bank challenges, or behavior that local simulation cannot reproduce. They should be **acceptance checks, not the main debugging loop**.

## 10. Non-goals and decision

**Non-goals**
- Hosted backend, distributed DB or a generalized booking framework.
- Automatically retrying Pay, checkout opening, discounts or selection on ambiguous acknowledgements.
- Bypassing verification challenges or automating bank authentication.
- Treating a high unit-test count as proof of unattended merchant compatibility.
- Replacing the functioning payment-safety design without evidence.

**Decision:** Invest first in reproducible evidence and deterministic recovery tests, then a realistic browser release gate. Preserve fail-closed payment behavior. The goal is to move the owner's role from repeated manual regression testing to occasional authentication and final supervised acceptance.

---

### Source map

- [Booking rules and current implementation](../README.md)
- [Payment system, live findings and outstanding unknowns](payment-system.md)
- [Historical releases and acceptance notes](release-notes.md)
- [Extension source and tests](../outputs/tennis-local/chrome-extension/)
- Key modules: `background.js`, `checkout.js`, `payment.js`, `reconciliation.js`, `stage-rules.js`, `stage-content.js`, `page-read.js`, `grid-read.js`, `run-log.js` and `diagnostics.js`.
