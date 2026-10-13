# Bethnal Green tennis: Windows local setup

13 October update: the current normal-Chrome extension is v0.4.6 in chrome-extension/. The £2.50 direct-card payment was confirmed in merchant purchase history, and the owner manually cancelled the test booking. Automatic receipt recognition and midnight completion remain unverified. See the [developer README](../../README.md), [payment findings](../../docs/payment-system.md) and chrome-extension/README.md. Runtime ZIPs are local build artifacts and are not committed. The Python runner below is a separate blocked prototype; the remaining historical notes are not the current extension specification.

Historical 12 October update: a standalone normal-Chrome read-only extension prototype is
available in chrome-extension/. See chrome-extension/README.md for setup.
It requires manual load-unpacked and live validation; it never books or pays.
The Python runner below still uses the separate profile and remains blocked.

STATUS: setup and inspection only. The site booking adapter has NOT been
implemented for payment and confirmation. A supervised one-hour basket test passed; the separate local profile and full runner remain unverified. See PROGRESS.md for current details.
No booking, payment or scheduled task will be performed by this package.
The scheduled mode and schedule installer are blocked until the implementation
is finished and tested. Do not enable adapter_verified manually.

## First run

1. Extract this ZIP into a permanent folder, e.g. Documents\TennisBooking.
2. Install Python 3.11 or newer from https://www.python.org/downloads/windows/
   if needed, with the Python launcher. Google Chrome must be installed.
3. Double-click setup.cmd. It installs Playwright into a local virtual environment
   and opens installed Chrome with a separate, persistent profile. It does not
   access your everyday Chrome profile. You sign in manually on the site.
4. Navigate to Bethnal Green Gardens through Book courts. If verification still
   fails, stop and tell me; no bypass is included.
5. On the court grid, return to the console and enter courts, then y.
6. Navigate manually to your upcoming bookings, then enter bookings and y.
7. Enter quit to save and close the local browser session.
8. Review inspection\courts-controls.json and inspection\bookings-controls.json.
   Share those reviewed files and screenshots of the court grid and booking-list
   layout with account details covered. Do not share chrome-profile, login data,
   payment pages or the whole folder. Input values, cookies and page HTML are
   deliberately excluded from the control reports, but labels can contain names.

## Your intended booking rules

- Bethnal Green Gardens, playing Monday-Thursday.
- Start at 20:00 or 21:00, for 1-2 hours. Proposed duration preference: 2h then 1h.
- Other bookings in the playing week do not block a new booking.
- Exact-slot submission records block repeat attempts, including uncertain outcomes.
- Victoria Park is a fallback only if it offers an eligible evening slot; currently
  it has no floodlights and evening slots are closed. The existing adapter still
  only inspects Bethnal Green Gardens.
- Standard court price. Confirm the actual price before enabling payment.
- Run at midnight London time. Slots release exactly seven days before the playing date.

## What remains to implement and test

Read the full upcoming booking list, including pagination and cancelled status;
determine the release date; select an available allowed slot; check the basket
and exact price; recheck existing bookings immediately before submission;
identify a confirmed booking, not just a basket; prevent repeat submission if
a payment or confirmation times out; and alert on failures/approval requests.
An uncertain duplicate check must stop the booking. A CAPTCHA requires a person.
Scheduling will be installed only after a supervised dry run and these checks.

The included PowerShell installer is a prepared template, not an installed task.
It checks Windows is on the London time zone and uses an interactive user task.
The laptop must be on and you must be logged in; a task can run late or fail.
For competition at midnight we can later pre-open Chrome and wait for release,
rather than depending on cold browser startup.

## Sources

https://playwright.dev/python/docs/api/class-browsertype
https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger
