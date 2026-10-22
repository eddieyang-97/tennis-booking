# Isolated Chromium gate

From the repository root (Node 24.18.0, PowerShell):

```powershell
npm ci --prefix outputs/tennis-local/chrome-extension/test/browser --ignore-scripts
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path $PWD 'artifacts/test-browsers'
node outputs/tennis-local/chrome-extension/test/browser/node_modules/playwright/cli.js install chromium
npm --prefix outputs/tennis-local/chrome-extension run test:ci
```

Playwright 1.62.1 and its lockfile pin Chromium (revision 1234). Installation needs network access; execution uses only a new local test profile and the loopback merchant. A sandbox that denies Chromium loopback access reports `ERR_PROXY_CONNECTION_FAILED`; run the same isolated command with local networking permitted. There is no dependency on normal Chrome, its extension installation, account, encrypted card file or unlocked card session.

`npm run test:browser` runs two proxy boundary tests and fourteen browser scenarios. `test:ci` also runs maintained tests, module reproductions, worker faults, and the production ZIP/source hash check (`test:package`). CI installs dependencies before running that exact complete command, including the network-isolated browser phase. Packaging uses .NET hashing rather than depending on PowerShell module autoload in npm's child environment.

## Coverage and evidence

The v0.9.5 gate also exercises a synthetic selection rejection (HTTP 409 with checkbox reversion): bounded acknowledgement, preserved journal and exactly one selection attempt without checkout or Pay. This does not identify the real merchant's rejection contract.


The synthetic merchant independently owns hourly items, prices, discount, pending/paid purchases and mutation counters. Its HTML represents sanitized observed DOM contracts, not captured private pages. The actual content scripts parse grid/basket/card/account/existing-purchase pages and dispatch selection, discount, opening and removal actions. Scenarios cover:

- Popup arming, immutable policy after saved-setting edits, BST/GMT release dates and rejected invalid settings.
- Controlled alarm callback → account/grid → delayed sequential selection → verified basket → checkout → fake card/Pay. Chromium closes while the Pay response is outstanding; a new process reuses only the test profile and reconciles from account evidence. Another payment command must leave Pay/open/fill counts at one.
- Missing, duplicate, changed-layout and wrong-total account rows; existing-purchase recognition with cancellation explicitly unknown.
- Actual worker termination via CDP while a fake card-fill response is outstanding. The durable marker survives worker recreation; independently enabling the button cannot authorize another fill or Pay.
- Real receipt HTML/content-script messaging through worker reconciliation: processing metadata, conflicting playing date, conflicting single start and unfamiliar layout. All receipts are synthetic.
- Concurrent unpaid-test requests, delayed checkout, discount once, positively verified unpaid cleanup and an account Pending purchase that remains after the basket clears.
- Merchant error after opening: no repeated opening/discount or payment. Unrelated basket: no selection, removal or payment.
- The permanent discount-read scenario advances through five synthetic gross-basket replies while loading, injects one unclassified Chrome-boundary message error, then uses real content scripts to verify the final loopback discount and complete one fake payment. It asserts exactly one discount/open/fill/Pay and bounded sanitized retry evidence. Fake-clock module/worker tests separately exercise expiry during diagnostics, tab reads and successful-response logging; the injected error does not identify the original Chrome exception.
- Denied page, frame and service-worker external requests, plus an unknown route and wrong loopback port that must fail the network gate.

Pass/failure JSON and a failure screenshot go under ignored `artifacts/browser-gate-*/`. Failures include the fake worker's journal/run history and counters. CI retains only these JSON/PNG files for seven days, never browser profiles. Reproduce with the same command; the fast worker-fault layer provides individual mutation-boundary diagnosis.

## Explicit test-only substitutions

`bundle.js` copies the reviewed runtime allowlist into an ignored **LOCAL TEST ONLY** extension. It changes merchant/Stripe origins to the sole loopback server, supplies a synthetic clock and captured alarm callback, replaces card-vault access with a dummy value, and uses a fake card frame that accepts no card information. Real card-field filling and vault cryptography remain covered by their maintained module fixtures, not by this browser flow. The headless driver opens `popup.html` as a tab; only in this copy it removes the `sender.tab` rejection while retaining sender extension-ID and popup-URL checks. Therefore this gate tests popup form/worker integration but does not establish toolbar-popup sender validation. Production retains the full guard.

Alarm callbacks are invoked through the actual registered handler at a controlled date. The test copy captures that handler without registering it for native delivery; otherwise the synthetic dates can trigger duplicate real Chrome alarms. This does not establish real midnight alarm timing, wake-from-sleep behavior or OS crash durability. The process restart is a real Chromium close/relaunch during an outstanding fake Pay response, with post-Pay account evidence held until shutdown so reconciliation cannot finish first. A separate CDP `ServiceWorker.stopWorker` test terminates the extension worker during an outstanding fake card fill, keeping Chromium and its profile open. Neither test is forced power loss.

All browser traffic is forced through a local denying proxy, including worker requests that can miss page interception. Only the exact merchant origin/port is forwarded. Page routing independently denies external page/frame/worker requests. The negative Stripe probe deliberately bypasses that routing layer to verify proxy denial. A fixed five-host list identifies Chromium's own blocked infrastructure probes (updates/sign-in/autofill/search); those requests are never forwarded and are retained in evidence. A page/worker route attempt to those hosts still fails, and every other unexpected external host fails the gate. This is a tested HTTP(S) boundary, not an OS-wide firewall.

Production package checks prohibit loopback/test imports and keep the original merchant/Stripe permissions. `build.ps1` creates the release ZIP from the explicit allowlist and compares every entry hash with tested source. No browser test, fake adapter, test manifest, clock or profile is packaged. Local simulated passes do not establish live Stripe compatibility, challenge handling, an active court reservation or unattended midnight payment.
