import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const main = read('src/main.tsx');
const css = read('src/styles/desktopWorkspaceCompact.css');
const previous = read('src/styles/desktopWorkspaceDeep.css');
assert.match(main, /import '\.\/styles\/desktopWorkspaceDeep\.css';\s*import '\.\/styles\/desktopWorkspaceCompact\.css';/,
  'Compact layer must follow V3.3 CSS to override stretched toolbar rules');
assert.match(app, /const userChoice = localStorage\.getItem\('hnl_desktop_workspace_mode_v1'\);\s*if \(userChoice === 'modern' \|\| userChoice === 'classic'\) return userChoice;/,
  'Persisted choice must continue to override new default');
assert.match(app, /return \(isDesktopRuntime \|\| window\.innerWidth >= 1024 \|\| chromeDesktopSite\) \? 'modern' : 'classic';/,
  'PC without saved preference defaults to modern, mobile stays classic');
assert.ok(css.startsWith('/* HNL QLTC — PC Workspace V3.4'));
assert.match(css, /@media \(min-width: 1024px\)/);
assert.match(css, /html\[data-hnl-pc-workspace="modern"\] \[data-hnl-desktop-design="modern"\]/);
for (const scope of ['floorplan', 'crew', 'warehouse', 'checklist', 'settings-center', 'chat-projects', 'ai-workspace', 'volume-filter-panel']) {
  assert.ok(css.includes(scope), `Missing compact presentation of ${scope}`);
}
assert.match(css, /\[data-hnl-workspace-module="floorplan"\] \[data-hnl-pc-region="commands"\] \{\s*display: block;/,
  'Floor plan commands must preserve nested toolbar layout');
assert.doesNotMatch(css, /(?:canvas|transform|zoom|z-index|pointer-events)\s*:/,
  'Compact layer must not mutate plan/media geometry or modal input semantics');
assert.match(previous, /\.hnl-pc-breadcrumb \{\s*display: none !important;/);
assert.match(read('src/styles/desktopWorkspace.css'), /--pc-nav:84px/);
// PC V3.5 scrollbar/layout regression: scroll affordances stay visible, not
// clipped by the warehouse table border, and only confirmed oversized CTAs
// become content-sized. This gate is static; device DPI is separately tested.
for (const marker of [
  '[data-hnl-settings-sheet-scrollbody]',
  '[data-hnl-warehouse-catalog-scroll="true"]',
  '[data-hnl-pc-v3-form="warehouse"]',
  '[data-hnl-pc-v3-form="volume"]',
  '[data-hnl-pc-v3-center="notification-center"]',
  '[data-hnl-pc-v32-window] [class*="overflow-y-auto"]',
]) assert.ok(css.includes(marker), `PC V3.5 missing scrollbar target ${marker}`);
assert.match(css, /scrollbar-width: thin;/);
assert.match(css, /::-webkit-scrollbar-thumb\s*\{\s*background-color: #94a3b8;/);
assert.match(css, /\[data-hnl-pc-v3-inner="warehouse-catalog-grid"\]\s*\{\s*border-color: #c7d2fe;/);
assert.ok(css.includes('scrollbar-gutter: stable;') && css.includes('overscroll-behavior: contain;'),
  'Catalogue must preserve scroll gutter and containment');
assert.ok(read('src/components/WarehouseTab.tsx').includes('data-hnl-warehouse-catalog-scroll="true"'),
  'Warehouse list must retain its real scroll container');
assert.ok(read('src/components/GoogleConfigTab.tsx').includes('data-hnl-project-settings-save="true"'),
  'Project settings save action remains mounted');
assert.ok(read('src/components/NotificationCenterModal.tsx').includes('data-hnl-notification-open-chat="true"'),
  'Notification chat action remains mounted');
assert.match(css, /@media \(min-width: 1024px\)\s*\{[\s\S]*data-hnl-notification-open-chat/,
  'CTA/scroll changes are scoped to PC 1024px+');
console.log('HNL PC V3.5 MODAL SCROLL & CTA GOLDEN PASS');

// Member contact actions must be inline LEFT of Contact/Reset PIN/Delete
// on modern PC; Classic/mobile still render the original full-width button.
const securityModal = read('src/components/SecurityModal.tsx');
const memberRow = securityModal.slice(securityModal.indexOf('sortedProjectMembers.map(m =>'));
assert.ok(memberRow.includes('data-hnl-security-contact-phone-action="inline"'),
  'PC contact action must be mounted in member action row');
assert.ok(memberRow.includes('data-hnl-security-contact-phone-action="below"'),
  'Mobile and Classic contact action must remain in its lower row');
assert.ok(memberRow.indexOf('data-hnl-security-contact-phone-action="inline"')
  < memberRow.indexOf('canReadMemberContacts && <ContactMenu'),
  'PC phone action must appear to the LEFT of Contact');
assert.ok(memberRow.indexOf('canReadMemberContacts && <ContactMenu')
  < memberRow.indexOf('Reset PIN')
  && memberRow.indexOf('Reset PIN') < memberRow.indexOf('title="Thu hồi quyền thành viên"'),
  'Keep Contact, Reset PIN, Delete buttons in their existing order');
assert.match(memberRow, /data-hnl-security-contact-phone-action="inline"\s+className="hidden /,
  'PC inline contact action must remain hidden on mobile/Classic');
assert.match(memberRow, /data-hnl-security-contact-phone-action="below"\s+className="w-full /,
  'Mobile/Classic contact action must remain full-width');
assert.match(memberRow, /editingContactEmail === email \? \(\s*<ContactPhoneEditor/,
  'Existing editable phone form must remain below the member action row');
const phoneStyles = css.slice(css.indexOf('/* Security member actions:'));
assert.ok(phoneStyles.startsWith('/* Security member actions:'),
  'Inline member contact CSS is required');
assert.match(phoneStyles, /@media \(min-width: 960px\)/,
  'Desktop-only member contact styling');
assert.match(phoneStyles, /html\[data-hnl-pc-workspace="modern"\]\s+button\[data-hnl-security-contact-phone-action="inline"\][\s\S]*?display: inline-flex;/,
  'PC contact action must display inline, not take an entire row');
assert.match(phoneStyles, /max-width: 180px;/,
  'PC inline contact action must fit its fixed 180px maximum width');
assert.match(phoneStyles, /html\[data-hnl-pc-workspace="modern"\]\s+button\[data-hnl-security-contact-phone-action="below"\]\s*\{\s*display: none;/,
  'PC must hide the duplicate lower action');
console.log('HNL PC MEMBER CONTACT INLINE GOLDEN PASS — Phone, Contact, Reset PIN, Delete; mobile/Classic unchanged');

console.log('HNL PC V3.4 COMPACT GOLDEN PASS — mode visibility, compact actions, 84px rail, classic/mobile and plan safety');
