"""Fail-closed booking rules, independent of the unverified site adapter."""
from datetime import datetime, timedelta, time
from decimal import Decimal
from zoneinfo import ZoneInfo
import json
import os
import re
import time as clock
from pathlib import Path

LONDON = ZoneInfo('Europe/London')

def released_date(now):
    if now.tzinfo is None:
        raise ValueError('An aware timestamp is required')
    return now.astimezone(LONDON).date() + timedelta(days=7)

def week_start(day):
    return day - timedelta(days=day.weekday())

def next_release(now):
    if now.tzinfo is None:
        raise ValueError('An aware timestamp is required')
    local = now.astimezone(LONDON)
    return datetime.combine(local.date() + timedelta(days=1), time.min, LONDON)

def wait_for_release(target, now=lambda: datetime.now(LONDON), sleep=clock.sleep):
    """Wait without network polling; use UTC subtraction across clock changes."""
    from datetime import timezone
    while True:
        remaining = (target.astimezone(timezone.utc) - now().astimezone(timezone.utc)).total_seconds()
        if remaining <= 0:
            if remaining < -60:
                raise ValueError('Release was missed by over one minute; stop for review')
            return
        sleep(min(remaining, 0.25 if remaining < 2 else 1))

def allowed_slot(config, day, start, hours, venue):
    return (venue in [config['venue'], *config.get('fallback_venues', [])] and
            day.strftime('%A') in config['playing_weekdays'] and
            start in config['start_times'] and hours in config['duration_hours'])

def weekly_clear(day, bookings, complete):
    """Adapter must establish complete pagination; unknown statuses stop work."""
    if not complete:
        raise ValueError('Upcoming booking list is incomplete')
    for booking in bookings:
        status = booking['status']
        if status not in {'confirmed', 'cancelled'}:
            raise ValueError('Uncertain booking status; manual review required')
        booked = datetime.strptime(booking['date'], '%Y-%m-%d').date()
        if status == 'confirmed' and week_start(booked) == week_start(day):
            return False
    return True

def price_allowed(config, total, currency):
    limit = config.get('max_total_gbp')
    if not config.get('automatic_payment_enabled') or limit is None or currency != 'GBP':
        return False
    amount, cap = Decimal(str(total)), Decimal(str(limit))
    return amount.is_finite() and cap.is_finite() and 0 <= amount <= cap

class Journal:
    """Persist intent BEFORE submission. Uncertain outcomes prevent retries."""
    def __init__(self, path):
        self.path = Path(path)

    def read(self):
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding='utf-8'))

    def write(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    def begin(self, day, slot):
        state = self.read()
        key = self.slot_key(day, slot)
        # Old week-keyed records have insufficient identity for safe migration.
        if any(re.fullmatch(r'\d{4}-\d{2}-\d{2}', k) for k in state):
            raise ValueError('Legacy submission records need manual reconciliation')
        if key in state:
            raise ValueError('Slot has an existing submission record; review required')
        state[key] = {'status': 'uncertain', 'slot': slot}
        self.write(state)

    @staticmethod
    def slot_key(day, slot):
        fields = ('venue', 'court', 'start', 'hours')
        if any(slot.get(field) in (None, '') for field in fields):
            raise ValueError('Complete slot identity is required')
        return json.dumps([day.isoformat(), *[slot[field] for field in fields]], separators=(',', ':'))

    def confirm(self, day, reference, slot=None):
        if not reference or not reference.strip():
            raise ValueError('A site confirmation reference is required')
        state = self.read()
        key = self.slot_key(day, slot or {})
        if state[key]['status'] != 'uncertain':
            raise ValueError('No pending submission')
        state[key].update(status='confirmed', reference=reference)
        self.write(state)
