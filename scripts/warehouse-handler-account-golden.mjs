import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveVerifiedIdentityLabel } from '../src/utils/authIdentityUtils.ts';

// The editable 'Người Giao / Nhận' field must originate from the actor
// opening a NEW voucher. It is not the project-wide 'Kỹ sư phụ trách'.
assert.equal(resolveVerifiedIdentityLabel({ uid: 'actor-1', email: 'actor@example.com', displayName: 'Nguyễn Thị Mai' }), 'Nguyễn Thị Mai');
assert.equal(resolveVerifiedIdentityLabel({ uid: 'actor-1', email: 'Actor@Example.Com', displayName: '' }), 'actor@example.com');
assert.equal(resolveVerifiedIdentityLabel({ uid: 'actor-1', email: 'actor@example.com', displayName: 'Kỹ sư QC' }), 'actor@example.com');
assert.equal(resolveVerifiedIdentityLabel({ uid: 'actor-2', email: 'new@example.com', displayName: '' }, { uid: 'old', email: 'old@example.com', displayName: 'Người dùng cũ' }), 'new@example.com', 'never inherit another account after switching');
assert.equal(resolveVerifiedIdentityLabel(null, { uid: 'verified-offline', email: 'offline@example.com', displayName: 'Nguyễn Văn A' }), 'Nguyễn Văn A');
assert.equal(resolveVerifiedIdentityLabel(null, null), '', 'never invent an identity when none is verified');

const app = fs.readFileSync('src/App.tsx', 'utf8');
const warehouse = fs.readFileSync('src/components/WarehouseTab.tsx', 'utf8');
assert.match(app, /accountHandlerName=\{resolveVerifiedIdentityLabel\(\s*getCurrentRealFirebaseUser\(\),\s*!isOnline \? getRememberedVerifiedAuthIdentity\(\) : null,/,
  'new voucher uses live Firebase identity; only use remembered verified identity offline');
assert.ok(warehouse.includes("setHandler(String(accountHandlerName || '').trim());"), 'new voucher uses current account name');
assert.ok(warehouse.includes("setHandler(item.handler || '');"), 'editing existing voucher keeps original handler');
assert.ok(warehouse.includes('value={handler}') && warehouse.includes('onChange={(e) => setHandler(e.target.value)}'), 'autofilled handler remains editable');
assert.ok(warehouse.includes('handler: handler.trim(),'), 'manual edited value is authoritative on save');
assert.ok(warehouse.includes('handler: accountHandlerName,'), 'quick-add new voucher rows share the same account default');
assert.ok(!warehouse.includes('setHandler(String(defaultHandler || \'\').trim());'), 'never default new voucher to project inspector');
assert.ok(warehouse.includes("row['handler'] || defaultHandler || ''"), 'legacy spreadsheet import behavior is unchanged');
assert.ok(warehouse.includes('if (keepOpen) {'), 'save-and-continue remains available');
assert.ok(warehouse.includes('roleResolved && canEditWarehouseData(userRole)'), 'existing role controls remain intact');

console.log('WAREHOUSE ACCOUNT HANDLER GOLDEN PASS: active verified account prefill, editable, old vouchers preserved, identity switch and offline safe');
