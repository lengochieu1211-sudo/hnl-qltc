from pathlib import Path
p = Path('scripts/rbac-matrix.mjs')
s = p.read_text(encoding='utf-8')
old = """assertContains(firebaseSource, 'requestProjectMemberPinReset', 'SUPER ADMIN remote PIN reset API is wired');
assertContains(firebaseSource, 'isSuperAdminEmail(actor.email)', 'remote PIN reset is company SUPER ADMIN-bound');
assertContains(appSource, 'subscribeCurrentUserPinResetRealtime', 'target account listens for remote PIN reset');
assertContains(securitySource, 'applyRemotePinReset', 'remote reset clears local PIN through monotonic epoch helper');
console.log('PASS RBAC: SUPER ADMIN remote PIN reset is identity-bound and target-listened');
"""
new = """check('SUPER ADMIN remote PIN reset API is wired', has(src.firebase, 'requestProjectMemberPinReset'));
check('remote PIN reset is company SUPER ADMIN-bound', has(src.firebase, 'isSuperAdminEmail(actor.email)'));
check('target account listens for remote PIN reset', has(src.app, 'subscribeCurrentUserPinResetRealtime'));
check('remote reset clears local PIN through monotonic epoch helper', has(src.security, 'applyRemotePinReset'));
"""
if old not in s:
    raise SystemExit('old regression guard block not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('fixed RBAC guard helper')
