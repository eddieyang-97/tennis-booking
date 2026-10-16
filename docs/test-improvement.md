# Tennis booking: reliability and test improvement proposal

**Status:** Proposed; no implementation in this document  
**Reviewed source:** `main` at `5aa63506a000d4adf05a7e8b8e635cab1b513dbd` (16 October 2026), extension v0.8.9  
**Scope:** Chrome extension in `outputs/tennis-local/chrome-extension/`

## Executive summary

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

Sources: [README](../README.md), [payment system findings](payment-system.md), [MVP release](mvp-release.md). Live and simulated evidence are deliberately distinguished in those documents.

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

Keep the fixture set small but representative. Scrub names, references, account information and tokens. Any screenshot/DOM evidence gathered during live inspection should remain private until specifically reduced and reviewed for inclusion.

### Layer 3 — deterministic stateful merchant simulator

Create an in-process/local fake merchant that implements just the site-visible contract:

- Court inventory and candidate selection.
- Asynchronous per-hour basket writes (including delayed/overwriting updates).
- Basket DOM, totals, discounts and the payment boundary.
- Checkout-opening state, provisional booking reference and card-page readiness.
- Fake Pay dispatch and account purchase history.
- Optional authentication, human-check route and merchant error state.

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

### Layer 5 — real-extension browser integration

Use Playwright/Chromium to load the unpacked MV3 extension against the local simulator and exercise the true service worker, messaging, tabs, alarms and page adapters. Run release logic with an injected clock or explicit test-only alarm trigger; do not wait for midnight.

**Origin and payment boundary requirement:** The production extension restricts trusted hosts to the real merchant/Stripe. Testing a localhost merchant needs an isolated test build or controlled routing layer that keeps the same production modules while substituting only the test origin and fake payment boundary. Never broaden production host permissions, copy live credentials, or call real Stripe Pay in automated tests.

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
| S11 | Discount application response lost or net total changed | One application only; exact gross/net/item validation; otherwise stop | P1 |
| S12 | Unpaid cleanup interrupted or basket changed | Remove only positively verified test items; otherwise stop with preserved journal | P1 |
| S13 | Service worker restarts with stale/closed tab | Read-only recovery; preserve payment guards and references | P1 |
| S14 | Saved settings edited after arming or during pending checkout | Original authorization remains immutable | P1 |
| S15 | DST boundary, missed alarm and late release | Correct London release; no unsafe late booking | P1 |
| S16 | Multiple invocations or older pending checkout | No concurrent conflicting checkout, lost hold or double submission | P1 |

Every scenario should verify the *observable mutation trace*, recovery decision and expected durable state. Explicitly label cases proven only by simulation versus reproduced against the real merchant.

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

These are **proposed** fields, not a description of today's stored schema. Diagnostics should include expected/actual sanitized slot identities, relative timings, route category, loading state, reference presence (not raw tokens), whether a mutation was dispatched, and exact reason that safe recovery did/did not proceed.

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

Consider a **read-only recovery assessment** button that reports the next permitted action without clearing state, selecting a court or touching payment. Existing controls should remain guarded.

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

Add GitHub Actions for quick and scenario tests on each PR, browser integration where feasible, and a release gate that tests the exact packaged extension source. Pin Node/Chromium versions, use controlled clocks, and avoid flaky wall-clock sleeps in simulated tests.

Maintain a small `test/fixtures` and `test/scenarios` catalog with readable names, linked back to the failure that introduced each scenario. Avoid a huge general-purpose test framework; favor simple interfaces and deterministic scheduling.

## 8. Delivery plan

### PR 1 — Make failures reproducible and diagnosable (P0)

**Scope**
- Introduce stable safe error codes and recovery classifications.
- Capture expected/actual basket and checkout evidence at existing stop boundaries.
- Create sanitized fixtures/reproductions for the 14–16 October failures.
- Add a scenario command and concise failure report, even if the initial scenarios use direct module testing.

**Done when**
- A checkout/basket failure reports exactly which identity or lifecycle invariant failed.
- Known failures have named offline reproductions.
- Existing payment guards and tests remain unchanged in semantics.
- No sensitive DOM, card details or private tokens enter committed fixtures.

### PR 2 — Stateful fault and reconciliation coverage (P0)

**Scope**
- Implement the minimal merchant model and worker restart harness.
- Add the S01–S10 P0 scenarios, with injected failures at every relevant persistence/dispatch boundary.
- Assert per-journal mutation counts and no-repeat guarantees.
- Document legal recovery transitions and clarify missing vs conflicting evidence.

**Done when**
- All P0 failures are reproduced deterministically.
- Every payment dispatch interruption retains the no-second-Pay invariant.
- The simulated happy path reaches paid-evidence reconciliation.
- Test runs require no credentials, owner interaction or real court availability.

### PR 3 — Browser integration and continuous release gate (P1)

**Scope**
- Test the real unpacked extension against the fake merchant in Chromium.
- Add the remaining P1 scenarios, including discount and unpaid cleanup.
- Add CI, test artifact retention and a one-command release check.
- Exercise the exact runtime package with a test-only configuration boundary.

**Done when**
- Browser tests cover alarm → account/grid → selection → basket → checkout → fake payment/reconciliation.
- Worker/extension restart and delayed content scripts are covered.
- CI prevents releasing regressions in the core safety contracts.
- Setup instructions are sufficient for a developer to reproduce a failure locally.

**Order:** PR 1 → PR 2 before additional behavior/features; PR 3 is the final release-confidence layer. This sequencing is more valuable than immediately adding new retries or widening payment recovery.

## 9. Acceptance criteria and live validation

**Automated release gate**
- All known October failures have deterministic scenarios.
- All relevant mutation boundaries have crash/lost-response coverage.
- Zero duplicate Pay dispatches or unauthorized basket/removal mutations in the test suite.
- Exact slot and gross/net payment authorization across all tested flows.
- Sanitized merchant DOM fixtures detect unsupported layout changes.
- Real-extension local browser integration covers the complete release-to-reconciliation path.
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
- [Release and acceptance notes](mvp-release.md)
- [Extension source and tests](../outputs/tennis-local/chrome-extension/)
- Key modules: `background.js`, `checkout.js`, `payment.js`, `reconciliation.js`, `stage-rules.js`, `stage-content.js`, `page-read.js`, `grid-read.js`, `run-log.js` and `diagnostics.js`.
