# Extension settings required before full release

Each explicitly armed job must contain a validated, immutable snapshot of its booking settings. Current MVP source still has fixed evening venue/time/duration/price rules. The controls below are release requirements, not implemented capabilities.

| Setting | Required behavior |
| --- | --- |
| Location | Select supported venues and rank them; allow either court for each hour. Show supported venue names rather than an unrestricted website URL. |
| Time range | Earliest start and latest finish in London local time. Every selected hour must fit inside the range; reject reversed/empty ranges and initially reject overnight ranges. |
| Hours | Desired duration and explicit minimum acceptable duration, such as prefer two hours but accept one. Show whether switching courts between hours is allowed. |
| Maximum payment | Explicit total GBP cap for this job, with separate caps for shorter-duration fallback if enabled. Reject invalid/nonpositive monetary input and compare integer pence. A payment can never exceed the saved authorization. |
| Optional discount code | Blank keeps the standard flow. Nonblank is saved with this job and applied only to its verified basket. Never hardcode an owner's code or include it in public fixtures/logs. |

## Validation must reach every layer

Availability filtering, pre-selection checks, partial-hour fallback, basket identity, gross versus discounted amount, checkout opening, payment submission, receipt recovery and duplicate guards must all use the same saved job/checkout policy. UI fields alone are insufficient. Changes after arming require explicit re-arming; changes while a checkout is pending cannot widen its authorization. Legacy jobs and journals must retain the policy under which they were created. Changing a price preference must not change a prior payment's amount/key.

## Discount acceptance criteria

Inspect the real merchant controls before implementing the adapter. Match their exact field/form and submit once; a lost submission response must be reconciled from the resulting basket, not replayed. Validate every original item, subtotal, explicit discount and net total independently. Never weaken item identity or allow arbitrary cheaper totals. Preserve the gross slot price and exact net payable amount separately in the journal. Payment identity and paid-receipt checks must use the net amount. Tests must cover an invalid/expired code, an already applied code, delayed responses, changed items, extra items, zero-cost totals (separate non-card flow), changed discount after opening, one-hour fallback and reload/recovery. A supplied but unverified discount must stop before payment rather than silently imply it was applied. An empty code must continue to work as before.

## Release gate

Require an observed unattended midnight booking through paid receipt verification, plus regression tests for configurable settings and a safe unpaid discount test. The existing success with manual payment does not establish unattended checkout success. Preserve developer findings in payment-system.md. Do not include card files, owner codes, access codes or raw private state in public release artifacts.
