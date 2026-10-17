/**
 * Conflict-aware, entity-scoped undo/redo for ADMIN operations.
 * Never replay an entire historical AppData snapshot over later Firestore changes.
 * This journal stores only records touched by the operation. External writes to
 * the same records invalidate the step instead of being silently overwritten.
 */
export const UNDO_COLLECTIONS = [
  'roomProgressList', 'inventory', 'workVolumes', 'floorPlans',
  'defects', 'checklist', 'crewRecords', 'teams', 'materialNorms',
] as const;

type Collection = typeof UNDO_COLLECTIONS[number];
type RecordWithId = { id: string; [key: string]: unknown };

type EntityChange = {
  collection: Collection;
  id: string;
  before: RecordWithId | null;
  after: RecordWithId | null;
};
type OrderChange = { collection: Collection; before: string[]; after: string[] };
export type ScopedUndoStep = { projectId: string; changes: EntityChange[]; orders: OrderChange[] };

const isRecordWithId = (value: unknown): value is RecordWithId =>
  Boolean(value && typeof value === 'object' && typeof (value as RecordWithId).id === 'string');

const metadataKeys = new Set(['updatedAt', 'revision', 'updatedByUid']);
const deletionKeys = new Set(['deleted', 'deletedAt', 'deletedByUid', 'deletedBy']);
const businessProjection = (record: RecordWithId | null): string => {
  if (!record) return 'null';
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (metadataKeys.has(key)) continue;
    // Missing and empty tombstone fields are equivalent for active records,
    // but a real soft-delete marker is an authoritative conflict.
    if (deletionKeys.has(key) && (record[key] == null || record[key] === false || record[key] === '')) continue;
    payload[key] = record[key];
  }
  return JSON.stringify(payload);
};
const sameBusinessRecord = (a: RecordWithId | null, b: RecordWithId | null): boolean =>
  a === b || businessProjection(a) === businessProjection(b);

const rowsFor = (data: Record<string, unknown>, key: Collection): RecordWithId[] | null => {
  const value = data[key];
  return Array.isArray(value) && value.every(isRecordWithId) ? value : null;
};

/** Produces no step if an affected collection cannot be identified safely. */
export function captureScopedUndoStep<T extends object>(before: T, after: T, projectId: string): ScopedUndoStep | null {
  if (!projectId) return null;
  const changes: EntityChange[] = [];
  const orders: OrderChange[] = [];
  for (const collection of UNDO_COLLECTIONS) {
    if ((before as Record<string, unknown>)[collection] === (after as Record<string, unknown>)[collection]) continue;
    const from = rowsFor(before as Record<string, unknown>, collection);
    const to = rowsFor(after as Record<string, unknown>, collection);
    if (!from || !to) return null;
    const oldMap = new Map(from.map((item) => [item.id, item]));
    const newMap = new Map(to.map((item) => [item.id, item]));
    if (oldMap.size !== from.length || newMap.size !== to.length) return null;
    const seen = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const id of seen) {
      const a = oldMap.get(id) || null;
      const b = newMap.get(id) || null;
      if (!sameBusinessRecord(a, b)) changes.push({ collection, id, before: a, after: b });
    }
    const oldOrder = from.map((x) => x.id);
    const newOrder = to.map((x) => x.id);
    if (oldOrder.join('\u0000') !== newOrder.join('\u0000')) {
      orders.push({ collection, before: oldOrder, after: newOrder });
    }
  }
  return changes.length || orders.length ? { projectId, changes, orders } : null;
}

export type ScopedUndoResult<T> =
  | { ok: true; state: T; changedCollections: Collection[] }
  | { ok: false; reason: 'project' | 'conflict' | 'invalid'; state: T };

/** Validation is all-or-nothing: a remote edit to one touched entity aborts the step. */
export function applyScopedUndoStep<T extends object>(
  current: T,
  step: ScopedUndoStep,
  direction: 'undo' | 'redo',
  projectId: string,
): ScopedUndoResult<T> {
  if (step.projectId !== projectId) return { ok: false, reason: 'project', state: current };
  const expectedSide = direction === 'undo' ? 'after' : 'before';
  const targetSide = direction === 'undo' ? 'before' : 'after';
  const touched = new Set<Collection>([
    ...step.changes.map((x) => x.collection), ...step.orders.map((x) => x.collection),
  ]);
  const maps = new Map<Collection, Map<string, RecordWithId>>();
  const sourceArrays = new Map<Collection, RecordWithId[]>();
  for (const collection of touched) {
    const records = rowsFor(current as Record<string, unknown>, collection);
    if (!records) return { ok: false, reason: 'invalid', state: current };
    const map = new Map(records.map((record) => [record.id, record]));
    if (map.size !== records.length) return { ok: false, reason: 'invalid', state: current };
    maps.set(collection, map);
    sourceArrays.set(collection, records);
  }
  for (const change of step.changes) {
    const actual = maps.get(change.collection)?.get(change.id) || null;
    if (!sameBusinessRecord(actual, change[expectedSide])) {
      return { ok: false, reason: 'conflict', state: current };
    }
  }
  // Pure reorders must also fail closed if another device changed the list order.
  for (const order of step.orders) {
    const expectedOrder = order[expectedSide];
    const actualOrder = sourceArrays.get(order.collection)!.map((item) => item.id);
    const comparable = actualOrder.filter((id) => expectedOrder.includes(id));
    const expectedComparable = expectedOrder.filter((id) => comparable.includes(id));
    if (comparable.join('\u0000') !== expectedComparable.join('\u0000')) {
      return { ok: false, reason: 'conflict', state: current };
    }
  }
  const output: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const collection of touched) {
    const map = maps.get(collection)!;
    for (const change of step.changes.filter((change) => change.collection === collection)) {
      const target = change[targetSide];
      if (target) map.set(change.id, target);
      else map.delete(change.id);
    }
    const order = step.orders.find((candidate) => candidate.collection === collection);
    if (order) {
      const orderedIds = order[targetSide];
      const known = orderedIds.flatMap((id) => map.has(id) ? [map.get(id)!] : []);
      const knownSet = new Set(orderedIds);
      const unrelated = Array.from(map.values()).filter((item) => !knownSet.has(item.id));
      output[collection] = [...known, ...unrelated];
    } else {
      // Preserve other users' unaffected records and their current ordering.
      const original = sourceArrays.get(collection)!;
      const visited = new Set<string>();
      const next = original.flatMap((item) => map.has(item.id) ? [map.get(item.id)!] : []);
      next.forEach((item) => visited.add(item.id));
      for (const item of map.values()) if (!visited.has(item.id)) next.push(item);
      output[collection] = next;
    }
  }
  return { ok: true, state: output as T, changedCollections: Array.from(touched) };
}
