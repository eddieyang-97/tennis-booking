"""Read-only adapter grounded in the court grid observed on 1 October 2026.

Basket staging is reversible and always cleaned up. Payment remains unavailable.
"""
import re
from datetime import datetime
from decimal import Decimal
from urllib.parse import urlsplit
from booking_rules import allowed_slot

BASE = 'https://tennistowerhamlets.com'
VENUE = BASE + '/book/courts/bethnal-green-gardens'

def require_site(page):
    parsed = urlsplit(page.url)
    if parsed.hostname != 'tennistowerhamlets.com' or parsed.scheme != 'https':
        raise ValueError('Unexpected website')
    if 'verify-human' in parsed.path or 'sign-in' in parsed.path:
        raise ValueError('Human verification or sign-in is needed in this local profile')

def check_upcoming(page, day):
    page.goto(BASE + '/account', wait_until='domcontentloaded')
    require_site(page)
    page.get_by_role('heading', name='Upcoming bookings', exact=True).wait_for()
    # Existing bookings no longer impose a weekly limit. This is only an
    # account-access check, not same-slot reconciliation or permission to pay.
    return True

def read_slots(page, day, config):
    page.goto(VENUE + '/' + day.isoformat() + '#book', wait_until='domcontentloaded')
    require_site(page)
    page.get_by_role('heading', name='Book courts at Bethnal Green Gardens', exact=True).wait_for()
    # Date verification avoids treating a redirect to today's grid as our target.
    date_label = f"{day.strftime('%A')} {day.day}"
    visible = page.locator('#book').inner_text()
    if date_label not in visible or day.strftime('%B %Y') not in visible:
        raise ValueError('Requested playing date is not displayed')
    rows = page.locator('#book table tr').evaluate_all('''rows => rows.map(r => ({
        time:r.querySelector('th')?.textContent.trim(),
        inputs:[...r.querySelectorAll('input[type=checkbox]')].map(e=>({
            disabled:e.disabled, label:e.labels?.[0]?.textContent.trim()}))}))''')
    available = {}
    for row in rows:
        if not row.get('time'):
            continue
        hour = datetime.strptime(row['time'], '%I%p').hour
        for item in row['inputs']:
            label = item.get('label') or ''
            match = re.fullmatch(r'Tennis court ([1-4])\s*£(\d+(?:\.\d{1,2})?)', label)
            if not item['disabled'] and match:
                available[(hour, int(match[1]))] = Decimal(match[2])
            elif not item['disabled'] and label.startswith('Tennis'):
                raise ValueError('Unknown tennis price or control label')
    candidates = []
    for duration in config['duration_hours']:
        for start in config['start_times']:
            hour = int(start.split(':')[0])
            for court in range(1,5):
                if (allowed_slot(config, day, start, duration, config['venue']) and
                        all((h,court) in available for h in range(hour,hour+duration))):
                    total = sum(available[(h,court)] for h in range(hour,hour+duration))
                    candidates.append({'date':day.isoformat(), 'venue':config['venue'], 'start':start,
                        'hours':duration, 'court':court, 'grid_total_gbp':str(total)})
    return candidates

def dry_run(page, day, config):
    if not check_upcoming(page,day):
        return {'result':'skip_existing_booking'}
    candidates = read_slots(page,day,config)
    return {'result':'candidate' if candidates else 'no_allowed_slot',
            'candidates':candidates, 'payment_submitted':False,
            'basket_verified':False}

def require_empty_basket(page):
    page.goto(BASE + '/basket', wait_until='domcontentloaded')
    require_site(page)
    if not page.get_by_text('There are no items in your basket',exact=True).is_visible():
        raise ValueError('Existing basket items require manual review; nothing removed')

def stage_basket(page, day, config, candidate):
    """Stop at Pay with card, never click it. Remove only our sole test item."""
    if candidate['hours'] != 1:
        raise ValueError('Two-hour basket layout has not yet been observed')
    require_empty_basket(page)
    if not check_upcoming(page,day):
        return {'result':'skip_existing_booking'}
    current = read_slots(page,day,config)
    if candidate not in current:
        raise ValueError('Candidate changed before selection')
    added = False
    try:
        hour = int(candidate['start'].split(':')[0])
        for h in range(hour,hour+candidate['hours']):
            label = datetime.strptime(str(h), '%H').strftime('%I%p').lstrip('0').lower()
            row = page.get_by_role('row').filter(has=page.get_by_role('rowheader',name=label,exact=True))
            box = row.get_by_role('checkbox',name=re.compile(r'^Tennis court '+str(candidate['court'])+r'\s*£'))
            if box.count() != 1 or not box.is_enabled():
                raise ValueError('Selected court is no longer available')
            # Set before interaction so an uncertain click also triggers cleanup.
            added = True
            box.check()
        page.goto(BASE + '/basket',wait_until='domcontentloaded')
        require_site(page)
        page.get_by_role('heading',name='Basket',exact=True).wait_for()
        if page.get_by_role('link',name='Remove',exact=True).count() != candidate['hours']:
            raise ValueError('Unexpected number of basket items')
        body = page.locator('body').inner_text()
        if f"Tennis court {candidate['court']}" not in body or config['venue'] not in body:
            raise ValueError('Unexpected court or venue in basket')
        start_label = datetime.strptime(candidate['start'],'%H:%M').strftime('%I:%M%p').lstrip('0').lower()
        if not re.search(r'\b'+str(day.day)+r'(?:st|nd|rd|th) '+day.strftime('%b')+r'\s*\|\s*'+re.escape(start_label)+r'–',body):
            raise ValueError('Unexpected date or starting time in basket')
        total_row = page.get_by_role('row').filter(has=page.get_by_role('cell',name='Total',exact=True))
        total_text = total_row.inner_text()
        total_match = re.search(r'£\s*(\d+\.\d{2})',total_text)
        if not total_match or Decimal(total_match[1]) != Decimal(candidate['grid_total_gbp']):
            raise ValueError('Basket total differs from grid')
        page.get_by_role('button',name='Pay with card',exact=True).wait_for()
        # Recheck the account before any potential future submission.
        if not check_upcoming(page,day):
            raise ValueError('A booking appeared during basket test')
        return {'result':'basket_test_passed', 'total_gbp':total_match[1],
                'payment_submitted':False, 'confirmation_verified':False}
    finally:
        if added:
            page.goto(BASE+'/basket',wait_until='domcontentloaded')
            require_site(page)
            # At most the hours we added; unexpected contents stop cleanup.
            removes = page.get_by_role('link',name='Remove',exact=True)
            count = removes.count()
            if count > candidate['hours']:
                raise ValueError('Unexpected basket contents; manual cleanup required')
            if count:
                contents = page.locator('body').inner_text()
                if f"Tennis court {candidate['court']}" not in contents or config['venue'] not in contents:
                    raise ValueError('Unrecognized basket item; manual cleanup required')
            for _ in range(count):
                page.get_by_role('link',name='Remove',exact=True).first.click()
            require_empty_basket(page)
