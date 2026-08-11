package com.qlct.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int STORAGE_PERMISSION_REQUEST = 1002;
    private static final String LOCAL_FALLBACK_URL = "file:///android_asset/www/index.html";

    private WebView webView;
    private WebView printWebView;
    private ValueCallback<Uri[]> filePathCallback;
    private String startUrl = LOCAL_FALLBACK_URL;
    private boolean loadedFallback = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);
        requestLegacyStoragePermissionIfNeeded();

        WebSettings settings = webView.getSettings();
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

        startUrl = getConfiguredStartUrl();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (shouldOpenExternally(url)) {
                    openExternalBrowser(url);
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!loadedFallback && isRemoteUrl(startUrl) && startUrl.equals(failingUrl)) {
                    loadLocalFallback();
                    return;
                }
                super.onReceivedError(view, errorCode, description, failingUrl);
            }
        });
        webView.addJavascriptInterface(new AndroidExportBridge(), "AndroidExport");
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
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    return false;
                }
                return true;
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

    private boolean shouldOpenExternally(String url) {
        if (url == null) {
            return false;
        }
        String lowerUrl = url.toLowerCase();
        return lowerUrl.contains("accounts.google.com")
                || lowerUrl.contains("oauth2.googleapis.com")
                || lowerUrl.contains("googleusercontent.com");
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

    public class AndroidExportBridge {
        private final Map<String, ChunkedExport> chunkedExports = new HashMap<>();

        @JavascriptInterface
        public void saveBase64File(String fileName, String mimeType, String base64Data) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                saveBytesToDownloads(fileName, mimeType, bytes);
                showToast("Da luu file vao Download/QLCT: " + fileName);
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
                showToast("Da luu file vao Download/QLCT: " + export.fileName);
                return true;
            } catch (Exception error) {
                showToast("Khong the hoan tat luu file: " + error.getMessage());
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
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/QLCT");

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

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "QLCT");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create Download/QLCT");
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
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/QLCT");

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

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "QLCT");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create Download/QLCT");
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
            safe = "QLCT_" + System.currentTimeMillis();
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

    private void showToast(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    public void onBackPressed() {
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
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        destroyTemporaryWebView(printWebView);

        super.onDestroy();
    }
}
