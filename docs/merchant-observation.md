# Merchant observation: issue #12 findings

**27 October 2026.** Based on `main` at `a3a65d8` (extension v0.9.6). This is a tooling evaluation and synthetic evidence, **not** an explanation of Courtside's midnight failures or live acceptance. See [issue #12](https://github.com/eddieyang-97/tennis-booking/issues/12).

## Decision

Use ordinary DevTools/CDP network and initiator evidence as the baseline. Keep **REA 6.8.0 as an optional, one-off investigation tool** for structured captures, captured-script export/static analysis and offline HAR inspection. Do not add REA to the extension, production permissions, normal payment profile or mandatory CI dependencies. Its value is organizing evidence, not proving backend commitment or granting recovery authority.

The next merchant-specific step still needs separately authorized observation in a dedicated profile. No new production recovery predicate is justified by this experiment.

## What was actually exercised

The optional [comparison driver](../outputs/tennis-local/chrome-extension/test/browser/rea-investigation.js) uses the existing fake merchant, isolated test-extension bundle and denying proxy. It runs the real `stage-content.js` selection/basket adapters through Chrome messaging. It sends the adapter command directly to compare observations; it does **not** test durable worker orchestration. The permanent browser regression separately exercises the actual `prepareCheckout` worker and journal.

Environment: Windows x64, Playwright 1.62.1 / Chromium revision 1234 (`Chrome/151.0.7922.34`), REA 6.8.0 under a private Node 24.22.1 executable. The repository's Node 24.18.0 and installed extension were not changed. REA's engine requirement excludes that older Node; the CLI was evaluated without global installation, setup or MCP registration.

Each synthetic case sent exactly one selection POST, no discount, checkout opening, card fill, Pay or basket removal. The disposable profile and fixture resets contain only fake data.

| Synthetic case | Direct CDP baseline | REA passive request record | Extension and fake-server evidence |
| --- | --- | --- | --- |
| Delayed accepted selection | Exact POST, `/site.js` initiator, HTTP 200 | Same request/initiator/status | One acknowledgement; exact one-hour basket and one server item |
| Explicit fixture rejection | Exact POST, HTTP 409 | Same request/initiator/status | Checkbox reverts, acknowledgement times out, server/basket empty |
| Server commits, JSON response is truncated | HTTP 200 headers followed by `Network.loadingFailed` | Request/initiator and HTTP 200, incomplete encoded length; its passive request record has no equivalent failure flag | No acknowledgement, checkbox remains checked, but server and fresh basket each contain one item |

These are distinct **synthetic contracts**, not discovered merchant behavior. The third demonstrates why neither a successful status nor a failed response decides mutation outcome. The second does not establish that a real Courtside 409 is terminal rejection.

Additional observed results:

- Exact-origin discovery and passive inspection worked against loopback CDP. A late capture retained `/site.js` source but no historical script-fetch request, with `prior_activity_available:false`.
- Script export accepted the saved **Evidence object**, not the CLI `{ok,data,meta}` wrapper. Static analysis identified the synthetic selection URL expression and a dynamic `form.action` fetch candidate. These are syntax candidates, not executed routes or backend contracts.
- Session observation recorded navigation to `/basket` and lifecycle events. Its `navigation_committed` timestamp was null; lifecycle timestamps used CDP monotonic seconds. Do not invent missing timestamps or compare them directly with extension UTC timestamps.
- Offline inspection accepted an unmodified complete one-record Playwright HAR. The interrupted-request HAR was rejected with `invalid_request`: a `timings.receive` value violated REA's minimum-zero schema constraint. The original was preserved; no timings were replaced, entries removed or successful import claimed. This is a tested producer/importer compatibility gap. Preserve direct-CDP evidence when HAR import fails.
- The fake-server truncation initially hung at the existing test proxy because it did not propagate an upstream abort. The proxy now forwards that abort/error downstream. A focused proxy test and permanent worker/browser scenario cover this fixture boundary. This was a test-infrastructure limitation, not evidence of a Courtside defect.

REA and baseline CDP ran concurrently; this does not quantify observer overhead or establish behavior without a debugger attached. The CLI has no readiness signal used by this driver: it schedules an action within the observation window and **asserts afterward** that both its dispatch time and exact request were captured. Slow startup fails the experiment rather than claiming complete coverage. This optional timing-dependent experiment is not a deterministic CI gate.

## Public merchant evidence and limits

Unauthenticated homepage GETs used for script inspection returned HTTP 200; only Fathom and Stripe were declared as external scripts. Bounded inline-script inspection did not reveal the court-selection handler. A public booking-grid path for 3 November returned **303 to `/verify-human`**; a repeat solely confirmed the redirect destination. The redirect was not followed and no challenge was bypassed. Public source availability differs from access to the booking application.

No authenticated page, normal Chrome profile, installed extension, real basket, discount, checkout journal, card, armed job or merchant mutation was used or changed. Public-page accessibility does not establish whether a signed-in profile will be challenged at midnight. The new rejection/response-loss fixtures must not be described as merchant-derived.

Still unknown:

- Courtside's selection endpoint, request identity, add/toggle/replace semantics, concurrency/version rules and inventory-hold lifetime.
- Whether an unchecked court represents rejection, pending acceptance, DOM replacement, session failure or another cause; quiet-hour versus release-hour protocol/timing differences.
- The raw Chrome exception from the 22 October post-discount incident. Merchant HTTP traffic and worker/content-script message transport are separate boundaries. Navigation evidence alone cannot identify the failing Chrome operation.
- Real discount, checkout navigation, Stripe/frame readiness and human-verification behavior under observation. The experiment made no live claims about these paths.

## Follow-up evidence contract

1. Begin with an isolated profile and read-only pages; establish observer readiness and verify target/origin. Never attach to the normal payment-enabled or armed profile. REA enables the debugger domain; its documentation notes that page `debugger` statements can pause execution and attachment can affect existing emulation.
2. A controlled live selection requires explicit authorization for the exact slot and a cleanup plan first. Capture a minimal window: action/DOM change, request ID/method/path category, initiator, response/failure, navigation/document identity and fresh exact basket. Anchor monotonic and UTC clocks; preserve unknowns and mark incomplete windows.
3. Keep raw captures private. REA retains ordinary URL query values/fragments, and selected script/console text may contain secrets despite header/cookie filtering. Review sanitation before publishing evidence. Do not capture payment fields or attach a debugger to authenticated checkout to fill a gap.
4. Compare quiet and release conditions only where independently authorized. No stress test, broad scraping, extra requests or runtime instrumentation rewrite is proposed.
5. Add a merchant-specific fixture only when evidence supports its semantics. Automatic alternate-court selection after a possibly dispatched attempt still requires exact correlation, verified terminal non-acceptance/no unresolved hold and consistent fresh basket evidence. Missing response, reversion or an empty basket alone remains insufficient.

The initial tool evaluation is delivered; merchant-protocol discovery remains open. Existing dispatch-before-mutation and no-replay/reconciliation-only rules are unchanged. This work does not make the next midnight run live-verified or unblock distribution.

## Validation

The pinned optional experiment passed all three request comparisons, script export/static analysis, navigation observation and complete-HAR inspection; interrupted-HAR rejection is explicitly retained as a limitation. The proxy-abort regression failed against the original proxy after its bounded two-second wait, then passed with abort forwarding. The final local `test:ci` gate passed 174 maintained tests, 136 worker tests, nine named scenarios, fifteen Chromium scenarios and three proxy tests. Exact runtime packaging passed under Windows PowerShell 5.1 and PowerShell 7. These are local/simulated results; GitHub CI and live acceptance are separate evidence.

## Reproduction and private artifacts

The ordinary regression is included in `npm run test:browser`; it requires no REA installation. The optional comparison is Windows x64 in the commands below, run from the repository root:

```powershell
npm ci --prefix outputs/tennis-local/chrome-extension/test/browser --ignore-scripts
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path $PWD 'artifacts/test-browsers'
node outputs/tennis-local/chrome-extension/test/browser/node_modules/playwright/cli.js install chromium
npm install --prefix artifacts/rea-investigation-tools --ignore-scripts --no-audit --no-fund rea-agents@6.8.0 node-win-x64@24.22.1
$env:REA_NODE=(Resolve-Path artifacts/rea-investigation-tools/node_modules/node-win-x64/bin/node.exe).Path
$env:REA_CLI=(Resolve-Path artifacts/rea-investigation-tools/node_modules/rea-agents/scripts/rea.mjs).Path
node outputs/tennis-local/chrome-extension/test/browser/rea-investigation.js
```

On another platform, supply a compatible Node executable through `REA_NODE`. The driver checks the REA package version and allows no merchant endpoint/profile override. Optional captures, exported scripts, synthetic HARs, profiles, analyses and `summary.json` remain in ignored `artifacts/rea-investigation-*`; none is packaged or committed. Changing REA versions requires reassessing schemas and limitations. Production source/permissions/version remain unchanged.

Sources: [REA browser observation](https://github.com/morluto/rea/blob/main/docs/browser-observation.md), [captured-script export](https://github.com/morluto/rea/blob/main/docs/website-script-export.md), [offline captures](https://github.com/morluto/rea/blob/main/docs/web-network-captures.md). Documentation was consulted on 27 October; execution used the pinned npm release rather than an unpinned checkout.
