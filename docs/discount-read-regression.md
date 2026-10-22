# Post-discount loading read regression

This is the focused regression guide for the 22 October 2026 midnight incident. See [payment-system.md](payment-system.md#22-october-release-post-discount-basket-read-failure) for sanitized incident evidence and the limits of the diagnosis. No private export is required to run these tests.

## Permanent deterministic coverage

From `outputs/tennis-local/chrome-extension/`:

```powershell
node --test test-page-read.js
node --experimental-vm-modules --test --test-name-pattern='discount.*(read|hold|recovery)|post-discount' test/worker-faults.js
npm run repro -- --scenario discount-loading-read-error-no-replay
npm test
npm run test:scenarios
```

Before the fix, both `discount observation survives an unclassified loading message failure on the same tab` and `release observes delayed discount after five loading reads and unknown transport failure, without mutation replay` failed on v0.9.5's early `PAGE_TAB_ERROR`. After the fix, the latter reaches fake paid confirmation with exactly two hourly selections, one discount, one opening, one fake fill and one fake Pay. No extra navigation is used to recover the read. Persistent failure holds the journal, reports the original deadline's exhaustion, and performs no opening/fill/Pay. A recreated worker preserves that marker and observes accepted or unapplied merchant state without reapplying.

Other cases reject returned invalid baskets/accounting, authentication or origin/route changes, complete-tab unknown errors, closed/denied/invalidated contexts and late evidence. Diagnostics/storage errors are outside the transport retry catch. Long retry sequences preserve the run's start in bounded history; no raw transport/merchant text enters the trace.

The maintained workflow runs module tests, worker faults, named scenarios and exact package checks on this branch. Production package allowlisting is unchanged; regression fixtures and browser dependencies are excluded.

## Supplementary isolated Chromium coverage

The browser harness is still separate in PR #4 (`b392097`), with the previously staged selection-reversion case also available locally. Do not merge or copy that milestone's runtime changes just to run this regression. Stage its test infrastructure in an ignored workspace, overlay **every current runtime allowlist entry**, and verify each staged file's hash against the branch source. Use its pinned Chromium, disposable profiles and deny-by-default loopback network gate. Normal Chrome, merchant credentials and real payment data are never used.

The new permanent case is [test/browser-discount-read.js](../outputs/tennis-local/chrome-extension/test/browser-discount-read.js). Copy that module into the staged `test/` directory. In the staged `test/browser/run.js`, import:

```js
import {discountReadBrowserCase} from '../browser-discount-read.js';
```

Inside the runner's existing `try` block, before its final settings/network scenarios, call:

```js
await discountReadBrowserCase({fresh,send,currentWorker:()=>worker,merchant,reports});
```

Run the staged `test/browser/run.js` and `node --test test/browser/isolation-test.js` with its documented `PLAYWRIGHT_BROWSERS_PATH`. The case performs preflight and the captured release callback. It injects five old gross-basket replies, a sixth-read exception and loading tab metadata at the Chrome API boundary. Real content scripts then read and verify the final local merchant discount, open checkout and reconcile one fake payment. The simulation asserts mutation counts and safe retry evidence. This is not an actual Chrome-generated unknown error, a merchant load test, or live payment acceptance.

The source case is committed here; the staged runner wiring and dependencies remain ignored. Until the browser milestone is integrated, this supplementary run is **local evidence**, not a browser job in this branch's GitHub Actions. Re-run against the reviewed runtime when integrating PR #4.

## Next-run boundary

A green regression gate makes this fix a candidate for review and an explicitly authorized installation/acceptance run. It does not update an installed extension, clear an existing `discount-dispatched` hold, establish whether the old merchant discount succeeded, or prove unattended booking. The exact original Chrome exception remains unavailable; future logs distinguish message retries from diagnostic-write failures and retain retry counts plus elapsed/remaining time.
