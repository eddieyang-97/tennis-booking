"""Read-only verification diagnostics. Never solve or alter a challenge."""
from collections import deque
from urllib.parse import urlsplit
import re

HOSTS = {'tennistowerhamlets.com', 'challenges.cloudflare.com',
         'www.google.com', 'www.recaptcha.net', 'js.hcaptcha.com', 'newassets.hcaptcha.com'}

# Check the live address and public-page markers before reading document state.
# A Python-side page.url can remain stale while the sync caller waits in input().
PUBLIC_VERIFICATION_STATE = '''() => {
    if (location.origin !== 'https://tennistowerhamlets.com' ||
        location.pathname !== '/verify-human') return null;
    const button = document.querySelector('#submit-btn');
    if (!button || button.textContent.trim() !== 'Complete') return null;
    return {
        ready:document.readyState,
        complete_present:true,
        complete_disabled:button.disabled,
        script_origins:[...document.querySelectorAll('script[src]')].map(e=>new URL(e.src,location.origin).hostname),
        frame_origins:[...document.querySelectorAll('iframe[src]')].map(e=>new URL(e.src,location.origin).hostname)
    };
}'''

def safe_host(url):
    host = urlsplit(url).hostname
    return host if host in HOSTS else None

def error_code(message):
    # Export only known error-code format, never arbitrary console messages.
    match = re.search(r'(?:Turnstile.*?error|Error code)\D*(\d{6})\b',message,re.I)
    return match[1] if match else None

class VerificationDiagnostics:
    def __init__(self, context):
        self.events = deque(maxlen=50)
        self.codes = set()
        self.context = context
        context.on('requestfailed', self.failed)
        context.on('response', self.response)
        context.on('page', self.watch_page)
        for page in context.pages:
            self.watch_page(page)

    def watch_page(self,page):
        page.on('console',lambda msg:self.console(msg.text))

    def console(self,message):
        code = error_code(message)
        if code:
            self.codes.add(code)

    def failed(self, request):
        host = safe_host(request.url)
        if host and request.resource_type in {'script','document','xhr','fetch'}:
            failure = request.failure or ''
            reason = re.search(r'net::ERR_[A-Z_]+',failure)
            self.events.append({'host':host, 'kind':request.resource_type,
                'failure':reason[0] if reason else 'request_failed'})

    def response(self,response):
        host = safe_host(response.url)
        if host and response.status >= 400:
            self.events.append({'host':host,'http_status':response.status})

    def report(self,page):
        dom = page.evaluate(PUBLIC_VERIFICATION_STATE)
        if dom is None:
            raise ValueError('Diagnostic export is restricted to the public verification page')
        dom['script_origins'] = sorted({x for x in dom['script_origins'] if x in HOSTS})
        dom['frame_origins'] = sorted({x for x in dom['frame_origins'] if x in HOSTS})
        browser = self.context.browser
        return {'page':'/verify-human', 'chrome_version':browser.version if browser else 'unavailable',
            'launch':{'channel':'chrome','headless':False,'sandbox':True,
                      'custom_proxy':False,'custom_user_agent':False},
            'dom':dom, 'resource_failures':list(self.events),
            'verification_error_codes':sorted(self.codes),
            'note':'Absence of logged errors does not prove verification succeeded. No URLs, tokens, cookies, input values or raw console messages exported.'}
