import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const binaryStorage = read('src/lib/binaryStorage.ts');
check(binaryStorage.includes("crypto.subtle.digest('SHA-256'"), 'Media binary path must be content-addressed from SHA-256.');
check(binaryStorage.includes('async function immutableMediaInput'), 'Immutable media upload wrapper is missing.');
check(binaryStorage.includes('assetId: `${logicalAssetId}--${contentSha256}`'), 'Edited media must upload under a content-versioned asset directory.');
check(binaryStorage.includes('getCurrentRealFirebaseUser()?.uid'), 'Immutable object ownership must bind to the actual authenticated uploader.');
check(binaryStorage.includes('createdByUid: uploaderUid'), 'Versioned media object metadata must carry the actual uploader uid.');
check(binaryStorage.includes('const immutableInput = await immutableMediaInput(input)'), 'All project media uploads must use immutable media input.');
check(binaryStorage.includes('uploadProjectBinary(immutableInput)'), 'Firebase Storage media upload must use immutable asset id.');
check(binaryStorage.includes('uploadProjectBinaryToR2(immutableInput)'), 'R2 media upload must use immutable asset id.');

const photoStorage = read('src/utils/photoStorage.ts');
check(photoStorage.includes('export async function updatePhotoAttachmentBlob'), 'Photo edit/replace path missing.');
check(photoStorage.includes("binaryUploadState: 'pending'"), 'Edited attachment must return to pending before Cloud publication.');
check(photoStorage.includes("storagePath: ''"), 'Edited attachment must clear the old shared pointer locally until replacement publication.');
check(photoStorage.includes('revision: Math.max(Number(p.revision || 0) + 1, 1)'), 'Edited attachment must advance revision.');

const cloudSync = read('src/lib/photoCloudSync.ts');
check(cloudSync.includes('uploadProjectBinaryToCloud'), 'Photo Cloud sync must route through binaryStorage atomic uploader.');
check(cloudSync.includes("binaryUploadState: 'ready'"), 'Photo metadata must publish an explicit ready state only after upload.');

const storageRules = read('storage.rules');
check(storageRules.includes('match /projects/{projectId}/media/{entityType}/{entityId}/{assetId}/{fileName}'), 'Storage rules must preserve project/entity/asset isolation for versioned media paths.');
check(storageRules.includes('request.resource.metadata.assetId == assetId'), 'Storage rules must bind metadata assetId to the immutable path segment.');
check(storageRules.includes('request.resource.metadata.createdByUid == request.auth.uid'), 'Storage rules must bind object uploader metadata to Firebase auth uid.');

console.log('Media P0 atomic publication golden PASS');
