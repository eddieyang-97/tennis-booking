# Payment system findings and development handoff

**v0.5.9 final pre-run hardening:** the grid-only surge policy left account and basket reads gated on the entire tab's load event and limited to fifteen seconds. A separate, strictly read-only adapter now accepts only account, basket and purchase-history messages, validates the expected merchant route, probes a ready DOM during loading, bounds each response to two seconds and retains failures with safe diagnostics. Scheduled preflight, release checking, basket verification and account purchase recovery use a sixty-second budget; manual reads retain fifteen seconds. Blank account/purchase DOMs while loading and incomplete basket markup are explicitly not-ready states, distinct from a completed login failure or changed layout. Card-page and post-fill readiness waits also gain the scheduled sixty-second budget; payment identity changes and unsupported destinations stop immediately. No filling, selection, checkout-opening or Pay action is replayed. The status export now includes the installed version, and scheduled failure results preserve retained-tab diagnostics. Sixty-seven tests pass, including 45-second page/card readiness, bounded hung responses, mutation-message rejection and policy propagation. Real midnight surge acceptance remains outstanding.

**v0.5.7 midnight traffic policy:** release-time grid reads and the subsequent pre-selection grid read now allow 60 seconds per navigation with a five-second pause before the one permitted retry. Manual checks remain at 20 seconds / 500 ms. Two attempts bound nominal grid readiness/retry waiting to approximately 125 seconds per grid, excluding Chrome API/timer overhead. Read responses remain bounded to two seconds; local probes do not issue site reloads. An on-time release is allowed to spend longer reading the grid; the late-start guard is unchanged. Scheduled scanning stops as soon as the preferred venue has an eligible candidate within the price cap, avoiding a slow fallback request before selection. Sixty-one tests pass, including simulated 45-second readiness, five-second retry backoff, exhaustive timeout termination and worker policy propagation to both release scanning and selection preparation. Account, basket and card-page timeouts remain unchanged. The real surge-time behaviour still needs live acceptance.

**Raw journal verified on 14 October:** installed-extension purchase reconciliation completed on 13 October at 00:58:44.524Z, confirming the previously dispatched payment without another submission. For the 21 October job, preflight first stopped at 22:55:01.133Z on an account read (`ok:false`, reason not included in this export), then passed at 22:55:31.515Z and again at 22:59:22.848Z. The manual availability check at 22:59:32Z stopped before page navigation; the requested date was still eight days away before London midnight and outside the seven-day checking window. Release began at 23:00:00.005Z, the account read succeeded at 23:00:01.563Z, the first venue's grid navigation started at 23:00:01.570Z, and the run stopped at 23:00:16.924Z with the fifteen-second readiness error. The first venue is Bethnal Green Gardens according to the source's ordering, not Victoria Park. No selection, checkout record or payment dispatch for 21 October appears. During BST these UTC times are one hour earlier than London wall time; the earlier pasted summary incorrectly labelled the final preflight 23:59 UTC. The saved job remains prepared but expired, not pending a future automatic attempt. No run of v0.5.5's new grid helper is present in this export, and the actual network/DOM cause remains unobserved because the old reader discarded the tab and did not log readiness state. The raw export and live references remain outside Git; these sanitized findings update the earlier hypotheses below.

**14 October / v0.5.5 follow-up:** a supplied summary reports that the 21 October release stopped at the first availability-grid readiness timeout, before selection. It does not establish no availability. Its preflight/release timestamps are inconsistent; the raw journal has not been independently read. Source inspection found that the old reader gated all content-script reads on `tabs.status === complete`, even when the DOM might already be usable. The new read-only grid helper probes while loading, budgets 20 seconds per navigation, bounds each message to two seconds and permits one fresh navigation on readiness timeout. Authentication, unexpected origin, closed tabs and layout mismatches stop immediately. Final failure retains a tab and safe load/route/read-state diagnostics. Fifty-nine tests pass, including pending load with a usable DOM, delayed/hung receiver, retry success/failure and no-availability distinction. The new source has not yet been verified in another live midnight run.

**v0.5.3 booking preference update:** two-hour slots still use consecutive hours, but may switch courts within the same venue. Mixed slots record an explicit `courts` array in chronological order and bind it into the durable key. Basket and selection adapters verify each hour's assigned court before payment; account purchase recovery verifies the resulting complete key. Legacy single-court journals retain their original keys. Mixed bookings use purchase-history evidence rather than the old single-court receipt parser. The current suite has 53 passing tests; a mixed-court live payment has not been attempted.

Recorded 13 October 2026 against extension v0.4.6. This document describes observed behaviour and source contracts; unknowns remain explicitly unknown. It intentionally omits card values, passphrases, authentication codes, account access codes, personal purchase history and actual merchant references.

**v0.5.0 MVP follow-up:** the historical gaps below are now implemented in source: account purchase matching with PT normalization, recovery independent of stale checkout tabs and expired booking windows, persistent basket-verification timestamps, timestamped reconciliation, duplicate-test prevention and pending-payment recovery before scheduling. The new parser recognised the actual paid test against the live account DOM. Fifty local tests pass, including worker recovery with a closed tab and locked card and a simulated two-hour checkout. The installed extension must still be reloaded and its recovery run; midnight completion remains unverified. Earlier sections describe the investigation as it happened, rather than v0.5.0's complete current behaviour. See [MVP release notes](mvp-release.md).

## Live evidence and what it establishes

1. The installed extension passed a one-hour basket test at Victoria Park, court 2, Monday 19 October 2026, 08:00, £5.00. Its exported result reported both `basketVerified:true` and `basketCleared:true`, with `booked:false` and `paid:false`. The empty basket was also checked independently. This tested the extension's own selection and cleanup code, rather than merely manual browser clicks.
2. The authorised paid test was Victoria Park, court 2, Saturday 17 October 2026, 07:00–07:59, one hour, £2.50. This deliberately falls outside the normal weekday/evening rules and is allowed only through the exact test slot. Earlier £7 basket experiments were not paid tests.
3. The successful v0.4.6 run started at **2026-10-13T00:38:48.941Z**. It entered `card-filling` at 00:38:52.574Z, journalled payment dispatch at 00:38:52.700Z, and stopped in `payment-uncertain` at 00:39:13.089Z. The approximately twenty-second receipt wait expired; no second payment was dispatched.
4. Independent inspection of the merchant's `/account` page showed the exact provisional reference in Recent purchases, prefixed `PT`, with **Confirmed**, **£2.50**, and **Paid ✔**. This establishes that the extension's direct-card payment actually succeeded despite its unresolved result. It does not establish that its receipt parser worked.
5. The browser was observed on a page headed **Cancellation complete**, and the test was absent from upcoming bookings. The owner explicitly confirmed manual cancellation. The purchase row still showed Paid ✔, while its Info cell was empty. Cancellation and transaction payment are separate states. No refund was verified.

The immediate post-payment receipt/redirect layout was not captured before the cancellation. Do not invent its heading or URL from the later account page. Midnight timing, a two-hour live checkout and recovery after arbitrary interruptions have not been verified end to end.

## Normal Chrome and verification barriers

The separate persistent Playwright profile used by the original Python prototype repeatedly reached `/verify-human`. The owner's ordinary Chrome session could use the site. This motivated an extension in normal Chrome rather than further work on the isolated profile. No cookie/profile copying, verification bypass or fingerprint spoofing was implemented.

Site human verification, Stripe Link authentication and bank authentication are different barriers. The site includes Cloudflare challenge integration, but the frequency and clearance lifetime are unknown. An apparently signed-in session or absence of console errors does not establish that verification will remain satisfied at midnight. Link can demand another SMS code despite earlier authentication. Direct card entry avoids depending on Link login but cannot eliminate bank challenges.

Browser automation clicks are not evidence that the extension's own code passed. Reloads, popup tests, exported run steps and merchant records were used to distinguish those cases. Browser tooling could not operate the Chrome extension manager/popup in this session, so the owner performed extension reloads and launched tests. The extension itself executes locally without an agent connection.

## Court grid, basket and Chrome transport

- Clicking a court checkbox adds the slot directly to the basket. Validate all requested consecutive hours before the first selection mutation.
- Victoria Park labels use `Court 2`; Bethnal Green Gardens labels use `Tennis court 2`. Booked cells can have labels such as `Tennis court 4 booked` without a price. Check availability/identity before price parsing; exclude padel, disabled, booked, closed or already checked cells.
- Basket items are represented by anchors matching `a[href^="#item-"]` and their corresponding item DOM. Displayed hours end at `:59` (for example `7:00am–7:59am`), rather than at the next `:00`. Dates can be abbreviated ordinal dates such as `17th Oct`.
- The basket badge uses `#menu-basket[data-items="1"]`. Its count is rendered through CSS; `textContent` can be empty. Read `data-items` instead.
- Install the navigation listener before `tabs.update`. A previous page's completion event must not satisfy readiness for the new navigation; wait for the new loading/completion sequence.
- Temporary read errors include a missing receiving end, a still-loading tab and Chrome's transient tab-edit rejection. Read retries are bounded to three attempts with 250/500 ms delays. Navigation retries are restricted to an explicitly rejected edit.
- Selection, card filling and Pay submission are mutations and are not blindly replayed after lost responses. Reconcile exact observed state first. An empty basket following an uncertain action is not enough to authorize replay.
- An unrelated or mixed basket blocks automatic selection/cleanup. Cleanup may only touch the exact authorised test basket. The old basket test UI was later removed; its remaining reconciliation control only verifies an explicitly empty basket and removes nothing.
- Each run has an ID and ISO UTC step timestamps. Reported London times differ during BST; compare UTC timestamps consistently.

## Slot identity and provisional booking references

Chrome storage may reorder object keys. Comparing whole slot objects with `JSON.stringify` caused a false `Unauthorized payment test` failure. `sameSlot` now checks the required values, types and key count, independent of object-key order. Extra/missing fields and wrong types still fail closed. Avoid reintroducing serialized-object identity checks when state crosses storage boundaries.

Opening or reloading unpaid card checkout can create a new provisional booking reference. Treating every change as fatal blocked legitimate recovery. Replacement is accepted only in a known pre-submission phase, after exact basket and amount verification. The old reference is retained in a timestamped `priorReferences` history.

After `paymentDispatchedAt` exists, reference replacement and a new submission are forbidden. A later phase update must never erase that marker. Legacy `payment-dispatched` and `payment-uncertain` phases also require receipt-only recovery. Checkout preparation cannot reset payment uncertainty. Unknown phases stop for inspection.

`booked:false` and `paid:false` in an error result mean the code could not verify success. The v0.4.6 paid test demonstrates why these flags cannot be read as proof of no charge.

## Stripe Link investigation

Link's card autofill button was inside a cross-origin Stripe frame with a URL resembling `/v3/elements-inner-link-button-for-card-*`, and used `#link-use`. Authentication/payment selection used a `/v3/universal-link-modal-inner-*` frame, with headings such as `Confirm it's you` and `Payment methods`. A selected card and Continue could enable the merchant's Pay button, but repeated authentication prevented a reliable unattended flow.

Service-worker in-memory frame registries disappear when the worker restarts or idles out. Stripe frame `document.referrer` can also be absent. Discovery was changed to an on-demand read-only broadcast so frames re-register, using the trusted Stripe frame URL and a separately validated merchant checkout tab. Eligible frames require a nonzero frame ID and a unique live probe. Discovery is bounded (12 attempts, 250 ms apart); uncertain actions are not retried.

Current runtime paid flows require an unlocked local card and do not fall back to Link. Legacy Link helpers remain for frame handling/old modal recovery and fixtures; their presence does not mean scheduled payments use Link. The pure payment module still has a dependency-level Link branch, so inspect the runtime dependency wiring when changing it.

## Encrypted local card file

The extension's setup page accepts number, expiry, CVC and billing postcode locally. It downloads `tennis-card.encrypted.json` with format `tennis-card-v1`: AES-GCM-256 ciphertext, a random 16-byte salt and 12-byte IV, and a key derived with PBKDF2-SHA256 at 600,000 iterations. The passphrase must contain at least twelve characters and is used exactly, including spaces.

The unlocked card is held in Chrome `storage.session`, restricted to `TRUSTED_CONTEXTS`, rather than persistent local storage. The worker supplies it only to the selected trusted Stripe card frame for filling. Values must never appear in run logs, error results, fixtures or repository files. This design relies on the installed extension and its code being trusted; encrypted storage does not remove the sensitivity of unlocked memory.

Extension reload/update or Chrome restart clears the unlocked session. Reload first, then reopen setup, unlock, close setup and check the popup's **Local card: unlocked** state. Reusing an old setup tab can produce a context-invalidated error. Closing the setup page does not itself lock the session.

The original generic unlock error conflated wrong passwords with successful decryption followed by a session-storage failure. Setup now distinguishes file selection/read/size errors, invalid JSON (including UTF-8 BOM handling), invalid encryption fields, authentication failure, invalid decrypted card data, old extension context and session-storage failure. Authentication failure cannot distinguish an incorrect passphrase from modified ciphertext. Messages use a fixed safe vocabulary rather than interpolating raw browser errors. Unlock writes then reads back all fields to verify session storage.

Arming, preflight and release all check card availability. Receipt-only reconciliation requires no card and must not refill fields. The encrypted file, passphrase and browser session must remain outside Git. A locked card stops before starting a new charge; it does not justify switching to Link.

## Direct Card Element filling: the v0.4.6 fix

Observed Stripe empty-form structure:

| Field | Initial state |
| --- | --- |
| `input[name="cardnumber"]` | Visible and enabled; labelled credit/debit card number |
| `input[name="exp-date"]` | Enabled but collapsed/`aria-hidden` |
| `input[name="cvc"]` | Enabled but collapsed/`aria-hidden` |
| Postal input | Absent until the card form expands |
| Inputs named `hidden` | Disabled hidden controls; not payment targets |

The earlier autofill implementation required all four visible fields up front and failed on the valid empty form. v0.4.6 validates the three primary controls, fills the number, then freshly resolves visible expiry, CVC and postcode in order. Each dependent field gets a bounded wait of up to five seconds (50 × 100 ms). The revealed postcode uses name `postal`, label Postcode and `autocomplete="postal-code"`.

The fill uses the native `HTMLInputElement.prototype.value` setter, bubbling input/change events and focus/blur. It does not return field values. An unknown primary layout stops before filling. Missing/ambiguous/disabled/read-only later fields can leave partial form input, but no payment is submitted. Diagnostics identify only the stage. After filling, the merchant Pay button must be enabled and its amount/reference must still match before journalled submission.

Regression fixtures cover collapsed form expansion and missing-postcode failure. The merchant's paid purchase subsequently confirmed the live path. Changing selectors or events still requires checking the actual Stripe form; local fixtures alone do not establish compatibility.

## Receipt recognition and duplicate-charge protection

`checkout-content.js` currently accepts only merchant paths starting `/basket`, specific confirmation headings, a numeric reference, explicit payment-success text, full slot details, duration/end time and one exact total. The observed account purchase history instead lives at `/account`, displays references with a `PT` prefix and marks rows `Confirmed` / `Paid ✔`.

The successful test left a durable pending journal in `payment-uncertain` even though the merchant confirmed payment. Its submission marker prevented a repeat charge as intended. A stale `tabId` was also present in the durable record, differing from the active checkout tab used by the run. Current receipt polling targets the checkout tab and does not reconcile account history. Current verification also expects a basket page. These are outstanding implementation gaps, not permission problems or evidence that payment failed.

The purchase row after cancellation contained date, reference, state, an empty Info cell, value and paid marker. It supplied no remaining slot description. Any future fallback must bind that row to durable, previously verified checkout evidence; matching £2.50 alone is insufficient. Do not conclude unpaid from the cancelled booking disappearing from upcoming bookings. Do not conclude refunded from cancellation success.

## Next implementation work

1. Add read-only purchase-history reconciliation for dispatched records, including strict normalization of `PT` plus the numeric provisional reference. Require one unique matching paid/confirmed row and exact amount, bound to the saved verified basket/slot and submission marker. Capture a sanitized fixture of the relevant row structure without account identifiers or unrelated purchases.
2. Resolve stale/closed tab IDs safely. Reconciliation should find or open a trusted merchant account page without changing the reference, refilling card fields or replaying Pay. Persist a new tab ID only after validating its origin and purpose.
3. Keep paid transaction state separate from active booking/cancellation/refund state. Record the owner-confirmed cancellation of this test without rewriting historical payment as unpaid. Cancellation must not unlock automatic resubmission of the same paid test.
4. Reconcile the existing live journal before another paid test or scheduled checkout. Do not clear `checkoutRecords`, change its reference after dispatch, or reset `paymentDispatchedAt` just to unblock a job. An armed job observed before this handoff was still unprepared; the unresolved checkout is a blocker, not proof of midnight readiness.
5. Add meaningful fixtures for account reconciliation, prefix handling, stale tabs, cancellation with a paid purchase, ambiguous rows and amount/reference mismatch. Preserve the once-only mutation tests. Then validate receipt reconciliation against the existing paid transaction without charging again.
6. Only after recovery works, verify an authorised midnight job end to end, including awake Chrome, unlocked session, preflight, exact basket, submission and journal confirmation. Do not claim a two-hour paid path or robust unattended operation from the one-hour supervised test.

## Development and safe diagnostics

Run `npm test` in `outputs/tennis-local/chrome-extension`; v0.4.6 has 43 passing tests. Keep field values out of assertion failures and logged browser responses. Test readiness and state transitions, especially commit-before-submit and lost-response recovery. Browser tab IDs are session-specific; UTC timestamps, slot keys and merchant reference binding provide more useful evidence.

Inspection captures, copied full account pages, Chrome profiles/cookies, card files, raw exported journals and authentication values are private working data. Only sanitized observations belong in this repository. Historical Python notes describe a blocked isolated-profile prototype and may contain obsolete booking rules; this README and the active extension source define the current behaviour.
