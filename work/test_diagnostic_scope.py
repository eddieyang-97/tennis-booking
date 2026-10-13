from pathlib import Path
import sys
sys.path.insert(0,str(Path('outputs/tennis-local').resolve()))
from playwright.sync_api import sync_playwright
from verification_diagnostics import VerificationDiagnostics

HTML = '<html><body><h1>Just checking…</h1><button id="submit-btn" disabled>Complete</button></body></html>'
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
    context = browser.new_context()
    context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
    page = context.new_page()
    diagnostics = VerificationDiagnostics(context)
    page.goto('https://tennistowerhamlets.com/verify-human')
    class CachedAddressPage:
        url = 'https://tennistowerhamlets.com/courts'
        def evaluate(self,expression): return page.evaluate(expression)
    report = diagnostics.report(CachedAddressPage())
    assert report['dom']['complete_disabled'] is True
    assert report['page'] == '/verify-human'
    for address in ['https://tennistowerhamlets.com/account',
                    'https://tennistowerhamlets.com/account/sign-in/code',
                    'https://tennistowerhamlets.com/basket',
                    'https://private.example/verify-human',
                    'http://tennistowerhamlets.com/verify-human']:
        page.goto(address)
        try: diagnostics.report(page)
        except ValueError: pass
        else: raise AssertionError('Private/wrong-origin page accepted')
    page.goto('https://tennistowerhamlets.com/verify-human?test-secret=DO_NOT_EXPORT')
    report = diagnostics.report(page)
    assert 'DO_NOT_EXPORT' not in str(report)
    page.set_content('<html><body>Unrecognized page</body></html>')
    try: diagnostics.report(page)
    except ValueError: pass
    else: raise AssertionError('Missing public-page marker accepted')
    browser.close()
print('Offline Chrome diagnostic checks passed: stale cached URL accepted for live public page; private paths, wrong origins, HTTP and missing markers rejected; query omitted. No external website requests.')
