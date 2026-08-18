/**
 * An Phu Tool - Primary Google Drive Bridge
 * Deploy THIS script while signed in as: lengochieu1211@gmail.com
 * Web app: Execute as "Me" / access "Anyone".
 * Security: every operation verifies a Firebase ID token and project membership/role.
 */

const PRIMARY_DRIVE_OWNER_EMAIL = 'lengochieu1211@gmail.com';
const FIREBASE_PROJECT_ID = 'com-example-qlct-61329';
const FIREBASE_WEB_API_KEY = 'AIzaSyAShhTKSnmLMOEm4dST--1_X7fjJUE4znY';
const ROOT_FOLDER_NAME = 'AN PHU - QUAN LY THI CONG';

function doGet() {
  return HtmlService.createHtmlOutput(
    '<h3>An Phu Tool - Primary Drive Bridge</h3><p>Bridge đang hoạt động. Hãy cấu hình URL /exec trong ứng dụng Quản Lý Thi Công.</p>'
  );
}

function doPost(e) {
  const requestId = String((e && e.parameter && e.parameter.requestId) || '');
  try {
    const action = String((e && e.parameter && e.parameter.action) || '');
    const idToken = String((e && e.parameter && e.parameter.idToken) || '');
    const payload = parseJson_((e && e.parameter && e.parameter.payload) || '{}');
    if (!requestId) throw new Error('Thiếu requestId.');
    if (!idToken) throw new Error('Thiếu Firebase ID token.');
    if (!payload.projectId) throw new Error('Thiếu projectId.');

    const user = verifyFirebaseUser_(idToken);
    const access = getProjectAccess_(payload.projectId, idToken, user);
    _verifiedProjectForRequest = access.project;

    let result;
    switch (action) {
      case 'ping':
        result = { ownerEmail: PRIMARY_DRIVE_OWNER_EMAIL, message: 'Drive chính đã kết nối.' };
        break;
      case 'quota':
        assertAdmin_(access);
        result = getDriveQuota_();
        break;
      case 'uploadPhoto':
        assertEditor_(access);
        result = uploadPhoto_(payload, user);
        break;
      case 'downloadPhoto':
        result = downloadPhoto_(payload);
        break;
      case 'uploadFloorPlan':
        assertEditor_(access);
        result = uploadFloorPlan_(payload, user);
        break;
      case 'downloadFloorPlan':
        result = downloadFloorPlan_(payload);
        break;
      case 'uploadBackup':
        assertEditor_(access);
        result = uploadBackup_(payload, access.project, user);
        break;
      case 'deletePhoto':
        assertEditor_(access);
        result = deletePhoto_(payload);
        break;
      case 'deleteFloorPlan':
        assertEditor_(access);
        result = deleteFloorPlan_(payload);
        break;
      default:
        throw new Error('Thao tác Drive không được hỗ trợ: ' + action);
    }
    return respond_(requestId, true, result, '');
  } catch (err) {
    return respond_(requestId, false, null, err && err.message ? err.message : String(err));
  }
}

function parseJson_(value) {
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

function verifyFirebaseUser_(idToken) {
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_WEB_API_KEY);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Phiên đăng nhập Firebase không hợp lệ hoặc đã hết hạn.');
  const body = parseJson_(res.getContentText());
  const user = body.users && body.users[0];
  if (!user || !user.localId) throw new Error('Không nhận diện được tài khoản Firebase.');
  return {
    uid: String(user.localId),
    email: String(user.email || '').trim().toLowerCase(),
    displayName: String(user.displayName || ''),
  };
}

function firestoreGet_(path, idToken) {
  const safePath = String(path || '').split('/').map(encodeURIComponent).join('/');
  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FIREBASE_PROJECT_ID) + '/databases/(default)/documents/' + safePath;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + idToken },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() !== 200) throw new Error('Không có quyền truy cập dự án hoặc Firestore từ chối yêu cầu.');
  return parseJson_(res.getContentText());
}

function firestoreValue_(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) {
    const fields = (value.mapValue && value.mapValue.fields) || {};
    const out = {};
    Object.keys(fields).forEach(function(k) { out[k] = firestoreValue_(fields[k]); });
    return out;
  }
  if ('arrayValue' in value) return (((value.arrayValue || {}).values) || []).map(firestoreValue_);
  return null;
}

function firestoreDocToObject_(doc) {
  const fields = (doc && doc.fields) || {};
  const out = {};
  Object.keys(fields).forEach(function(k) { out[k] = firestoreValue_(fields[k]); });
  return out;
}

function getProjectAccess_(projectId, idToken, user) {
  const projectDoc = firestoreGet_('projects/' + projectId, idToken);
  if (!projectDoc) throw new Error('Dự án không tồn tại hoặc tài khoản chưa được cấp quyền.');
  const project = firestoreDocToObject_(projectDoc);
  const ownerUid = String(project.ownerUid || '');
  const ownerEmail = String(project.ownerEmail || '').trim().toLowerCase();
  if ((ownerUid && ownerUid === user.uid) || (ownerEmail && ownerEmail === user.email)) {
    return { role: 'ADMIN', project: project, user: user };
  }

  let memberDoc = null;
  try { memberDoc = firestoreGet_('projects/' + projectId + '/members/' + user.uid, idToken); } catch (_) {}
  if (!memberDoc && user.email) {
    try { memberDoc = firestoreGet_('projects/' + projectId + '/members/' + user.email, idToken); } catch (_) {}
  }
  if (!memberDoc) throw new Error('Tài khoản chưa được gán quyền cho dự án này.');
  const member = firestoreDocToObject_(memberDoc);
  const role = String(member.role || 'VIEWER').toUpperCase();
  return { role: role, project: project, user: user };
}

function assertEditor_(access) {
  if (!access || (access.role !== 'ADMIN' && access.role !== 'ENGINEER')) {
    throw new Error('Tài khoản chỉ có quyền xem, không được tải/xóa ảnh.');
  }
}

function assertAdmin_(access) {
  if (!access || access.role !== 'ADMIN') throw new Error('Chỉ ADMIN được xem dung lượng tổng Drive chính.');
}

function sanitizeName_(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Khong_ten';
}

function getOrCreateRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('ANPHU_ROOT_FOLDER_ID');
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (_) {}
  }
  const it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ANPHU_ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateFolder_(parent, name) {
  const safe = sanitizeName_(name);
  const it = parent.getFoldersByName(safe);
  return it.hasNext() ? it.next() : parent.createFolder(safe);
}

function getProjectFolder_(projectId, projectName) {
  const root = getOrCreateRootFolder_();
  return getOrCreateFolder_(root, sanitizeName_(projectName || 'Du_an') + '__' + String(projectId).slice(0, 12));
}

function photoFolder_(payload, project) {
  const projectFolder = getProjectFolder_(payload.projectId, project.name || payload.projectId);
  const images = getOrCreateFolder_(projectFolder, 'HINH ANH');
  const group = payload.entityType === 'crewRecord' ? 'BAO CAO QUAN SO' : 'DEFECT';
  const typeFolder = getOrCreateFolder_(images, group);
  const date = new Date(Number(payload.updatedAt || Date.now()));
  const monthFolder = getOrCreateFolder_(typeFolder, Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM'));
  return getOrCreateFolder_(monthFolder, payload.entityId || payload.photoId || 'Khac');
}

function extensionForMime_(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.indexOf('png') >= 0) return 'png';
  if (mime.indexOf('webp') >= 0) return 'webp';
  if (mime.indexOf('heic') >= 0) return 'heic';
  return 'jpg';
}

function floorPlanFolder_(payload, project) {
  const projectFolder = getProjectFolder_(payload.projectId, project.name || payload.projectId);
  const images = getOrCreateFolder_(projectFolder, 'HINH ANH');
  const typeFolder = getOrCreateFolder_(images, 'MAT BANG');
  return getOrCreateFolder_(typeFolder, payload.floorPlanId || 'Khac');
}

function uploadFloorPlan_(payload, user) {
  if (!payload.floorPlanId || !payload.base64) throw new Error('Thiếu dữ liệu ảnh mặt bằng tải lên.');
  const bytes = Utilities.base64Decode(String(payload.base64));
  if (!bytes || !bytes.length) throw new Error('Ảnh mặt bằng tải lên bị rỗng.');
  const mimeType = String(payload.mimeType || 'image/jpeg');
  const fileName = sanitizeName_(payload.floorPlanId) + '.' + extensionForMime_(mimeType);
  const project = getProjectAccessProjectCached_(payload.projectId, payload);
  const folder = floorPlanFolder_(payload, project);

  const oldFiles = folder.getFilesByName(fileName);
  while (oldFiles.hasNext()) {
    try { oldFiles.next().setTrashed(true); } catch (_) {}
  }

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setDescription(JSON.stringify({
    app: 'An Phu Tool - QLTC',
    projectId: payload.projectId,
    floorPlanId: payload.floorPlanId,
    floorName: payload.floorName || '',
    assetType: 'floor-plan',
    uploadedByUid: user.uid,
    uploadedByEmail: user.email,
    updatedAt: Number(payload.updatedAt || Date.now()),
  }));

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    mimeType: file.getMimeType(),
    fileSize: bytes.length,
    folderPath: ROOT_FOLDER_NAME + '/HINH ANH/MAT BANG',
    ownerEmail: PRIMARY_DRIVE_OWNER_EMAIL,
  };
}

function uploadPhoto_(payload, user) {
  if (!payload.photoId || !payload.base64) throw new Error('Thiếu dữ liệu ảnh tải lên.');
  const bytes = Utilities.base64Decode(String(payload.base64));
  if (!bytes || !bytes.length) throw new Error('Ảnh tải lên bị rỗng.');
  const mimeType = String(payload.mimeType || 'image/jpeg');
  const fileName = sanitizeName_(payload.photoId) + '.' + extensionForMime_(mimeType);
  const folder = photoFolder_(payload, getProjectAccessProjectCached_(payload.projectId, payload));

  const oldFiles = folder.getFilesByName(fileName);
  while (oldFiles.hasNext()) {
    try { oldFiles.next().setTrashed(true); } catch (_) {}
  }
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setDescription(JSON.stringify({
    app: 'An Phu Tool - QLTC',
    projectId: payload.projectId,
    photoId: payload.photoId,
    entityType: payload.entityType || '',
    entityId: payload.entityId || '',
    category: payload.category || '',
    uploadedByUid: user.uid,
    uploadedByEmail: user.email,
    updatedAt: Number(payload.updatedAt || Date.now()),
  }));
  return {
    fileId: file.getId(),
    fileName: file.getName(),
    mimeType: file.getMimeType(),
    fileSize: bytes.length,
    folderPath: ROOT_FOLDER_NAME + '/' + (payload.entityType === 'crewRecord' ? 'BAO CAO QUAN SO' : 'DEFECT'),
    ownerEmail: PRIMARY_DRIVE_OWNER_EMAIL,
  };
}

// Project object was already verified in getProjectAccess_(). Keep a tiny per-execution cache
// so uploadPhoto_ does not need another Firestore call. doPost sets this value below.
let _verifiedProjectForRequest = null;
function getProjectAccessProjectCached_(projectId, payload) {
  return _verifiedProjectForRequest || { name: projectId };
}

function assertFileBelongsToProject_(file, projectId, photoId) {
  const desc = parseJson_(file.getDescription() || '{}');
  if (String(desc.projectId || '') !== String(projectId || '')) throw new Error('File Drive không thuộc dự án hiện tại.');
  if (photoId && desc.photoId && String(desc.photoId) !== String(photoId)) throw new Error('ID ảnh Drive không khớp.');
}

function downloadPhoto_(payload) {
  if (!payload.fileId) throw new Error('Thiếu fileId Drive.');
  const file = DriveApp.getFileById(String(payload.fileId));
  assertFileBelongsToProject_(file, payload.projectId, payload.photoId);
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  return {
    base64: Utilities.base64Encode(bytes),
    mimeType: file.getMimeType() || blob.getContentType() || 'image/jpeg',
    fileSize: bytes.length,
    fileName: file.getName(),
  };
}

function deletePhoto_(payload) {
  if (!payload.fileId) return { deleted: false };
  const file = DriveApp.getFileById(String(payload.fileId));
  assertFileBelongsToProject_(file, payload.projectId, payload.photoId);
  file.setTrashed(true);
  return { deleted: true, fileId: payload.fileId };
}

function assertFloorPlanFileBelongsToProject_(file, projectId, floorPlanId) {
  const desc = parseJson_(file.getDescription() || '{}');
  if (String(desc.projectId || '') !== String(projectId || '')) throw new Error('File mặt bằng Drive không thuộc dự án hiện tại.');
  if (floorPlanId && desc.floorPlanId && String(desc.floorPlanId) !== String(floorPlanId)) throw new Error('ID mặt bằng Drive không khớp.');
}

function downloadFloorPlan_(payload) {
  if (!payload.fileId) throw new Error('Thiếu fileId mặt bằng Drive.');
  const file = DriveApp.getFileById(String(payload.fileId));
  assertFloorPlanFileBelongsToProject_(file, payload.projectId, payload.floorPlanId);
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  return {
    base64: Utilities.base64Encode(bytes),
    mimeType: file.getMimeType() || blob.getContentType() || 'image/jpeg',
    fileSize: bytes.length,
    fileName: file.getName(),
  };
}

function deleteFloorPlan_(payload) {
  if (!payload.fileId) return { deleted: false };
  const file = DriveApp.getFileById(String(payload.fileId));
  assertFloorPlanFileBelongsToProject_(file, payload.projectId, payload.floorPlanId);
  file.setTrashed(true);
  return { deleted: true, fileId: payload.fileId };
}

function uploadBackup_(payload, project, user) {
  const backupData = payload.backupData;
  if (!backupData || typeof backupData !== 'object') throw new Error('Thiếu dữ liệu backup JSON.');
  const projectFolder = getProjectFolder_(payload.projectId, project.name || payload.projectId);
  const backupFolder = getOrCreateFolder_(projectFolder, 'BACKUP JSON');
  const kind = String(payload.kind || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto';
  const stamp = Utilities.formatDate(new Date(Number(payload.generatedAt || Date.now())), Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmmss');
  const baseName = kind === 'auto' ? '[AUTO]_LATEST.json' : '[MANUAL]_' + stamp + '.json';
  const json = JSON.stringify(backupData, null, 2);

  // AUTO uses exactly one rolling file per project. MANUAL keeps timestamped versions.
  if (kind === 'auto') {
    const old = backupFolder.getFilesByName(baseName);
    while (old.hasNext()) {
      try { old.next().setTrashed(true); } catch (_) {}
    }
  }
  const blob = Utilities.newBlob(json, 'application/json', baseName);
  const file = backupFolder.createFile(blob);
  file.setDescription(JSON.stringify({
    app: 'An Phu Tool - QLTC',
    projectId: payload.projectId,
    backupType: kind,
    generatedAt: Number(payload.generatedAt || Date.now()),
    uploadedByUid: user.uid,
    uploadedByEmail: user.email,
  }));
  return {
    fileId: file.getId(),
    fileName: file.getName(),
    fileSize: blob.getBytes().length,
    ownerEmail: PRIMARY_DRIVE_OWNER_EMAIL,
  };
}

function getDriveQuota_() {
  const token = ScriptApp.getOAuthToken();
  const url = 'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)';
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Không đọc được dung lượng Google Drive chính.');
  const data = parseJson_(res.getContentText());
  const q = data.storageQuota || {};
  return {
    ownerEmail: (data.user && data.user.emailAddress) || PRIMARY_DRIVE_OWNER_EMAIL,
    displayName: (data.user && data.user.displayName) || '',
    usageBytes: Number(q.usage || 0),
    limitBytes: Number(q.limit || 0),
    usageInDriveBytes: Number(q.usageInDrive || 0),
    trashBytes: Number(q.usageInDriveTrash || 0),
  };
}

function respond_(requestId, ok, result, error) {
  const message = {
    channel: 'ANPHU_PRIMARY_DRIVE',
    requestId: requestId,
    ok: Boolean(ok),
    result: result || null,
    error: error || '',
  };
  const safeJson = JSON.stringify(message).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><body><script>' +
    'try{window.parent.postMessage(' + safeJson + ',"*");}catch(e){}' +
    '</script></body></html>'
  );
}
