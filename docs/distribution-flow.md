# Distribution flow

**Status:** Planned — do not begin Phase 1 until automatic booking passes the acceptance gate below.  
**Initial audience:** One trusted friend, not the general public.  
**Active product:** The Chrome Manifest V3 extension in [`outputs/tennis-local/chrome-extension/`](../outputs/tennis-local/chrome-extension/).  
**Decision (16 October 2026):** **Build Phase 1 as soon as automatic booking is fully proven working.** Do not start a parallel public-launch or hosting project now.

## 1. Decision and release gate

A working developer build is not the same as proven unattended booking. The extension's October 2026 record includes successful real card payment/reconciliation and live two-hour basket selection, but **not a verified unattended release-to-paid-booking completion**. Historical evidence is in [release notes](release-notes.md); the required offline confidence work is in [test-improvement.md](test-improvement.md).

**Phase 1 is blocked until all of the following are documented:**

- [ ] The actual unpacked extension starts its scheduled run at the intended London midnight release without a manual trigger, reads an eligible slot, selects the intended hour(s), and verifies the exact basket.
- [ ] The extension independently opens checkout, validates the saved payment authorization, submits Pay **once**, and matches a **paid** merchant receipt or account-purchase entry. No owner interaction is needed for the successful path beyond the advance sign-in, card unlock, and arming.
- [ ] The active reservation is checked separately from the paid transaction. The run must not claim a booking based solely on `paid:true` or on an empty basket.
- [ ] The latest regression suite runs clean, and the known October failure modes have documented deterministic coverage (especially lost acknowledgements, worker restart, checkout opening, ambiguous payment, and safe recovery). Record actual commands/results rather than relying on old test counts.
- [ ] The end-to-end evidence is recorded in [release notes](release-notes.md), including installed version, exact supported flow, observed receipt and active-booking evidence, and remaining limitations. Keep private IDs/logs out of Git.

This gate calls for **at least one complete, genuinely unattended paid live acceptance run** with independent verification plus the applicable offline reliability gate. A single success establishes feasibility, not statistical reliability: continue monitoring and keep Phase 1 explicitly labelled a controlled beta. No need to wait for a public release.

**Security condition before handing a payment-enabled build to another person:** Review and address the current local encrypted card file's retention of **CVC**. Encryption does not itself make retaining a verification code compliant with applicable payment rules. Get an appropriate payments/privacy review and redesign card handling if necessary (for example, provider-approved tokenization or user-mediated payment), even if that changes the unattended-payment requirement. Do not ask a friend to supply their card/CVC until this is resolved. See [PCI SSC guidance on stored verification codes](https://www.pcisecuritystandards.org/faqs/1280/).

## 2. Distribution options

| Route | How a user installs it | Review | Updates | Use |
| --- | --- | --- | --- | --- |
| **Local ZIP / unpacked extension** | Extract ZIP → `chrome://extensions` → Developer mode → Load unpacked | No Chrome Web Store review | Manual file replacement and reload | **Phase 1: one trusted friend** |
| **Chrome Web Store — Private** | Approved trusted testers / permitted Google accounts install from the Store | Store review | Store-managed | Phase 2 when access control matters |
| **Chrome Web Store — Unlisted** | Anyone with the direct Store link can install | Store review | Store-managed | Phase 2 when simple sharing matters more than access control |
| **Chrome Web Store — Public** | Searchable listing, ordinary installation | Store review | Store-managed | Optional Phase 3 |

**Unlisted does not mean permission-restricted.** Google's distribution rules apply the same review/policy requirements to all three Store visibility settings. Public publishing is **not** needed for the first friend. Refer to [Chrome's distribution guide](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/) before selecting a Store route.

## 3. Phase 1 — direct ZIP for one friend

**Trigger:** Begin implementation immediately after `1's acceptance gate is satisfied. **Current state:** Not started / blocked on the gate and payment-security review.

### Already available

- [`build.ps1`](../build.ps1) assembles a ZIP from an explicit runtime allowlist, verifies its entries, and prints its SHA-256 hash.
- The source [`manifest.json`](../outputs/tennis-local/chrome-extension/manifest.json) defines the extension version and limits host access to Courtside and Stripe.
- The [extension usage guide](../outputs/tennis-local/chrome-extension/README.md) documents account sign-in, local setup, scheduling and guarded recovery.
- No backend or shared account infrastructure is needed. Each Chrome profile has its own `chrome.storage.local` journals/preferences and session-scoped unlock state; account and payment credentials must be provided independently by each user.

### Build and handoff

1. Tag the exact tested source revision. Do not ship an untested follow-up patch under an unchanged version; confirm `manifest.json` version and package contents.
2. Run the full applicable regression/release gate, then from the repository root (PowerShell):
   ~~~powershell
   powershell -ExecutionPolicy Bypass -File .\build.ps1
   ~~~
3. Confirm that `artifacts/tennis-booking-v<version>.zip` contains `manifest.json` **at the archive root**, not nested in an extra directory, and contains only allowlisted runtime files. Keep tests, full browser profiles, logs, vault files and secrets out of it.
4. Keep an internal record of version, Git commit, SHA-256, tests executed and explicit known issues. Deliver only the reviewed ZIP and a short installation guide to the friend over a trusted channel. The ZIP is **not** an auto-installing CRX.
5. Keep the beta distribution limited to that friend; do not silently turn a locally verified build into a broadly advertised payment tool.

### Friend installation and onboarding

1. Download and **extract** the ZIP to a persistent folder containing `manifest.json` directly.
2. In normal Chrome, sign in to their **own** Courtside account. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
3. Pin the extension, check the version and readiness panel, choose their own playing date and booking limits. Demonstrate read-only availability and recovery first.
4. **Only after the payment-security condition is resolved**, complete any payment setup through the approved design. Do not send a card file or passphrase created by another user.
5. Explain what arming does, that Chrome must stay open and the laptop awake, that a lost payment response must not trigger another Pay attempt, and how to use **Verify paid receipt** / guarded recovery.
6. Agree on a way to report failures using a **sanitized diagnostic export**. Booking references and times can still be personal; review before sending. Do not send `Show diagnostic JSON` raw output or card vault files.

### Manual updates and recoverability

- Send an explicitly versioned replacement ZIP. The friend extracts the new runtime contents **into the same existing unpacked extension directory** (after keeping a safe copy), then clicks **Reload** at `chrome://extensions` and refreshes Courtside tabs.
- Keep the same installed unpacked extension identity/profile where possible. Removing and reinstalling as a different extension can orphan existing browser storage and unresolved journals. **Do not delete or migrate checkout records casually** to make an update install.
- Reloading clears the locally unlocked card session: if applicable, unlock only **after the final reload**.
- Keep old versions available for debugging; distribute a fix only after testing it with realistic stored journals and recovery states.
- No automatic update checks, hosted update service or CRX self-installation are needed for Phase 1.

### Phase 1 deliverables and exit criteria

- [ ] Reviewed ZIP build and reproducible release/checksum instructions.
- [ ] One-page friend quick start, including safe recovery and diagnostic sharing.
- [ ] Versioned manual-update procedure preserving existing storage and payment holds.
- [ ] Friend beta completed with **their own account**, without sharing credentials or private checkout history.
- [ ] Any observed regressions captured as sanitized, deterministic offline scenarios before another release.
- [ ] User-facing payment/security controls reviewed and any outstanding concerns resolved before a payment-enabled handoff.

**Scope discipline:** No hosted backend, new account system, automated updater, general-purpose installer, or Web Store work is necessary for this phase.

## 4. Phase 2 — Chrome Web Store beta (defer)

**Trigger:** Phase 1 shows that a friend can reliably install, operate and recover without continuous developer assistance. Choose either:

- **Private:** explicit trusted-tester accounts/approved Google Groups, for genuinely restricted access.
- **Unlisted:** ordinary Store link and automatic updates, but any holder of the link may install.

Preparation:
- Register and verify a Chrome Web Store developer account; prepare listing description, screenshots, appropriate icons/metadata, contact/support information, privacy disclosures and a support path.
- Review requested permissions, remote-code restrictions, merchant automation rules, card/payment handling and user-data policy. Describe actual behaviors accurately; do not claim a guarantee of booking or payment.
- Upload a reviewed ZIP with the manifest at its root; submit for Chrome Web Store review. Increase the manifest version for subsequent submissions; approved updates are distributed by the Store.
- Define a versioned migration strategy for pending journals and an incident/recovery support process before inviting more people.

**Store review is required even for private/unlisted listings.** See [prepare your extension](https://developer.chrome.com/docs/webstore/prepare) and [distribution visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/).

## 5. Phase 3 — public launch (optional, not committed)

Proceed only if there is genuine demand and after:
- Stable unattended booking and incident recovery have held up across real users and releases.
- Privacy, payment-storage, platform and merchant-authorization questions have been resolved for general distribution.
- Support, documentation, responsible update/rollback processes, and monitoring are sustainable.
- The Web Store listing and permissions clearly reflect the product.

**Do not broaden distribution simply because Phase 1 proved an individual happy path.**

## 6. Relationship to testing and source control

Distribution must consume **the same audited build that passed tests**, not a custom zip manually assembled after acceptance. The next implementation focus remains [testing reliability](test-improvement.md) and an independently verified unattended live checkout, **not packaging automation before the release gate**.

Later, if Phase 1 creates meaningful repeated packaging work, consider a `.github/workflows/release.yml` to run tests, verify the allowlist and attach a ZIP/checksum to a versioned release. This is optional and does not replace Chrome Web Store review for Phase 2.

Keep current behavior in the [root README](../README.md), operating instructions in the [extension README](../outputs/tennis-local/chrome-extension/README.md), evidence in [release notes](release-notes.md), and payment-specific findings in [payment-system.md](payment-system.md). This document owns **distribution decisions and gates only**.
