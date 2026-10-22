# Payment system: merchant contracts, safety and incident evidence

**Status:** Technical reference for the active Chrome Manifest V3 extension, source updated through the v0.9.5 selection-diagnostics branch (21 October 2026). **Not** a release changelog or a claim of unattended production readiness.

Use the [root README](../README.md) for current booking policy, the [extension guide](../outputs/tennis-local/chrome-extension/README.md) for operating/recovery controls, [release notes](release-notes.md) for version chronology, and [test improvement plan](test-improvement.md) for proposed reliability work. This document preserves **merchant-specific observations and recovery contracts**. Historical observations are labelled; site DOM and payment-provider behavior can change.

## 1. Core payment and recovery contract

An ordinary reference-less `checkout-opening` can be explicitly archived only with owner attestation of no payment and a newly observed empty basket. The narrowly scoped predicate requires an ordinary pending journal, matching saved slot/key, valid opening timestamp, and absence of any reference/prior-reference, card-fill, payment-dispatch or manual-report field. Empty/null marker fields also block recovery. The worker serializes this action, checks the current confirmation before observation, and rejects any journal/archive change after the read. One storage write preserves the original opening phase/intent and prior history in `abandonedCheckouts`, recording `owner-attested-failed-checkout-no-payment` provenance; merchant payment and cancellation remain unknown. No site mutation occurs and no payment hold can qualify. Offline regressions cover persistence failure before/after commit, restart, stale confirmation and changed evidence. This is local abandonment, not merchant cancellation or verified-unpaid evidence.

PR 2 serializes mutation entry points within the active MV3 worker and persists `cardFillDispatchedAt` before filling. A legacy `card-filling` phase is treated as potentially dispatched; recovery stops for explicit manual review before changing phases, refilling or submitting Pay. An enabled button with matching reference/amount does not establish authorized card provenance. Known paid-receipt contradictions for the saved reference remain held, while unrelated/unreadable current pages may fall back to independently matched account evidence. Existing-purchase payment pages are recognised for read-only assessment and cannot be used as an alternate automatic Pay or cancellation route. These contracts are simulated in an isolated actual-worker harness.

The guard recognizes `cardFillDispatchedAt`, legacy `card-filling` and any existing `cardFillRecoveryRequired:true` latch, preserves them unchanged and returns `CARD_FILL_REVIEW_REQUIRED`. Only an uninterrupted fresh fill can proceed to readiness and Pay. Existing payment-dispatch/manual-report markers take precedence and remain reconciliation-only. Existing-purchase worker tests separately require the saved exact reference and amount and assert zero mutations for matching, mismatched and missing references.

Receipt dates are scoped to explicit `Playing date`, `Date of play` or `Court date` fields, or the legacy standalone date immediately following a recognized venue/court line. Processing/creation metadata cannot supply or contradict the playing date. Playing-time fields recognize labelled starts and ranges, plus standalone times immediately following court/venue or standalone date details. Explicit mismatches on the saved paid reference remain `RECEIPT_CONFLICT`; unfamiliar layouts remain unverifiable and may use independently matched account evidence, which proves payment only. Synthetic receipt fixtures establish this parser contract; they do not establish the live merchant layout.

Manual `check` and `resume` actions remain serialized because they share running/result/trace state. Admission refuses them whenever a saved job exists, before merchant reads or running-state changes (`MANUAL_CHECK_WHILE_ARMED`). Cancel or completed release removes that blocker; cancellation remains queued, not preemptive. This deliberately prevents manual checks even well before an armed release. Recovery assessment remains outside that queue with bounded reads and no business-journal writes.

The v0.9.0 reliability branch stores `latestAction` separately from historical results, classifies safe stop reasons, and includes those classifications in exports. Archived tests carry `abandonmentEvidence`: `merchant-unpaid-verified`, `owner-attested-no-payment` or `unsubmitted-selection-empty`. Owner attestation is bound to the current checkout key/reference/opening identity, and never establishes merchant payment or cancellation status. These changes are locally simulated; they do not add a new merchant recovery mutation or prove unattended acceptance.

Recognized structured error codes determine recovery modes before legacy message matching. Possible payment always overrides to reconciliation-only. Action-status updates use a per-storage queue around start registration and identity-checked completion writes; mutation actions are separately serialized; read-only recovery assessment remains independent. The latest status persists a monotonic sequence and unique ID. A replacement MV3 worker reads the persisted sequence, while termination discards old callbacks. This is single-active-worker ordering, not a distributed storage transaction or recovery of interrupted work; payment journals and historical results remain independent.

Scheduled release actions return their checkout/payment outcome so a stopped checkout cannot appear as a completed latest action. Payment-verification failures are reconciliation-only in both run steps and latest status; automatic-payment failures derive that guidance from durable dispatch/manual-report markers or uncertain-payment phases. These diagnostics do not grant permission to repeat any mutation or clear a payment hold.

- **Pay dispatch is not idempotent.** Persist the complete checkout identity and `paymentDispatchedAt` **before** the one Pay action. An interrupted, returned-error or ambiguous dispatch may already have charged the card. Recover through trusted receipt/account purchase evidence only; never resubmit Pay for that journal.
- **Mutation acknowledgement is not outcome proof.** A lost response to selecting an hour, applying a discount, opening checkout, or removing a test item does not authorize an automatic replay. Observe and reconcile the actual site state. Read-only probes may retry within explicit budgets; mutation calls may not.
- **Payment and reservation state are distinct.** A uniquely matched `Confirmed / Paid ✔` purchase proves payment, not that the court remains booked, that cancellation succeeded, or that a refund occurred. Preserve separate state for payment, active booking, cancellation and refund; represent ambiguous evidence as unknown.
- **Authorization is immutable once armed.** Check saved venue, playing date, each hour and court, minimum duration, gross caps, discount and exact net amount at every boundary. Do not use current popup edits to widen a pending journal. Unknown/extra basket items, price or reference changes, unsupported route, or unrelated purchase evidence stop the operation.
- **Recovery evidence is durable.** Keep `checkoutRecords`, `paymentDispatchedAt`, `manualPaymentReportedAt`, historical references, intent/phase, and prior trusted observations. Never erase them to unblock an alarm or force a new checkout. Restore journal identity even when the tab closes or the booking date passes.
- **Manual payment is a separate hold.** If the owner completes a pending ordinary checkout outside the extension, `manualPaymentReportedAt` and the explicitly supplied reference must be persisted before any account read; it never implies the extension dispatched Pay. Matching paid account evidence is required, and subsequent actions are reconciliation-only. Test-only and already-dispatched records must not use this path.
- **Client-only once-per-journal is not distributed exactly-once.** Without merchant-supported idempotency keys, the enforceable guarantee is *at most one authorized Pay dispatch by this client journal*, followed by conservative reconciliation.

Source areas: `background.js`, `checkout.js`, `payment.js`, `reconciliation.js`, `payment-content.js` and `checkout-content.js` in the [active extension](../outputs/tennis-local/chrome-extension/).

## 2. Merchant court, basket and account DOM observations

| Area | Observed contract and defensive parsing rule |
| --- | --- |
| Court labels | Victoria Park cells use **Court 2**; Bethnal Green Gardens uses **Tennis court 2**. Booked labels can include *Tennis court 4 booked* without a price. Test booked/disabled/closed/already-checked status **before** parsing price; exclude padel. |
| Hour selection | Clicking a court checkbox adds one hour to the basket. Validate consecutive hours and exact per-hour court identity before mutation. Later merchant updates may replace grid nodes; re-resolve them before further observation/selection. |
| Basket items | Item anchors match `a[href^="#item-"]`. The merchant displays one-hour slots ending in `:59` (e.g. `7:00am–7:59am`), and abbreviated ordinal dates such as `17th Oct`. Two booked hours are **two basket items**, not one. |
| Basket badge | `#menu-basket[data-items="1"]` supplies the count; its CSS-rendered label may leave `textContent` empty. Observe stability before treating a transient count as final. |
| Exact basket | Match venue/date, every hour/court, original gross prices, item count and sum; reject unrelated items. A two-hour same- or mixed-court candidate needs **two exact hourly identities**. |
| Account purchase history | Observed at `/account` with a `PT`-prefixed numeric reference, paid state `Confirmed` / `Paid ✔` and an exact amount; the historical cancelled-paid row had an **empty Info cell** and did not reproduce the original court details. |
| Unpaid purchase | A unique matching `Pending` row with an exact `Pay £X` state and amount can support guarded test cleanup. A missing/duplicated row, still-loading page, changed layout or paid/unknown state is **not** equivalent to unpaid. |
| Basket removal | The observed merchant item removal control resembled `/basket/remove/<32 hex characters>`. This is a **mutation**, not a harmless read; it must target only positively verified test-owned items with a pre-dispatch removal fingerprint. |

These are recorded observations, **not a guaranteed current merchant API**. The [test proposal](test-improvement.md) requires sanitized real DOM fixtures and a stateful fake merchant so site-layout drift does not surface only during paid live runs.

### Navigation and content-script transport

- Selection polling uses a monotonic elapsed deadline shared across both hourly clicks, retaining a bounded poll cap. After timer throttling/suspension, the next callback checks the expired deadline before any further click or acknowledgement acceptance. This bounds extension work after resumption, not browser callback latency. A timeout or transport loss remains uncertain and cannot trigger automatic selection at another court.
- Selection responses cross a closed diagnostic schema in `selection-evidence.js`. Dispatch/result steps and the durable journal retain safe classifications, elapsed time, per-hour timestamps, last checked state and reversion evidence. Unknown merchant/transport messages are replaced with fixed text. A later basket-read failure cannot erase the saved original `selectionFailure`.
- Optional resource timing observes only same-origin fetch/XHR entries starting during this selection window, with at most eight HTTP status/completion pairs; no URL, endpoint identity, header, payload or response body is retained. These entries may be unrelated, unavailable or incomplete and cannot establish merchant rejection, payment state or permission to retry. Generic visible alert categories are similarly observational; raw text is discarded. `merchantOutcome` stays `unknown`.
- **21 October observation:** The scheduled run found eligible BGG slots, dispatched the first hour, observed no acknowledgement and later an empty basket; checkout opening/card filling/Pay were never dispatched. The owner also reported manual selections becoming unchecked. This supports investigating the merchant selection path but does not establish its cause. Its roughly 115-second wait exceeded the intended 60-second budget; timer throttling is a hypothesis. No correlated terminal-rejection response is available, so automatic alternate-court fallback remains blocked. Public inspection redirected to human verification; native browser inspection was stopped by the URL-confidence safety boundary. No challenge was bypassed and no live diagnostic selection was made.

- The scheduled release can hand its retained availability grid directly to selection in the same invocation. A fresh, route-checked grid read must still contain the exact saved hourly candidate and original price; the content script also revalidates every hour before clicking. This existing-document read does not navigate or retry navigation. Missing, moved or changed tabs stop safely.
- The initial empty basket is independently loaded once while retaining the grid. After selection, the selection tab loads `/basket` for exact verification and refreshes it again from the merchant before payment preparation. This second server observation is necessary: another tab can change the shared basket without updating an old DOM. Immediately before checkout opening, a fresh stable DOM read verifies the same refreshed tab. Manual/pending recovery still uses its previous independently loaded basket observations; a fresh manual preparation avoids navigating an already newly created basket tab twice.
- Tab handoffs are in-memory scheduling hints, not saved authorization or cached merchant evidence. They are not persisted in jobs/results and cannot be recovered to replay a mutation after interruption. Durable journal markers, immutable settings and all existing payment/discount/opening guards remain authoritative.

- Install the navigation listener before `chrome.tabs.update`; a completion event from the *previous* page must not satisfy the new navigation. Check origin and expected route before accepting content-script evidence.
- Read-only messages use known account, purchase and basket adapters. When a tab is `loading`, an existing usable DOM can be probed without waiting for `status:complete`. Known transient message/replaced-frame errors may be polled under bounded deadlines; an unknown route, authentication challenge or unrelated origin stops.
- Observed historical policies included a **60-second scheduled page-read budget** (versus shorter manual reads) and two bounded grid navigation attempts, with a five-second pause, when the midnight surge made readiness uncertain. The current source—not these old budgets—is authoritative if timing code changes.
- Content-script messages and merchant DOM updates are separate asynchronous events. Assert effects and acknowledgement counts, not merely a reported success flag. A closed tab can justify a new **read-only** trusted-site observation, not a replay of the prior selection, discount or Pay.
- Logs include run IDs and UTC timestamps. London wall-clock time differs from UTC during BST; compare timestamps using an explicit zone.

## 3. Slot identity, discounts and checkout opening

### Slot and provisional-reference identity

The original code once compared whole slot objects with `JSON.stringify`, but Chrome storage can reorder object keys. The `sameSlot` contract compares required typed fields and values independently of property order and rejects missing/extra fields. Mixed-court two-hour slots store an ordered `courts` array in the durable key; legacy same-court keys must remain recoverable. Do not accidentally use a partial venue/date-only match for payment.

Opening or revisiting an **unpaid, pre-submission** checkout may create a different provisional reference. A replacement may be accepted only in a known pre-Pay phase following exact basket/amount verification, with the earlier value retained in timestamped `priorReferences`. **After** `paymentDispatchedAt` or `manualPaymentReportedAt`, reference replacement or a fresh Pay attempt is forbidden.

### Discount accounting and one-shot application

A nonempty per-job code is included in the immutable authorized snapshot and used only after an exact basket verification. The merchant-applied discount is validated against **each original item**, gross subtotal, explicit discount amount and the separately verified net card amount; receipts must match the saved **net** payment identity. Do not let a cheaper net price excuse a changed basket or an over-cap original price.

Persist a discount dispatch marker before applying it. On timeout, error, lost acknowledgement or changed page, **observe** the basket; do not apply the same code again. An invalid/expired code, inconsistent numbers, additional basket item or changed discount stops before Pay. Zero-cost orders require a different designed non-card flow and are not supported by the ordinary card path. Required edge cases are consolidated in [test-improvement.md](test-improvement.md#settings-and-discount-regression-contract-carried-forward-from-v080-requirements).

### 22 October release: post-discount basket-read failure

The private installed-v0.9.5 export records a two-hour BGG court 2 basket for 29 October, 20:00–22:00, verified at £14. Selection completed at `23:00:33.055Z` on 21 October (22 October London midnight). Discount intent was persisted at `23:00:39.934Z`. Five subsequent basket observations succeeded while Chrome reported `loading`; the next read stopped at `23:00:45.546Z` with `PAGE_TAB_ERROR`, `operation: message-read`, trusted basket route and `unclassified-tab-error`. That invocation had a 54,777 ms budget and failed after approximately 370 ms. The journal remained `discount-dispatched`, without verified discount, checkout opening, card fill or Pay markers. The export contains a nonempty saved discount code; an earlier pasted arm result without a discount does not describe this journal. The code itself and raw export remain private.

**Confirmed client defect:** `readPageState()` only continued after recognized transient Chrome messages or response timeouts. An unclassified thrown message error escaped immediately, and `ensureDiscount()` propagated it instead of using the remaining observation budget. Successful earlier reads are snapshots, not evidence that the POST completed. The export intentionally omitted raw Chrome exception text, so the exact transport error, navigation/receiver race and actual merchant discount outcome remain unknown.

**v0.9.6 change:** Only the two discount-observation callers opt into continued unclassified message-error observation, and only after a durable discount marker. The helper restricts that policy to read-only `basket-read` on the exact existing tab, with `navigate:false`, trusted basket route and Chrome `loading` status. Each iteration rechecks the tab/route. Unknown errors on a complete tab, closed/denied/invalidated contexts and returned rejection remain stops. Known transient read errors retain the previous policy. No new mutation or navigation retry is introduced; complete exact item/gross/discount/net verification is still required before opening checkout.

Read retry diagnostics retain fixed safe categories, count and elapsed/remaining budget, logging early and periodic retries to preserve the run's bounded history. Successful recovery retains its retry count; persistent failure reports `PAGE_READY_TIMEOUT` and the final read category. Logging/storage failures lie outside the transport catch and cannot be retried as message errors. Evidence arriving after the read deadline is rejected.

Permanent module, actual-worker and named scenario regressions model five loading reads followed by an unknown message error, recovery, persistent failure, lost discount acknowledgement, changed items/accounting, authentication and restart against accepted or unapplied discount state. They assert one discount dispatch and no further checkout/payment mutation while outcome is unknown. The supplementary browser case injects the message fault and loading metadata at the Chrome boundary while actual content scripts parse the final local fake-merchant basket. This is simulated evidence, not a reproduction of the original raw exception or live acceptance. The installed extension and existing owner journal were not changed during this investigation.

### Checkout-open acknowledgement vs card-page readiness

On 16 October, a two-hour BGG basket of **£10 gross**, with **£7 discount** and **£3 net**, was verified. The single checkout-opening command acknowledged success, but the card-page read timed out after 15 seconds. The owner reported a merchant error and returning manually to the basket. A later inspection saw a £3 card page with a provisional reference and disabled Pay. **Neither observation proves the original timed-out request ultimately completed**, and the unpaid test did not fill a card or dispatch Pay.

v0.8.9 changed opening readiness to a bounded **60 seconds** with safe route/readiness/error observation for scheduled and manual paths. A matching card page may be resumed only after identity verification. It must not repeat an ambiguous opening click or discard its opening marker based on a generic loading/merchant error. The underlying merchant-error cause remains unknown; [release notes](release-notes.md) describe what changed and [the regression plan](test-improvement.md) describes what remains unproven.

## 4. Direct Stripe Card Element and legacy Stripe Link

### Direct Card Element: observed collapsed form

The original Stripe form initially presented:

| Control | Initial observed state |
| --- | --- |
| `input[name="cardnumber"]` | Visible and enabled |
| `input[name="exp-date"]` | Enabled but collapsed / `aria-hidden` |
| `input[name="cvc"]` | Enabled but collapsed / `aria-hidden` |
| Postal input | Not yet rendered until card form expands |
| `input[name="hidden"]` | Disabled; not a payment target |

An early autofill implementation incorrectly required all four fields to be visible **before** entry. The v0.4.6 fix validates initial primary controls, fills the number, and **re-resolves** expiry, CVC and postcode as the form expands. The revealed postcode was labelled `Postcode` and used `name="postal"` / `autocomplete="postal-code"`. Dependent fields had a historical bounded wait of up to five seconds.

The adapter uses the native input value setter, focus/blur and bubbling input/change events; it never returns field values to loggers. Ambiguous, disabled, read-only or missing fields stop the workflow (possibly with partial local form entry, **without Pay**). A filled form alone does not authorize payment: the merchant Pay button and its amount/reference must be verified immediately before the durable one-click dispatch. Local DOM fixtures establish parser behavior but do not guarantee live Stripe compatibility.

### Legacy Stripe Link investigation (not the scheduled payment path)

Link autofill was observed in a cross-origin frame resembling `/v3/elements-inner-link-button-for-card-*` (control `#link-use`), while authentication/payment-method selection appeared in a `/v3/universal-link-modal-inner-*` frame. SMS authentication could recur and made a no-intervention Link flow unreliable.

Worker in-memory frame registries vanish across MV3 suspension, and Stripe frame `document.referrer` may be absent. The old implementation added read-only re-discovery of trusted frames using origin/merchant checkout checks, unique nonzero frame IDs and bounded probes. **Current scheduled payment requires the unlocked local card and does not automatically fall back to Link.** Residual Link modules and a pure payment dependency hook do not establish an active Link payment path. Never bypass Link/merchant/bank verification.

## 5. Local encrypted card vault and its distribution limitation

The extension's optional local encrypted file `tennis-card.encrypted.json` uses the `tennis-card-v1` format: AES-GCM-256 ciphertext, a random 16-byte salt, a 12-byte IV, and a PBKDF2-SHA256-derived key (historically 600,000 iterations). **Current minimum new passphrase length is six characters**; the original design required twelve, so historical notes that say twelve are superseded. Existing files must be opened using their original passphrase exactly, including spaces.

The local setup accepts card number, expiry, CVC and billing postcode. Unlocking stores the decrypted fields in `chrome.storage.session` restricted to `TRUSTED_CONTEXTS`; the worker supplies them only to the trusted Stripe card frame for authorized filling. The vault is not kept in persistent Chrome local storage, and the encrypted file/passphrase must never enter Git or diagnostics. Reloading/updating Chrome extension or restarting Chrome clears the unlocked session; unlock **after** the last reload. Receipt-only reconciliation needs no card access.

The vault distinguishes missing/corrupt file, invalid JSON/metadata, authentication failure, decrypted-data failure, obsolete extension context and session-storage failure. A failed authentication check cannot tell wrong password from modified ciphertext; fixed safe errors should not interpolate private form values. Unlock performs a session write/read-back check.

**Unresolved distribution/security issue:** The encrypted vault retains the **CVC** for later payment. Encrypting it does not itself resolve payment-industry restrictions on storage of card verification data. Review the payment/security design before distributing a payment-enabled extension to another person; see [distribution-flow.md](distribution-flow.md). This document does **not** assert that the current design is cleared for multi-user deployment.

## 6. Unpaid-test cleanup and manual recovery

A cleanup action for a **test-only** checkout must not reset an ordinary/potentially paid checkout or bypass a known payment marker. An opened test checkout requires an exact, uniquely matched `Pending / Pay` purchase row at the expected reference and amount **before and after** cleanup. Missing rows, a changed/malformed account table or unexpected paid state stop automatically.

- Only remove positively verified test-owned basket items. Validate hourly identities, original totals and any applied discount. Unrelated items stop cleanup. Persist the item removal fingerprint before each dispatch, observe the resulting basket, and do not repeat a removal when its response is lost.
- A verified empty basket alone does **not** prove the checkout was unpaid. The owner-attested route for a cleared test has a distinct evidence standard from merchant purchase-history verification. Record which standard justified an archive; do not describe attestation as merchant proof.
- An opened card/checkout tab may be closed during guarded cleanup only when it is identified as belonging to that test. Unknown references or ambiguous account evidence require manual inspection; never clear an unresolved payment journal.
- On 16 October, manual live inspection established the merchant `Pending / Pay` row and item-scoped removal control. A manually added inspection-only item was removed, leaving an empty basket. This **did not** establish that all installed-extension automated cleanup cases work live.

The [extension README](../outputs/tennis-local/chrome-extension/README.md) documents the current controls. The [test-improvement plan](test-improvement.md) records a real six-stop cleanup loop, unknown account lookup errors, post-discount message loss, and missing cleanup provenance requiring deterministic offline reproduction.

## 7. Time-stamped historical evidence worth preserving

This section retains compact, distinctive run facts. It is **not** a second version-by-version changelog and does not replace current code.

| Date / observed run | Preserved evidence | What remains unknown |
| --- | --- | --- |
| **13 October, paid Victoria Park test** | Intended test: court 2, **17 October 07:00–07:59**, **£2.50**. v0.4.6 began **00:38:48.941Z**; card filling at **00:38:52.574Z**; `paymentDispatchedAt` written **00:38:52.700Z**; stopped `payment-uncertain` at **00:39:13.089Z** after receipt timeout. `/account` independently showed one matching `PT` purchase, `Confirmed`, `£2.50` and `Paid ✔`. Owner manually cancelled; later paid row remained, Info empty. | Original immediate post-Pay receipt/redirect DOM was not captured; cancellation does not prove refund. |
| **14 October release for 21 October** | Release began **2026-10-13T23:00:00.005Z** (midnight London BST). Account read worked at **23:00:01.563Z**, BGG grid navigation started at **23:00:01.570Z**, and readiness stopped at **23:00:16.924Z**, before selection. The installed journal also showed earlier preflight attempts and no checkout/payment dispatch. | Whether an eligible court existed; the real cause of grid readiness delay. Old summaries mixed UTC and London times. |
| **15 October release for 22 October** | Release began **00:00:00.050 London**. BGG court 4, **20:00–22:00, £14**, was eligible. Basket initially empty at **00:00:21.648**, intent journalled at **00:00:21.653**, selection grid loaded at **00:00:30.880**, and checkout stopped on item-count mismatch at **00:00:49.349**. Owner saw an hour unselected after two briefly appeared selected. | A rapid-update race is plausible but **unproven**; old log lacked the complete selection response and actual final count. No Pay dispatch was observed. |
| **16 October release for 23 October** | BGG two-hour **£14** basket was selected and verified, but checkout-opening failed with `Not the verified basket` before card fill or Pay. | Exact retained-tab/route race and a successful unattended midnight paid confirmation. |
| **16 October daytime discount test** | `£10` two-hour basket, `£7` discount, `£3` net; checkout-open acknowledged, old 15-second card-read timeout; later £3 card-page observation. | Whether the first open eventually became usable; merchant error root cause; no Pay was attempted by that test. |

**Additional verified read-only evidence:** A separate one-hour Victoria Park basket-only test (court 2, **19 October 08:00**, £5) showed the extension's `basketVerified:true` and `basketCleared:true` with an independently empty basket. This did **not** book or charge a court.

Historical per-version source/test notes and older test-count claims now live only in [release notes](release-notes.md), which must not be treated as a fresh execution report. For more granular root-cause reproduction, use the sanitized observations and scenario IDs in [test-improvement.md](test-improvement.md), keeping any original private logs out of the repository.

## 8. Boundaries and outstanding validation

- A complete unattended midnight paid reservation has not been independently demonstrated in the reviewed evidence. One-hour local-card payment success and two-hour basket preparation prove different pieces.
- Exact source/DOM compatibility, transient merchant errors, Stripe form changes and human/bank challenges still need realistic offline regression plus deliberately authorized live acceptance. No verification bypass, cookie/profile copying or fingerprint spoofing should be used.
- Site human verification (`/verify-human`) in the original isolated Python/Playwright profile motivated the **normal Chrome extension** design; an already signed-in normal Chrome session still might face future verification. The retired Python runner is **not** the active payment implementation.
- Tests must exercise guard behavior across process/service-worker restart, storage retention, stale tab IDs, ambiguous receipts, manual-payment reports, failed discount/checkout openings and partial basket updates. Passing simulated tests is not proof of live merchant acceptance.

**Next work is tracked in [test-improvement.md](test-improvement.md).** This technical reference should be updated for new observed merchant contracts or safety design changes—not for every release note or old implementation TODO.
