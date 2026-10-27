/**
 * HNL QLTC P8: OFFLINE-ONLY migration preflight for ADMIN-owned room subitem
 * definitions and EDITOR-owned progress. This tool performs NO Cloud writes.
 *
 * Stable intended paths:
 * projects/{projectId}/rooms/{roomId}/subitem_definitions/{subItemId}
 * projects/{projectId}/rooms/{roomId}/subitem_progress/{subItemId}
 *
 * The paths above are a design target, NOT active Firestore collections/rules.
 * Usage: node scripts/room-subitem-migration-plan.mjs --project ID --input local.json
 * Optional: --output local-private-plan.json (writes PII-containing payloads LOCALLY).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK_STATUSES = new Set(['Chưa làm', 'Đang làm', 'Đã hoàn thành']);
const INSPECTION_STATUSES = new Set(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)']);
const DEFINITION_FIELDS = ['name', 'category', 'workCategoryId', 'workVolume', 'volumeUnit', 'progressWeight'];
const PROGRESS_FIELDS = ['status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId'];
const KNOWN_FIELDS = new Set(['id', ...DEFINITION_FIELDS, ...PROGRESS_FIELDS]);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validDocId = (value) => typeof value === 'string' && value.length > 0
  && value.trim() === value && value !== '.' && value !== '..'
  && !value.includes('/') && !/^__.*__$/.test(value)
  && Buffer.byteLength(value, 'utf8') <= 1500;

function take(record, fields) {
  const result = {};
  for (const field of fields) if (Object.hasOwn(record, field)) result[field] = record[field];
  return result;
}

function parseRooms(input) {
  if (Array.isArray(input)) return input;
  if (!isPlain(input)) throw new Error('INVALID_SNAPSHOT: expected array/object');
  for (const field of ['roomProgressList', 'rooms', 'documents']) {
    if (Array.isArray(input[field])) return input[field];
  }
  // Firestore keyed document map; intentionally do not guess arbitrary object.
  if (isPlain(input.byRoomId)) {
    return Object.entries(input.byRoomId).map(([id, data]) => isPlain(data) ? ({ ...data, id: data.id ?? id }) : null);
  }
  throw new Error('INVALID_SNAPSHOT: expected rooms/roomProgressList/documents or byRoomId');
}

export function planRoomSubItemMigration(input, { projectId } = {}) {
  if (!validDocId(projectId)) throw new Error('INVALID_PROJECT_ID');
  const rooms = parseRooms(input);
  const issues = [], warnings = [], definitions = [], progress = [], roomHashes = [];
  const seenRoomIds = new Set();
  let deletedRooms = 0;
  const issue = (code, roomIndex, subIndex) => issues.push({ code, roomIndex, ...(subIndex === undefined ? {} : { subIndex }) });

  if (!rooms.length) issue('EMPTY_ROOM_SNAPSHOT', -1);

  for (const [roomIndex, room] of rooms.entries()) {
    if (!isPlain(room)) { issue('INVALID_ROOM', roomIndex); continue; }
    const roomId = room.id;
    if (!validDocId(roomId)) { issue('INVALID_ROOM_ID', roomIndex); continue; }
    if (seenRoomIds.has(roomId)) { issue('DUPLICATE_ROOM_ID', roomIndex); continue; }
    seenRoomIds.add(roomId);
    if (Object.hasOwn(room, 'projectId') && room.projectId !== projectId) {
      issue('PROJECT_SCOPE_MISMATCH', roomIndex); continue;
    }
    if (room.deleted === true || (room.deletedAt !== undefined && room.deletedAt !== null)) {
      deletedRooms += 1;
      continue; // preserve original tombstone; never revive via sidecar backfill
    }
    if (room.subItems !== undefined && room.subItems !== null && !Array.isArray(room.subItems)) {
      issue('INVALID_SUBITEM_ARRAY', roomIndex); continue;
    }
    const sourceItems = room.subItems || [];
    const itemIds = new Set();
    for (const [subIndex, sub] of sourceItems.entries()) {
      if (!isPlain(sub)) { issue('INVALID_SUBITEM', roomIndex, subIndex); continue; }
      if (!validDocId(sub.id)) { issue('INVALID_SUBITEM_ID', roomIndex, subIndex); continue; }
      if (itemIds.has(sub.id)) { issue('DUPLICATE_SUBITEM_ID', roomIndex, subIndex); continue; }
      itemIds.add(sub.id);
      // A sidecar migration MUST NOT silently discard unknown legacy custom fields.
      if (Object.keys(sub).some(field => !KNOWN_FIELDS.has(field))) issue('UNRECOGNIZED_SUBITEM_FIELDS', roomIndex, subIndex);
      for (const field of ['category', 'workCategoryId', 'volumeUnit', 'targetDate', 'assignedTeam', 'teamId']) {
        if (Object.hasOwn(sub, field) && typeof sub[field] !== 'string') issue(`INVALID_${field.toUpperCase()}`, roomIndex, subIndex);
      }
      if (typeof sub.name !== 'string' || !sub.name.trim()) issue('INVALID_SUBITEM_NAME', roomIndex, subIndex);
      if (!WORK_STATUSES.has(sub.status)) issue('INVALID_SUBITEM_STATUS', roomIndex, subIndex);
      if (sub.inspectionStatus !== undefined && !INSPECTION_STATUSES.has(sub.inspectionStatus)) {
        issue('INVALID_INSPECTION_STATUS', roomIndex, subIndex);
      }
      for (const field of ['workVolume', 'progressWeight']) {
        if (sub[field] !== undefined && (typeof sub[field] !== 'number' || !Number.isFinite(sub[field]) || sub[field] < 0)) {
          issue(`INVALID_${field.toUpperCase()}`, roomIndex, subIndex);
        }
      }
      if (sub.targetDate !== undefined && (typeof sub.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sub.targetDate))) {
        issue('INVALID_TARGET_DATE', roomIndex, subIndex);
      }
      const docPath = `projects/${projectId}/rooms/${roomId}`;
      definitions.push({
        path: `${docPath}/subitem_definitions/${sub.id}`,
        data: { id: sub.id, projectId, roomId, order: subIndex, ...take(sub, DEFINITION_FIELDS) },
      });
      progress.push({
        path: `${docPath}/subitem_progress/${sub.id}`,
        data: { id: sub.id, projectId, roomId, ...take(sub, PROGRESS_FIELDS) },
      });
    }
    roomHashes.push({ roomId, subItemsHash: hash(sourceItems), sourceRevision: room.revision ?? null, sourceUpdatedAt: room.updatedAt ?? null });
    if (sourceItems.length && !Number.isInteger(room.revision)) warnings.push({ code: 'LEGACY_ROOM_REVISION_MISSING', roomIndex });
  }

  definitions.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  progress.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  roomHashes.sort((a, b) => a.roomId.localeCompare(b.roomId, 'en'));
  const isBlocked = issues.length > 0;
  return {
    status: isBlocked ? 'BLOCKED' : 'PLAN_READY_FOR_SERVER_VALIDATION',
    note: 'Offline-only proposed migration payload. NOT a Cloud write, parity proof, deployed schema or release certification.',
    projectId,
    counts: {
      snapshotRooms: rooms.length, activeRooms: roomHashes.length, deletedRooms,
      definitions: definitions.length, progress: progress.length,
      issues: issues.length, warnings: warnings.length,
    },
    issues, warnings,
    // Manifest can be checked against a fresh server snapshot BEFORE any migration.
    sourceManifest: roomHashes,
    payloadDigest: hash({ definitions, progress, roomHashes }),
    // On any malformed/duplicate input, never export a partial import plan.
    definitions: isBlocked ? [] : definitions,
    progress: isBlocked ? [] : progress,
  };
}

function main() {
  const a = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < a.length; i += 2) {
    if (!['--input', '--project', '--output'].includes(a[i]) || !a[i + 1] || args.has(a[i])) {
      console.error('Usage: node scripts/room-subitem-migration-plan.mjs --project ID --input snapshot.json [--output PRIVATE_LOCAL_PLAN.json]');
      return 1;
    }
    args.set(a[i], a[i + 1]);
  }
  if (!args.has('--input') || !args.has('--project')) { console.error('Missing --input / --project'); return 1; }
  try {
    const json = JSON.parse(readFileSync(resolve(args.get('--input')), 'utf8'));
    const result = planRoomSubItemMigration(json, { projectId: args.get('--project') });
    const { definitions: _definitions, progress: _progress, sourceManifest: _manifest, ...report } = result;
    console.log(JSON.stringify(report, null, 2)); // Do not print private room names / teams / payload to terminal.
    if (args.has('--output')) {
      if (result.status !== 'PLAN_READY_FOR_SERVER_VALIDATION') {
        console.error('REFUSED: invalid snapshot; no partial migration output written.');
        return 2;
      }
      writeFileSync(resolve(args.get('--output')), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
      console.log('Private local plan written (mode 0600). NEVER upload without authorization.');
    }
    return result.status === 'BLOCKED' ? 2 : 0;
  } catch (error) {
    console.error(`ROOM_SUBITEM_MIGRATION_ABORTED: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = main();
