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

The review regressions advance the same fake clock during initial diagnostics, tab-state observation, successful-response logging and navigation. The page deadline starts before awaited setup and is checked after each of these boundaries. `ensureDiscount()` independently checks its own deadline after the entire read returns; late valid evidence cannot save a verified discount or authorize opening/fill/Pay. Boundary tests reject evidence at and beyond expiry while accepting exact evidence just before it. Worker recreations retain the dispatch marker and may observe an already-applied discount under a new explicit recovery invocation, never a repeated discount submission.

The maintained workflow runs module tests, worker faults, named scenarios, isolated Chromium and exact package checks on this branch. Production package allowlisting is unchanged; regression fixtures and browser dependencies are excluded.

## Maintained isolated Chromium coverage

PR #4's browser gate is merged into the current baseline (`c9e5281`). The permanent `test/browser/run.js` imports and invokes [test/browser-discount-read.js](../outputs/tennis-local/chrome-extension/test/browser-discount-read.js). No staging or manual runner modification is needed. Its pinned Chromium, disposable profiles and deny-by-default loopback network gate use no normal Chrome profile, merchant credentials or real payment data.

From the repository root, after installing the pinned test dependency/browser as documented in the [browser guide](../outputs/tennis-local/chrome-extension/test/browser/README.md):

```powershell
npm --prefix outputs/tennis-local/chrome-extension run test:ci
```

The complete command runs the module/worker/named regressions, network-boundary tests, Chromium scenarios and exact package verification. The browser case performs preflight and the captured release callback. It injects five old gross-basket replies, a sixth-read exception and loading tab metadata at the Chrome API boundary. Real content scripts then read and verify the final local merchant discount, open checkout and reconcile one fake payment. The simulation asserts mutation counts and safe retry evidence. This is not an actual Chrome-generated unknown error, a merchant load test, or live payment acceptance.

GitHub Actions' browser job runs this same `test:ci` command against the PR's combined tree. Dependencies, profiles and generated bundles stay ignored and out of production ZIPs. A successful local run is reported separately from the CI result for the final commit.

## Next-run boundary

A green regression gate makes this fix a candidate for review and an explicitly authorized installation/acceptance run. It does not update an installed extension, clear an existing `discount-dispatched` hold, establish whether the old merchant discount succeeded, or prove unattended booking. The exact original Chrome exception remains unavailable; future logs distinguish message retries from diagnostic-write failures and retain retry counts plus elapsed/remaining time.
