package com.qlct.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.OpenableColumns;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.Map;

import org.json.JSONObject;
import org.json.JSONArray;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int STORAGE_PERMISSION_REQUEST = 1002;
    private static final int EXPORT_CREATE_DOCUMENT_REQUEST = 1003;
    private static final int AUTO_SAVE_TREE_REQUEST = 1004;
    private static final String LOCAL_FALLBACK_URL = "file:///android_asset/www/index.html";
    private static final String PREFS_NAME = "qlct_native_prefs";
    private static final String PREF_AUTO_SAVE_TREE_URI = "auto_save_tree_uri";

    private WebView webView;
    private WebView authPopupWebView;
    private WebView printWebView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCameraImageUri;
    private boolean fileChooserDirectCamera = false;
    private String startUrl = LOCAL_FALLBACK_URL;
    private boolean loadedFallback = false;
    private PendingExport pendingExport;
    private String pendingAutoSaveTreeRequestId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);
        requestLegacyStoragePermissionIfNeeded();

        configureWebView(webView);

        startUrl = getConfiguredStartUrl();
        webView.setWebViewClient(createAppWebViewClient(true));
        webView.addJavascriptInterface(new AndroidExportBridge(), "AndroidExport");
        webView.addJavascriptInterface(new AndroidContactBridge(), "AndroidContact");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }

                filePathCallback = callback;
                fileChooserDirectCamera = false;
                deletePendingCameraImage();
                try {
                    Intent intent;
                    // RC2.2.12: camera and gallery are separate paths. The web UI already has
                    // separate "Chup anh" / "Thu vien" controls; never inject Camera into
                    // the gallery chooser because some OEM pickers return an ambiguous result.
                    if (params != null && params.isCaptureEnabled() && acceptsImages(params)) {
                        intent = buildCameraCaptureIntent();
                        if (intent != null) {
                            fileChooserDirectCamera = true;
                        } else {
                            intent = buildFileChooserIntent(params);
                        }
                    } else {
                        intent = buildFileChooserIntent(params);
                    }
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    return false;
                } catch (Exception error) {
                    filePathCallback = null;
                    showToast("Khong the mo trinh chon anh: " + error.getMessage());
                    return false;
                }
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                closeAuthPopup();

                authPopupWebView = new WebView(MainActivity.this);
                authPopupWebView.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                configureWebView(authPopupWebView);
                authPopupWebView.setWebViewClient(createAppWebViewClient(false));
                authPopupWebView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onCloseWindow(WebView window) {
                        closeAuthPopup();
                    }
                });

                addContentView(authPopupWebView, new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));

                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(authPopupWebView);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                closeAuthPopup();
            }
        });

        webView.loadUrl(startUrl);
    }

    private String getConfiguredStartUrl() {
        String configured = getString(R.string.web_url).trim();
        if (isRemoteUrl(configured)) {
            return configured;
        }
        return LOCAL_FALLBACK_URL;
    }

    private boolean isRemoteUrl(String url) {
        return url != null && (url.startsWith("https://") || url.startsWith("http://"));
    }

    private void configureWebView(WebView target) {
        WebSettings settings = target.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(target, true);
        }
    }

    private WebViewClient createAppWebViewClient(final boolean allowFallback) {
        return new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrlOverride(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request != null && handleUrlOverride(request.getUrl().toString());
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (allowFallback && !loadedFallback && isRemoteUrl(startUrl) && startUrl.equals(failingUrl)) {
                    loadLocalFallback();
                    return;
                }
                super.onReceivedError(view, errorCode, description, failingUrl);
            }
        };
    }

    private boolean handleUrlOverride(String url) {
        if (shouldOpenExternally(url)) {
            openExternalBrowser(url);
            return true;
        }
        return false;
    }

    private boolean shouldOpenExternally(String url) {
        if (url == null) {
            return false;
        }
        String lowerUrl = url.toLowerCase();
        return lowerUrl.startsWith("tel:")
                || lowerUrl.startsWith("mailto:")
                || lowerUrl.startsWith("sms:")
                || lowerUrl.startsWith("geo:")
                || lowerUrl.startsWith("market:")
                || lowerUrl.startsWith("intent:");
    }

    private Intent buildFileChooserIntent(WebChromeClient.FileChooserParams params) {
        boolean imageOnly = acceptsImages(params);
        Intent contentIntent = new Intent(Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT
                ? Intent.ACTION_OPEN_DOCUMENT : Intent.ACTION_GET_CONTENT);
        contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
        contentIntent.setType(imageOnly ? "image/*" : "*/*");
        contentIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            contentIntent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
            contentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                    params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        }
        return Intent.createChooser(contentIntent, imageOnly ? "Chon anh tu Thu vien" : "Chon tep");
    }

    private Uri[] extractGalleryResultUris(Intent data) {
        if (data == null) return new Uri[0];
        List<Uri> uris = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null && seen.add(uri.toString())) uris.add(uri);
            }
        }
        Uri single = data.getData();
        if (single != null && seen.add(single.toString())) uris.add(single);
        if (uris.isEmpty()) {
            Uri[] parsed = WebChromeClient.FileChooserParams.parseResult(RESULT_OK, data);
            if (parsed != null) for (Uri uri : parsed) if (uri != null && seen.add(uri.toString())) uris.add(uri);
        }
        return uris.toArray(new Uri[0]);
    }

    private String queryDisplayName(Uri uri, int index) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0 && !cursor.isNull(column)) {
                    String name = sanitizeFileName(cursor.getString(column));
                    if (name.length() > 0) return name;
                }
            }
        } catch (Exception ignored) {
        } finally { if (cursor != null) cursor.close(); }
        return "gallery_" + System.currentTimeMillis() + "_" + index + ".jpg";
    }

    private String extensionForMime(String mimeType) {
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        if (mime.contains("png")) return ".png";
        if (mime.contains("webp")) return ".webp";
        if (mime.contains("gif")) return ".gif";
        if (mime.contains("heic") || mime.contains("heif")) return ".heic";
        return ".jpg";
    }

    private Uri copyGalleryUriToStableCache(Uri sourceUri, int index) throws IOException {
        if (sourceUri == null) throw new IOException("Gallery URI missing");
        String mimeType = getContentResolver().getType(sourceUri);
        String displayName = queryDisplayName(sourceUri, index);
        if (!displayName.contains(".")) displayName += extensionForMime(mimeType);
        displayName = "pick_" + System.currentTimeMillis() + "_" + index + "_" + displayName;
        File dir = new File(getCacheDir(), PickerCacheProvider.CACHE_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create picker cache");
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        File[] oldFiles = dir.listFiles();
        if (oldFiles != null) for (File old : oldFiles) if (old.isFile() && old.lastModified() < cutoff) old.delete();
        File target = new File(dir, displayName);
        long total = 0L;
        InputStream input = getContentResolver().openInputStream(sourceUri);
        if (input == null) throw new IOException("Gallery stream unavailable");
        FileOutputStream output = new FileOutputStream(target);
        try {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) if (read > 0) { output.write(buffer, 0, read); total += read; }
            output.flush();
        } finally {
            try { input.close(); } catch (Exception ignored) {}
            try { output.close(); } catch (Exception ignored) {}
        }
        if (total <= 0L || target.length() <= 0L) {
            target.delete();
            throw new IOException("Gallery returned an empty image");
        }
        return new Uri.Builder().scheme("content").authority(PickerCacheProvider.AUTHORITY).appendPath(target.getName()).build();
    }

    private void deliverGalleryUrisThroughStableCache(final Intent data) {
        final ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        if (callback == null) return;
        final Uri[] sourceUris = extractGalleryResultUris(data);
        if (sourceUris.length == 0) { callback.onReceiveValue(null); return; }
        new Thread(() -> {
            List<Uri> stableUris = new ArrayList<>();
            String failure = null;
            for (int i = 0; i < sourceUris.length; i++) {
                try { stableUris.add(copyGalleryUriToStableCache(sourceUris[i], i)); }
                catch (Exception error) { failure = error.getMessage(); break; }
            }
            final Uri[] result = failure == null ? stableUris.toArray(new Uri[0]) : null;
            final String errorMessage = failure;
            runOnUiThread(() -> {
                if (errorMessage != null) showToast("Khong doc duoc anh Thu vien: " + errorMessage);
                callback.onReceiveValue(result);
            });
        }, "qlct-gallery-copy").start();
    }

    private boolean acceptsImages(WebChromeClient.FileChooserParams params) {
        if (params == null) {
            return false;
        }
        String[] acceptTypes = params.getAcceptTypes();
        if (acceptTypes == null || acceptTypes.length == 0) {
            return params.isCaptureEnabled();
        }
        for (String acceptType : acceptTypes) {
            if (acceptType == null || acceptType.trim().length() == 0) {
                continue;
            }
            String lower = acceptType.toLowerCase();
            if (lower.contains("image") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp")) {
                return true;
            }
        }
        return false;
    }

    private Intent buildCameraCaptureIntent() {
        Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (cameraIntent.resolveActivity(getPackageManager()) == null) {
            return null;
        }

        pendingCameraImageUri = createCameraImageUri();
        if (pendingCameraImageUri == null) {
            return null;
        }

        cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraImageUri);
        cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            cameraIntent.setClipData(android.content.ClipData.newRawUri("QLTC camera output", pendingCameraImageUri));
        }
        // Explicitly grant the content URI to every camera activity. Some OEM camera apps
        // ignore only the flag and otherwise return RESULT_OK with an empty/broken image.
        java.util.List<android.content.pm.ResolveInfo> cameraActivities =
                getPackageManager().queryIntentActivities(cameraIntent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
        for (android.content.pm.ResolveInfo resolved : cameraActivities) {
            grantUriPermission(resolved.activityInfo.packageName, pendingCameraImageUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        }
        return cameraIntent;
    }

    private Uri createCameraImageUri() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "QLTC_IMG_" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/QLTC");
            }
            return getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        } catch (Exception error) {
            showToast("Khong the tao file anh tam: " + error.getMessage());
            return null;
        }
    }

    private long getContentUriSize(Uri uri) {
        if (uri == null) return -1L;
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(
                    uri,
                    new String[]{MediaStore.MediaColumns.SIZE},
                    null,
                    null,
                    null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) {
                    return cursor.getLong(index);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return -1L;
    }

    private void deliverCameraImageWhenReady(final Uri cameraUri, final int attempt) {
        if (filePathCallback == null) return;

        long size = getContentUriSize(cameraUri);
        if (size > 0L) {
            ValueCallback<Uri[]> callback = filePathCallback;
            filePathCallback = null;
            pendingCameraImageUri = null;
            callback.onReceiveValue(new Uri[]{cameraUri});
            return;
        }

        // Some OEM camera apps return RESULT_OK before MediaStore has flushed the
        // JPEG bytes. Passing the URI immediately makes Android WebView expose a
        // zero-byte File and the web compressor reports "Khong doc duoc anh".
        // Wait briefly for MediaStore to publish a non-empty image instead.
        if (attempt < 10) {
            new Handler(Looper.getMainLooper()).postDelayed(
                    () -> deliverCameraImageWhenReady(cameraUri, attempt + 1),
                    180L);
            return;
        }

        ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        pendingCameraImageUri = null;
        try { getContentResolver().delete(cameraUri, null, null); } catch (Exception ignored) {}
        showToast("Camera chua ghi xong anh. Vui long chup lai.");
        callback.onReceiveValue(null);
    }

    private void deletePendingCameraImage() {
        if (pendingCameraImageUri != null) {
            try {
                getContentResolver().delete(pendingCameraImageUri, null, null);
            } catch (Exception ignored) {
            }
        }
        pendingCameraImageUri = null;
    }

    private void loadLocalFallback() {
        loadedFallback = true;
        showToast("Khong the tai web online, dang mo ban du phong trong APK");
        webView.loadUrl(LOCAL_FALLBACK_URL);
    }

    private void openExternalBrowser(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (Exception error) {
            showToast("Khong the mo trinh duyet: " + error.getMessage());
        }
    }

    private void requestLegacyStoragePermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST);
            }
        }
    }

    public class AndroidContactBridge {
        @JavascriptInterface
        public boolean shareText(String title, String text) {
            try {
                final String safeTitle = title == null || title.trim().isEmpty() ? "HNL QLTC" : title.trim();
                final String safeText = text == null ? "" : text;
                if (safeText.trim().isEmpty()) return false;
                runOnUiThread(() -> {
                    try {
                        Intent sendIntent = new Intent(Intent.ACTION_SEND);
                        sendIntent.setType("text/plain");
                        sendIntent.putExtra(Intent.EXTRA_SUBJECT, safeTitle);
                        sendIntent.putExtra(Intent.EXTRA_TEXT, safeText);
                        startActivity(Intent.createChooser(sendIntent, "Chia se tu HNL QLTC"));
                    } catch (Exception error) {
                        showToast("Khong the mo chia se he thong: " + error.getMessage());
                    }
                });
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareFiles(String title, String text, String attachmentsJson) {
            try {
                final String safeTitle = title == null || title.trim().isEmpty() ? "HNL QLTC" : title.trim();
                final String safeText = text == null ? "" : text;
                JSONArray items = new JSONArray(attachmentsJson == null ? "[]" : attachmentsJson);
                if (items.length() == 0) return false;

                final int maxFiles = Math.min(items.length(), 6);
                final long maxTotalBytes = 12L * 1024L * 1024L;
                long totalBytes = 0L;
                final ArrayList<Uri> uris = new ArrayList<>();
                final ArrayList<String> mimeTypes = new ArrayList<>();
                File dir = new File(getCacheDir(), PickerCacheProvider.CACHE_DIR);
                if (!dir.exists() && !dir.mkdirs()) return false;

                long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
                File[] oldFiles = dir.listFiles();
                if (oldFiles != null) for (File old : oldFiles) {
                    if (old.isFile() && old.getName().startsWith("share_") && old.lastModified() < cutoff) old.delete();
                }

                for (int i = 0; i < maxFiles; i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    String encoded = item.optString("base64", "").replaceAll("\\s", "");
                    if (encoded.length() == 0) continue;
                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                    if (bytes.length == 0 || totalBytes + bytes.length > maxTotalBytes) break;
                    totalBytes += bytes.length;

                    String originalName = sanitizeFileName(item.optString("fileName", "image_" + (i + 1) + ".jpg"));
                    String fileName = "share_" + System.currentTimeMillis() + "_" + i + "_" + originalName;
                    File target = new File(dir, fileName);
                    FileOutputStream output = new FileOutputStream(target);
                    try { output.write(bytes); output.flush(); } finally { output.close(); }
                    Uri uri = new Uri.Builder().scheme("content").authority(PickerCacheProvider.AUTHORITY).appendPath(target.getName()).build();
                    uris.add(uri);
                    mimeTypes.add(item.optString("mimeType", "image/jpeg"));
                }
                if (uris.isEmpty()) return false;

                runOnUiThread(() -> {
                    try {
                        Intent share = new Intent(uris.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);
                        share.setType(uris.size() > 1 ? "image/*" : mimeTypes.get(0));
                        share.putExtra(Intent.EXTRA_TEXT, safeText);
                        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        if (uris.size() > 1) share.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                        else share.putExtra(Intent.EXTRA_STREAM, uris.get(0));

                        ClipData clip = ClipData.newUri(getContentResolver(), "HNL QLTC share", uris.get(0));
                        for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
                        share.setClipData(clip);
                        startActivity(Intent.createChooser(share, safeTitle));
                    } catch (Exception error) {
                        showToast("Khong the chia se anh: " + error.getMessage());
                    }
                });
                return true;
            } catch (Exception error) {
                showToast("Khong the chuan bi anh chia se: " + error.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean openZalo() {
            try {
                runOnUiThread(() -> {
                    try {
                        Intent launchIntent = getPackageManager().getLaunchIntentForPackage("com.zing.zalo");
                        if (launchIntent != null) {
                            startActivity(launchIntent);
                            return;
                        }
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://zalo.me/")));
                    } catch (Exception error) {
                        showToast("Khong the mo Zalo. Hay mo Zalo thu cong.");
                    }
                });
                return true;
            } catch (Exception error) {
                return false;
            }
        }
    }

    public class AndroidExportBridge {
        private final Map<String, ChunkedExport> chunkedExports = new HashMap<>();

        @JavascriptInterface
        public void saveBase64File(String fileName, String mimeType, String base64Data) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                saveBytesToDownloads(fileName, mimeType, bytes);
                showToast("Da luu file vao Download/QLTC: " + fileName);
            } catch (Exception error) {
                showToast("Khong the luu file: " + error.getMessage());
            }
        }

        @JavascriptInterface
        public boolean beginBase64File(String sessionId, String fileName, String mimeType) {
            return beginChunkedFile(sessionId, fileName, mimeType);
        }

        @JavascriptInterface
        public boolean beginTextFile(String sessionId, String fileName, String mimeType) {
            return beginChunkedFile(sessionId, fileName, mimeType);
        }

        private boolean beginChunkedFile(String sessionId, String fileName, String mimeType) {
            try {
                String safeSessionId = sanitizeFileName(sessionId);
                File tempFile = new File(getCacheDir(), safeSessionId + ".bin");
                ChunkedExport export = new ChunkedExport(fileName, mimeType, tempFile, new FileOutputStream(tempFile));
                synchronized (chunkedExports) {
                    ChunkedExport previous = chunkedExports.put(sessionId, export);
                    if (previous != null) {
                        previous.closeAndDelete();
                    }
                }
                return true;
            } catch (Exception error) {
                showToast("Khong the bat dau luu file: " + error.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean appendBase64Chunk(String sessionId, String base64Chunk) {
            try {
                ChunkedExport export;
                synchronized (chunkedExports) {
                    export = chunkedExports.get(sessionId);
                }
                if (export == null) {
                    throw new IOException("Missing export session");
                }
                byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                export.output.write(bytes);
                return true;
            } catch (Exception error) {
                showToast("Khong the ghi du lieu file: " + error.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean appendTextChunk(String sessionId, String textChunk) {
            try {
                ChunkedExport export;
                synchronized (chunkedExports) {
                    export = chunkedExports.get(sessionId);
                }
                if (export == null) {
                    throw new IOException("Missing export session");
                }
                export.output.write(textChunk.getBytes(StandardCharsets.UTF_8));
                return true;
            } catch (Exception error) {
                showToast("Khong the ghi du lieu file: " + error.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean finishBase64File(String sessionId) {
            return finishChunkedFile(sessionId);
        }

        @JavascriptInterface
        public boolean finishTextFile(String sessionId) {
            return finishChunkedFile(sessionId);
        }

        @JavascriptInterface
        public boolean finishBase64FileWithPicker(String sessionId, String requestId) {
            return finishChunkedFileWithPicker(sessionId, requestId);
        }

        @JavascriptInterface
        public boolean finishTextFileWithPicker(String sessionId, String requestId) {
            return finishChunkedFileWithPicker(sessionId, requestId);
        }

        private boolean finishChunkedFile(String sessionId) {
            ChunkedExport export;
            synchronized (chunkedExports) {
                export = chunkedExports.remove(sessionId);
            }
            if (export == null) {
                showToast("Khong tim thay phien luu file");
                return false;
            }

            try {
                export.output.close();
                saveFileToDownloads(export.fileName, export.mimeType, export.tempFile);
                showToast("Da luu file vao Download/QLTC: " + export.fileName);
                return true;
            } catch (Exception error) {
                showToast("Khong the hoan tat luu file: " + error.getMessage());
                return false;
            } finally {
                export.deleteTemp();
            }
        }

        private boolean finishChunkedFileWithPicker(String sessionId, String requestId) {
            ChunkedExport export;
            synchronized (chunkedExports) {
                export = chunkedExports.remove(sessionId);
            }
            if (export == null) {
                showToast("Khong tim thay phien luu file");
                dispatchAndroidEvent("android-export-result", requestId, false, "Missing export session", null);
                return false;
            }

            try {
                export.output.close();
                startCreateDocumentForExport(new PendingExport(requestId, export.fileName, export.mimeType, export.tempFile));
                return true;
            } catch (Exception error) {
                export.deleteTemp();
                showToast("Khong the mo hop luu file: " + error.getMessage());
                dispatchAndroidEvent("android-export-result", requestId, false, error.getMessage(), export.fileName);
                return false;
            }
        }

        @JavascriptInterface
        public boolean finishBase64FileToAutoSaveFolder(String sessionId, String requestId) {
            return finishChunkedFileToAutoSaveFolder(sessionId, requestId);
        }

        @JavascriptInterface
        public boolean finishTextFileToAutoSaveFolder(String sessionId, String requestId) {
            return finishChunkedFileToAutoSaveFolder(sessionId, requestId);
        }

        private boolean finishChunkedFileToAutoSaveFolder(String sessionId, String requestId) {
            ChunkedExport export;
            synchronized (chunkedExports) {
                export = chunkedExports.remove(sessionId);
            }
            if (export == null) {
                dispatchAndroidEvent("android-autosave-result", requestId, false, "Missing autosave session", null);
                return false;
            }

            try {
                export.output.close();
                writeFileToAutoSaveFolder(export.fileName, export.mimeType, export.tempFile);
                showToast("Da tu dong luu JSON: " + export.fileName);
                dispatchAndroidEvent("android-autosave-result", requestId, true, "Saved", export.fileName);
                return true;
            } catch (Exception error) {
                showToast("Khong the tu dong luu JSON: " + error.getMessage());
                dispatchAndroidEvent("android-autosave-result", requestId, false, error.getMessage(), export.fileName);
                return false;
            } finally {
                export.deleteTemp();
            }
        }

        @JavascriptInterface
        public void abortBase64File(String sessionId) {
            abortChunkedFile(sessionId);
        }

        @JavascriptInterface
        public void abortTextFile(String sessionId) {
            abortChunkedFile(sessionId);
        }

        private void abortChunkedFile(String sessionId) {
            ChunkedExport export;
            synchronized (chunkedExports) {
                export = chunkedExports.remove(sessionId);
            }
            if (export != null) {
                export.closeAndDelete();
            }
        }

        @JavascriptInterface
        public void saveHtmlPdf(String fileName, String htmlBase64) {
            try {
                byte[] bytes = Base64.decode(htmlBase64, Base64.DEFAULT);
                final String html = new String(bytes, StandardCharsets.UTF_8);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        renderHtmlToPdf(fileName, html);
                    }
                });
            } catch (Exception error) {
                showToast("Khong the tao PDF: " + error.getMessage());
            }
        }

        @JavascriptInterface
        public void openExternalUrl(String url) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception error) {
                showToast("Khong the mo trinh duyet: " + error.getMessage());
            }
        }

        @JavascriptInterface
        public boolean pickAutoSaveFolder(String requestId) {
            return startAutoSaveFolderPicker(requestId);
        }

        @JavascriptInterface
        public boolean hasAutoSaveFolder() {
            return getAutoSaveTreeUri() != null;
        }

        @JavascriptInterface
        public String getAutoSaveFolderName() {
            return getAutoSaveFolderLabel();
        }

        @JavascriptInterface
        public void forgetAutoSaveFolder() {
            Uri uri = getAutoSaveTreeUri();
            if (uri != null) {
                try {
                    getContentResolver().releasePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {
                }
            }
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().remove(PREF_AUTO_SAVE_TREE_URI).apply();
            showToast("Da huy thu muc tu dong luu JSON");
        }
    }

    private static class ChunkedExport {
        final String fileName;
        final String mimeType;
        final File tempFile;
        final OutputStream output;

        ChunkedExport(String fileName, String mimeType, File tempFile, OutputStream output) {
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.tempFile = tempFile;
            this.output = output;
        }

        void closeAndDelete() {
            try {
                output.close();
            } catch (IOException ignored) {
            }
            deleteTemp();
        }

        void deleteTemp() {
            if (tempFile.exists()) {
                tempFile.delete();
            }
        }
    }

    private static class PendingExport {
        final String requestId;
        final String fileName;
        final String mimeType;
        final File tempFile;

        PendingExport(String requestId, String fileName, String mimeType, File tempFile) {
            this.requestId = requestId;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.tempFile = tempFile;
        }

        void deleteTemp() {
            if (tempFile != null && tempFile.exists()) {
                tempFile.delete();
            }
        }
    }

    private void startCreateDocumentForExport(final PendingExport export) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                synchronized (MainActivity.this) {
                    if (pendingExport != null) {
                        export.deleteTemp();
                        dispatchAndroidEvent("android-export-result", export.requestId, false, "Another export is pending", export.fileName);
                        showToast("Dang co file khac cho chon noi luu");
                        return;
                    }
                    pendingExport = export;
                }

                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(normalizeMimeType(export.mimeType));
                    intent.putExtra(Intent.EXTRA_TITLE, sanitizeFileName(export.fileName));
                    startActivityForResult(intent, EXPORT_CREATE_DOCUMENT_REQUEST);
                } catch (Exception error) {
                    synchronized (MainActivity.this) {
                        if (pendingExport == export) {
                            pendingExport = null;
                        }
                    }
                    export.deleteTemp();
                    dispatchAndroidEvent("android-export-result", export.requestId, false, error.getMessage(), export.fileName);
                    showToast("Khong the mo hop chon noi luu: " + error.getMessage());
                }
            }
        });
    }

    private boolean startAutoSaveFolderPicker(final String requestId) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    pendingAutoSaveTreeRequestId = requestId;
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                            | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                    startActivityForResult(intent, AUTO_SAVE_TREE_REQUEST);
                } catch (Exception error) {
                    pendingAutoSaveTreeRequestId = null;
                    dispatchAndroidEvent("android-folder-result", requestId, false, error.getMessage(), null);
                    showToast("Khong the chon thu muc: " + error.getMessage());
                }
            }
        });
        return true;
    }

    private void renderHtmlToPdf(final String fileName, String html) {
        destroyTemporaryWebView(printWebView);
        printWebView = new WebView(this);
        printWebView.setAlpha(0f);
        printWebView.getSettings().setJavaScriptEnabled(false);
        printWebView.getSettings().setDomStorageEnabled(true);
        addContentView(printWebView, new ViewGroup.LayoutParams(1, 1));

        printWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        openPrintManager(fileName);
                    }
                }, 1000);
            }
        });

        printWebView.loadDataWithBaseURL(
                "file:///android_asset/www/",
                html,
                "text/html",
                "UTF-8",
                null);
    }

    private void openPrintManager(String fileName) {
        if (printWebView == null) {
            showToast("Khong co noi dung PDF de in");
            return;
        }

        PrintManager printManager = (PrintManager) getSystemService(PRINT_SERVICE);
        if (printManager == null) {
            showToast("Thiet bi khong ho tro in/luu PDF");
            return;
        }

        PrintDocumentAdapter adapter = printWebView.createPrintDocumentAdapter(fileName);
        PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setResolution(new PrintAttributes.Resolution("qlct_pdf", "QLCT PDF", 300, 300))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
        printManager.print(fileName, adapter, attributes);
        showToast("Chon 'Luu thanh PDF' de xuat bao cao");
    }

    private Uri saveBytesToDownloads(String fileName, String mimeType, byte[] bytes) throws IOException {
        String safeFileName = sanitizeFileName(fileName);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeFileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/QLTC");

            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IOException("MediaStore insert failed");
            }

            OutputStream output = getContentResolver().openOutputStream(uri);
            if (output == null) {
                throw new IOException("Cannot open output stream");
            }
            try {
                output.write(bytes);
            } finally {
                output.close();
            }
            return uri;
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "QLTC");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create Download/QLTC");
        }

        File outputFile = getUniqueFile(dir, safeFileName);
        FileOutputStream output = new FileOutputStream(outputFile);
        try {
            output.write(bytes);
        } finally {
            output.close();
        }

        Uri uri = Uri.fromFile(outputFile);
        sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, uri));
        return uri;
    }

    private Uri saveFileToDownloads(String fileName, String mimeType, File sourceFile) throws IOException {
        String safeFileName = sanitizeFileName(fileName);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeFileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/QLTC");

            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IOException("MediaStore insert failed");
            }

            OutputStream output = getContentResolver().openOutputStream(uri);
            if (output == null) {
                throw new IOException("Cannot open output stream");
            }
            try {
                copyFileToOutput(sourceFile, output);
            } finally {
                output.close();
            }
            return uri;
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "QLTC");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create Download/QLTC");
        }

        File outputFile = getUniqueFile(dir, safeFileName);
        FileOutputStream output = new FileOutputStream(outputFile);
        try {
            copyFileToOutput(sourceFile, output);
        } finally {
            output.close();
        }

        Uri uri = Uri.fromFile(outputFile);
        sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, uri));
        return uri;
    }

    private void savePendingExportToUri(PendingExport export, Uri uri) throws IOException {
        OutputStream output;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            output = getContentResolver().openOutputStream(uri, "wt");
        } else {
            output = getContentResolver().openOutputStream(uri);
        }
        if (output == null) {
            throw new IOException("Cannot open output stream");
        }
        try {
            copyFileToOutput(export.tempFile, output);
        } finally {
            output.close();
        }
    }

    private Uri getAutoSaveTreeUri() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String uriString = prefs.getString(PREF_AUTO_SAVE_TREE_URI, "");
        if (uriString == null || uriString.length() == 0) {
            return null;
        }
        try {
            return Uri.parse(uriString);
        } catch (Exception error) {
            return null;
        }
    }

    private String getAutoSaveFolderLabel() {
        Uri uri = getAutoSaveTreeUri();
        if (uri == null) {
            return "";
        }
        try {
            String docId = DocumentsContract.getTreeDocumentId(uri);
            int colon = docId == null ? -1 : docId.lastIndexOf(':');
            if (colon >= 0 && colon < docId.length() - 1) {
                return docId.substring(colon + 1);
            }
            return docId == null ? uri.toString() : docId;
        } catch (Exception error) {
            return uri.toString();
        }
    }

    private void writeFileToAutoSaveFolder(String fileName, String mimeType, File sourceFile) throws IOException {
        Uri treeUri = getAutoSaveTreeUri();
        if (treeUri == null) {
            throw new IOException("Chua chon thu muc tu dong luu");
        }

        String safeFileName = sanitizeFileName(fileName);
        Uri targetUri = findChildDocumentByName(treeUri, safeFileName);
        if (targetUri == null) {
            String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
            targetUri = DocumentsContract.createDocument(
                    getContentResolver(),
                    parentUri,
                    normalizeMimeType(mimeType),
                    safeFileName);
            if (targetUri == null) {
                throw new IOException("Cannot create autosave file");
            }
        }

        OutputStream output = getContentResolver().openOutputStream(targetUri, "wt");
        if (output == null) {
            throw new IOException("Cannot open autosave output");
        }
        try {
            copyFileToOutput(sourceFile, output);
        } finally {
            output.close();
        }
    }

    private Uri findChildDocumentByName(Uri treeUri, String displayName) {
        Cursor cursor = null;
        try {
            String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocId);
            cursor = getContentResolver().query(
                    childrenUri,
                    new String[]{
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME
                    },
                    null,
                    null,
                    null);
            if (cursor == null) {
                return null;
            }
            while (cursor.moveToNext()) {
                String childDocId = cursor.getString(0);
                String childName = cursor.getString(1);
                if (displayName.equals(childName)) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);
                }
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    private String normalizeMimeType(String mimeType) {
        if (mimeType == null || mimeType.trim().length() == 0) {
            return "application/octet-stream";
        }
        return mimeType.split(";")[0].trim();
    }

    private void copyFileToOutput(File sourceFile, OutputStream output) throws IOException {
        FileInputStream input = new FileInputStream(sourceFile);
        try {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } finally {
            input.close();
        }
    }

    private String sanitizeFileName(String fileName) {
        String safe = fileName == null ? "" : fileName.replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        if (safe.length() == 0) {
            safe = "QLTC_" + System.currentTimeMillis();
        }
        return safe;
    }

    private File getUniqueFile(File dir, String fileName) {
        File file = new File(dir, fileName);
        if (!file.exists()) {
            return file;
        }

        int dot = fileName.lastIndexOf('.');
        String base = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";
        int index = 1;
        while (file.exists()) {
            file = new File(dir, base + "_" + index + ext);
            index++;
        }
        return file;
    }

    private void destroyTemporaryWebView(WebView temporaryWebView) {
        if (temporaryWebView == null) {
            return;
        }
        ViewGroup parent = (ViewGroup) temporaryWebView.getParent();
        if (parent != null) {
            parent.removeView(temporaryWebView);
        }
        temporaryWebView.destroy();
        if (temporaryWebView == printWebView) {
            printWebView = null;
        }
    }

    private void closeAuthPopup() {
        if (authPopupWebView == null) {
            return;
        }
        ViewGroup parent = (ViewGroup) authPopupWebView.getParent();
        if (parent != null) {
            parent.removeView(authPopupWebView);
        }
        authPopupWebView.destroy();
        authPopupWebView = null;
    }

    private void showToast(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void dispatchAndroidEvent(final String eventName, final String requestId, final boolean success, final String message, final String fileName) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView == null) {
                    return;
                }
                String script = "window.dispatchEvent(new CustomEvent("
                        + JSONObject.quote(eventName)
                        + ",{detail:{requestId:"
                        + JSONObject.quote(requestId == null ? "" : requestId)
                        + ",success:"
                        + (success ? "true" : "false")
                        + ",message:"
                        + JSONObject.quote(message == null ? "" : message)
                        + ",fileName:"
                        + JSONObject.quote(fileName == null ? "" : fileName)
                        + "}}));";
                webView.evaluateJavascript(script, null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (authPopupWebView != null) {
            if (authPopupWebView.canGoBack()) {
                authPopupWebView.goBack();
            } else {
                closeAuthPopup();
            }
            return;
        }

        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            if (fileChooserDirectCamera) {
                fileChooserDirectCamera = false;
                if (resultCode == RESULT_OK && pendingCameraImageUri != null) {
                    // Camera-only path keeps the OEM MediaStore flush guard. Gallery can never
                    // enter this path, so it can no longer show the camera-not-ready toast.
                    deliverCameraImageWhenReady(pendingCameraImageUri, 0);
                    return;
                }
                deletePendingCameraImage();
                ValueCallback<Uri[]> callback = filePathCallback;
                filePathCallback = null;
                callback.onReceiveValue(null);
                return;
            }

            deletePendingCameraImage();
            if (resultCode == RESULT_OK && data != null) {
                deliverGalleryUrisThroughStableCache(data);
            } else {
                ValueCallback<Uri[]> callback = filePathCallback;
                filePathCallback = null;
                callback.onReceiveValue(null);
            }
        } else if (requestCode == EXPORT_CREATE_DOCUMENT_REQUEST) {
            PendingExport export;
            synchronized (this) {
                export = pendingExport;
                pendingExport = null;
            }
            if (export == null) {
                return;
            }
            try {
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    savePendingExportToUri(export, data.getData());
                    showToast("Da luu file: " + export.fileName);
                    dispatchAndroidEvent("android-export-result", export.requestId, true, "Saved", export.fileName);
                } else {
                    dispatchAndroidEvent("android-export-result", export.requestId, false, "Cancelled", export.fileName);
                }
            } catch (Exception error) {
                showToast("Khong the luu file: " + error.getMessage());
                dispatchAndroidEvent("android-export-result", export.requestId, false, error.getMessage(), export.fileName);
            } finally {
                export.deleteTemp();
            }
        } else if (requestCode == AUTO_SAVE_TREE_REQUEST) {
            String requestId = pendingAutoSaveTreeRequestId;
            pendingAutoSaveTreeRequestId = null;
            try {
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    Uri uri = data.getData();
                    int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    if (flags != 0) {
                        getContentResolver().takePersistableUriPermission(uri, flags);
                    }
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                            .edit()
                            .putString(PREF_AUTO_SAVE_TREE_URI, uri.toString())
                            .apply();
                    showToast("Da chon thu muc tu dong luu JSON");
                    dispatchAndroidEvent("android-folder-result", requestId, true, "Folder selected", getAutoSaveFolderLabel());
                } else {
                    dispatchAndroidEvent("android-folder-result", requestId, false, "Cancelled", null);
                }
            } catch (Exception error) {
                showToast("Khong the luu quyen thu muc: " + error.getMessage());
                dispatchAndroidEvent("android-folder-result", requestId, false, error.getMessage(), null);
            }
        }
    }

    @Override
    protected void onDestroy() {
        closeAuthPopup();

        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        destroyTemporaryWebView(printWebView);

        super.onDestroy();
    }
}
