# Chrome extension: setup, testing and recovery

This is the **operating guide** for the active Manifest V3 extension. The installed version is shown at the top of the popup; the source version is defined in [`manifest.json`](manifest.json) (**0.9.5**, selection-diagnostics branch, 21 October 2026).

- [Project overview and safety model](../../../README.md)
- [Release history and observed live evidence](../../../docs/release-notes.md)
- [Detailed payment investigation](../../../docs/payment-system.md)

**Status:** Real one-hour direct-card payment and purchase reconciliation have been verified, and two-hour basket preparation has worked live. A fully unattended two-hour midnight booking through paid confirmation has **not** been verified. Do not mistake an armed job, selected basket or completed checkout test for a paid reservation.

## Install or update

1. In normal Chrome, sign in to [Courtside](https://tennistowerhamlets.com/).
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this `chrome-extension/` directory.
3. After changing source, reload the extension at `chrome://extensions`. Reload relevant Courtside tabs too, because open tabs may still have old content scripts.
4. Open the extension popup. Its readiness panel reports version, card state, existing checkout blockers and armed-job details.

An extension reload or Chrome restart **locks the local payment card session**, while persistent jobs and journals survive. Do the final extension reload **before** unlocking the card for a scheduled payment.

## Set up the card and arm a booking

1. Select **Set up or unlock card file**. Create `tennis-card.encrypted.json` using card number, expiry, CVC, billing postcode and a passphrase of at least six characters, or unlock an existing file using its original passphrase. Store the file **outside the repository**.
2. Return to the popup and check for **Local card: unlocked for this Chrome session**.
3. Choose a playing date whose London-midnight release is in the future. The popup suggests London today + 8 days; it does not auto-shift weekdays.
4. Set first/fallback venue, earliest start/latest finish (whole hours), desired and minimum hours (1 or 2), court switching and gross price caps. The defaults are BGG then Victoria Park; 20:00–22:00, prefer 2 hours/accept 1; £14 total and £7 one-hour maximum.
5. Optionally enter a discount code (up to 10 supported characters). Click **Arm midnight booking and payment**. The job saves a snapshot of preferences and the code; editing fields or saving preferences later does not change that armed job. Re-arming replaces an earlier future alarm only after its safety guards pass.
6. Keep Chrome open and the laptop awake, and avoid reloading the extension after unlocking the card.

The release is **00:00 London, seven days before play** (23:00 UTC the previous calendar day during BST); preflight is five minutes earlier. **Arm** means the job was scheduled, not that preflight, selection, payment or booking succeeded. Chrome alarms cannot wake a sleeping laptop. Late starts, human verification, merchant errors or bank approval can stop unattended execution.

The encrypted file uses AES-GCM with a PBKDF2-SHA256-derived key. The decrypted card is held in trusted Chrome session storage only while unlocked, rather than in persistent project files or diagnostic exports. Direct card filling uses the Stripe Card Element; there is no automatic Stripe Link fallback. Receipt-only reconciliation does not need an unlocked card.

## Check and recover

For a selection that becomes unchecked or times out, download the diagnostic log before recovery. `SELECTION_ACK_TIMEOUT` distinguishes the elapsed-time deadline from changed route, price, layout or selection state. The journal preserves the original selection failure even if a later basket read fails. New diagnostics show observed reversion, hourly dispatch times, visibility and optional generic alert/status categories; these are observations, not proof of a merchant rejection. Same-origin HTTP statuses may belong to unrelated requests, and missing status entries do not prove that no request occurred. No raw response, URL or alert text is exported.

The 15-second manual / 60-second scheduled deadline covers the entire hourly selection sequence. Browser suspension can delay the next callback beyond the deadline; the extension stops when it resumes and issues no further hourly click. An empty basket after an uncertain click retains its recovery hold. Automatic switching to another court is not enabled without a verified terminal merchant rejection contract. A fresh exact one-hour basket can still proceed only under the saved minimum-duration and price authorization, without selecting again.

The controls below live in the popup's **Check and recover** section. Before taking action, read the readiness panel for an older pending checkout. **Never delete a journal or payment-dispatch marker to unblock a new job.**

| Situation | Use this control | Important boundary |
| --- | --- | --- |
| Check an already released date (today through 7 days ahead) | **Check availability now** | Read-only; paused while a job is armed so it cannot delay release |
| Signed-in site blocked the last availability check | **Resume after site verification** | Requires previous failure context; also paused while a job is armed |
| Need to prepare/pay the current result manually | **Prepare or resume checkout**, then **Pay or reconcile checkout** | The latter **can submit a real payment** if no payment dispatch has occurred; review basket, authorization and card readiness |
| Earlier extension Pay was dispatched, receipt unclear | **Verify paid receipt** | Receipt/account observation only, **never another charge** |
| You completed a normal pending checkout manually | Enter **Manually paid booking reference**, then **Verify manual payment** | Durable manual-payment hold first; exact reference, amount and paid history required; no Pay click |
| Abandon an unsubmitted, unreferred selection | Remove its items on the site, then **Reconcile cleared selection** | Requires stable empty basket; cannot clear any reference or payment submission |
| Ordinary checkout failed while opening, without a saved reference or card/payment intent | Inspect checkout and purchase history; if you did not pay, verify an empty basket, tick **I did not submit payment for the failed checkout shown above**, then **Archive failed checkout** | Explicit owner attestation; preserves original opening journal in history. Never cancels a merchant purchase or establishes unpaid status |
| Clean up a *verified unpaid checkout test* | **Clear unfinished unpaid test** | Automatic guarded cleanup; will stop if paid/uncertain, account evidence missing or basket changed |
| Stale interrupted availability check | **Reset interrupted availability check** | Clears the read-only availability lock, **not** payment records |
| Leftover basket-only record from old versions | **Verify cleared legacy test basket** | Verifies emptiness; does not remove items or modify paid journals |

A confirmed purchase in account history verifies **payment**, but does not by itself verify that a booking remains active. A cancelled booking may still have a paid purchase; refund status is separate. An ambiguous or missing paid receipt remains unresolved, not unpaid.

The failed-checkout archive is separate from unpaid-test cleanup. It accepts only one ordinary pending `checkout-opening` journal with a valid saved slot/key and opening timestamp, no reference or prior-reference field, and no card-fill, payment-dispatch or manual-payment marker (even an empty marker blocks it). Its confirmation is bound to that exact opening. The worker checks unchanged journals/history after observing an empty basket and writes the preserved archive and remaining journals together. It never removes site items, repeats opening or submits payment. If anything changed, payment may have been submitted, or you are unsure, retain the hold and investigate. An empty basket alone is insufficient. Reloading the extension clears the unlocked card session; unlock again only after completing recovery and the final update.

### Unpaid test: two-hour daytime basket

Use **Test 09:00–11:00 basket (no payment)** on an eligible released date. It searches Bethnal Green Gardens then Victoria Park for a two-hour slot, may use different courts in the same venue, and caps the total at £14. This records a durable `basketOnly` test intent and blocks card/payment access.

If the test succeeds, inspect the basket on the merchant site. **Remove the test items manually**, then click **Reconcile cleared selection**. Partial or uncertain selection remains pending until evidence is resolved. This test does not produce a booking or payment.

### Unpaid test: discount and opening the card page

Cancel clears future alarms when its queued command executes. It does not preempt an already queued or running release, reverse merchant actions or revoke a dispatched payment. Check the journal before starting another run.

Manual availability checks and verification resumes return `MANUAL_CHECK_WHILE_ARMED` whenever a saved job exists, even hours before release. Cancel the job first if you want to check manually, then re-arm if appropriate. This admission policy protects the release queue without allowing concurrent writes to shared run/result state; it does not interrupt an already running operation. **Assess recovery (read only)** remains available independently.

1. Cancel any armed job. Use **Check availability now** with the intended released date and preferences.
2. Enter the optional discount code (or leave it blank), then select **Test discount and open checkout (no payment)**. **Do not prepare a normal payable checkout first.**
3. The extension uses the saved availability preferences, selects and verifies exact items, verifies any gross/discount/net accounting, and attempts one checkout-opening click. A successful result is `checkout-test-passed` with `paymentBlocked: true` and `cardFilled: false`. It does not unlock/fill the card or submit Pay.
4. Use **Clear unfinished unpaid test** to remove a verified test. For an opened checkout, it must first identify the exact provisional reference and observe a matching **Pending / Pay** purchase row before and after cleanup. Unrelated basket items, ambiguous purchase state or any payment marker stop automatic cleanup.

Changing a test's discount code, checked date or search preferences can trigger the same guarded cleanup before restarting. If cleanup is blocked, inspect the record instead of forcing a reset. For the manual fallback, use the merchant's **Cancel & return to basket**, remove the test items/discount, attest **I did not submit payment** only if true, and use **Reconcile cleared selection**. **Never apply this unpaid-test cleanup to a paid or potentially paid checkout.**

An unfinished checkout-page test can have no saved reference after opening was attempted. The popup now identifies that specific case and expands **Check and recover** with the manual steps above; it never ticks the attestation for you. A missing dispatch marker does not prove no payment occurred. If you are unsure, preserve the journal and inspect purchase history. The guidance does not remove items, archive a record or establish merchant cancellation; the existing worker checks still apply when you explicitly reconcile.

## Failure handling and diagnostics

- For selection, the extension validates both hour/court cells before starting, clicks each hour once, waits for stable checkbox/basket-count acknowledgement, and verifies stable basket snapshots. A partial selection may become a one-hour scheduled booking only if all saved rules allow it. An uncertain click is not replayed.
- Read-only grid navigation uses 20-second manual or 60-second scheduled readiness budgets, with one bounded retry. The scheduled selection reuses the availability tab and freshly reads its exact venue/date without navigation; a changed route, closed tab or timeout stops this handoff without reloading. Other scheduled page reads allow 60 seconds; manual account/basket reads generally use 15 seconds. Checkout card-page opening has a bounded **60-second** readiness wait for both manual and scheduled paths. A human verification page, changed route or merchant error is a stop, not a request to retry payment blindly.
- After the initial empty-basket check and selection, the scheduled tab loads the basket to verify the selected items. Before payment preparation, it refreshes that same basket from the merchant, because another tab could change the shared server basket without changing the old DOM. Checkout opening then performs a fresh stable DOM observation on that tab. No previously parsed basket is used as permission to mutate. A worker restart loses these in-memory tab handoffs and uses the existing durable-journal recovery rules. This removes two navigations in the simulated scheduled success path; no live speed or booking-success improvement has been established.
- Checkout can produce a **new provisional reference before Pay**, but only a fresh exact basket/amount check can authorize a pre-dispatch replacement. After `paymentDispatchedAt` or `manualPaymentReportedAt` is set, recovery must not reopen and resubmit a charge.
- **Download diagnostic log** saves a locally redacted `tennis-booking-log-<timestamp>.json` including installed version, current job, basket/checkout evidence, references and bounded run history. Card details, passphrases and discount-code values are sanitized, but **booking references/slot details remain sensitive**. Nothing is automatically uploaded; do not publish the file to GitHub.
- **Show diagnostic JSON** shows the **raw** local status, including potentially sensitive discount codes; use the downloaded sanitized log when requesting help.

### Card file troubleshooting

After a reload, close stale card-vault tabs and reopen setup from the popup. Select your original encrypted file and enter its **original** passphrase exactly (including spaces). A decryption-authentication failure could mean a wrong passphrase or modified ciphertext; it cannot reliably distinguish the two. Malformed JSON, unsupported metadata, decryption failure and session-storage failure are distinct diagnostics.

Stripe's initial collapsed Card Element may show number/expiry/CVC before postcode. The form adapter re-resolves inputs as they appear and stops if required fields are missing, disabled, read-only or ambiguous. Do not bypass the stop by trying to replay Pay.

## Tests and releases

PR #4 integrates `npm run test:browser` and `npm run test:ci` with the current runtime, using pinned Chromium, a disposable local fake merchant, denied external HTTP(S) and a test-only card/clock. See [the isolated browser guide](test/browser/README.md). No test adapter, card substitute, browser profile or fake host permission is included in the production package. Live merchant acceptance remains separate.


PR 2 adds `npm run test:worker`, a stateful fake merchant with isolated actual-worker VM restarts and fault injection. Popup/alarm mutation commands are serialized, and card filling has a durable marker. Interrupted card filling stops with `CARD_FILL_REVIEW_REQUIRED`: an enabled button and matching amount/reference cannot prove which card is present, so recovery cannot refill or Pay automatically. **Assess recovery (read only)** identifies open existing-purchase pages without paying or cancelling them; a price match cannot establish identity. Positively conflicting paid receipt evidence retains its hold for investigation, including conflicting venue, date, court, time, duration or total. Recovery assessment runs independently of the mutation queue, with one-second tab reads and a five-second overall observation budget; incomplete evidence stays unknown.

The reliability branch adds a **Latest action** line, separate from the current unresolved journal and historical `checkoutResult`. Stopped commands retain stable failure/recovery classifications even if they fail before a page read. Diagnostic downloads include this status. Test archives identify owner attestation, merchant-unpaid verification or an unsubmitted empty selection separately; none establishes merchant cancellation. Reopening the popup clears a stale attestation when its checkout identity changes.

Use `npm run test:scenarios` for named offline reproductions, or `npm run repro -- --scenario post-discount-read-loss` for one case. `npm run analyze:logs -- <local-file.json> [...]` compares exports without copying merchant references into its summary; keep source exports and analysis private. These are simulations, not live payment checks.

From this directory:

~~~powershell
npm test
~~~

This runs the Node `node:test` suite for business rules, adapters and mocked worker flows. It does **not** establish live merchant/midnight acceptance. Build the runtime ZIP with [`build.ps1`](../../../build.ps1) from the repository root. For historical fixes see [release notes](../../../docs/release-notes.md); for the plan to replace manual live-test cycles with deterministic integration tests see [test-improvement.md](../../../docs/test-improvement.md).
