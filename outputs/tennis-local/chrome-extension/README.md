# Tennis booking extension — v0.4.6

Runs in normal Chrome using your Courtside sign-in. It checks and books at London midnight, seven days before the selected playing date, then attempts payment. Monday–Thursday only; starts at 20:00 or 21:00. Bethnal Green Gardens precedes Victoria Park; two hours precede one, with consecutive hours on the same court. Limits are £14 for two hours and £7 for one. Confirmed dates and unresolved checkouts block duplicate bookings. Each armed job runs once.

## Setup and scheduling

1. Load this directory as an unpacked Chrome extension, or reload after updating. Reload any existing checkout tab to attach its scripts.
2. Open **Set up or unlock card file**. Enter card number, expiry, CVC and billing postcode locally; choose a passphrase of at least 12 characters. Creation downloads `tennis-card.encrypted.json` and unlocks it for the current Chrome session.
3. Close setup, choose a future playing date, and use **Arm midnight booking and payment**. Unlock the existing file before subsequent sessions. Keep Chrome open and the laptop awake. Chrome restart or extension reload locks the card.

The file uses AES-GCM encryption with PBKDF2-SHA256 and a random salt and IV. Card details stay only in trusted extension session storage while unlocked; they are not written to project files, persistent extension storage, logs or results. Store the encrypted file separately from the extension source.

Payments require an unlocked local card and fill Stripe's card form directly. There is no Link fallback. The popup shows whether the card is unlocked, and enables the test only when ready (or when reconciling a previously submitted payment). Unlock verifies the session-storage write. Arming, preflight and release check card availability before proceeding. Human verification and bank approval can still require intervention.

## Recovery and the current payment test

**Check and recover** contains availability checks, site-verification resume, checkout preparation, payment reconciliation and paid-receipt verification. The availability reset does not erase payment uncertainty. The legacy basket reconciliation control only verifies an explicitly empty basket; it removes nothing and exists for unresolved records from older versions.

**Run £2.50 checkout test** is the authorised Victoria Park court 2 booking on Saturday 17 October 2026, 07:00–07:59, £2.50. Run it from its existing basket or card checkout. Do not add another item or clear its pending record. Payment uses the extension's submission code; leave the site's Pay button untouched.

The extension verifies slot, total and provisional reference, commits its payment journal before submitting once, and requires a matching paid receipt. An interrupted or uncertain submission is never charged again automatically. Unknown layouts and mismatched details stop for inspection. Discovery and temporary read retries are bounded; run steps include timestamps.

Existing availability-only or basket-only jobs retain their saved modes; updating does not convert them into paid jobs or erase journals. Chrome alarms cannot wake a sleeping laptop. Checks more than a minute late stop.

## Validation

On 13 October 2026, the extension filled the local card directly and paid the authorised Victoria Park £2.50 test. Merchant account purchase history independently confirmed the matching reference as Confirmed / Paid ✔. The owner subsequently cancelled that booking manually; no refund was verified. The extension stopped in payment-uncertain because its receipt matcher did not recognise the result. Preserve the submission marker: do not charge again. Automatic receipt reconciliation, two-hour live payment and midnight completion remain unverified. See the [developer README](../../../README.md) and [payment findings](../../../docs/payment-system.md) for evidence and required recovery work.

Run `npm test` in this directory for the maintained regression suite. Runtime archives omit test sources and development metadata. Historical evidence remains outside the extension in `../inspection/`.

## Card file troubleshooting

After an extension reload, close old card-setup tabs and reopen setup from the popup. Select the original `tennis-card.encrypted.json` and enter its original passphrase exactly, including spaces. The file format is unchanged; existing files remain supported. The setup now distinguishes invalid JSON, unsupported or damaged encryption fields, decryption failure, and failures storing a decrypted card in browser memory. A decryption authentication failure can mean either an incorrect passphrase or changed ciphertext; these cannot be distinguished reliably. Error messages contain no entered values or underlying browser error contents. JSON files with a UTF-8 byte-order mark are supported. The maintained suite has 43 passing tests.


Before payment submission, a reloaded checkout may issue a new provisional reference. The extension accepts that replacement only after re-verifying the exact basket and amount, and records the prior reference with a timestamp. Once payment dispatch is journalled, its persistent submission marker prevents another payment even if other phase metadata changes. Checkout preparation cannot erase that marker or a legacy uncertain-payment phase; only a matching paid receipt can confirm the record. Unknown phases stop for inspection.

Reload the extension before unlocking the card, not after. Once setup confirms the card is unlocked, close setup and reopen the popup on the checkout tab. Confirm the top line says Local card: unlocked, then run the test. Receipt reconciliation remains available without card access and cannot submit another charge.


Stripe's empty Card Element initially contains number, expiry and CVC inputs but no postcode input. Autofill validates those primary fields, enters the number, then resolves each remaining visible input afresh and waits up to five seconds per field for it to appear. Missing, disabled, read-only or ambiguous fields stop without payment. Failure messages identify the stage without returning field values. The collapsed-form sequence and missing-postcode stop are covered by regression tests.
