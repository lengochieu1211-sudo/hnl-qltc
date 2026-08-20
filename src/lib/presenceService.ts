import { getDatabase, onDisconnect, onValue, ref, remove, serverTimestamp as rtdbServerTimestamp, set, type Database, type Unsubscribe } from 'firebase/database';
import { firebaseApp, getCurrentRealFirebaseUser } from './firebase';
import { getDeviceId, getDeviceName } from '../utils/deviceIdentity';

const env = (import.meta as any).env || {};
const databaseUrl = String(env.VITE_FIREBASE_DATABASE_URL || '').trim();
let database: Database | null = null;

export const isPresenceConfigured = Boolean(databaseUrl && /^https:\/\//i.test(databaseUrl));

function getPresenceDb(): Database | null {
  if (!isPresenceConfigured) return null;
  if (!database) database = getDatabase(firebaseApp, databaseUrl);
  return database;
}

export interface PresenceState {
  online: boolean;
  connectionCount: number;
  lastSeen: number;
}

export function startPresence(): () => void {
  const db = getPresenceDb();
  const user = getCurrentRealFirebaseUser();
  if (!db || !user) return () => {};

  const deviceId = getDeviceId();
  const connectedRef = ref(db, '.info/connected');
  const connectionRef = ref(db, `presence/${user.uid}/connections/${deviceId}`);
  const lastSeenRef = ref(db, `presence/${user.uid}/lastSeen`);
  let armed = true;

  const unsub = onValue(connectedRef, async (snap) => {
    if (!armed || snap.val() !== true) return;
    try {
      await onDisconnect(connectionRef).remove();
      await onDisconnect(lastSeenRef).set(rtdbServerTimestamp());
      await set(connectionRef, {
        connectedAt: rtdbServerTimestamp(),
        deviceName: getDeviceName(),
      });
    } catch (err) {
      console.warn('[Presence] connection setup failed:', err);
    }
  });

  return () => {
    armed = false;
    unsub();
    remove(connectionRef).catch(() => {});
    set(lastSeenRef, rtdbServerTimestamp()).catch(() => {});
  };
}

export function subscribeUserPresence(uid: string, onUpdate: (state: PresenceState) => void): Unsubscribe {
  const db = getPresenceDb();
  if (!db || !uid) { onUpdate({ online: false, connectionCount: 0, lastSeen: 0 }); return () => {}; }
  return onValue(ref(db, `presence/${uid}`), (snap) => {
    const value = snap.val() || {};
    const connections = value.connections && typeof value.connections === 'object' ? Object.keys(value.connections) : [];
    onUpdate({
      online: connections.length > 0,
      connectionCount: connections.length,
      lastSeen: typeof value.lastSeen === 'number' ? value.lastSeen : 0,
    });
  });
}

export function setTyping(conversationId: string, typing: boolean): Promise<void> {
  const db = getPresenceDb();
  const user = getCurrentRealFirebaseUser();
  if (!db || !user || !conversationId) return Promise.resolve();
  const typingRef = ref(db, `typing/${conversationId}/${user.uid}`);
  if (!typing) return remove(typingRef);
  return onDisconnect(typingRef).remove()
    .then(() => set(typingRef, { active: true, at: rtdbServerTimestamp(), name: user.displayName || user.email || 'Thành viên' }));
}

export function subscribeTyping(conversationId: string, onUpdate: (users: Array<{ uid: string; name: string }>) => void): Unsubscribe {
  const db = getPresenceDb();
  const me = getCurrentRealFirebaseUser();
  if (!db || !conversationId) { onUpdate([]); return () => {}; }
  return onValue(ref(db, `typing/${conversationId}`), (snap) => {
    const value = snap.val() || {};
    const now = Date.now();
    const users = Object.entries(value)
      .filter(([uid, item]: any) => uid !== me?.uid && item?.active && (!item.at || now - Number(item.at) < 15000))
      .map(([uid, item]: any) => ({ uid, name: String(item?.name || 'Thành viên') }));
    onUpdate(users);
  });
}
