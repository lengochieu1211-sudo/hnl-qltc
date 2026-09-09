import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value);
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  assert(first >= 0, `Missing ${label}`);
  assert(source.indexOf(from, first + from.length) < 0, `Multiple ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

// 1) App.tsx: durable staging + preserve a newer local replacement during realtime reconciliation.
{
  const path = 'src/App.tsx';
  let source = read(path);
  source = replaceOnce(
    source,
    "import { floorPlanNeedsCloudUpload, isDisplayableFloorPlanUrl, loadFloorPlanImageFromCloud, syncFloorPlanImageToCloud, deleteFloorPlanImageFromCloud } from './lib/floorPlanImageSync';",
    "import { floorPlanNeedsCloudUpload, isDisplayableFloorPlanUrl, loadFloorPlanImageFromCloud, stageFloorPlanImageOutbox, syncFloorPlanImageToCloud, deleteFloorPlanImageFromCloud } from './lib/floorPlanImageSync';",
    'floorPlanImageSync import',
  );

  source = replaceOnce(
    source,
    '  const merged = { ...cloudItem };\n',
    `  const merged = { ...cloudItem };\n  // P0 floor-plan durability: a newer local replacement must survive an older Cloud\n  // snapshot even when the Cloud row temporarily contains an empty/legacy imageUrl.\n  // This also recovers pre-outbox DEV records that already have imageRevision > cloud.\n  const pendingLocalFloorImage = String(localItem?.imageUrl || '');\n  const pendingLocalFloorRevision = Number(localItem?.imageRevision || 0);\n  const pendingCloudFloorRevision = Number(cloudItem?.imageCloudRevision || 0);\n  const preservePendingFloorImage = (\n    (pendingLocalFloorImage.startsWith('data:image/') || pendingLocalFloorImage.startsWith('blob:'))\n    && pendingLocalFloorRevision > pendingCloudFloorRevision\n  );\n  if (preservePendingFloorImage) {\n    merged.imageUrl = localItem.imageUrl;\n    merged.imageRevision = localItem.imageRevision;\n    merged.imageCloudRevision = localItem.imageCloudRevision;\n    merged.cloudFileId = localItem.cloudFileId;\n    merged.driveFileId = localItem.driveFileId;\n    merged.driveUrl = localItem.driveUrl;\n    merged.storageProvider = localItem.storageProvider;\n    merged.storagePath = localItem.storagePath;\n    merged.thumbnailPath = localItem.thumbnailPath;\n    merged.storageMd5Hash = localItem.storageMd5Hash;\n    merged.storageEtag = localItem.storageEtag;\n    merged.imageMimeType = localItem.imageMimeType;\n    merged.imageFileSize = localItem.imageFileSize;\n    merged.imageCloudSyncedAt = localItem.imageCloudSyncedAt;\n    merged.imageUploadState = localItem.imageUploadState;\n    merged.imagePendingByUid = localItem.imagePendingByUid;\n    merged.imageOutboxRevision = localItem.imageOutboxRevision;\n  }\n`,
    'restoreLocalOmittedImages merged initializer',
  );

  const marker = '  const handleUpdateFloorPlanImage = (id: string, imageUrl: string) => {';
  const start = source.indexOf(marker);
  assert(start >= 0, 'Missing handleUpdateFloorPlanImage');
  const end = source.indexOf('\n  const handle', start + marker.length);
  assert(end > start, 'Could not isolate handleUpdateFloorPlanImage block');
  let block = source.slice(start, end);
  block = replaceOnce(
    block,
    marker,
    '  const handleUpdateFloorPlanImage = async (id: string, imageUrl: string) => {',
    'handleUpdateFloorPlanImage signature',
  );
  block = replaceOnce(
    block,
    '    const imageRevision = Date.now();\n',
    `    const imageRevision = Date.now();\n    const projectId = activeProjectIdRef.current;\n    const uploaderUid = getCurrentRealFirebaseUser()?.uid || '';\n    try {\n      await stageFloorPlanImageOutbox(projectId, id, imageRevision, imageUrl);\n    } catch (err) {\n      appendRuntimeDiagnostic({\n        level: 'error',\n        area: 'floor-plan-image',\n        projectId,\n        code: 'OUTBOX_STAGE_FAILED',\n        message: \`Không thể lưu ảnh thay mặt bằng vào outbox: \${err instanceof Error ? err.message : String(err)}\`,\n      });\n      alert('Không thể lưu ảnh mặt bằng an toàn trên thiết bị. Ảnh chưa được thay; hãy thử lại.');\n      return;\n    }\n`,
    'imageRevision staging point',
  );
  block = replaceOnce(
    block,
    '        imageCloudRevision: 0,\n',
    `        imageCloudRevision: 0,\n        imageUploadState: 'pending',\n        imagePendingByUid: uploaderUid,\n        imageOutboxRevision: imageRevision,\n`,
    'imageCloudRevision reset',
  );
  block = replaceOnce(
    block,
    '        storageProvider: undefined,\n',
    `        storageProvider: undefined,\n        storagePath: undefined,\n        thumbnailPath: undefined,\n        storageMd5Hash: undefined,\n        storageEtag: undefined,\n        imageMimeType: undefined,\n        imageFileSize: undefined,\n        imageCloudSyncedAt: undefined,\n        uploadedAt: new Date().toISOString().split('T')[0],\n        updatedAt: imageRevision,\n        revision: Math.max(Number((fp as any).revision || 0), 0) + 1,\n        updatedByUid: uploaderUid || fp.updatedByUid,\n`,
    'floor plan old cloud pointer reset',
  );
  source = source.slice(0, start) + block + source.slice(end);
  write(path, source);
}

// 2) Diagnostics: never call a floor ready merely because the local data URL disappeared.
{
  const path = 'src/components/GoogleConfigTab.tsx';
  let source = read(path);
  source = replaceOnce(
    source,
    "import { buildDiagnosticBundle, clearRuntimeDiagnostics } from '../lib/runtimeDiagnostics';\n",
    "import { buildDiagnosticBundle, clearRuntimeDiagnostics } from '../lib/runtimeDiagnostics';\nimport { getFloorPlanImageOutboxSnapshot } from '../lib/floorPlanImageSync';\n",
    'diagnostic floor-plan outbox import',
  );

  const startMarker = '    const floorPlanRows = Array.isArray(fullAppData?.floorPlans) ? fullAppData.floorPlans : [];';
  const start = source.indexOf(startMarker);
  assert(start >= 0, 'Missing floorPlanRows diagnostic block');
  const end = source.indexOf('    return buildDiagnosticBundle({', start);
  assert(end > start, 'Could not isolate floorPlanDiagnostics block');
  const replacement = `    const floorPlanOutboxRows = activeProjectId\n      ? await getFloorPlanImageOutboxSnapshot(activeProjectId).catch(() => [])\n      : [];\n    const latestOutboxByFloor = new Map<string, any>();\n    for (const row of floorPlanOutboxRows) {\n      const previous = latestOutboxByFloor.get(row.floorPlanId);\n      if (!previous || Number(row.revision || 0) > Number(previous.revision || 0)) latestOutboxByFloor.set(row.floorPlanId, row);\n    }\n    const floorPlanRows = Array.isArray(fullAppData?.floorPlans) ? fullAppData.floorPlans : [];\n    const floorPlanDiagnosticRows = floorPlanRows.map((plan: any) => {\n      const imageUrl = String(plan?.imageUrl || '');\n      const localBinary = imageUrl.startsWith('data:image/') || imageUrl.startsWith('blob:');\n      const outbox = latestOutboxByFloor.get(String(plan?.id || ''));\n      const imageRevision = Number(plan?.imageRevision || 0);\n      const effectiveRevision = Math.max(imageRevision, Number(outbox?.revision || 0));\n      const cloudRevision = Number(plan?.imageCloudRevision || 0);\n      const storageProvider = String(plan?.storageProvider || '');\n      const storagePath = String(plan?.storagePath || '');\n      const hasCloudPointer = Boolean(storageProvider && storagePath);\n      const cloudReady = hasCloudPointer && (effectiveRevision <= 0 || cloudRevision >= effectiveRevision);\n      const hasImageEvidence = Boolean(\n        localBinary || outbox || imageUrl || effectiveRevision || plan?.imageMimeType || plan?.imageFileSize || hasCloudPointer || plan?.imageUploadState\n      );\n      let status = 'NO_IMAGE';\n      if (cloudReady) status = 'READY';\n      else if (outbox && Number(outbox.revision || 0) > cloudRevision) status = 'PENDING_OUTBOX';\n      else if (localBinary) status = 'PENDING_LOCAL';\n      else if (hasCloudPointer && effectiveRevision > cloudRevision) status = 'CLOUD_POINTER_INCONSISTENT';\n      else if (hasImageEvidence) status = 'MISSING_BINARY';\n      const pending = status !== 'READY' && status !== 'NO_IMAGE';\n      return {\n        id: String(plan?.id || ''),\n        floorName: String(plan?.floorName || ''),\n        status,\n        pending,\n        localBinary,\n        imageRevision,\n        effectiveImageRevision: effectiveRevision,\n        imageCloudRevision: cloudRevision,\n        imageUploadState: String(plan?.imageUploadState || ''),\n        imagePendingByUid: String(plan?.imagePendingByUid || ''),\n        imageOutboxRevision: Number(plan?.imageOutboxRevision || 0),\n        outboxRevision: Number(outbox?.revision || 0),\n        outboxBytes: Number(outbox?.bytes || 0),\n        storageProvider,\n        storagePath,\n        imageCloudSyncedAt: Number(plan?.imageCloudSyncedAt || 0),\n      };\n    });\n    const floorPlanDiagnostics = {\n      total: floorPlanRows.length,\n      pending: floorPlanDiagnosticRows.filter((row: any) => row.pending).length,\n      outboxCount: floorPlanOutboxRows.length,\n      outboxBytes: floorPlanOutboxRows.reduce((sum: number, row: any) => sum + Number(row?.bytes || 0), 0),\n      floors: floorPlanDiagnosticRows.slice(0, 50),\n    };\n`;
  source = source.slice(0, start) + replacement + source.slice(end);
  write(path, source);
}

// 3) FloorPlanDefectTab: distinguish PDF rendering from normal image optimization.
{
  const path = 'src/components/FloorPlanDefectTab.tsx';
  let source = read(path);
  source = replaceOnce(
    source,
    '  const [isConvertingPdf, setIsConvertingPdf] = useState(false);\n',
    `  const [isConvertingPdf, setIsConvertingPdf] = useState(false);\n  const [floorPlanProcessingKind, setFloorPlanProcessingKind] = useState<'pdf' | 'image' | null>(null);\n  const beginFloorPlanFileProcessing = (file: File) => {\n    const isPdfFile = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');\n    setFloorPlanProcessingKind(isPdfFile ? 'pdf' : 'image');\n    setIsConvertingPdf(true);\n  };\n  const endFloorPlanFileProcessing = () => {\n    setIsConvertingPdf(false);\n    setFloorPlanProcessingKind(null);\n  };\n`,
    'floor plan processing state',
  );
  const trueMatches = source.match(/setIsConvertingPdf\(true\);/g) || [];
  // One occurrence belongs to beginFloorPlanFileProcessing itself; the remaining calls are file handlers.
  assert(trueMatches.length >= 3, `Expected at least two file-handler starts, got ${trueMatches.length - 1}`);
  let seenHelperTrue = false;
  source = source.replace(/setIsConvertingPdf\(true\);/g, (match, offset) => {
    const before = source.slice(Math.max(0, offset - 180), offset);
    if (before.includes('setFloorPlanProcessingKind')) {
      seenHelperTrue = true;
      return match;
    }
    return 'beginFloorPlanFileProcessing(file);';
  });
  assert(seenHelperTrue, 'Did not preserve beginFloorPlanFileProcessing internal setter');

  const falseMatches = source.match(/setIsConvertingPdf\(false\);/g) || [];
  assert(falseMatches.length >= 3, `Expected helper + at least two file-handler stops, got ${falseMatches.length}`);
  let seenHelperFalse = false;
  source = source.replace(/setIsConvertingPdf\(false\);/g, (match, offset) => {
    const before = source.slice(Math.max(0, offset - 120), offset);
    if (before.includes('const endFloorPlanFileProcessing')) {
      seenHelperFalse = true;
      return match;
    }
    return 'endFloorPlanFileProcessing();';
  });
  assert(seenHelperFalse, 'Did not preserve endFloorPlanFileProcessing internal setter');

  source = replaceOnce(
    source,
    '            <span className="font-bold block">🔄 Đang nạp &amp; chuyển đổi tệp PDF mặt bằng...</span>\n            <span className="text-[11px] text-amber-700">Đang chuyển PDF thành ảnh mặt bằng sắc nét; không tự tạo Căn / Phòng hoặc dữ liệu mẫu.</span>',
    `            <span className="font-bold block">\n              {floorPlanProcessingKind === 'pdf' ? '🔄 Đang render PDF thành ảnh mặt bằng...' : '🖼️ Đang tối ưu ảnh mặt bằng...'}\n            </span>\n            <span className="text-[11px] text-amber-700">\n              {floorPlanProcessingKind === 'pdf'\n                ? 'Đang chuyển trang PDF đã chọn thành ảnh mặt bằng; không tự tạo Căn / Phòng hoặc dữ liệu mẫu.'\n                : 'Đang nén và chuẩn bị ảnh JPG/PNG/WebP để lưu mặt bằng; không có bước chuyển PDF.'}\n            </span>`,
    'floor plan processing banner',
  );
  write(path, source);
}

// 4) Permanent source-level regression gate.
{
  const testPath = 'scripts/floorplan-p0-golden.ts';
  const test = `import fs from 'node:fs';\n\nconst read = (path: string) => fs.readFileSync(path, 'utf8');\nconst check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };\n\nconst sync = read('src/lib/floorPlanImageSync.ts');\ncheck(sync.includes('fetchProjectUserRoleFromCloud'), 'Floor-plan upload must use project-scoped Cloud role verification.');\ncheck(!sync.includes('getCurrentUserRole'), 'Legacy global role cache must not authorize floor-plan upload.');\ncheck(sync.includes('stageFloorPlanImageOutbox'), 'Floor-plan binary outbox staging is missing.');\ncheck(sync.includes('FLOOR_PLAN_ROLE_VERIFICATION_UNAVAILABLE'), 'Unavailable role verification must fail closed and retry.');\ncheck(sync.includes('latestPendingRevision > revision'), 'Two rapid replacements must keep the newest revision authoritative.');\ncheck(sync.includes('imagePendingByUid'), 'Pending outbox must be uploader/account scoped.');\n\nconst app = read('src/App.tsx');\nconst handlerStart = app.indexOf('const handleUpdateFloorPlanImage = async');\nconst handlerEnd = app.indexOf('\\n  const handle', handlerStart + 10);\ncheck(handlerStart >= 0 && handlerEnd > handlerStart, 'Async floor-plan replacement handler missing.');\nconst handler = app.slice(handlerStart, handlerEnd);\ncheck(handler.indexOf('await stageFloorPlanImageOutbox') >= 0, 'Replacement must stage binary before state mutation.');\ncheck(handler.indexOf('await stageFloorPlanImageOutbox') < handler.indexOf('updateAppData'), 'Outbox staging must happen before updateAppData.');\ncheck(handler.includes("imageUploadState: 'pending'"), 'Replacement must mark pending upload state.');\ncheck(handler.includes('storagePath: undefined'), 'Replacement must clear the old cloud object pointer.');\ncheck(handler.includes('updatedAt: imageRevision'), 'Replacement must advance record updatedAt to defeat stale snapshots.');\ncheck(app.includes('preservePendingFloorImage'), 'Realtime merge must preserve a newer pending local drawing.');\n\nconst ui = read('src/components/FloorPlanDefectTab.tsx');\ncheck(ui.includes("floorPlanProcessingKind === 'pdf'"), 'Floor-plan processing UI must branch by file type.');\ncheck(ui.includes('Đang tối ưu ảnh mặt bằng'), 'Normal image processing label missing.');\ncheck(ui.includes('không có bước chuyển PDF'), 'Image path must explicitly avoid the misleading PDF message.');\n\nconst config = read('src/components/GoogleConfigTab.tsx');\nfor (const status of ['PENDING_OUTBOX', 'PENDING_LOCAL', 'MISSING_BINARY', 'CLOUD_POINTER_INCONSISTENT']) {\n  check(config.includes(status), 'Diagnostic status missing: ' + status);\n}\ncheck(config.includes('getFloorPlanImageOutboxSnapshot'), 'Diagnostics must inspect the floor-plan outbox.');\n\nconsole.log('Floor-plan P0 golden PASS');\n`;
  write(testPath, test);

  const packagePath = 'package.json';
  const pkg = JSON.parse(read(packagePath));
  pkg.scripts['test:floorplan-p0'] = 'tsx scripts/floorplan-p0-golden.ts';
  if (!String(pkg.scripts['test:stability'] || '').includes('npm run test:floorplan-p0')) {
    pkg.scripts['test:stability'] = `${pkg.scripts['test:stability']} && npm run test:floorplan-p0`;
  }
  write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log('Applied floor-plan P0 patch successfully.');
