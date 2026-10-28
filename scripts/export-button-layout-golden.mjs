#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const cases = [
  ['src/components/WarehouseReportActions.tsx', 4],
  ['src/components/WarehouseVoucherShareSheet.tsx', 4],
  ['src/components/CrewReportShareModal.tsx', 3],
  ['src/components/ExportPdfModal.tsx', 3],
  ['src/healthCenter/HealthCenterPanelBase.tsx', 3],
];
for (const [path,count] of cases) {
  const source=read(path);
  assert.match(source,/data-hnl-export-format-group="true"/,`${path}: standard export marker`);
  assert.ok(source.includes(`data-hnl-export-format-count="${count}"`),`${path}: ${count} formats`);
}
const css=read('src/styles/desktopWorkspaceCompact.css');
assert.match(css,/@media \(min-width: 960px\)/,'responsive PC breakpoint must be preserved');
for (const needle of [
  'display: inline-flex', 'flex-wrap: wrap', 'max-width: 100%',
  'width: 112px', 'min-height: 44px', 'font-size: 12px',
  '[data-hnl-export-format-group="true"][role="group"] > button',
]) assert.ok(css.includes(needle),`Missing PC compact/export CSS: ${needle}`);
assert.ok(read('src/components/CrewReportShareModal.tsx').includes('data-hnl-crew-export-menu="unified"'),'Crew report keeps existing export flow');
assert.ok(read('src/components/ExportPdfModal.tsx').includes('data-hnl-report-format="pdf"'),'PDF export flow retained');
assert.ok(read('src/components/WarehouseVoucherShareSheet.tsx').includes('data-hnl-voucher-export-options="toggle"'),'Voucher options retained');
assert.ok(read('src/components/WarehouseReportActions.tsx').includes('data-hnl-warehouse-export-options="toggle"'),'Catalog and Order options retained');
console.log('Export button layout golden: PASS — 5 shared groups, 3/4 formats, 112x44 PC, mobile unchanged');
