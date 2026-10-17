# Chrome extension: setup, testing and recovery

This is the **operating guide** for the active Manifest V3 extension. The installed version is shown at the top of the popup; the source version is defined in [`manifest.json`](manifest.json) (**0.9.0**, reliability PR 1, 17 October 2026).

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

The controls below live in the popup's **Check and recover** section. Before taking action, read the readiness panel for an older pending checkout. **Never delete a journal or payment-dispatch marker to unblock a new job.**

| Situation | Use this control | Important boundary |
| --- | --- | --- |
| Check an already released date (today through 7 days ahead) | **Check availability now** | Read-only; does not select or pay |
| Signed-in site blocked the last availability check | **Resume after site verification** | Resumes a retained, verified site tab; requires the previous failure context |
| Need to prepare/pay the current result manually | **Prepare or resume checkout**, then **Pay or reconcile checkout** | The latter **can submit a real payment** if no payment dispatch has occurred; review basket, authorization and card readiness |
| Earlier extension Pay was dispatched, receipt unclear | **Verify paid receipt** | Receipt/account observation only, **never another charge** |
| You completed a normal pending checkout manually | Enter **Manually paid booking reference**, then **Verify manual payment** | Durable manual-payment hold first; exact reference, amount and paid history required; no Pay click |
| Abandon an unsubmitted, unreferred selection | Remove its items on the site, then **Reconcile cleared selection** | Requires stable empty basket; cannot clear any reference or payment submission |
| Clean up a *verified unpaid checkout test* | **Clear unfinished unpaid test** | Automatic guarded cleanup; will stop if paid/uncertain, account evidence missing or basket changed |
| Stale interrupted availability check | **Reset interrupted availability check** | Clears the read-only availability lock, **not** payment records |
| Leftover basket-only record from old versions | **Verify cleared legacy test basket** | Verifies emptiness; does not remove items or modify paid journals |

A confirmed purchase in account history verifies **payment**, but does not by itself verify that a booking remains active. A cancelled booking may still have a paid purchase; refund status is separate. An ambiguous or missing paid receipt remains unresolved, not unpaid.

### Unpaid test: two-hour daytime basket

Use **Test 09:00–11:00 basket (no payment)** on an eligible released date. It searches Bethnal Green Gardens then Victoria Park for a two-hour slot, may use different courts in the same venue, and caps the total at £14. This records a durable `basketOnly` test intent and blocks card/payment access.

If the test succeeds, inspect the basket on the merchant site. **Remove the test items manually**, then click **Reconcile cleared selection**. Partial or uncertain selection remains pending until evidence is resolved. This test does not produce a booking or payment.

### Unpaid test: discount and opening the card page

1. Cancel any armed job. Use **Check availability now** with the intended released date and preferences.
2. Enter the optional discount code (or leave it blank), then select **Test discount and open checkout (no payment)**. **Do not prepare a normal payable checkout first.**
3. The extension uses the saved availability preferences, selects and verifies exact items, verifies any gross/discount/net accounting, and attempts one checkout-opening click. A successful result is `checkout-test-passed` with `paymentBlocked: true` and `cardFilled: false`. It does not unlock/fill the card or submit Pay.
4. Use **Clear unfinished unpaid test** to remove a verified test. For an opened checkout, it must first identify the exact provisional reference and observe a matching **Pending / Pay** purchase row before and after cleanup. Unrelated basket items, ambiguous purchase state or any payment marker stop automatic cleanup.

Changing a test's discount code, checked date or search preferences can trigger the same guarded cleanup before restarting. If cleanup is blocked, inspect the record instead of forcing a reset. For the manual fallback, use the merchant's **Cancel & return to basket**, remove the test items/discount, attest **I did not submit payment** only if true, and use **Reconcile cleared selection**. **Never apply this unpaid-test cleanup to a paid or potentially paid checkout.**

## Failure handling and diagnostics

- For selection, the extension validates both hour/court cells before starting, clicks each hour once, waits for stable checkbox/basket-count acknowledgement, and verifies stable basket snapshots. A partial selection may become a one-hour scheduled booking only if all saved rules allow it. An uncertain click is not replayed.
- Read-only grid checks use 20-second manual or 60-second scheduled readiness budgets, with one bounded retry. Other scheduled page reads allow 60 seconds; manual account/basket reads generally use 15 seconds. Checkout card-page opening has a bounded **60-second** readiness wait for both manual and scheduled paths. A human verification page, changed route or merchant error is a stop, not a request to retry payment blindly.
- Checkout can produce a **new provisional reference before Pay**, but only a fresh exact basket/amount check can authorize a pre-dispatch replacement. After `paymentDispatchedAt` or `manualPaymentReportedAt` is set, recovery must not reopen and resubmit a charge.
- **Download diagnostic log** saves a locally redacted `tennis-booking-log-<timestamp>.json` including installed version, current job, basket/checkout evidence, references and bounded run history. Card details, passphrases and discount-code values are sanitized, but **booking references/slot details remain sensitive**. Nothing is automatically uploaded; do not publish the file to GitHub.
- **Show diagnostic JSON** shows the **raw** local status, including potentially sensitive discount codes; use the downloaded sanitized log when requesting help.

### Card file troubleshooting

After a reload, close stale card-vault tabs and reopen setup from the popup. Select your original encrypted file and enter its **original** passphrase exactly (including spaces). A decryption-authentication failure could mean a wrong passphrase or modified ciphertext; it cannot reliably distinguish the two. Malformed JSON, unsupported metadata, decryption failure and session-storage failure are distinct diagnostics.

Stripe's initial collapsed Card Element may show number/expiry/CVC before postcode. The form adapter re-resolves inputs as they appear and stops if required fields are missing, disabled, read-only or ambiguous. Do not bypass the stop by trying to replay Pay.

## Tests and releases

The reliability branch adds a **Latest action** line, separate from the current unresolved journal and historical `checkoutResult`. Stopped commands retain stable failure/recovery classifications even if they fail before a page read. Diagnostic downloads include this status. Test archives identify owner attestation, merchant-unpaid verification or an unsubmitted empty selection separately; none establishes merchant cancellation. Reopening the popup clears a stale attestation when its checkout identity changes.

Use `npm run test:scenarios` for named offline reproductions, or `npm run repro -- --scenario post-discount-read-loss` for one case. `npm run analyze:logs -- <local-file.json> [...]` compares exports without copying merchant references into its summary; keep source exports and analysis private. These are simulations, not live payment checks.

From this directory:

~~~powershell
npm test
~~~

This runs the Node `node:test` suite for business rules, adapters and mocked worker flows. It does **not** establish live merchant/midnight acceptance. Build the runtime ZIP with [`build.ps1`](../../../build.ps1) from the repository root. For historical fixes see [release notes](../../../docs/release-notes.md); for the plan to replace manual live-test cycles with deterministic integration tests see [test-improvement.md](../../../docs/test-improvement.md).
