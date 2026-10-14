# Tennis booking extension — v0.5.9 MVP

Runs in normal Chrome using your Courtside sign-in. It checks and books at London midnight, seven days before the selected playing date, then attempts payment. Monday–Thursday only; starts at 20:00 or 21:00. Bethnal Green Gardens precedes Victoria Park; two hours precede one, with consecutive hours in the same venue; switching courts is allowed, with same-court options tried first. Limits are £14 for two hours and £7 for one. Confirmed dates and unresolved checkouts block duplicate bookings. Each armed job runs once.

## Setup and scheduling

v0.5.9 closes the remaining scheduled account/basket timeout gap: read-only account, basket and purchase-history checks wait up to 60 seconds and recognise ready DOMs without waiting for the whole tab to finish loading. Scheduled card-page/post-fill readiness also waits up to 60 seconds. Manual checks retain shorter budgets. Failed reads retain diagnostic tabs; changed payment identity, unexpected destinations and real authentication requirements stop. Nothing in this update retries card filling or payment. Exported status now includes the installed version.

The midnight grid policy uses a 60-second budget per attempt and waits five seconds before one fresh retry. This applies both to the scheduled availability scan and its pre-selection grid read. Manual checks retain 20-second attempts and a 500 ms pause. A ready grid can be read before the whole page finishes loading. The scheduled scan proceeds immediately when the preferred venue has an eligible candidate; manual checks still inspect both venues. Sign-in/human verification and changed layouts stop without retries. Final failure retains a diagnostic tab and reports availability as unknown; no payment or selection is blindly retried. The extended budgets have not yet been validated under a real midnight traffic surge.

1. Load this directory as an unpacked Chrome extension, or reload after updating. Reload any existing checkout tab to attach its scripts.
2. Open **Set up or unlock card file**. Enter card number, expiry, CVC and billing postcode locally; choose a passphrase of at least 12 characters. Creation downloads `tennis-card.encrypted.json` and unlocks it for the current Chrome session.
3. Close setup, choose a future playing date, and use **Arm midnight booking and payment**. Unlock the existing file before subsequent sessions. Keep Chrome open and the laptop awake. Chrome restart or extension reload locks the card.

The playing-date field defaults to London’s today plus eight days. It does not skip weekends automatically or change an already armed job; choose a Monday–Thursday date before arming. The armed response shows the saved date and release in UTC. During BST, 23:00Z means midnight London on the next calendar day. Preflight runs five minutes before release. An armed response does not mean preflight has passed or a booking has succeeded.

After a source update, reload the extension once, then unlock the card again. The saved schedule survives reload, but the unlocked card does not. Keep the card unlocked and avoid another reload before the run.

The file uses AES-GCM encryption with PBKDF2-SHA256 and a random salt and IV. Card details stay only in trusted extension session storage while unlocked; they are not written to project files, persistent extension storage, logs or results. Store the encrypted file separately from the extension source.

Payments require an unlocked local card and fill Stripe's card form directly. There is no Link fallback. The popup shows whether the card is unlocked. Unlock verifies the session-storage write. Arming, preflight and release check card availability before proceeding. Receipt-only recovery does not require an unlocked card. Human verification and bank approval can still require intervention.

## Recovery and historical payment test

**Check and recover** contains availability checks, site-verification resume, checkout preparation, payment reconciliation and paid-receipt verification. The availability reset does not erase payment uncertainty. The legacy basket reconciliation control only verifies an explicitly empty basket; it removes nothing and exists for unresolved records from older versions.

The paid-test button and its launch action were removed in v0.5.2. The earlier £2.50 test remains in historical payment records; receipt reconciliation still supports that record without submitting another charge. Do not delete its submission marker. This update does not change saved jobs, but reloading the extension clears the unlocked card session; unlock again before an armed run.

The extension verifies slot, total and provisional reference, commits its payment journal before submitting once, and requires matching paid evidence. It now reconciles the merchant account purchase history if the receipt tab is closed, stale or unrecognised, requiring the exact dispatched reference and amount in one Confirmed / Paid ✔ row. Account history confirms payment and leaves active booking state unknown. An interrupted or uncertain submission is never charged again automatically. Unknown layouts and mismatched details stop for inspection. Discovery and temporary read retries are bounded; run steps include timestamps. Arming, preflight and release reconcile an older dispatched payment before proceeding; unpaid unresolved baskets still stop.

Existing availability-only or basket-only jobs retain their saved modes; updating does not convert them into paid jobs or erase journals. Chrome alarms cannot wake a sleeping laptop. Checks more than a minute late stop.

## Validation

On 13 October 2026, v0.4.6 filled the local card directly and paid the authorised Victoria Park £2.50 test. Merchant account purchase history independently confirmed the matching reference as Confirmed / Paid ✔. The owner subsequently cancelled that booking manually; no refund was verified. v0.5.0's parser recognised that real purchase on the live account DOM, and worker recovery passed local integration tests. Preserve the submission marker: do not charge again. Reload the extension, then use **Verify paid receipt** to reconcile the existing journal; this does not need an unlocked card or a specific active tab. The installed-extension reconciliation, two-hour live payment and midnight completion still need live acceptance. See the [developer README](../../../README.md) and [payment findings](../../../docs/payment-system.md).

Run `npm test` in this directory for the maintained regression suite. Runtime archives omit test sources and development metadata. Historical evidence remains outside the extension in `../inspection/`.

## Card file troubleshooting

After an extension reload, close old card-setup tabs and reopen setup from the popup. Select the original `tennis-card.encrypted.json` and enter its original passphrase exactly, including spaces. The file format is unchanged; existing files remain supported. The setup now distinguishes invalid JSON, unsupported or damaged encryption fields, decryption failure, and failures storing a decrypted card in browser memory. A decryption authentication failure can mean either an incorrect passphrase or changed ciphertext; these cannot be distinguished reliably. Error messages contain no entered values or underlying browser error contents. JSON files with a UTF-8 byte-order mark are supported. The maintained suite has 67 passing tests.


Before payment submission, a reloaded checkout may issue a new provisional reference. The extension accepts that replacement only after re-verifying the exact basket and amount, and records the prior reference with a timestamp. Once payment dispatch is journalled, its persistent submission marker prevents another payment even if other phase metadata changes. Checkout preparation cannot erase that marker or a legacy uncertain-payment phase; only a matching paid receipt can confirm the record. Unknown phases stop for inspection.

Reload the extension before unlocking the card, not after. Once setup confirms the card is unlocked, close setup and reopen the popup on the checkout tab. Confirm the top line says Local card: unlocked, then run the test. Receipt reconciliation remains available without card access and cannot submit another charge.


Stripe's empty Card Element initially contains number, expiry and CVC inputs but no postcode input. Autofill validates those primary fields, enters the number, then resolves each remaining visible input afresh and waits up to five seconds per field for it to appear. Missing, disabled, read-only or ambiguous fields stop without payment. Failure messages identify the stage without returning field values. The collapsed-form sequence and missing-postcode stop are covered by regression tests.
