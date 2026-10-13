# v0.5.0 MVP — 13 October 2026

This release completes the minimum source path: scheduled availability → exact basket → direct local-card fill → one journalled Pay dispatch → merchant paid-evidence reconciliation. It does not promise that Cloudflare or the bank will never request intervention.

## Shipped

- Account purchase fallback binds the unique Confirmed / Paid ✔ row to the exact numeric dispatched reference (normalising PT) and exact amount.
- Stale or closed checkout tabs do not block recovery. Existing bank/challenge tabs are not navigated away from.
- Dispatched journal recovery works after the booking window expires and without unlocking the card. Legacy journals with a valid dispatch timestamp remain supported; journals without durable dispatch evidence stop for manual inspection.
- New checkouts persist the basket-verification time. Reference replacement and duplicate payment remain prohibited after dispatch.
- Arming and both scheduled phases reconcile an older pending charge first. Unresolved pre-submission baskets remain blocked.
- Successful paid test records cannot be submitted again, including after manual cancellation.
- Paid and stopped runs produce notifications. Purchase confirmation reports active booking state as unknown; it does not infer cancellation/refund or an active booking from payment alone.
- A runtime build script checks its file allowlist; fixtures and private data are excluded.

## Validation and live acceptance

50 tests pass. Coverage includes the full two-hour simulated selection/payment/journal flow, actual worker recovery with a closed checkout tab and locked card, account ambiguity/mismatch/unpaid rejection, historical recovery, sticky submission markers and existing form/grid contracts. The current account parser source also recognised the actual £2.50 paid transaction on the live merchant account DOM, without changing the site or charging again.

The owner must reload the installed unpacked extension before the new code can run. Chrome internal extension controls were unavailable to browser automation in this session. After reload, **Verify paid receipt** reconciles the existing transaction without card access; its expected result is `status:confirmed`, `paid:true`, `receiptSource:account-purchase`, `bookingState:unknown`, `booked:null`. The test remains manually cancelled; no refund was verified.

Then unlock the local card, confirm the popup shows unlocked, and arm the playing date. Reloading again clears the card session. Keep Chrome open and the laptop awake. The real midnight release and two-hour live payment have not yet been observed, so this is an MVP release candidate pending those acceptance checks, not a claim of guaranteed unattended operation.

## Enhancements after MVP acceptance

1. Read active booking/cancellation state from a narrowly scoped, verified account DOM adapter; keep refund state independent.
2. Show a compact readiness panel (version, card lock, preflight, release time, pending recovery) instead of requiring users to inspect exported JSON.
3. Add explicit bank-challenge detection with a retained tab and actionable notification, without bypassing authentication.
4. Make historical test controls developer-only and add a reviewed test-slot configuration rather than hardcoded dates.
5. Improve release diagnostics and packaging automation. Continue treating uncertain mutations as receipt-only recovery.

These are follow-on enhancements. None is needed to repeat the already-confirmed charge, and no new live payment was made for this release.
