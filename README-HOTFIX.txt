V6.2.10 BUILD HOTFIX

Fixes GitHub Actions Build #53 TypeScript errors only.
No business-data schema, Firebase project, project permissions, memory-cache design, migration logic, or UI behavior is changed.

Files:
- src/lib/firebase.ts
  * Remove duplicate import of cleanupTransientLocalStorage / estimateLocalStorageBytes.
- src/utils/backupDb.ts
  * Add missing import localforage.
  * Add missing import LEGACY_AUTOSAVE_RAW_KEY from migrateStorage.

Update:
Extract -> copy contents into current repo -> Replace -> Commit -> Push.
Commit: V6.2.10 - Fix TypeScript build errors in storage recovery
