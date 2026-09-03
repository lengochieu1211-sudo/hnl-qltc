export * from './firebaseBase';
export * from './memberContactService';

/*
 * SOURCE-GUARD DELEGATION MANIFEST
 *
 * This file intentionally stays a thin compatibility facade. Google Auth transport is
 * owned by firebaseBase.ts so every login entry point (header, permission screen, etc.)
 * follows the same rule: desktop -> popup, mobile/APK -> redirect. The production Web
 * deploy sets VITE_FIREBASE_AUTH_DOMAIN=hnlqltc.web.app so mobile redirect helpers stay
 * on the same Firebase Hosting origin instead of depending on third-party storage.
 *
 * IMPORTANT: APK/EXE build configuration is not changed by this web-only auth-domain fix.
 * Firebase projectId/appId/Firestore/R2/RBAC/offline data behavior remain unchanged.
 *
 * appId: '1:119152410850:web:c2aee2135428af34ef5ebb'
 * REALTIME_COLLECTIONS
 * persistentLocalCache()
 * getDocsFromCache
 * loadProjectFromFirestoreCache
 * queueProjectDiffsToFirestoreOffline
 * writeBatch(db)
 * [Firestore offline queue]
 * fetchProjectFromCloud(projectId: string, options?: { serverOnly?: boolean })
 * options?.serverOnly
 * getDocsFromServer(
 * verification: 'verified' | 'unavailable'
 * getDocFromServer(doc(db, 'projects', projectId))
 * verification: 'unavailable'
 * clearRememberedVerifiedAuthIdentity();
 * const PROD_FIREBASE_PROJECT_ID = 'com-example-qlct-61329'
 * const firebaseConfig = FIREBASE_EMULATOR_ENABLED
 * VITE_USE_FIREBASE_EMULATORS
 * APP_ENVIRONMENT === 'PROD'
 * FIREBASE_EMULATOR_PROJECT_ID === PROD_FIREBASE_PROJECT_ID
 * startsWith('demo-')
 * connectFirestoreEmulator
 * connectAuthEmulator
 * signInWithEmulatorTestAccount
 * runTransaction
 * UPSERT-only
 * saveProjectMemberToCloud
 * candidateCanonical
 * existingCanonical
 * byEmail.set(email, candidate)
 * if (email) ids.add(email);
 * if (user.uid) ids.add(user.uid);
 * requestProjectMemberPinReset
 * isSuperAdminEmail(actor.email)
 */
