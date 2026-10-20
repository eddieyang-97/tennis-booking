# Release notes

This is the historical change log for the **active Chrome extension** in [`outputs/tennis-local/chrome-extension/`](../outputs/tennis-local/chrome-extension/). The authoritative source version is [`manifest.json`](../outputs/tennis-local/chrome-extension/manifest.json), **0.9.4** on the failed-checkout recovery branch (20 October 2026). `main` contains merged v0.9.3; branch builds are not merged release claims.

Notes below describe changes made *at each release*, not instructions to install or downgrade to older builds. Historical test counts and unverified behaviors are not current release-quality claims. For up-to-date setup, use the [project README](../README.md) and [extension usage guide](../outputs/tennis-local/chrome-extension/README.md). For original investigation and detailed timestamps, see [payment-system.md](payment-system.md).

## Latest verification status (16 October 2026)

| Evidence | What is established | What is not established |
| --- | --- | --- |
| 13 October, Victoria Park £2.50 test | Real local-card fill, Pay dispatch and unique paid merchant purchase; installed-extension purchase-history reconciliation later confirmed the charge. Owner manually cancelled the booking. | Refund status and a repeatable two-hour paid checkout |
| 14 October, first midnight release | Alarm started on time; account read worked, then grid readiness timed out. | Court unavailability or a completed booking |
| 15 October, Bethnal Green Gardens release for 22 October | Candidate found; checkout stopped after the two-hour selection/basket mismatch. No Pay was dispatched. | Exact root cause of an observed hour becoming unselected |
| 15 October, daytime two-hour test | Owner's installed log showed two hourly selections and a matching £10 basket at Bethnal Green Gardens. | Unattended payment or midnight selection reliability |
| 16 October, midnight release for 23 October | Two-hour £14 basket selected and verified; automatic checkout opening stopped with `Not the verified basket` before card fill or Pay. | Unattended paid completion. The owner's subsequent manual payment report was not verified by that export |
| 16 October, discounted unpaid checkout inspection | Two-hour basket with £10 gross, £7 discount and £3 net; checkout opening was acknowledged, but the card page timed out and a merchant error was reported. Later inspection saw a £3 card page. | That the timed-out opening completed successfully or that a discounted payment was submitted |

**Current acceptance limitation:** Source improvements and simulated tests do not establish an unattended successful midnight booking through paid receipt verification. Payment confirmation is also not proof that a reservation is still active after a cancellation.

## Changes by version

### v0.9.4 — explicit recovery of reference-less failed checkout opening (20 October 2026)
- Adds a separate, owner-attested local archive for an ordinary checkout interrupted during opening before any reference, card-fill or payment intent. A verified empty basket and unchanged journal are required; original intent, phase and prior history are preserved. Merchant payment and cancellation remain unknown.
- Popup guidance identifies eligible failures and provides an unchecked confirmation bound to the saved opening. Unpaid tests and payment holds keep their existing recovery paths; no merchant mutation or uncertain operation is replayed.
- Offline unit/popup and actual-worker simulations cover stale/absent confirmation, changed evidence, nonempty/unreadable baskets, persistence failure before/after commit, restart and repeated recovery with zero merchant mutations. These passes do not establish live recovery acceptance or unattended midnight payment.
- Local validation: 159 maintained tests, 120 worker fault tests, seven named scenarios and exact ZIP/source checks under PowerShell 7 and Windows PowerShell 5.1. The separate browser-milestone harness, staged with matching runtime files, passed its 12 existing isolated Chromium scenarios and two network-boundary tests; these do not specifically establish acceptance of the new archive control against the live merchant.
- Installed-extension recovery verified on 20 October: after explicit owner confirmation of no payment and an observed empty merchant basket, v0.9.4 returned `failed-checkout-archived` and showed **No unresolved checkout**. The operation only observed the merchant and archived local state; payment/cancellation stayed unknown. No merchant mutation, payment or new arm was performed. This single recovery observation does not establish unattended booking acceptance.

### v0.9.3 — reuse scheduled grid and basket navigation (20 October 2026)
- Retains the selected availability grid and freshly rechecks its route, exact candidate and original price before the single selection dispatch. The retained grid is not reloaded; a changed or unavailable tab stops instead of replaying selection.
- Removes duplicate initial basket navigation and the grid reload before selection: two fewer navigations in the simulated scheduled success path. A fresh merchant basket load before payment preparation remains necessary to detect server changes hidden by an old DOM; it refreshes the checkout tab itself. Ephemeral tab handoffs are not saved or recovered after worker recreation; payment journals and one-shot mutation guards are unchanged.
- Offline regressions exercise navigation counts, changed grid/basket state, one-hour fallback, discounts, fallback venues and mutation-boundary restarts. These establish simulated behavior, not live speed improvements, merchant checkout acceptance or an unattended paid reservation.
- Missing responses to the read-only checkout-progress probe can be observed again within the existing readiness deadline, without repeating opening or another mutation. Structured grid refusals survive subsequent empty-basket reconciliation and reach the stopped action/result classification; diagnostics do not copy raw merchant responses.
- Validation: 157 maintained Node tests, 105 worker fault tests and seven named module scenarios; exact runtime packaging under PowerShell 7 and Windows PowerShell 5.1. The branch also uses the isolated browser harness from `codex/reliability-browser-gate` at `b392097` in an ignored validation workspace with this branch's runtime files overlaid, rather than merging that milestone. Its network boundary and synthetic merchant remain separate from normal Chrome and live Courtside. The runtime retains that milestone's structured `CHECKOUT_READ_UNAVAILABLE` handling. A tab-snapshot regression separately reproduces a same-price server basket change hidden by unchanged DOM and rejects it before checkout opening or payment.

### Unreleased — unfinished unpaid-test guidance (19 October 2026)
- A single checkout-page test without a saved reference now has specific readiness/arming guidance and automatically expanded recovery instructions. The owner must inspect checkout, empty the basket and explicitly attest that no payment was submitted before using the existing reconciliation control.
- Presentation-only predicates exclude payment/manual-report/card-fill evidence, multiple pending records and unsupported phases. Attestation remains unchecked initially and resets when its existing key/reference/opening identity changes. Cleanup, payment and journal guards are unchanged; offline regression tests are not live recovery acceptance.

### v0.9.1 — stateful worker faults and guarded recovery
- An independent fake merchant and isolated actual-worker VM harness exercise intent persistence, dispatch, acknowledgement-following writes, repeated recovery and simulated worker recreation with retained storage. Mutation counts enforce no repeated Pay, discount or checkout opening.
- Mutation entry points are serialized to prevent an older preflight overwriting a newer arm. This composes with v0.9.0's separate metadata ordering and retains its reviewed alarm outcomes, recovery classifications and PowerShell packaging fixes.
- Card filling has a durable dispatch marker. Interrupted/legacy fills and existing uncertainty latches stop for manual review before further checkout actions: readiness alone cannot prove card provenance. Payment holds remain reconciliation-only.
- Receipt-source decisions distinguish unrelated/unavailable evidence from positively conflicting paid evidence. **Assess recovery (read only)** recognises existing-purchase pages only by saved reference and amount, never by price alone; payment/cancellation remain unknown and no mutation is issued.
- Receipt date/time interpretation is scoped to recognized booking fields and the legacy adjacent booking-detail layout. Processing/creation dates do not invent conflicts; contradictory single starts as well as ranges retain the payment hold. Unknown layouts remain unverifiable. Added actual-content-script/worker regressions for metadata, labelled/standalone starts and contradictory booking fields.
- Manual availability checks and verification resumes are refused while any job is armed, before merchant reads or shared running/result changes. This admission policy protects release timing without concurrent check state; cancelling the saved job permits checks again. Offline tests cover a potentially stalled manual read at midnight, worker recreation and cancellation ordering.
- Review regressions exercise unknown card provenance, same-reference receipt contradictions through the real content-script response and worker reconciliation boundary, and hung diagnostic reads overlapping release alarms. Recovery assessment runs outside the mutation queue with bounded reads and a five-second overall budget; changed journals invalidate snapshots. Cancel clears future alarms when its queued command executes and cannot preempt a queued/running release. The harness models merchant URL filtering for tab queries. All evidence here is offline simulation, not live payment or actual Chromium termination; browser integration remains the next milestone.

### v0.9.0 — diagnosable recovery and offline reproductions
- Added safe, centralized error-code/recovery mapping, including unresolved-checkout and page/grid readiness errors. Legacy messages provide classification only when no recognized structured code exists; possible payment always requires reconciliation and never automatic replay.
- Latest-action identity and a persisted sequence keep older completions/failures from replacing newer status. Asynchronous status read/check/write operations are serialized within the active MV3 worker; interrupted status remains distinct from historical checkout results and payment journals.
- Scheduled release status propagates the actual checkout/payment result instead of treating a discarded result as completion. Verification and automatic-payment failure traces retain reconciliation-only guidance for potentially paid journals, including manual-payment reports.
- Test archives record merchant-unpaid evidence, owner attestation or unsubmitted-selection provenance separately. Attestation is bound to the current checkout identity and does not prove merchant cancellation.
- Added seven named offline reproductions, private log comparison, production package/permission checks, exact runtime ZIP/source hashes and baseline GitHub Actions CI.
- The documented Windows PowerShell build decodes the runtime list without nesting its array; CI verifies both that command and PowerShell 7 packaging. Focused worker-function regressions cover alarm result propagation and payment-failure trace consistency without introducing a merchant simulator.
- Focused regressions use synthetic worker errors, out-of-order actions and delayed storage, including failures and worker recreation. These are local simulations; this release adds no live-site payment or unattended-midnight acceptance evidence. Stateful merchant and browser integration remain separate work.

### v0.8.9 — checkout readiness and merchant error diagnosis
- Bounded card-page readiness now waits up to 60 seconds for both scheduled and manual checkout-opening paths.
- The read-only checkout-progress adapter exposes safe route/readiness and known merchant-error states. Checkout opening is still sent once; the extension does not silently repeat an ambiguous opening click.
- Existing matching card pages may be observed and reused only after identity verification.
- Motivation: the 16 October discounted unpaid test's merchant error / delayed card-page behavior. The merchant-side root cause remains unknown.

### v0.8.8 — unpaid-test cleanup reconciliation
- A verified empty basket and explicit owner attestation can finish recovery of certain stopped **test-only** cleanup phases (`test-cleanup-checking` and `test-cleanup-removing`).
- Actual payment markers, ordinary checkouts and uncertain paid states remain protected.

### v0.8.7 — downloadable diagnostic logs
- Added **Check and recover → Download diagnostic log**, exporting a local timestamped JSON snapshot with version, journal/reference/phase, settings and bounded run history.
- Known card details, passphrases and discount-code values are redacted; booking references and slot details remain sensitive. Exports are not automatically uploaded.

### v0.8.6 — unloaded purchase-history guard
- Unpaid-test purchase verification waits for a loaded account document before inspecting purchase history.
- Missing/duplicate matching-reference errors include reference and match count rather than assuming an unrelated transaction is the right one.

### v0.8.5 — guarded automatic unpaid-test cleanup
- Changing an unfinished unpaid checkout test's discount code, checked date or preferences can first clear the **verified unpaid test**. Added **Clear unfinished unpaid test**.
- Cleanup checks exact test-owned basket items and accounting before removal, journals a removal before dispatch, and verifies an empty basket before archiving.
- If checkout opened, the expected purchase must be explicitly Pending / Pay at the exact amount before and after cleanup. Paid, missing, ambiguous or unrelated evidence blocks cleanup.
- Automatic cleanup is deliberately limited to test records; production payment journals remain protected.

### v0.8.3 — unpaid discount / checkout-opening acceptance test
- Added **Test discount and open checkout (no payment)**, using the last successful availability result and saved settings.
- The test verifies intended basket and net amount, applies a discount at most once, opens checkout at most once, and blocks card filling and Pay at multiple layers.
- Reduced popup control density and lowered the new encrypted-file passphrase minimum to six characters without changing existing encrypted files.
- Note: simulated checks do not establish an unattended live discounted payment. The first real discount checkout inspection later exposed the merchant-error case addressed by v0.8.9.

### v0.8.2 — clarify future arming versus pending recovery
- Clarified that **Arm** applies only before the intended playing date's London release.
- Readiness and errors now distinguish an unreleased future job from an older blocked checkout, with the historical pending slot and appropriate recovery action.
- Added structured `UNRESOLVED_CHECKOUT` context; failed arming does not discard prior payment evidence or saved jobs.

### v0.8.1 — manually paid checkout reconciliation
- Added **Manually paid booking reference → Verify manual payment** for a normal pending checkout completed by the owner without an extension-recorded payment dispatch/reference.
- Persists `manualPaymentReportedAt` before account-history verification. Requires exact reference, paid state and net amount.
- This mode cannot silently become a new automatic payment; failure retains the reconciliation-only hold. Test-only and already-dispatched payment records are excluded.
- Account purchase evidence reports active `bookingState` as unknown.

### v0.8.0 — configurable settings and readiness panel
- Added ranked venues, whole-hour London start/finish windows, desired/minimum duration, same-/mixed-court choice, gross total and one-hour caps, and an optional discount code.
- Arming captures an immutable settings snapshot. Changes to popup preferences cannot retroactively alter a pending/armed checkout.
- The panel shows version, local card readiness, pending recovery, job date/release/preflight and saved preferences.
- Legacy journals without settings preserve their historical booking rules. Overnight, fractional and over-two-hour options are not supported.

### v0.7.0 — optional discount code
- Added per-job optional discount code, persisted with immutable job and checkout snapshots.
- Discount is applied only after exact basket verification, with a durable pre-dispatch marker and one observed application attempt; net and gross amounts remain separately validated.
- Unknown/expired codes, changed items, invalid or zero-cost totals stop without payment. The zero-cost path is not supported.
- A manual live form inspection accepted a code and showed a discount in the basket; that was not a completed automated payment.

### v0.6.6 — checkout-opening retained-tab check
- After the 16 October midnight run prepared an exact £14 two-hour basket but stopped at `Not the verified basket`, checkout opening was changed to validate the **retained checkout tab** immediately before the opening command.
- Rejects an unexpected route or changed basket and records safe diagnostics; does not retry an opening click on uncertain response.
- The historical failure's exact cause was not reproduced.

### v0.6.5 — any playing weekday
- Removed the former Monday–Thursday eligibility restriction; explicitly armed Friday–Sunday dates use the same release, preference and safety logic.

### v0.6.4 — authorized one-hour partial fallback
- On scheduled runs, a two-hour selection may fall back to one **already selected intended hour** only when exact basket evidence, saved minimum duration, court/time/price caps and pre-payment phase allow it.
- No additional selection or removal is sent to manufacture a fallback. The journal records the original intent in `fallbackFrom`.
- Added bounded logs (up to 100 runs / 100 steps per run), version and preparation-run correlation. Live fallback remained unverified.

### v0.6.3 — read-only message recovery
- Bounded read polling handles transient Chrome message-channel and removed-frame failures without navigating again or repeating mutations.
- Diagnostics distinguish operation, reason, read state, route, timeout and retained tab. The previously observed `PAGE_TAB_ERROR` root cause was not conclusively identified.

### v0.6.2 — closed selection-tab recovery
- A closed tab may be replaced with a **read-only basket tab** for an unsubmitted, unreferenced selection intent; the intent is then reconciled against observed basket state.
- Empty/partial basket remains blocked, and referenced/paid phases cannot be reopened as a new selection.
- Installed test evidence from 15 October showed the two-hour daytime £10 basket prepared successfully.

### v0.6.1 — daytime two-hour basket-only test
- Added **Test 09:00–11:00 basket (no payment)** for an eligible released date, searching Bethnal Green Gardens then Victoria Park for two hours (mixed courts allowed), capped at £14.
- Basket-only records block all payment paths. The owner must remove basket items and reconcile the cleared selection manually.

### v0.6.0 — serialized hourly selection
- After the 15 October release's basket-count mismatch, changed from rapid multi-hour clicks to one-hour-at-a-time selection with stable checkbox and basket-badge acknowledgement.
- Re-resolves checkbox nodes after merchant updates and waits for stable basket snapshots. Captures expected/actual basket and selection diagnostics.
- A concurrent-update race was reproduced in a controlled test; it remains a hypothesis, not proof of the site's internal implementation.

### v0.5.9 — longer read-only scheduled readiness
- Scheduled account, basket, purchase-history and card readiness budgets increased to 60 seconds, with read-only DOM probing permitted before full tab load and bounded message calls.
- Auth, unknown layouts, unexpected destinations and changed payment identity still stop. This does not authorize any mutation replay.

### v0.5.7 — midnight court-grid readiness policy
- Scheduled grid navigation changed to two bounded 60-second attempts separated by five seconds; manual checks use shorter budgets.
- Preferred venue checkout may start once an eligible candidate is found, without waiting for a fallback-venue scan.

### v0.5.5 — grid probing before full tab load
- Introduced the read-only grid helper with DOM probing while Chrome reports loading, a readiness timeout/retry policy and retained-tab diagnostics.
- The initial 14 October release failure preceded live acceptance of the hardening.

### v0.5.3 — mixed-court consecutive hours
- Introduced explicit ordered per-hour `courts` identity for two-hour reservations and bound it into journal/verification keys.
- Preserved legacy same-court journal key format; mixed-court paid confirmation uses purchase-history evidence.

### v0.5.2 — historical paid-test control retired
- Removed the dedicated £2.50 paid-test launch control while keeping the original paid journal and read-only receipt reconciliation available.

### v0.5.0 — initial payment safety MVP (13 October 2026)
- The source path covered scheduled availability → exact basket → local-card fill → a durable, once-only Pay dispatch → merchant paid-evidence reconciliation. Successful simulation did **not** establish a complete unattended midnight booking.
- A unique `PT`-prefixed Confirmed / Paid purchase with the exact amount was recognised against the live account DOM. Recovery was designed to survive a closed/stale checkout tab, an expired booking window and a locked card, while retaining the original dispatch marker, basket-verification timestamp and test-duplicate guard. Receipt-only recovery did not require card access.
- The historical MVP report stated **50 passing local tests**, including a simulated two-hour checkout and worker recovery with a closed tab. This is a **historical assertion, not a current executed test count**. The installed extension still required a reload and live follow-up; the original £2.50 paid test had been manually cancelled, with no verified refund.

### v0.4.6 — first real £2.50 test charge
- The extension filled Stripe's card form and submitted an authorized £2.50 Victoria Park test.
- Merchant history independently showed a matching Confirmed / Paid ✔ purchase; the owner then manually cancelled the booking. Refund was not verified.
- This demonstrated the need for independently reconciled payment evidence after a lost or uncertain submit response.

## Validation policy

- A version's mocked/simulated tests establish only the simulated behavior. **Do not treat historical passing test counts as the current test status.** Run `npm test` in the extension directory for the current suite.
- The installed unpacked extension is not updated until Chrome reloads it; reloading clears its unlocked card session.
- Never clear `paymentDispatchedAt` or `manualPaymentReportedAt` just to unblock arming.
- There is no evidence yet of a fully unattended release-through-paid-confirmation success; see the [test improvement plan](test-improvement.md) before expanding live acceptance.

## Other documents

- [Current project README](../README.md)
- [Extension usage and recovery](../outputs/tennis-local/chrome-extension/README.md)
- [Payment investigation and merchant DOM findings](payment-system.md) — detailed chronological evidence, including earlier superseded hypotheses
- [Testing reliability proposal](test-improvement.md)
- [Current booking policy](../README.md#default-booking-policy) — implemented settings and immutable job rules
- [Settings and discount regression matrix](test-improvement.md#5-required-scenario-matrix) — requirements consolidated from the v0.8.0 settings specification
