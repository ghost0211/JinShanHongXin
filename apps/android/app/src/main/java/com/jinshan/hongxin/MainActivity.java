package com.jinshan.hongxin;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String VIRTUAL_HOST = "appassets.jinshan.local";
    private static final String START_URL = "http://" + VIRTUAL_HOST + "/index.html";
    private static final String ASSET_PREFIX = "www/";

    private WebView webView;
    private long lastBackPressMs = 0L;
    private OnBackInvokedCallback backCallback;
    private OtaUpdateManager otaManager;
    private LanDiscoveryManager lanDiscovery;
    private LanHostServer lanHostServer;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        otaManager = new OtaUpdateManager(this);
        lanDiscovery = new LanDiscoveryManager(this);
        lanHostServer = new LanHostServer(this, otaManager, roomsJson -> lanDiscovery.updateRoomsSnapshot(roomsJson));

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF061D16);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(
            new AndroidBridge(this, webView, otaManager, lanHostServer, lanDiscovery),
            "JinshanAndroid"
        );
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new LocalAssetWebViewClient());

        applyImmersiveMode();
        registerBackHandler();

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleBackAction;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                backCallback
            );
        }
    }

    private void handleBackAction() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastBackPressMs < 2000L) {
            finish();
        } else {
            lastBackPressMs = now;
            Toast.makeText(this, "再按一次返回键退出金山打红心", Toast.LENGTH_SHORT).show();
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBackAction();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
    }

    @Override
    protected void onPause() {
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (lanHostServer != null) {
            lanHostServer.stop();
            lanHostServer = null;
        }
        if (lanDiscovery != null) {
            lanDiscovery.dispose();
            lanDiscovery = null;
        }
        LanForegroundService.stop(this);
        if (webView != null) {
            webView.removeJavascriptInterface("JinshanAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void applyImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(
                    WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars()
                );
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            applyLegacyImmersive();
        }
    }

    @SuppressWarnings("deprecation")
    private void applyLegacyImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }

    private class LocalAssetWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(
            WebView view,
            WebResourceRequest request
        ) {
            Uri uri = request.getUrl();
            if (uri == null || !VIRTUAL_HOST.equalsIgnoreCase(uri.getHost())) {
                return super.shouldInterceptRequest(view, request);
            }

            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) {
                path = "index.html";
            } else if (path.startsWith("/")) {
                path = path.substring(1);
            }

            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");

            if (path.contains("..")) {
                return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    403,
                    "Forbidden",
                    headers,
                    new ByteArrayInputStream(new byte[0])
                );
            }

            try {
                InputStream stream = otaManager != null
                    ? otaManager.openAsset(path)
                    : getAssets().open(ASSET_PREFIX + path);
                return new WebResourceResponse(
                    guessMimeType(path),
                    "UTF-8",
                    200,
                    "OK",
                    headers,
                    stream
                );
            } catch (IOException e) {
                return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    404,
                    "Not Found",
                    headers,
                    new ByteArrayInputStream(new byte[0])
                );
            }
        }
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private static final class AndroidBridge {
        private final Activity activity;
        private final Context context;
        private final WebView webView;
        private final OtaUpdateManager otaManager;
        private final LanHostServer hostServer;
        private final LanDiscoveryManager discovery;

        AndroidBridge(
            Activity activity,
            WebView webView,
            OtaUpdateManager otaManager,
            LanHostServer hostServer,
            LanDiscoveryManager discovery
        ) {
            this.activity = activity;
            this.context = activity.getApplicationContext();
            this.webView = webView;
            this.otaManager = otaManager;
            this.hostServer = hostServer;
            this.discovery = discovery;
        }

        @JavascriptInterface
        public boolean isAndroidApk() {
            return true;
        }

        @JavascriptInterface
        public boolean isLanSupported() {
            return true;
        }

        @JavascriptInterface
        public String getLocalIpsJson() {
            JSONArray arr = new JSONArray();
            for (String ip : discovery.getLocalIpv4Addresses()) {
                arr.put(ip);
            }
            return arr.toString();
        }

        @JavascriptInterface
        public String startLanHost(int preferredPort, String hostName) {
            JSONObject res = new JSONObject();
            try {
                int port = hostServer.start(preferredPort > 0 ? preferredPort : 3001);
                discovery.startBroadcast(port, hostName);
                List<String> ips = discovery.getLocalIpv4Addresses();
                String primaryIp = ips.isEmpty() ? "" : ips.get(0);
                String summary = primaryIp.isEmpty()
                    ? "监听端口 " + port + " · 等待同局域网牌友加入"
                    : "地址 " + primaryIp + ":" + port + " · 保持前台避免休眠";
                LanForegroundService.start(context, summary);

                res.put("ok", true);
                res.put("port", port);
                res.put("hostToken", hostServer.getHostToken());
                res.put("primaryIp", primaryIp);
                JSONArray ipsArr = new JSONArray();
                for (String ip : ips) ipsArr.put(ip);
                res.put("ips", ipsArr);
            } catch (Throwable t) {
                try {
                    res.put("ok", false);
                    res.put("error", t.getMessage() != null ? t.getMessage() : "启动局域网房主失败");
                } catch (Throwable ignored) {
                    // ignore
                }
            }
            return res.toString();
        }

        @JavascriptInterface
        public void stopLanHost() {
            discovery.stopBroadcast();
            hostServer.stop();
            LanForegroundService.stop(context);
        }

        @JavascriptInterface
        public String getLanHostStatusJson() {
            JSONObject res = new JSONObject();
            try {
                List<String> ips = discovery.getLocalIpv4Addresses();
                res.put("running", hostServer.isRunning());
                res.put("port", hostServer.getPort());
                res.put("hostToken", hostServer.getHostToken());
                res.put("primaryIp", ips.isEmpty() ? "" : ips.get(0));
                res.put("guestCount", hostServer.getGuestCount());
                JSONArray ipsArr = new JSONArray();
                for (String ip : ips) ipsArr.put(ip);
                res.put("ips", ipsArr);
            } catch (Throwable ignored) {
                // ignore
            }
            return res.toString();
        }

        @JavascriptInterface
        public boolean startLanDiscovery() {
            return discovery.startDiscovery();
        }

        @JavascriptInterface
        public void stopLanDiscovery() {
            discovery.stopDiscovery();
        }

        @JavascriptInterface
        public String getDiscoveredLanHostsJson() {
            return discovery.getDiscoveredHostsJson();
        }

        @JavascriptInterface
        public String getAppVersionInfoJson() {
            return otaManager.getVersionInfoJson();
        }

        @JavascriptInterface
        public String fetchTextUrl(String url) {
            return otaManager.fetchTextUrl(url);
        }

        @JavascriptInterface
        public String startOtaInstall(String version, String downloadUrl, String expectedSha256) {
            return otaManager.startInstall(version, downloadUrl, expectedSha256);
        }

        @JavascriptInterface
        public String getOtaTaskStatusJson() {
            return otaManager.getTaskStatusJson();
        }

        @JavascriptInterface
        public void confirmOtaBootReady() {
            otaManager.confirmBootReady();
        }

        @JavascriptInterface
        public boolean clearOtaBundle() {
            return otaManager.clearOta();
        }

        @JavascriptInterface
        public void reloadApp() {
            activity.runOnUiThread(() -> {
                if (webView != null) {
                    webView.clearCache(true);
                    webView.loadUrl(START_URL);
                }
            });
        }

        @JavascriptInterface
        public boolean openExternalUrl(String url) {
            return otaManager.openExternalUrl(url);
        }

        @JavascriptInterface
        public void vibrate(int durationMs) {
            int clamped = Math.max(5, Math.min(80, durationMs));
            try {
                Vibrator vibrator;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    VibratorManager vm =
                        (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                    vibrator = vm != null ? vm.getDefaultVibrator() : null;
                } else {
                    vibrator = getLegacyVibrator();
                }
                if (vibrator != null && vibrator.hasVibrator()) {
                    vibrator.vibrate(
                        VibrationEffect.createOneShot(clamped, VibrationEffect.DEFAULT_AMPLITUDE)
                    );
                }
            } catch (Throwable ignored) {
                // Ignore vibration failures on devices without haptic motor
            }
        }

        @SuppressWarnings("deprecation")
        private Vibrator getLegacyVibrator() {
            return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
    }
}
