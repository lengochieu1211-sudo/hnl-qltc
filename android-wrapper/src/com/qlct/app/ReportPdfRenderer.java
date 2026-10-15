package com.qlct.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Offline A4 PDF writer for the same self-contained HTML used by Print Preview.
 * The output is a real PDF produced by the system WebView print adapter, never
 * an HTML document with a .pdf extension or a zero-byte SAF placeholder.
 */
final class ReportPdfRenderer {
    interface Result {
        void onReady(File pdf);
        void onFailure(String reason);
    }

    private ReportPdfRenderer() {}

    static void render(Activity activity, String html, String fileName, Result result) {
        final File output;
        try {
            output = File.createTempFile("qltc-report-", ".pdf", activity.getCacheDir());
        } catch (IOException ex) {
            result.onFailure(ex.getMessage());
            return;
        }
        final WebView viewer = new WebView(activity);
        viewer.setAlpha(0f);
        viewer.getSettings().setJavaScriptEnabled(false);
        viewer.getSettings().setDomStorageEnabled(true);
        activity.addContentView(viewer,new ViewGroup.LayoutParams(1,1));
        final AtomicBoolean started = new AtomicBoolean(false);
        final AtomicBoolean completed = new AtomicBoolean(false);
        viewer.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!started.compareAndSet(false,true)) return;
                // Keep the same brief image/font settling period as Print Preview.
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(fileName);
                    try {
                        PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setResolution(new PrintAttributes.Resolution("qltc_pdf", "QLTC PDF",300,300))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS).build();
                        adapter.onStart();
                        adapter.onLayout(null, attrs, new CancellationSignal(),
                            new PrintDocumentAdapter.LayoutResultCallback() {
                                @Override
                                public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                                    final ParcelFileDescriptor descriptor;
                                    try {
                                        descriptor = ParcelFileDescriptor.open(output,
                                            ParcelFileDescriptor.MODE_READ_WRITE |
                                            ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
                                    } catch (IOException error) {
                                        finish(activity,viewer,adapter,output,completed,result,error.getMessage());
                                        return;
                                    }
                                    try {
                                        adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES},descriptor,
                                            new CancellationSignal(),new PrintDocumentAdapter.WriteResultCallback() {
                                                @Override
                                                public void onWriteFinished(PageRange[] pages) {
                                                    try { descriptor.close(); } catch (IOException ignored) {}
                                                    finish(activity,viewer,adapter,output,completed,result,null);
                                                }
                                                @Override
                                                public void onWriteFailed(CharSequence error) {
                                                    try { descriptor.close(); } catch (IOException ignored) {}
                                                    finish(activity,viewer,adapter,output,completed,result,String.valueOf(error));
                                                }
                                                @Override
                                                public void onWriteCancelled() {
                                                    try { descriptor.close(); } catch (IOException ignored) {}
                                                    finish(activity,viewer,adapter,output,completed,result,"PDF write cancelled");
                                                }
                                            });
                                    } catch (Exception error) {
                                        try { descriptor.close(); } catch (IOException ignored) {}
                                        finish(activity,viewer,adapter,output,completed,result,error.getMessage());
                                    }
                                }
                                @Override
                                public void onLayoutFailed(CharSequence error) {
                                    finish(activity,viewer,adapter,output,completed,result,String.valueOf(error));
                                }
                                @Override
                                public void onLayoutCancelled() {
                                    finish(activity,viewer,adapter,output,completed,result,"PDF layout cancelled");
                                }
                            },new Bundle());
                    } catch (Exception error) {
                        finish(activity,viewer,adapter,output,completed,result,error.getMessage());
                    }
                },1000);
            }
        });
        viewer.loadDataWithBaseURL("file:///android_asset/www/",html,"text/html","UTF-8",null);
    }

    private static void finish(Activity activity, WebView viewer, PrintDocumentAdapter adapter,
                               File output, AtomicBoolean completed, Result result, String error) {
        if (!completed.compareAndSet(false,true)) return;
        try { adapter.onFinish(); } catch (Exception ignored) {}
        ViewGroup parent=(ViewGroup)viewer.getParent();
        if(parent!=null) parent.removeView(viewer);
        viewer.destroy();
        if (error != null) {
            if (output.exists()) output.delete();
            result.onFailure(error);
        } else {
            result.onReady(output);
        }
    }
}
