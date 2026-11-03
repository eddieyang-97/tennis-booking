# Developer releases and local updates

This is the development update route for the existing unpacked extension. It does not establish unattended live-booking acceptance or open the friend/public distribution gate.

## After a merge

1. The main Reliability gate tests the exact main commit: maintained Node tests, worker/scenario tests, isolated Chromium, and runtime ZIP verification under PowerShell 7 and Windows PowerShell 5.1.
2. Once **both jobs pass**, a separate job downloads that tested artifact and publishes a **development prerelease**, tagged `dev-v<version>-<commit first 12 characters>`. PR runs cannot publish. A superseded main run retains its CI artifact but does not publish a release. No live booking or payment is performed.
3. Assets are `tennis-booking-v<version>.zip`, `release.json` (source commit, archive and per-file hashes), and `checksums.txt`. Only allowlisted runtime files enter the ZIP. Tests, updater scripts, browser profiles, logs, card files and credentials do not.
4. The publisher uploads into a draft, verifies the complete asset set, then publishes. It can resume its own incomplete draft; it never replaces published assets. A rerun producing different ZIP bytes stops for inspection instead of overwriting evidence.

Until the workflow is merged and succeeds on main, this is implemented/tested delivery code, **not an observed published release**. Repository Actions permissions must permit this job's `contents: write`; a denied permission fails visibly and needs repository-owner configuration.

## Update a repository-backed install

If Chrome loaded `outputs/tennis-local/chrome-extension/` directly from a checkout, Git supplies the runtime files. Before the first update, finish active work, cancel any armed job and close Chrome normally. In that checkout, review `git status --short` and preserve any local edits. From a clean `main` branch, run:

```powershell
git pull --ff-only origin main
```

Reopen Chrome in the same profile with the existing unpacked extension path. If needed, click **Reload** for that extension at `chrome://extensions`. Check the popup version, refresh the Courtside tabs and unlock the card. Keeping the path and profile preserves preferences and payment journals. This is also the first upgrade path from v0.9.11 to v0.9.12. Pulling already updates the runtime, so the ZIP updater's same-version refusal is expected for this layout.

## Update a standalone install

Use Windows PowerShell 5.1 or PowerShell 7. Run from a current repository checkout containing `update-extension.ps1` and `scripts/Release.psm1`. Point it at the standalone folder Chrome already loads:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\update-extension.ps1 -InstallDirectory 'C:\path\to\existing\chrome-extension' -OpenChrome
```

`-InstallDirectory` is the **same standalone folder containing `manifest.json` that is already loaded in Chrome**. Keep that path and Chrome profile.

An older folder without `installed-release.json` has no baseline for checking edits. The default command refuses it before replacing any files. For a first upgrade to a newer version, review and preserve your edits, then append `-AdoptUntracked` to the command to authorize replacing those runtime files. The updater backs up the original bytes and records the new provenance. Later updates verify the recorded file hashes even if the adoption switch is supplied. Same-version replacement without provenance is refused even with the switch.

Before applying: cancel any scheduled run, let active work finish, close Chrome normally (including background processes), and keep the computer away from a release deadline. The updater never closes Chrome for you and refuses writes while any Chrome process runs. It cannot inspect booking state in a closed browser, and is not an unattended update daemon. Do not launch Chrome until it completes. `-OpenChrome` reopens Chrome after verified installation, which loads the new files without a separate extension-manager reload.

Then check the popup version, refresh relevant Courtside tabs, **unlock the card**, and arm your chosen date again. Persistent journals/preferences remain in the same Chrome profile. A browser restart or reload locks the session card; updates do not make an old job ready to pay.

Useful options:

```powershell
# Safe to run while Chrome is open: download and verify, no installation.
powershell -NoProfile -ExecutionPolicy Bypass -File .\update-extension.ps1 -InstallDirectory 'C:\path\to\existing\chrome-extension' -DownloadOnly

# Select an exact tested prerelease instead of automatic main-ancestry selection.
powershell -NoProfile -ExecutionPolicy Bypass -File .\update-extension.ps1 -InstallDirectory 'C:\path\to\existing\chrome-extension' -Tag 'dev-v0.9.12-0123456789ab'
```

The example tag is illustrative. Select a real published tag. Default selection uses recent main commit ancestry. If no release matches the bounded recent history, it stops and asks for an exact tag. With saved installed provenance, the candidate must be the same commit or a descendant. Numeric version downgrades, tracked local file edits, ambiguous release identity, new permissions/site access, unsafe/duplicate archive entries, symlinks and hash mismatches stop installation.

The updater downloads public GitHub assets over HTTPS and verifies their commit/tag identity and SHA-256 content. Checksums protect transfer/content consistency; they are **not independent signing or protection from a compromised repository/CI**. No GitHub token or merchant credentials are needed locally. It does not read browser profiles or Chrome storage.

## Backup and recovery

Downloads, staging and backups live under `%LOCALAPPDATA%\TennisBooking\updates` by default (`-WorkDirectory` overrides). Replaced runtime files and any previous install provenance are backed up. Copy failures restore the prior files and remove only exact new files created by that attempt. Keep Chrome closed if rollback reports an error; inspect the reported backup before restarting. Unknown files are never enumerated for deletion, and older runtime files omitted from a newer allowlist are left in place.

The extension directory receives `installed-release.json` with public build provenance. It contains no payment/account information. Never delete Chrome storage or payment holds to recover an update. Do not automatically downgrade a journal to match older runtime code.

## Programmatic Chrome reload

Chrome's supported `chrome.runtime.reload()` API reloads this extension; desktop UI automation is unnecessary. In an installed v0.9.12+ build use **Advanced diagnostics and recovery → Developer tools → Reload updated extension**, keeping Chrome Developer mode enabled. The action is serialized with booking work, refuses any armed/running/interrupted job, clears only the unlocked session card, finishes its action status before reload, and preserves durable financial journals. Reopen the popup afterward to check version and unlock.

This button reloads files **already present locally**; it does not download a release. Older versions do not gain the button until updated. The local updater uses close/update/reopen because copying multiple runtime files into a running extension could mix versions during a booking. There is no remote-debugging port, native host, new extension permission, forced browser shutdown or automatic reload while armed.
