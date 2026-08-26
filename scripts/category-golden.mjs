import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (msg) => { console.error(`CATEGORY GOLDEN FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`PASS: ${msg}`);

function buildCatalog(workVolumes) {
  const byId = new Map();
  const byName = new Map();
  for (const item of workVolumes) {
    const title = String(item.title || '').trim();
    if (!title) continue;
    byName.set(title.toLocaleLowerCase('vi-VN'), title);
    for (const id of [item.id, item.workCategoryId].filter(Boolean)) byId.set(String(id), title);
  }
  return { byId, byName, hasCatalog: byName.size > 0 };
}

function resolve(catalog, rawName, rawId) {
  const id = String(rawId || '').trim();
  if (id && catalog.byId.has(id)) return catalog.byId.get(id);
  const raw = String(rawName || '').trim();
  if (!raw) return null;
  if (!catalog.hasCatalog) return raw;
  if (catalog.byId.has(raw)) return catalog.byId.get(raw);
  return catalog.byName.get(raw.toLocaleLowerCase('vi-VN')) || null;
}

const active = [
  { id: 'CAT-C04', workCategoryId: 'CAT-C04', title: 'Trần C04' },
  { id: 'CAT-IW08', workCategoryId: 'CAT-IW08', title: 'Vách IW08' },
];
const catalog = buildCatalog(active);
if (resolve(catalog, 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn')) fail('deleted title was treated as active');
if (resolve(catalog, 'CAT-C04') !== 'Trần C04') fail('active ID did not resolve to canonical title');
if (resolve(catalog, 'trần c04') !== 'Trần C04') fail('active title did not resolve case-insensitively');

const room = {
  workCategory: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
  categoryVolumes: {
    'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn': 76.58,
    'CAT-IW08': 11.53,
  },
  subItems: [
    { category: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn', name: 'Thi công khung' },
    { workCategoryId: 'CAT-IW08', category: 'Vách IW08', name: 'Thi công vách' },
  ],
};
const categories = new Set();
for (const key of Object.keys(room.categoryVolumes)) {
  const value = resolve(catalog, key);
  if (value) categories.add(value);
}
for (const sub of room.subItems) {
  const value = resolve(catalog, sub.category || room.workCategory, sub.workCategoryId);
  if (value) categories.add(value);
}
const primary = resolve(catalog, room.workCategory);
if (primary) categories.add(primary);
if (categories.has('Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn')) fail('deleted category leaked into operational room summary');
if (!categories.has('Vách IW08') || categories.size !== 1) fail('active category filtering removed valid room data');
pass('deleted category hidden while valid active category remains');

const legacyCatalog = buildCatalog([]);
if (resolve(legacyCatalog, 'Khung trần legacy') !== 'Khung trần legacy') fail('legacy project fallback broken when no WorkVolume catalog exists');
pass('legacy no-catalog fallback remains readable');

const modal = read('src/components/RoomHighlightModal.tsx');
const floor = read('src/components/FloorPlanDefectTab.tsx');
if (!modal.includes("const [workCategory, setWorkCategory] = useState('')")) fail('room modal hard-coded default category returned');
if (!modal.includes('return projectWorkCategoryTitles;')) fail('room presets are not sourced only from active WorkVolume catalog');
if (!modal.includes('ứng dụng không tự phục hồi hạng mục đã xóa')) fail('empty active-category state warning missing');
if (!floor.includes('operationalWorkCategoryCatalog') || !floor.includes('resolveOperationalCategoryName')) fail('floor operational category filter missing');
pass('source guards prevent deleted-category resurrection');

console.log('CATEGORY GOLDEN PASS');
