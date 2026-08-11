import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import multer from 'multer';
import { Readable } from 'stream';

dotenv.config();

const safeFilename = typeof __filename !== 'undefined' ? __filename : process.cwd();

const safeDirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(safeFilename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Memory storage for uploaded files via multer
const upload = multer({ storage: multer.memoryStorage() });

// OAuth Token Memory Store per Session ID (Isolated per user/browser)
const userTokensStore = new Map<string, any>();

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

function getSessionId(req?: express.Request, res?: express.Response): string {
  if (!req) return 'default_session';

  // Header or query override
  const headerSid = (req.headers['x-session-id'] as string) || (req.query.sid as string);
  if (headerSid) return headerSid;

  // Cookie check
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.sid) return cookies.sid;

  // Generate new session ID
  const newSid = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  if (res) {
    res.setHeader('Set-Cookie', `sid=${newSid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return newSid;
}

function getUserTokens(req?: express.Request): any {
  const sid = getSessionId(req);
  return userTokensStore.get(sid) || null;
}

function setUserTokens(tokens: any, req?: express.Request, res?: express.Response): void {
  const sid = getSessionId(req, res);
  userTokensStore.set(sid, tokens);
}

function clearUserTokens(req?: express.Request, res?: express.Response): void {
  const sid = getSessionId(req, res);
  userTokensStore.delete(sid);
}

function getOAuth2Client(req?: express.Request) {
  const clientId = process.env.CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  let appUrl = process.env.APP_URL;
  if (!appUrl && req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    appUrl = `${protocol}://${host}`;
  }
  if (!appUrl) {
    appUrl = 'http://localhost:3000';
  }

  const redirectUri = `${appUrl}/api/auth/callback`;

  if (!clientId || !clientSecret) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthenticatedAuthClient(req?: express.Request) {
  const oauth2Client = getOAuth2Client(req);
  const tokens = getUserTokens(req);
  if (!oauth2Client || !tokens) return null;
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

// ==========================================
// AUTH ROUTES
// ==========================================

app.get('/api/auth/url', (req, res) => {
  const oauth2Client = getOAuth2Client(req);
  if (!oauth2Client) {
    return res.json({
      configured: false,
      message: 'Chế độ Lưu trữ Tự do (Local Storage & Export Excel/PDF/Base64) đang hoạt động. Bạn có thể lưu dữ liệu công trình và tải xuất file hoàn toàn đầy đủ mà không cần cấu hình Google OAuth.',
    });
  }

  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  return res.json({ url: authUrl, configured: true });
});

app.get('/api/auth/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  const oauth2Client = getOAuth2Client(req);
  if (!oauth2Client) {
    return res.status(500).send('OAuth client not configured');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    setUserTokens(tokens, req, res);
    oauth2Client.setCredentials(tokens);

    // Get user info if possible
    let userEmail = 'Đã kết nối Google';
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      if (userInfo.data.email) {
        userEmail = userInfo.data.email;
      }
    } catch (e) {
      console.warn('Could not fetch user profile:', e);
    }

    // Redirect back to app main screen
    res.send(`
      <html>
        <head>
          <title>Google Authentication Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px; background: #f8fafc; color: #0f172a; }
            .card { background: white; max-width: 420px; margin: 0 auto; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h2 { margin-bottom: 8px; color: #166534; }
            p { color: #475569; margin-bottom: 24px; }
            button { background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h2>Kết Nối Google Thành Công!</h2>
            <p>Đã liên kết tài khoản Google Drive & Sheets (${userEmail}). Ứng dụng sẽ tự động quay lại trong giây lát...</p>
            <button onclick="window.close(); if(window.opener){window.opener.location.reload();}">Quay Lại Ứng Dụng</button>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', email: '${userEmail}' }, '*');
              setTimeout(() => window.close(), 2000);
            } else {
              setTimeout(() => { window.location.href = '/'; }, 2000);
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('OAuth token exchange error:', err);
    res.status(500).send(`Xác thực thất bại: ${err.message}`);
  }
});

app.get('/api/auth/status', async (req, res) => {
  if (!getUserTokens(req)) {
    return res.json({ authenticated: false });
  }

  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.json({ authenticated: false });
  }

  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: authClient });
    const userInfo = await oauth2.userinfo.get();
    return res.json({
      authenticated: true,
      email: userInfo.data.email,
      name: userInfo.data.name,
      picture: userInfo.data.picture,
    });
  } catch (err) {
    return res.json({ authenticated: true, email: 'Đã kết nối Google' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearUserTokens(req, res);
  res.json({ success: true });
});

// ==========================================
// GOOGLE SHEETS ENDPOINTS
// ==========================================

app.post('/api/sheets/sync-all', async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.status(401).json({ error: 'Chưa kết nối Google OAuth. Vui lòng đăng nhập Google.' });
  }

  const { projectName, inventory, workVolumes, floorChecklists, defects, floorPlans, roomProgressList, materialNorms } = req.body;
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Search if spreadsheet exists for this project
    const sheetTitle = `[Quản Lý Thi Công] - ${projectName || 'Công Trình Mẫu'}`;
    let spreadsheetId = '';

    const listRes = await drive.files.list({
      q: `name = '${sheetTitle}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      fields: 'files(id, name, webViewLink)',
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
      spreadsheetId = listRes.data.files[0].id!;
    } else {
      // Create new spreadsheet
      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: sheetTitle,
          },
          sheets: [
            { properties: { title: 'Nhập Xuất Kho' } },
            { properties: { title: 'Khối Lượng Thi Công' } },
            { properties: { title: 'Checklist & Defect Tầng' } },
          ],
        },
      });
      spreadsheetId = createRes.data.spreadsheetId!;
    }

    // 2. Format Inventory Data
    const inventoryRows = [
      ['Mã GD', 'Ngày', 'Loại', 'Tên Vật Tư / Vật Liệu', 'Đơn Vị', 'Số Lượng', 'Tầng / Vị Trí', 'Người Thực Hiện', 'Ghi Chú'],
      ...(inventory || []).map((item: any) => [
        item.id || '',
        item.date || '',
        item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
        item.materialName || '',
        item.unit || '',
        item.quantity || 0,
        item.location || '',
        item.handler || '',
        item.notes || '',
      ]),
    ];

    // 3. Format Work Volume Data
    const volumeRows = [
      ['Mã Hạng Mục', 'Tên Hạng Mục', 'Vị Trí Tầng', 'Đơn Vị', 'Kế Hoạch', 'Thực Hiện', 'Tỷ Lệ (%)', 'Đơn Giá (VNĐ)', 'Thành Tiền (VNĐ)', 'Trạng Thái'],
      ...(workVolumes || []).map((item: any) => [
        item.id || '',
        item.title || '',
        item.floor || '',
        item.unit || '',
        item.planned || 0,
        item.actual || 0,
        `${Math.round(((item.actual || 0) / (item.planned || 1)) * 100)}%`,
        item.unitPrice || 0,
        (item.actual || 0) * (item.unitPrice || 0),
        item.status || 'Đang thi công',
      ]),
    ];

    // 4. Format Checklist & Defect Data
    const checklistRows = [
      ['Mã', 'Tầng', 'Hạng Mục Thi Công', 'Nội Dung Kiểm Tra', 'Trạng Thái Nghiệm Thu', 'Số Lỗi Defect', 'Ghi Chú / Bắn Tấm / Khung Trần'],
      ...(floorChecklists || []).map((item: any) => [
        item.id || '',
        item.floor || '',
        item.category || '',
        item.title || '',
        item.status === 'passed' ? 'ĐÃ NGHIỆM THU' : item.status === 'defect' ? 'CÓ DEFECT (LỖI)' : 'CHƯA NGHIỆM THU',
        item.defectCount || 0,
        item.notes || '',
      ]),
      [''],
      ['DANH SÁCH DEFECT (LỖI ĐỊNH VỊ TRÊN MẶT BẰNG)'],
      ['Mã Defect', 'Tầng', 'Loại Lỗi', 'Mô Tả Lỗi', 'Mức Độ', 'Tọa Độ (X,Y)', 'Đơn Vị Sửa', 'Link Ảnh Drive', 'Trạng Thái Sửa'],
      ...(defects || []).map((d: any) => [
        d.id || '',
        d.floor || '',
        d.category || '',
        d.description || '',
        d.severity || 'Trung bình',
        `(${d.x}%, ${d.y}%)`,
        d.assignedTo || '',
        d.imageUrl || '',
        d.status || 'Chưa khắc phục',
      ]),
    ];

    // Update spreadsheet values
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Nhập Xuất Kho!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: inventoryRows },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Khối Lượng Thi Công!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: volumeRows },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Checklist & Defect Tầng!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: checklistRows },
    });

    // Save full JSON backup file to Google Drive
    try {
      const backupFileName = `[Backup Dữ Liệu Công Trình] - ${projectName || 'Công Trình'}.json`;
      const fullBackupData = JSON.stringify({
        projectName: projectName || 'Công Trình',
        updatedAt: new Date().toLocaleString('vi-VN'),
        inventory: inventory || [],
        workVolumes: workVolumes || [],
        checklist: floorChecklists || [],
        defects: defects || [],
        floorPlans: floorPlans || [],
        roomProgressList: roomProgressList || [],
        materialNorms: materialNorms || [],
      }, null, 2);

      const backupSearch = await drive.files.list({
        q: `name = '${backupFileName}' and trashed = false`,
        fields: 'files(id)',
      });

      const media = {
        mimeType: 'application/json',
        body: Readable.from([fullBackupData]),
      };

      if (backupSearch.data.files && backupSearch.data.files.length > 0) {
        await drive.files.update({
          fileId: backupSearch.data.files[0].id!,
          media,
        });
      } else {
        await drive.files.create({
          requestBody: {
            name: backupFileName,
            mimeType: 'application/json',
          },
          media,
        });
      }
    } catch (backupErr) {
      console.warn('Google Drive JSON backup warning:', backupErr);
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      message: 'Đã lưu & đồng bộ toàn bộ dữ liệu công trình lên Google Sheets & Google Drive thành công!',
    });
  } catch (err: any) {
    console.error('Google Sheets Sync Error:', err);
    return res.status(500).json({
      error: `Không thể đồng bộ Google Sheets: ${err.message}`,
    });
  }
});

// ==========================================
// GOOGLE DRIVE ENDPOINTS
// ==========================================

app.post('/api/drive/upload-image', upload.single('file'), async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);

  // Base64 or multipart support
  let fileBuffer: Buffer | null = null;
  let fileName = req.body.fileName || `construction_upload_${Date.now()}.png`;
  let mimeType = req.body.mimeType || 'image/png';

  if (req.file) {
    fileBuffer = req.file.buffer;
    fileName = req.file.originalname || fileName;
    mimeType = req.file.mimetype || mimeType;
  } else if (req.body.base64Data) {
    const base64Data = req.body.base64Data.replace(/^data:image\/\w+;base64,/, '');
    fileBuffer = Buffer.from(base64Data, 'base64');
  }

  if (!fileBuffer) {
    return res.status(400).json({ error: 'Không tìm thấy dữ liệu tệp tin hình ảnh' });
  }

  if (!authClient) {
    // Local mode fallback if Google OAuth isn't connected yet
    const base64Url = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    return res.json({
      success: true,
      isLocal: true,
      url: base64Url,
      message: 'Lưu ảnh nội bộ (Kết nối Google OAuth để tải trực tiếp lên Google Drive)',
    });
  }

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });

    // Check if folder "Thủ Kho & Defect Công Trình" exists
    let folderId = '';
    const folderSearch = await drive.files.list({
      q: "name = 'Ảnh Thi Công Công Trình' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id)',
    });

    if (folderSearch.data.files && folderSearch.data.files.length > 0) {
      folderId = folderSearch.data.files[0].id!;
    } else {
      const folderCreate = await drive.files.create({
        requestBody: {
          name: 'Ảnh Thi Công Công Trình',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });
      folderId = folderCreate.data.id!;
    }

    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);

    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };

    const media = {
      mimeType,
      body: stream,
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, webViewLink, webContentLink, thumbnailLink',
    });

    // Make file viewable by anyone with link
    try {
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (e) {
      console.warn('Could not set public permission:', e);
    }

    return res.json({
      success: true,
      isLocal: false,
      fileId: file.data.id,
      fileName: file.data.name,
      url: file.data.webViewLink,
      directUrl: `https://lh3.googleusercontent.com/d/${file.data.id}`,
      webViewLink: file.data.webViewLink,
      message: 'Đã tải ảnh lên thư mục Google Drive thành công!',
    });
  } catch (err: any) {
    console.error('Drive Upload Error:', err);
    // Fallback to base64 data URL
    const base64Url = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    return res.json({
      success: true,
      isLocal: true,
      url: base64Url,
      warning: `Không thể đẩy lên Drive: ${err.message}. Đã lưu ở máy tạm thời.`,
    });
  }
});

app.post('/api/drive/sync-up', async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.status(401).json({ error: 'Chưa kết nối tài khoản Google. Vui lòng kết nối để sử dụng tự động sao lưu.' });
  }

  const {
    folderId = '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6',
    projectName,
    contractorName,
    inspectorName,
    inventory,
    workVolumes,
    checklist,
    defects,
    floorPlans,
    roomProgressList,
    materialNorms,
    updatedAt
  } = req.body;

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });

    let processedFloorPlans = [...(floorPlans || [])];
    let processedDefects = [...(defects || [])];
    let hasUploadedImages = false;
    let imagesFolderId = '';

    // Helper to get or create images subfolder inside the main sync folder
    const getImagesFolderId = async () => {
      if (imagesFolderId) return imagesFolderId;
      try {
        const folderName = 'Ảnh Bản Vẽ & Sự Cố';
        const folderSearch = await drive.files.list({
          q: `name = '${folderName}' and '${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id)',
        });

        if (folderSearch.data.files && folderSearch.data.files.length > 0) {
          imagesFolderId = folderSearch.data.files[0].id!;
        } else {
          const folderCreate = await drive.files.create({
            requestBody: {
              name: folderName,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [folderId],
            },
            fields: 'id',
          });
          imagesFolderId = folderCreate.data.id!;
        }

        // Try to set public read permission on the images subfolder
        try {
          await drive.permissions.create({
            fileId: imagesFolderId,
            requestBody: {
              role: 'reader',
              type: 'anyone',
            },
          });
        } catch (pe) {
          console.warn('Could not set public read on images folder:', pe);
        }
      } catch (err) {
        console.error('Error creating images folder:', err);
        imagesFolderId = folderId; // Fallback to main folder
      }
      return imagesFolderId;
    };

    // 1. Process Floor Plans
    for (let i = 0; i < processedFloorPlans.length; i++) {
      const plan = { ...processedFloorPlans[i] };
      if (plan.imageUrl && plan.imageUrl.startsWith('data:')) {
        try {
          const targetFolder = await getImagesFolderId();
          const matches = plan.imageUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const base64String = matches[2];
            const fileBuffer = Buffer.from(base64String, 'base64');

            const stream = new Readable();
            stream.push(fileBuffer);
            stream.push(null);

            const safeFloorName = (plan.floorName || `tang_${i + 1}`).replace(/[^a-zA-Z0-9\s-_]/g, '').trim().replace(/\s+/g, '_');
            const fileName = `BanVe_${safeFloorName}_${Date.now()}.png`;

            const imgFile = await drive.files.create({
              requestBody: {
                name: fileName,
                parents: [targetFolder],
              },
              media: {
                mimeType,
                body: stream,
              },
              fields: 'id, name, webViewLink',
            });

            const imgId = imgFile.data.id!;

            // Try to set public read permission on individual file
            try {
              await drive.permissions.create({
                fileId: imgId,
                requestBody: {
                  role: 'reader',
                  type: 'anyone',
                },
              });
            } catch (pe) {
              console.warn('Could not set public read on plan image:', pe);
            }

            plan.driveFileId = imgId;
            plan.driveUrl = imgFile.data.webViewLink || '';
            plan.imageUrl = `https://lh3.googleusercontent.com/d/${imgId}`;
            processedFloorPlans[i] = plan;
            hasUploadedImages = true;
          }
        } catch (uploadErr) {
          console.error(`Error uploading floor plan image ${plan.floorName}:`, uploadErr);
        }
      }
    }

    // 2. Process Defects
    for (let i = 0; i < processedDefects.length; i++) {
      const defect = { ...processedDefects[i] };
      if (defect.imageUrl && defect.imageUrl.startsWith('data:')) {
        try {
          const targetFolder = await getImagesFolderId();
          const matches = defect.imageUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const base64String = matches[2];
            const fileBuffer = Buffer.from(base64String, 'base64');

            const stream = new Readable();
            stream.push(fileBuffer);
            stream.push(null);

            const safeCategory = (defect.category || 'suco').replace(/[^a-zA-Z0-9\s-_]/g, '').trim().replace(/\s+/g, '_');
            const fileName = `AnhSuCo_${safeCategory}_${defect.id || Date.now()}.png`;

            const imgFile = await drive.files.create({
              requestBody: {
                name: fileName,
                parents: [targetFolder],
              },
              media: {
                mimeType,
                body: stream,
              },
              fields: 'id, name, webViewLink',
            });

            const imgId = imgFile.data.id!;

            // Try to set public read permission on individual file
            try {
              await drive.permissions.create({
                fileId: imgId,
                requestBody: {
                  role: 'reader',
                  type: 'anyone',
                },
              });
            } catch (pe) {
              console.warn('Could not set public read on defect image:', pe);
            }

            defect.imageUrl = `https://lh3.googleusercontent.com/d/${imgId}`;
            processedDefects[i] = defect;
            hasUploadedImages = true;
          }
        } catch (uploadErr) {
          console.error(`Error uploading defect image ${defect.id}:`, uploadErr);
        }
      }
    }

    // Format the backup JSON data with processed (clean direct link) values
    const backupData = JSON.stringify({
      projectName: projectName || 'Công Trình Mẫu',
      contractorName: contractorName || '',
      inspectorName: inspectorName || '',
      inventory: inventory || [],
      workVolumes: workVolumes || [],
      checklist: checklist || [],
      defects: processedDefects,
      floorPlans: processedFloorPlans,
      roomProgressList: roomProgressList || [],
      materialNorms: materialNorms || [],
      updatedAt: updatedAt || Date.now()
    }, null, 2);

    const backupFileName = 'construction_sync.json';

    // 1. Search for existing sync file inside the specific parent folder
    const fileSearch = await drive.files.list({
      q: `name = '${backupFileName}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, webViewLink)',
    });

    const stream = new Readable();
    stream.push(backupData);
    stream.push(null);

    const media = {
      mimeType: 'application/json',
      body: stream,
    };

    let fileId = '';
    let webViewLink = '';

    if (fileSearch.data.files && fileSearch.data.files.length > 0) {
      // Update existing file
      fileId = fileSearch.data.files[0].id!;
      const updateRes = await drive.files.update({
        fileId,
        media,
        fields: 'id, name, webViewLink',
      });
      webViewLink = updateRes.data.webViewLink || '';
    } else {
      // Create new file in the target folder
      const createRes = await drive.files.create({
        requestBody: {
          name: backupFileName,
          parents: [folderId],
          mimeType: 'application/json',
        },
        media,
        fields: 'id, name, webViewLink',
      });
      fileId = createRes.data.id!;
      webViewLink = createRes.data.webViewLink || '';
    }

    // Try to set anyone reader permission so other devices can easily access it if needed (optional)
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (permErr) {
      console.warn('Could not make backup file public, proceeding anyway:', permErr);
    }

    return res.json({
      success: true,
      fileId,
      webViewLink,
      updatedAt: updatedAt || Date.now(),
      message: hasUploadedImages
        ? 'Đã tự động tải cấu hình & các tệp tin hình ảnh riêng biệt lên thư mục Google Drive thành công!'
        : 'Đã tự động tải cấu hình & dữ liệu thi công lên thư mục Google Drive thành công!',
      data: {
        projectName: projectName || 'Công Trình Mẫu',
        contractorName: contractorName || '',
        inspectorName: inspectorName || '',
        inventory: inventory || [],
        workVolumes: workVolumes || [],
        checklist: checklist || [],
        defects: processedDefects,
        floorPlans: processedFloorPlans,
        roomProgressList: roomProgressList || [],
        materialNorms: materialNorms || [],
        updatedAt: updatedAt || Date.now()
      }
    });
  } catch (err: any) {
    console.error('Drive Sync Up Error:', err);
    return res.status(500).json({ error: `Không thể đồng bộ lên Drive: ${err.message}` });
  }
});

// Endpoint to upload generated PDF/Excel reports directly to Google Drive (Bypassing APK download blocking)
app.post('/api/drive/upload-report', async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.status(401).json({ error: 'Chưa kết nối tài khoản Google. Vui lòng đăng nhập Google.' });
  }

  const { fileName, mimeType, base64Data, folderId = '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6' } = req.body;

  if (!base64Data) {
    return res.status(400).json({ error: 'Không tìm thấy dữ liệu tệp tin' });
  }

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });

    // Decode base64 to buffer
    const fileBuffer = Buffer.from(base64Data, 'base64');
    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);

    // 1. Find or create a subfolder for reports: "Báo Cáo Xuất Bản"
    let reportsFolderId = '';
    const reportsFolderSearch = await drive.files.list({
      q: `name = 'Báo Cáo Xuất Bản' and '${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
    });

    if (reportsFolderSearch.data.files && reportsFolderSearch.data.files.length > 0) {
      reportsFolderId = reportsFolderSearch.data.files[0].id!;
    } else {
      const folderCreate = await drive.files.create({
        requestBody: {
          name: 'Báo Cáo Xuất Bản',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [folderId],
        },
        fields: 'id',
      });
      reportsFolderId = folderCreate.data.id!;
    }

    // 2. Upload file to "Báo Cáo Xuất Bản" folder
    const fileMetadata = {
      name: fileName || `Bao_Cao_${Date.now()}`,
      parents: [reportsFolderId],
    };

    const media = {
      mimeType,
      body: stream,
    };

    const uploadedFile = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, webViewLink',
    });

    // Make report viewable by anyone with link
    try {
      await drive.permissions.create({
        fileId: uploadedFile.data.id!,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (pe) {
      console.warn('Could not set public permission on uploaded report:', pe);
    }

    return res.json({
      success: true,
      fileId: uploadedFile.data.id,
      fileName: uploadedFile.data.name,
      webViewLink: uploadedFile.data.webViewLink,
      message: 'Đã xuất và lưu tệp báo cáo trực tiếp lên thư mục Google Drive của bạn thành công!'
    });
  } catch (err: any) {
    console.error('Drive Report Upload Error:', err);
    return res.status(500).json({ error: `Lỗi tải tệp lên Drive: ${err.message}` });
  }
});

app.post('/api/drive/sync-down', async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.status(401).json({ error: 'Chưa kết nối tài khoản Google.' });
  }

  const { folderId = '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6' } = req.body;

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const backupFileName = 'construction_sync.json';

    // Search for sync file inside the specific folder
    const fileSearch = await drive.files.list({
      q: `name = '${backupFileName}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, modifiedTime)',
    });

    if (!fileSearch.data.files || fileSearch.data.files.length === 0) {
      return res.json({
        success: false,
        found: false,
        message: 'Chưa tìm thấy tệp sao lưu tự động trên thư mục Google Drive.'
      });
    }

    const fileId = fileSearch.data.files[0].id!;

    // Download content
    const downloadRes = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'json' });

    const backupData = downloadRes.data;

    return res.json({
      success: true,
      found: true,
      data: backupData,
      message: 'Đã tải dữ liệu cấu hình & thiết lập công trình mới nhất từ Google Drive thành công!'
    });
  } catch (err: any) {
    console.error('Drive Sync Down Error:', err);
    return res.status(500).json({ error: `Không thể tải dữ liệu từ Drive: ${err.message}` });
  }
});

app.post('/api/drive/sync-up-all', async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.status(401).json({ error: 'Chưa kết nối tài khoản Google.' });
  }

  const { folderId = '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6', allData } = req.body;
  if (!allData) {
    return res.status(400).json({ error: 'Không tìm thấy dữ liệu để sao lưu.' });
  }

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const backupFileName = 'construction_all_projects_sync.json';

    const fileSearch = await drive.files.list({
      q: `name = '${backupFileName}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, webViewLink)',
    });

    const stream = new Readable();
    stream.push(JSON.stringify(allData, null, 2));
    stream.push(null);

    const media = {
      mimeType: 'application/json',
      body: stream,
    };

    let fileId = '';
    if (fileSearch.data.files && fileSearch.data.files.length > 0) {
      fileId = fileSearch.data.files[0].id!;
      await drive.files.update({
        fileId,
        media,
        fields: 'id, name, webViewLink',
      });
    } else {
      const createRes = await drive.files.create({
        requestBody: {
          name: backupFileName,
          parents: [folderId],
          mimeType: 'application/json',
        },
        media,
        fields: 'id, name, webViewLink',
      });
      fileId = createRes.data.id!;
    }

    return res.json({
      success: true,
      message: 'Đã sao lưu toàn bộ hệ thống lên Google Drive thành công!',
    });
  } catch (err: any) {
    console.error('Drive Sync Up All Error:', err);
    return res.status(500).json({ error: `Không thể đồng bộ lên Drive: ${err.message}` });
  }
});

app.post('/api/drive/sync-down-all', async (req, res) => {
  const authClient = getAuthenticatedAuthClient(req);
  if (!authClient) {
    return res.status(401).json({ error: 'Chưa kết nối tài khoản Google.' });
  }

  const { folderId = '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6' } = req.body;

  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const backupFileName = 'construction_all_projects_sync.json';

    const fileSearch = await drive.files.list({
      q: `name = '${backupFileName}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, modifiedTime)',
    });

    if (!fileSearch.data.files || fileSearch.data.files.length === 0) {
      return res.json({
        success: false,
        found: false,
        message: 'Chưa tìm thấy tệp sao lưu toàn bộ trên Google Drive.'
      });
    }

    const fileId = fileSearch.data.files[0].id!;
    const downloadRes = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'json' });

    return res.json({
      success: true,
      found: true,
      data: downloadRes.data,
      message: 'Đã tải dữ liệu toàn bộ từ Google Drive thành công!'
    });
  } catch (err: any) {
    console.error('Drive Sync Down All Error:', err);
    return res.status(500).json({ error: `Không thể tải dữ liệu từ Drive: ${err.message}` });
  }
});

// Redirect legacy icon.png and apple-touch-icon.png requests to the custom rounded icon.svg
app.get(['/icon.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => {
  res.redirect('/icon.svg');
});

// ==========================================
// VITE & APP STARTUP
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Construction Management Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
