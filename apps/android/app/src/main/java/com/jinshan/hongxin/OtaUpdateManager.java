package com.jinshan.hongxin;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Zero-dependency Android OTA web-bundle manager with SHA-256 verification,
 * Zip-Slip protection, native-version superseding, and automatic anti-brick rollback.
 */
public final class OtaUpdateManager {
    private static final String ASSET_PREFIX = "www/";
    private static final int MAX_REDIRECTS = 6;
    private static final int MAX_TEXT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;

    private final Context appContext;
    private final File otaRoot;
    private final File bundlesDir;
    private final File stagingDir;
    private final File stateFile;
    private final String nativeVersion;
    private final long nativeVersionCode;

    private volatile File activeBundleDir;
    private volatile String activeOtaVersion;
    private volatile boolean pendingVerification;

    private final Object taskLock = new Object();
    private String taskState = "idle";
    private String taskVersion = "";
    private long downloadedBytes = 0L;
    private long totalBytes = 0L;
    private int taskProgress = 0;
    private String taskError = "";

    public OtaUpdateManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.otaRoot = new File(appContext.getFilesDir(), "ota");
        this.bundlesDir = new File(otaRoot, "bundles");
        this.stagingDir = new File(otaRoot, "staging");
        this.stateFile = new File(otaRoot, "state.json");

        String verName = "0.3.0";
        long verCode = 300L;
        try {
            PackageInfo pi = getPackageInfo(appContext);
            if (pi != null) {
                if (pi.versionName != null && !pi.versionName.trim().isEmpty()) {
                    verName = pi.versionName.trim();
                }
                verCode = getVersionCode(pi);
            }
        } catch (Throwable ignored) {
            // Keep default
        }
        this.nativeVersion = stripLeadingV(verName);
        this.nativeVersionCode = verCode;

        loadInitialState();
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo getPackageInfo(Context ctx) throws PackageManager.NameNotFoundException {
        PackageManager pm = ctx.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(ctx.getPackageName(), PackageManager.PackageInfoFlags.of(0));
        }
        return pm.getPackageInfo(ctx.getPackageName(), 0);
    }

    @SuppressWarnings("deprecation")
    private static long getVersionCode(PackageInfo pi) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return pi.getLongVersionCode();
        }
        return pi.versionCode;
    }

    private synchronized void loadInitialState() {
        if (!stateFile.isFile()) return;
        try {
            String raw = readFileUtf8(stateFile);
            JSONObject obj = new JSONObject(raw);
            String savedVersion = stripLeadingV(obj.optString("activeVersion", ""));
            String savedDir = obj.optString("activeDir", "");
            boolean wasPending = obj.optBoolean("pendingVerification", false);

            if (savedVersion.isEmpty() || savedDir.isEmpty()) {
                clearOtaLocked();
                return;
            }
            // If user installed a newer or equal native APK, discard older OTA bundle
            if (compareSemver(savedVersion, nativeVersion) <= 0) {
                clearOtaLocked();
                return;
            }
            // Anti-brick rollback: previous boot with this OTA bundle never confirmed ready
            if (wasPending) {
                clearOtaLocked();
                return;
            }

            File dir = new File(bundlesDir, savedDir);
            File indexHtml = new File(dir, "index.html");
            if (!dir.isDirectory() || !indexHtml.isFile() || indexHtml.length() <= 0) {
                clearOtaLocked();
                return;
            }

            this.activeBundleDir = dir;
            this.activeOtaVersion = savedVersion;
            this.pendingVerification = true;
            // Mark pending until React mounts and calls confirmBootReady()
            persistStateLocked(savedVersion, savedDir, true);
        } catch (Throwable ignored) {
            clearOtaLocked();
        }
    }

    public InputStream openAsset(String relPath) throws IOException {
        String clean = sanitizeRelPath(relPath);
        if (clean == null) {
            throw new IOException("Invalid asset path");
        }
        File activeDir = this.activeBundleDir;
        if (activeDir != null) {
            File candidate = new File(activeDir, clean);
            String baseCanonical = activeDir.getCanonicalPath();
            String fileCanonical = candidate.getCanonicalPath();
            if (fileCanonical.startsWith(baseCanonical + File.separator) && candidate.isFile()) {
                return new FileInputStream(candidate);
            }
        }
        return appContext.getAssets().open(ASSET_PREFIX + clean);
    }

    public byte[] readAssetBytes(String relPath) {
        try (InputStream is = openAsset(relPath)) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    public synchronized void confirmBootReady() {
        if (activeOtaVersion != null && activeBundleDir != null && pendingVerification) {
            pendingVerification = false;
            try {
                persistStateLocked(activeOtaVersion, activeBundleDir.getName(), false);
            } catch (Throwable ignored) {
                // ignore
            }
        }
    }

    public synchronized boolean clearOta() {
        clearOtaLocked();
        synchronized (taskLock) {
            taskState = "idle";
            taskVersion = "";
            downloadedBytes = 0L;
            totalBytes = 0L;
            taskProgress = 0;
            taskError = "";
        }
        return true;
    }

    private void clearOtaLocked() {
        activeBundleDir = null;
        activeOtaVersion = null;
        pendingVerification = false;
        deleteRecursive(stateFile);
        deleteRecursive(bundlesDir);
        deleteRecursive(stagingDir);
    }

    public String getVersionInfoJson() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("platform", "android");
            obj.put("nativeVersion", nativeVersion);
            obj.put("nativeVersionCode", nativeVersionCode);
            obj.put("otaVersion", activeOtaVersion != null ? activeOtaVersion : JSONObject.NULL);
            obj.put("otaActive", activeOtaVersion != null);
            obj.put("supportsOta", true);
        } catch (Throwable ignored) {
            // ignore
        }
        return obj.toString();
    }

    public String getTaskStatusJson() {
        JSONObject obj = new JSONObject();
        synchronized (taskLock) {
            try {
                obj.put("state", taskState);
                obj.put("version", taskVersion);
                obj.put("downloadedBytes", downloadedBytes);
                obj.put("totalBytes", totalBytes);
                obj.put("progress", taskProgress);
                obj.put("error", taskError);
            } catch (Throwable ignored) {
                // ignore
            }
        }
        return obj.toString();
    }

    public String fetchTextUrl(String urlStr) {
        JSONObject res = new JSONObject();
        HttpURLConnection conn = null;
        try {
            conn = openWithRedirects(urlStr);
            int status = conn.getResponseCode();
            InputStream stream = status >= 200 && status < 400
                ? conn.getInputStream()
                : conn.getErrorStream();
            String body = "";
            if (stream != null) {
                try (InputStream is = new BufferedInputStream(stream)) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int total = 0;
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        total += n;
                        if (total > MAX_TEXT_BYTES) {
                            throw new IOException("响应体超过大小限制");
                        }
                        baos.write(buf, 0, n);
                    }
                    body = baos.toString(StandardCharsets.UTF_8.name());
                }
            }
            res.put("ok", status >= 200 && status < 300);
            res.put("status", status);
            res.put("body", body);
            if (status < 200 || status >= 300) {
                res.put("error", "HTTP " + status);
            }
        } catch (Throwable t) {
            try {
                res.put("ok", false);
                res.put("status", 0);
                res.put("body", "");
                res.put("error", t.getMessage() != null ? t.getMessage() : "网络请求失败");
            } catch (Throwable ignored) {
                // ignore
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
        return res.toString();
    }

    public String startInstall(String rawVersion, String downloadUrl, String expectedSha256) {
        String version = stripLeadingV(rawVersion);
        JSONObject res = new JSONObject();
        try {
            if (version.isEmpty() || downloadUrl == null || downloadUrl.trim().isEmpty()) {
                res.put("ok", false);
                res.put("error", "更新参数无效");
                return res.toString();
            }
            synchronized (taskLock) {
                if ("downloading".equals(taskState) || "verifying".equals(taskState) || "extracting".equals(taskState)) {
                    res.put("ok", false);
                    res.put("error", "已有热更新任务正在进行中");
                    return res.toString();
                }
                taskState = "downloading";
                taskVersion = version;
                downloadedBytes = 0L;
                totalBytes = 0L;
                taskProgress = 0;
                taskError = "";
            }

            Thread worker = new Thread(
                () -> runInstallWorker(version, downloadUrl.trim(), expectedSha256 != null ? expectedSha256.trim() : ""),
                "jinshan-ota-install"
            );
            worker.setDaemon(true);
            worker.start();

            res.put("ok", true);
        } catch (Throwable t) {
            try {
                res.put("ok", false);
                res.put("error", t.getMessage() != null ? t.getMessage() : "启动热更新失败");
            } catch (Throwable ignored) {
                // ignore
            }
        }
        return res.toString();
    }

    private void runInstallWorker(String version, String downloadUrl, String expectedSha256) {
        File tmpZip = new File(otaRoot, "tmp-bundle.zip");
        File stageTarget = null;
        HttpURLConnection conn = null;
        try {
            if (!otaRoot.exists() && !otaRoot.mkdirs()) {
                throw new IOException("无法创建热更新目录");
            }
            deleteRecursive(tmpZip);

            conn = openWithRedirects(downloadUrl);
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("下载热更新包失败（HTTP " + status + "）");
            }

            long contentLength = conn.getContentLengthLong();
            synchronized (taskLock) {
                totalBytes = Math.max(0L, contentLength);
            }

            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            long received = 0L;
            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream out = new FileOutputStream(tmpZip)) {
                byte[] buf = new byte[16 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    received += n;
                    if (received > MAX_BUNDLE_BYTES) {
                        throw new IOException("热更新包体积超过安全上限");
                    }
                    out.write(buf, 0, n);
                    sha256.update(buf, 0, n);
                    int pct = contentLength > 0
                        ? (int) Math.min(80L, (received * 80L) / contentLength)
                        : Math.min(75, (int) (received / 8192));
                    synchronized (taskLock) {
                        downloadedBytes = received;
                        taskProgress = pct;
                    }
                }
            }

            synchronized (taskLock) {
                taskState = "verifying";
                taskProgress = 84;
            }
            String actualHash = toHex(sha256.digest());
            if (!expectedSha256.isEmpty() && !expectedSha256.equalsIgnoreCase(actualHash)) {
                throw new IOException("热更新包 SHA-256 校验失败，请重试");
            }

            synchronized (taskLock) {
                taskState = "extracting";
                taskProgress = 90;
            }
            String safeDirName = "v" + version.replaceAll("[^0-9A-Za-z._-]", "_");
            stageTarget = new File(stagingDir, safeDirName);
            deleteRecursive(stageTarget);
            if (!stageTarget.mkdirs()) {
                throw new IOException("无法创建解压临时目录");
            }

            extractZipSafe(tmpZip, stageTarget);
            File indexHtml = new File(stageTarget, "index.html");
            if (!indexHtml.isFile() || indexHtml.length() <= 0) {
                throw new IOException("热更新包缺少 index.html");
            }

            synchronized (this) {
                if (!bundlesDir.exists() && !bundlesDir.mkdirs()) {
                    throw new IOException("无法创建版本存储目录");
                }
                File finalDir = new File(bundlesDir, safeDirName);
                deleteRecursive(finalDir);
                if (!stageTarget.renameTo(finalDir)) {
                    throw new IOException("无法提交新版本目录");
                }
                stageTarget = null;

                // Mark pendingVerification=false until next reload? No: set true on commit,
                // Wait: on reload, loadInitialState() does NOT re-run; confirmBootReady() runs after reload!
                // If user force-kills before reload finishes, setting pendingVerification=false here
                // and flipping to true at next cold start ensures reload itself works smoothly AND
                // any crash on next cold start rolls back cleanly!
                this.activeBundleDir = finalDir;
                this.activeOtaVersion = version;
                this.pendingVerification = false;
                persistStateLocked(version, safeDirName, false);
                pruneOldBundlesLocked(safeDirName);
            }

            synchronized (taskLock) {
                taskState = "ready";
                taskProgress = 100;
                taskError = "";
            }
        } catch (Throwable t) {
            synchronized (taskLock) {
                taskState = "error";
                taskError = t.getMessage() != null ? t.getMessage() : "热更新安装失败";
            }
        } finally {
            if (conn != null) conn.disconnect();
            deleteRecursive(tmpZip);
            if (stageTarget != null) deleteRecursive(stageTarget);
        }
    }

    public boolean openExternalUrl(String urlStr) {
        if (urlStr == null) return false;
        String trimmed = urlStr.trim();
        if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
            return false;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            appContext.startActivity(intent);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void persistStateLocked(String version, String dirName, boolean pending) throws IOException {
        if (!otaRoot.exists() && !otaRoot.mkdirs()) {
            throw new IOException("无法创建热更新目录");
        }
        JSONObject obj = new JSONObject();
        try {
            obj.put("activeVersion", version);
            obj.put("activeDir", dirName);
            obj.put("pendingVerification", pending);
            obj.put("nativeVersion", nativeVersion);
            obj.put("updatedAt", System.currentTimeMillis());
        } catch (Throwable ignored) {
            // ignore
        }
        File tmp = new File(otaRoot, "state.json.tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(obj.toString().getBytes(StandardCharsets.UTF_8));
        }
        if (stateFile.exists() && !stateFile.delete()) {
            // overwrite fallback
        }
        if (!tmp.renameTo(stateFile)) {
            try (FileOutputStream fos = new FileOutputStream(stateFile)) {
                fos.write(obj.toString().getBytes(StandardCharsets.UTF_8));
            }
            deleteRecursive(tmp);
        }
    }

    private void pruneOldBundlesLocked(String keepDirName) {
        File[] children = bundlesDir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (!keepDirName.equals(child.getName())) {
                deleteRecursive(child);
            }
        }
    }

    private HttpURLConnection openWithRedirects(String urlStr) throws IOException {
        String current = urlStr;
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            URL url = new URL(current);
            String proto = url.getProtocol().toLowerCase(Locale.ROOT);
            if (!"https".equals(proto) && !"http".equals(proto)) {
                throw new IOException("不支持的协议：" + proto);
            }
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "JinShanHongXin-Android/" + nativeVersion);
            conn.setRequestProperty("Accept", "*/*");
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new IOException("重定向目标为空");
                }
                current = new URL(url, location).toString();
                continue;
            }
            return conn;
        }
        throw new IOException("重定向次数过多");
    }

    private static void extractZipSafe(File zipFile, File destDir) throws IOException {
        String destCanonical = destDir.getCanonicalPath();
        byte[] buf = new byte[16 * 1024];
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                while (name.startsWith("/")) name = name.substring(1);
                if (name.isEmpty() || name.contains("..")) {
                    throw new IOException("热更新包包含非法路径：" + entry.getName());
                }
                File outFile = new File(destDir, name);
                String outCanonical = outFile.getCanonicalPath();
                if (!outCanonical.equals(destCanonical) && !outCanonical.startsWith(destCanonical + File.separator)) {
                    throw new IOException("热更新包路径越界：" + entry.getName());
                }
                if (entry.isDirectory()) {
                    if (!outFile.exists() && !outFile.mkdirs()) {
                        throw new IOException("无法创建目录：" + name);
                    }
                } else {
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        throw new IOException("无法创建父目录：" + name);
                    }
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        int n;
                        while ((n = zis.read(buf)) != -1) {
                            fos.write(buf, 0, n);
                        }
                    }
                }
                zis.closeEntry();
            }
        }
    }

    private static String sanitizeRelPath(String raw) {
        if (raw == null) return null;
        String clean = raw;
        while (clean.startsWith("/")) clean = clean.substring(1);
        if (clean.isEmpty()) clean = "index.html";
        if (clean.contains("..") || clean.contains("\\")) return null;
        return clean;
    }

    private static String stripLeadingV(String s) {
        if (s == null) return "";
        String t = s.trim();
        if (t.startsWith("v") || t.startsWith("V")) {
            return t.substring(1).trim();
        }
        return t;
    }

    private static int compareSemver(String a, String b) {
        int[] pa = parseSemverCore(a);
        int[] pb = parseSemverCore(b);
        for (int i = 0; i < 3; i++) {
            if (pa[i] != pb[i]) return Integer.compare(pa[i], pb[i]);
        }
        return 0;
    }

    private static int[] parseSemverCore(String s) {
        int[] out = new int[]{0, 0, 0};
        if (s == null) return out;
        String clean = stripLeadingV(s);
        int dash = clean.indexOf('-');
        if (dash >= 0) clean = clean.substring(0, dash);
        String[] parts = clean.split("\\.");
        for (int i = 0; i < Math.min(3, parts.length); i++) {
            try {
                out[i] = Integer.parseInt(parts[i].trim());
            } catch (NumberFormatException ignored) {
                out[i] = 0;
            }
        }
        return out;
    }

    private static String readFileUtf8(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file)) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = fis.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return sb.toString();
    }
}
