import unittest
from datetime import date, datetime, timezone
from tempfile import TemporaryDirectory
from pathlib import Path
from booking_rules import released_date, weekly_clear, Journal, price_allowed, allowed_slot, next_release, wait_for_release

class RulesTest(unittest.TestCase):
    def test_release_wait_uses_exact_midnight(self):
        now = datetime(2026,10,1,22,59,59,tzinfo=timezone.utc)
        target = next_release(now)
        self.assertEqual(target.astimezone(timezone.utc), datetime(2026,10,1,23,tzinfo=timezone.utc))
        from datetime import timedelta
        ticks = iter([now, now + timedelta(seconds=1)])
        pauses = []
        wait_for_release(target, now=lambda:next(ticks), sleep=pauses.append)
        self.assertEqual(pauses,[0.25])
        with self.assertRaises(ValueError):
            wait_for_release(target,now=lambda:now+timedelta(minutes=2),sleep=pauses.append)

    def test_release_across_dst(self):
        self.assertEqual(released_date(datetime(2026,10,24,23,0,tzinfo=timezone.utc)), date(2026,11,1))
        self.assertEqual(released_date(datetime(2026,10,25,23,0,tzinfo=timezone.utc)), date(2026,11,1))

    def test_duplicates_and_uncertainty(self):
        day = date(2026,10,8)
        booking = {'date':'2026-10-11','status':'confirmed'}
        self.assertFalse(weekly_clear(day,[booking],True))
        self.assertTrue(weekly_clear(day,[dict(booking,status='cancelled')],True))
        with self.assertRaises(ValueError): weekly_clear(day,[],False)
        with self.assertRaises(ValueError): weekly_clear(day,[dict(booking,status='pending')],True)

    def test_payment_gate(self):
        self.assertFalse(price_allowed({},7,'GBP'))
        config = {'automatic_payment_enabled':True,'max_total_gbp':14}
        self.assertTrue(price_allowed(config,14,'GBP'))
        self.assertFalse(price_allowed(config,14.01,'GBP'))
        self.assertFalse(price_allowed(config,7,'EUR'))

    def test_submission_timeout_blocks_retries(self):
        with TemporaryDirectory() as root:
            path = Path(root)/'journal.json'
            day = date(2026,10,8)
            slot = {'venue':'Bethnal Green Gardens','court':2,'start':'20:00','hours':1}
            Journal(path).begin(day, slot)
            with self.assertRaises(ValueError): Journal(path).begin(day,slot)
            Journal(path).begin(date(2026,10,9),slot)
            Journal(path).confirm(day,'test-reference',slot)
            with self.assertRaises(ValueError): Journal(path).begin(day,slot)
            with self.assertRaises(ValueError): Journal(path).begin(day,{})

    def test_legacy_records_need_reconciliation(self):
        with TemporaryDirectory() as root:
            path = Path(root)/'journal.json'
            path.write_text('{"2026-10-05":{"status":"uncertain"}}')
            with self.assertRaises(ValueError):
                Journal(path).begin(date(2026,10,8),
                    {'venue':'Bethnal Green Gardens','court':2,'start':'20:00','hours':1})

if __name__ == '__main__': unittest.main()
