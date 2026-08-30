package com.qlct.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * App-owned read-only provider used to hand WebView a stable URI for images selected
 * from OEM galleries / Google Photos. Some providers return ephemeral content:// URIs
 * that WebView cannot reliably reopen after onActivityResult; MainActivity copies the
 * selected stream into cache first and exposes only this provider URI to Chromium.
 */
public class PickerCacheProvider extends ContentProvider {
    public static final String AUTHORITY = "com.qlct.app.picker";
    public static final String CACHE_DIR = "qlct_picker";

    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolveFile(Uri uri) throws FileNotFoundException {
        if (getContext() == null) throw new FileNotFoundException("Provider context unavailable");
        String name = uri == null ? null : uri.getLastPathSegment();
        if (name == null || name.length() == 0 || name.contains("/") || name.contains("\\")) {
            throw new FileNotFoundException("Invalid picker cache URI");
        }
        File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        File file = new File(dir, name);
        try {
            String dirPath = dir.getCanonicalPath() + File.separator;
            String filePath = file.getCanonicalPath();
            if (!filePath.startsWith(dirPath) || !file.exists() || !file.isFile()) {
                throw new FileNotFoundException("Picker cache file missing");
            }
        } catch (java.io.IOException error) {
            throw new FileNotFoundException("Invalid picker cache path");
        }
        return file;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && mode.contains("w")) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolveFile(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        try {
            String name = resolveFile(uri).getName();
            int dot = name.lastIndexOf('.');
            String ext = dot >= 0 && dot < name.length() - 1 ? name.substring(dot + 1).toLowerCase() : "";
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            return mime == null ? "image/jpeg" : mime;
        } catch (Exception ignored) {
            return "image/jpeg";
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File file = resolveFile(uri);
            String[] requested = projection == null || projection.length == 0
                    ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
                    : projection;
            MatrixCursor cursor = new MatrixCursor(requested, 1);
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : requested) {
                if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(file.getName());
                else if (OpenableColumns.SIZE.equals(column)) row.add(file.length());
                else row.add(null);
            }
            return cursor;
        } catch (Exception ignored) {
            return null;
        }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
}
