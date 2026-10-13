import unittest
from verification_diagnostics import safe_host,error_code,VerificationDiagnostics
from types import SimpleNamespace
from unittest.mock import Mock

class DiagnosticPrivacyTest(unittest.TestCase):
    def test_report_uses_live_guard_instead_of_cached_address(self):
        context = SimpleNamespace(on=Mock(),pages=[],browser=SimpleNamespace(version='test'))
        diagnostics = VerificationDiagnostics(context)
        class Page:
            @property
            def url(self): raise AssertionError('Stale address must not be consulted')
            def evaluate(self,script):
                return {'complete_disabled':True,'script_origins':['challenges.cloudflare.com','private.example'],
                        'frame_origins':[]}
        result = diagnostics.report(Page())
        self.assertTrue(result['dom']['complete_disabled'])
        self.assertEqual(result['dom']['script_origins'],['challenges.cloudflare.com'])
    def test_live_guard_rejection_is_not_exported(self):
        context = SimpleNamespace(on=Mock(),pages=[],browser=None)
        with self.assertRaises(ValueError):
            VerificationDiagnostics(context).report(SimpleNamespace(evaluate=lambda script:None))

    def test_host_only_and_no_unknown_sites(self):
        self.assertEqual(safe_host('https://challenges.cloudflare.com/api?token=secret'),'challenges.cloudflare.com')
        self.assertIsNone(safe_host('https://private.example/account?token=secret'))
    def test_only_verification_codes_exported(self):
        self.assertEqual(error_code('[Cloudflare Turnstile] Error: 600010.'),'600010')
        self.assertIsNone(error_code('token=private-123456'))
        self.assertIsNone(error_code('Unexpected private information'))

if __name__ == '__main__': unittest.main()
