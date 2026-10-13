"""Local setup/inspection tool. Does not submit bookings or payments."""
from pathlib import Path
import argparse
import json
import sys
from datetime import date
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
COURTS = "https://tennistowerhamlets.com/courts"

# Read visible control metadata only: no input values, URLs, cookies or HTML.
CONTROLS = r"""() => [...document.querySelectorAll(
  'button,a,input,select,label,[role="button"],[role="gridcell"]')]
  .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
  .filter(e => !e.matches('input[type="password"],input[type="hidden"]'))
  .map(e => ({tag:e.tagName.toLowerCase(), role:e.getAttribute('role'),
    type:e.getAttribute('type'), id:e.id || null,
    label:e.getAttribute('aria-label') || e.getAttribute('placeholder') ||
      (e.matches('input') ? '' : (e.innerText || '').trim().slice(0,180)),
    options:e.matches('select') ? [...e.options].map(o=>o.textContent) : undefined}))"""

def inspect():
    from playwright.sync_api import sync_playwright
    from verification_diagnostics import VerificationDiagnostics
    out = ROOT / "inspection"
    out.mkdir(exist_ok=True)
    print("A separate Chrome profile will open. Sign in yourself.")
    print("Navigate to Bethnal Green Gardens using Book courts.")
    print("This tool does not click controls or book anything.")
    print("If verification fails, stop; this tool cannot bypass it.")
    print("Commands: courts = export court controls; bookings = export booking controls;")
    print("          status = read-only verification diagnostic report (no refresh);")
    print("          quit = close and save your local Chrome session.")
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(ROOT / "chrome-profile"), channel="chrome", headless=False,
            chromium_sandbox=True, viewport={"width":1280,"height":900})
        diagnostics = VerificationDiagnostics(context)
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(COURTS, wait_until="domcontentloaded")
            while True:
                command = input("\nCommand (courts/bookings/status/quit): ").strip().lower()
                if command == "quit":
                    break
                if command not in {"courts", "bookings", "status"}:
                    continue
                # Yield to Playwright after blocking console input so manual
                # navigation events update its cached tab addresses. No refresh.
                open_pages = [x for x in context.pages if not x.is_closed()]
                if open_pages:
                    open_pages[0].wait_for_timeout(100)
                # Use most recently opened site tab. No reading other websites.
                candidates = [x for x in context.pages if
                              urlsplit(x.url).hostname == "tennistowerhamlets.com"]
                if not candidates:
                    print("Open the Tower Hamlets site first.")
                    continue
                page = candidates[-1]
                if command == 'status':
                    verification_pages = [x for x in candidates if
                        urlsplit(x.url).scheme == 'https' and
                        urlsplit(x.url).path == '/verify-human']
                    if len(verification_pages) > 1:
                        print('More than one verification tab is open. Close the extra verification tabs and type status again.')
                        continue
                    if len(verification_pages) == 1:
                        page = verification_pages[0]
                    try:
                        report = diagnostics.report(page)
                    except ValueError as exc:
                        print(str(exc))
                        continue
                    dest = out / 'verification-status.json'
                    dest.write_text(json.dumps(report,indent=2),encoding='utf-8')
                    print(json.dumps(report,indent=2))
                    print('Saved',dest)
                    continue
                if any(x in urlsplit(page.url).path.lower() for x in
                       ("verify-human", "login", "sign-in", "checkout", "payment")):
                    print("Do not export verification, login or payment pages.")
                    continue
                answer = input("Is the browser showing the correct page (y/n)? ")
                if answer.lower() != "y":
                    continue
                report = {"page_kind":command,"controls":page.evaluate(CONTROLS)}
                dest = out / (command + "-controls.json")
                dest.write_text(json.dumps(report, indent=2), encoding="utf-8")
                print("Saved", dest)
                print("Review this file before sharing; labels may contain personal details.")
                print("No screenshot, credentials, input values or browser session exported.")
        finally:
            context.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["inspect", "dry-run", "release-dry-run", "scheduled"])
    parser.add_argument("--date", type=date.fromisoformat, help="Playing date YYYY-MM-DD for read-only dry run")
    parser.add_argument('--stage-basket',action='store_true',help='Test a one-hour candidate through basket, then remove it; never pay')
    args = parser.parse_args()
    if args.mode == "scheduled":
        print("Booking adapter has not been implemented or validated. No action taken.")
        return 2
    if args.mode in {'dry-run', 'release-dry-run'}:
        from playwright.sync_api import sync_playwright
        from booking_rules import released_date, LONDON, next_release, wait_for_release
        from datetime import datetime
        from site_adapter import dry_run, check_upcoming, stage_basket
        config = json.loads((ROOT / 'preferences.json').read_text(encoding='utf-8'))
        now = datetime.now(LONDON)
        target = None
        if args.mode == 'release-dry-run':
            if args.date or now.hour != 23 or now.minute < 55:
                raise ValueError('Release dry run must start at 23:55-23:59 London without --date')
            target = next_release(now)
        day = args.date or released_date(target or now)
        if day.strftime('%A') not in config['playing_weekdays']:
            print('Newly released playing date is outside Monday-Thursday. No action taken.')
            return 0
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                str(ROOT / 'chrome-profile'), channel='chrome', headless=False,
                chromium_sandbox=True, viewport={'width':1280,'height':900})
            try:
                page = context.pages[0] if context.pages else context.new_page()
                if target:
                    if not check_upcoming(page,day):
                        print('Existing booking in playing week. Skipped.')
                        return 0
                    print('Authenticated preflight passed. Waiting for London midnight; no payment will be submitted.')
                    wait_for_release(target)
                result = dry_run(page, day, config)
                if args.stage_basket and result.get('candidates'):
                    one_hour = next((x for x in result['candidates'] if x['hours'] == 1),None)
                    if one_hour:
                        result = stage_basket(page,day,config,one_hour)
                print(json.dumps(result, indent=2))
            finally:
                context.close()
    else:
        inspect()
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Stopped.")
        sys.exit(130)
    except Exception as exc:
        print(f"Setup failed ({type(exc).__name__}): {exc}", file=sys.stderr)
        sys.exit(1)
