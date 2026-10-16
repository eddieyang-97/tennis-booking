# Legacy Python tennis prototype — not the active booking extension

**Status: retired / blocked. Do not use this directory to run scheduled bookings or payments.**

This directory contains an **earlier Windows/Python/Playwright inspection prototype** (including `tennis.py`, `site_adapter.py`, `setup.cmd` and `install-schedule.ps1`). It used a separate Chrome profile, repeatedly encountered site human verification, and **never became the supported automatic booking/payment runner**. Its sample preferences, historical validation status, scheduled-task installer and setup commands are **not current product instructions**.

**Use the active Chrome Manifest V3 extension instead:**

- [Project overview and current booking policy](../../README.md)
- [Chrome extension installation, payment readiness, testing and recovery](chrome-extension/README.md)
- [Historical releases and evidence](../../docs/release-notes.md)
- [Merchant/payment findings](../../docs/payment-system.md)

## Safety boundary

- Do **not** run `setup.cmd`, `dry-run.cmd`, `install-schedule.ps1` or other files here as a workaround for the current extension.
- Do **not** manually toggle `adapter_verified` or install the legacy Windows scheduled task; the old site adapter and acceptance checks are not supported.
- Do **not** move an authenticated Chrome profile, session cookies, card files or personal diagnostics between the Python prototype and the extension.
- Retain these files only as **historical source/inspection experiments**. Earlier instructions and exact historical setup details remain accessible through Git history if needed for investigation.

For a new user or a friend beta, follow [docs/distribution-flow.md](../../docs/distribution-flow.md), **not** these legacy scripts.
