# Agent instructions

## Scope and source of truth

- This file applies to the whole repository. The active product is the Chrome Manifest V3 extension under `outputs/tennis-local/chrome-extension/`; the Python files under `outputs/tennis-local/` are an inactive, blocked prototype. Do not revive or deploy them as the booking runner.
- Read [README.md](README.md) for current architecture and booking policy, [the extension usage guide](outputs/tennis-local/chrome-extension/README.md) for operating/recovery controls, and [docs/payment-system.md](docs/payment-system.md) before changing checkout, payment, or reconciliation.
- [docs/test-improvement.md](docs/test-improvement.md) is the roadmap for deterministic regression testing. [docs/distribution-flow.md](docs/distribution-flow.md) documents the gated friend beta and later Chrome Web Store options, **not** an authorization to ship a payment-enabled build now. [docs/release-notes.md](docs/release-notes.md) is historical release evidence, not the current specification. Check the current source and `manifest.json` rather than relying on old release descriptions.

## Non-negotiable safety invariants

- Persist durable intent **before** any externally visible mutation. In particular, `paymentDispatchedAt` must be written before Pay is clicked. A dispatched, manually reported, or uncertain payment is **reconciliation-only**: never click Pay again or delete its hold to make progress.
- A lost acknowledgement is **not** proof an action failed. Never blindly replay court selection, discount application, checkout opening, basket removal, card filling, or payment. Observe and reconcile the exact site state first; if evidence is insufficient, stop safely.
- Preserve `checkoutRecords`, `paymentDispatchedAt`, `manualPaymentReportedAt`, provisional references and prior-reference history across failures, restarts and migrations. Do not reset, rewrite, or fabricate journal fields to unblock a run.
- Verify the **saved, immutable authorization** through every layer: venue, playing date, hour-by-hour court identity, duration, authorized price cap, gross basket amount, discount and net payable amount. An extra/unrelated item, ambiguous identity, unexpected route, or changed price must stop automatic checkout.
- Missing/ambiguous evidence means **unknown**, not unpaid or unavailable. A confirmed merchant purchase proves payment, **not** an active reservation or refund. Keep payment, booking, cancellation and refund states separate.
- Read-only navigation/reconciliation may use bounded, explicitly scoped retries. Do not extend that retry policy to mutation messages. Never bypass merchant human-verification challenges or bank authentication.

## Live-site and payment boundaries

- Repository tasks do **not** authorize live-site mutations. Do not book a real court, add/remove live basket items, apply a real discount, submit a charge, or arm a live paid job unless the user explicitly authorizes that specific action.
- Prefer isolated fixtures, a local fake merchant, and simulated payments. Do not use real cards or merchant credentials in automated tests or CI. An unpaid live acceptance test still mutates a basket and requires explicit authorization and a cleanup plan.
- Chrome service-worker restarts, closed tabs, delayed DOM updates and lost responses are expected failure modes; preserve the state necessary for safe recovery.

## Implementation workflow

1. Before editing behavior, inspect the active module, callers, durable state transitions and existing tests. Identify the safety invariant and how the change could violate it.
2. For a bug, first add an offline regression scenario reproducing the observed failure when feasible. Use sanitized evidence and realistic merchant behavior; do not invent a site root cause when logs only support a hypothesis.
3. Prefer small changes to the existing modules and explicit recovery predicates. Avoid a new backend, broad state-machine rewrite, or extra mutation retries without demonstrated need.
4. Add tests for the happy path, changed/ambiguous observations, lost acknowledgement, interruption before/after persistence, and restart with the same durable storage where relevant. Assert **mutation counts**, not only returned status.
5. Run focused local checks when useful. GitHub Actions' [Reliability gate](.github/workflows/reliability.yml) is the authoritative shared automated gate: the `deterministic` job runs maintained Node tests, named/worker regressions and both PowerShell package checks; the `browser` job runs isolated Chromium and network-denial tests without repeating those checks. For a PR, verify both jobs passed on the latest head commit; do not rerun the same full suite locally solely to claim completion. Use `npm test`, `npm run test:scenarios`, or `npm run test:browser` for focused debugging, and `npm run test:ci` for an optional full local gate. Report what actually ran and passed or could not run. Simulated passes must never be described as real-site or unattended-midnight acceptance.
6. When packaging changes are needed, inspect [build.ps1](build.ps1) and update its explicit runtime allowlist deliberately; ensure test sources and private data stay out of release ZIPs.

## Privacy and documentation

- Never commit or display card numbers, CVCs, passphrases, encrypted card files, cookies, access tokens, private browser profiles, full account pages, or raw owner diagnostic exports. Redact fixture data and logs; booking references can also be sensitive.
- Preserve sanitized diagnostics that distinguish expected versus observed state, stage, mutation dispatch/acknowledgement, error category and the permitted recovery action. Do not log secret inputs or raw payment-page contents.
- Keep the root README focused on current project facts and settings; the extension README on current usage/recovery; version history in `docs/release-notes.md`; merchant/payment technical contracts in `docs/payment-system.md`; test architecture and regression requirements in `docs/test-improvement.md`; and distribution gates in `docs/distribution-flow.md`.
- Update the relevant documentation when behavior or acceptance evidence changes. Distinguish **implemented**, **simulated/tested**, **verified live**, and **still unverified**; do not copy forward stale test counts or release claims.

## Completion checklist

- Safety invariants preserved; uncertain mutations cannot be repeated automatically.
- Regression coverage added or a clear limitation explained.
- Relevant tests executed and results reported accurately.
- No live mutation performed without explicit authorization.
- No secrets/private logs committed; documentation and runtime packaging updated if needed.
