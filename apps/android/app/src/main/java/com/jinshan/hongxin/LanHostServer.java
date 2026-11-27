package com.jinshan.hongxin;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Zero-dependency embedded HTTP + RFC 6455 WebSocket server for offline Android LAN play.
 *
 * - Serves the bundled `assets/www/` web client over HTTP so friends (even iOS/PC browsers)
 *   can scan the QR code and join without installing anything.
 * - Accepts LAN guests on `/ws` and relays frames to the authoritative JS Worker on `/host`
 *   (strictly loopback + per-session random token).
 * - Exposes `/api/health` and `/api/rooms` from the latest snapshot pushed by the Host Worker.
 */
public final class LanHostServer {
    private static final String WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final String ASSET_PREFIX = "www/";
    private static final int MAX_HEADER_BYTES = 8 * 1024;
    private static final int MAX_WS_PAYLOAD_BYTES = 256 * 1024;

    private final Context appContext;
    private final OtaUpdateManager otaManager;
    private final Consumer<String> onRoomsSnapshot;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicInteger nextPeerSeq = new AtomicInteger(0);
    private final ConcurrentHashMap<String, WsConn> guestConns = new ConcurrentHashMap<>();

    private volatile ServerSocket serverSocket;
    private volatile ExecutorService executor;
    private volatile WsConn hostConn;
    private volatile int boundPort = 0;
    private volatile String hostToken = "";
    private volatile String roomsJson = "[]";
    private volatile int roomsCount = 0;

    public LanHostServer(Context appContext, OtaUpdateManager otaManager, Consumer<String> onRoomsSnapshot) {
        this.appContext = appContext.getApplicationContext();
        this.otaManager = otaManager;
        this.onRoomsSnapshot = onRoomsSnapshot;
    }

    public synchronized int start(int preferredPort) throws IOException {
        if (running.get() && serverSocket != null && !serverSocket.isClosed()) {
            return boundPort;
        }

        ServerSocket ss = bindPortWithFallback(preferredPort > 0 ? preferredPort : 3001);
        this.serverSocket = ss;
        this.boundPort = ss.getLocalPort();
        this.hostToken = generateTokenHex();
        this.roomsJson = "[]";
        this.roomsCount = 0;
        this.running.set(true);

        ExecutorService pool = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "jinshan-lan-io");
            t.setDaemon(true);
            return t;
        });
        this.executor = pool;

        Thread acceptThread = new Thread(() -> acceptLoop(ss, pool), "jinshan-lan-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return boundPort;
    }

    public synchronized void stop() {
        running.set(false);
        boundPort = 0;
        hostToken = "";
        roomsJson = "[]";
        roomsCount = 0;

        WsConn hc = hostConn;
        hostConn = null;
        if (hc != null) {
            hc.closeQuietly(1001, "Host stopped");
        }

        for (WsConn gc : guestConns.values()) {
            gc.closeQuietly(1001, "Host stopped");
        }
        guestConns.clear();

        ServerSocket ss = serverSocket;
        serverSocket = null;
        if (ss != null) {
            try {
                ss.close();
            } catch (IOException ignored) {
                // ignore
            }
        }

        ExecutorService pool = executor;
        executor = null;
        if (pool != null) {
            pool.shutdownNow();
        }
    }

    public boolean isRunning() {
        return running.get() && boundPort > 0;
    }

    public int getPort() {
        return boundPort;
    }

    public String getHostToken() {
        return hostToken;
    }

    public int getGuestCount() {
        return guestConns.size();
    }

    private ServerSocket bindPortWithFallback(int preferredPort) throws IOException {
        for (int port = preferredPort; port < preferredPort + 20; port++) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress("0.0.0.0", port));
                return ss;
            } catch (IOException ignored) {
                // Try next port
            }
        }
        ServerSocket ss = new ServerSocket();
        ss.setReuseAddress(true);
        ss.bind(new InetSocketAddress("0.0.0.0", 0));
        return ss;
    }

    private static String generateTokenHex() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder(32);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xFF));
        }
        return sb.toString();
    }

    private void acceptLoop(ServerSocket ss, ExecutorService pool) {
        while (running.get() && !ss.isClosed()) {
            try {
                Socket client = ss.accept();
                pool.execute(() -> handleClient(client));
            } catch (IOException e) {
                if (!running.get()) {
                    break;
                }
            }
        }
    }

    private void handleClient(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(15000);
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            OutputStream out = socket.getOutputStream();

            HttpRequest req = readHttpRequest(in);
            if (req == null) {
                closeSocketQuietly(socket);
                return;
            }

            if ("OPTIONS".equalsIgnoreCase(req.method)) {
                writeCorsNoContent(out);
                closeSocketQuietly(socket);
                return;
            }

            String upgrade = req.headers.get("upgrade");
            String wsKey = req.headers.get("sec-websocket-key");
            if (upgrade != null && upgrade.equalsIgnoreCase("websocket") && wsKey != null) {
                if ("/host".equals(req.path)) {
                    handleHostWebSocket(socket, in, out, req, wsKey);
                    return;
                }
                if ("/ws".equals(req.path)) {
                    handleGuestWebSocket(socket, in, out, wsKey);
                    return;
                }
                writeHttpText(out, 404, "Not Found", "application/json; charset=utf-8", "{\"error\":\"Not Found\"}");
                closeSocketQuietly(socket);
                return;
            }

            if (!"GET".equalsIgnoreCase(req.method) && !"HEAD".equalsIgnoreCase(req.method)) {
                writeHttpText(out, 405, "Method Not Allowed", "application/json; charset=utf-8", "{\"error\":\"Method Not Allowed\"}");
                closeSocketQuietly(socket);
                return;
            }

            handleHttpGet(req, out, "HEAD".equalsIgnoreCase(req.method));
            closeSocketQuietly(socket);
        } catch (Throwable ignored) {
            closeSocketQuietly(socket);
        }
    }

    private void handleHostWebSocket(
        Socket socket,
        InputStream in,
        OutputStream out,
        HttpRequest req,
        String wsKey
    ) throws Exception {
        InetAddress remote = socket.getInetAddress();
        String suppliedToken = req.queryParams.get("token");
        if (remote == null || !remote.isLoopbackAddress() || !hostToken.equals(suppliedToken)) {
            writeHttpText(out, 403, "Forbidden", "application/json; charset=utf-8", "{\"error\":\"Forbidden\"}");
            closeSocketQuietly(socket);
            return;
        }

        sendWsHandshake(out, wsKey);
        socket.setSoTimeout(0);

        WsConn conn = new WsConn("host", socket, out);
        WsConn previous = hostConn;
        hostConn = conn;
        if (previous != null && previous != conn) {
            previous.closeQuietly(1000, "Replaced by new host bridge");
        }

        // Notify the freshly attached host bridge about any already-open guests
        for (String peerId : guestConns.keySet()) {
            sendHostBridgeEvent("PEER_OPEN", peerId, null);
        }

        try {
            while (running.get() && conn.isOpen()) {
                String frame = readWsTextFrame(in, conn);
                if (frame == null) break;
                handleHostControlFrame(frame);
            }
        } finally {
            if (hostConn == conn) {
                hostConn = null;
            }
            conn.closeQuietly(1000, "Host bridge closed");
        }
    }

    private void handleHostControlFrame(String raw) {
        try {
            JSONObject obj = new JSONObject(raw);
            String type = obj.optString("type", "");
            if ("SEND".equals(type)) {
                String peerId = obj.optString("peerId", "");
                String payload = obj.optString("payload", "");
                WsConn guest = guestConns.get(peerId);
                if (guest != null) {
                    guest.sendText(payload);
                }
            } else if ("CLOSE".equals(type)) {
                String peerId = obj.optString("peerId", "");
                int code = obj.optInt("code", 1000);
                String reason = obj.optString("reason", "");
                WsConn guest = guestConns.remove(peerId);
                if (guest != null) {
                    guest.closeQuietly(code, reason);
                }
            } else if ("ROOMS_SNAPSHOT".equals(type)) {
                JSONArray rooms = obj.optJSONArray("rooms");
                if (rooms != null) {
                    String serialized = rooms.toString();
                    this.roomsJson = serialized;
                    this.roomsCount = rooms.length();
                    if (onRoomsSnapshot != null) {
                        onRoomsSnapshot.accept(serialized);
                    }
                }
            }
        } catch (Throwable ignored) {
            // ignore malformed control frame
        }
    }

    private void handleGuestWebSocket(
        Socket socket,
        InputStream in,
        OutputStream out,
        String wsKey
    ) throws Exception {
        sendWsHandshake(out, wsKey);
        socket.setSoTimeout(0);

        String peerId = "g" + nextPeerSeq.incrementAndGet();
        WsConn conn = new WsConn(peerId, socket, out);
        guestConns.put(peerId, conn);
        sendHostBridgeEvent("PEER_OPEN", peerId, null);

        try {
            while (running.get() && conn.isOpen()) {
                String frame = readWsTextFrame(in, conn);
                if (frame == null) break;
                sendHostBridgeEvent("PEER_MSG", peerId, frame);
            }
        } finally {
            guestConns.remove(peerId, conn);
            conn.closeQuietly(1000, "Guest disconnected");
            sendHostBridgeEvent("PEER_CLOSE", peerId, null);
        }
    }

    private void sendHostBridgeEvent(String type, String peerId, String payload) {
        WsConn hc = hostConn;
        if (hc == null || !hc.isOpen()) return;
        try {
            JSONObject obj = new JSONObject();
            obj.put("type", type);
            obj.put("peerId", peerId);
            if (payload != null) {
                obj.put("payload", payload);
            }
            hc.sendText(obj.toString());
        } catch (Throwable ignored) {
            // ignore
        }
    }

    private void handleHttpGet(HttpRequest req, OutputStream out, boolean headOnly) throws IOException {
        String path = req.path;
        if ("/api/health".equals(path) || "/health".equals(path)) {
            String json = "{\"ok\":true,\"lanHost\":true,\"port\":" + boundPort + ",\"rooms\":" + roomsCount + "}";
            writeHttpBytes(out, 200, "OK", "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8), headOnly);
            return;
        }
        if ("/api/rooms".equals(path)) {
            String json = "{\"rooms\":" + roomsJson + "}";
            writeHttpBytes(out, 200, "OK", "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8), headOnly);
            return;
        }
        if ("/api/history".equals(path)) {
            writeHttpBytes(out, 200, "OK", "application/json; charset=utf-8", "{\"matches\":[]}".getBytes(StandardCharsets.UTF_8), headOnly);
            return;
        }
        if ("/api/leaderboard".equals(path)) {
            writeHttpBytes(out, 200, "OK", "application/json; charset=utf-8", "{\"users\":[]}".getBytes(StandardCharsets.UTF_8), headOnly);
            return;
        }
        if (path.startsWith("/api/")) {
            writeHttpBytes(out, 404, "Not Found", "application/json; charset=utf-8", "{\"error\":\"Not Found\"}".getBytes(StandardCharsets.UTF_8), headOnly);
            return;
        }

        String relPath;
        if (path == null || path.isEmpty() || "/".equals(path)) {
            relPath = "index.html";
        } else {
            relPath = path.startsWith("/") ? path.substring(1) : path;
        }

        if (relPath.contains("..") || relPath.contains("\\")) {
            writeHttpText(out, 403, "Forbidden", "text/plain; charset=utf-8", "Forbidden");
            return;
        }

        byte[] data = otaManager != null
            ? otaManager.readAssetBytes(relPath)
            : readAssetBytes(appContext.getAssets(), ASSET_PREFIX + relPath);
        String resolvedPath = relPath;
        if (data == null && !relPath.contains(".")) {
            data = otaManager != null
                ? otaManager.readAssetBytes("index.html")
                : readAssetBytes(appContext.getAssets(), ASSET_PREFIX + "index.html");
            resolvedPath = "index.html";
        }
        if (data == null) {
            writeHttpText(out, 404, "Not Found", "text/plain; charset=utf-8", "Not Found");
            return;
        }

        writeHttpBytes(out, 200, "OK", guessMimeType(resolvedPath), data, headOnly);
    }

    private static byte[] readAssetBytes(AssetManager assets, String path) {
        try (InputStream is = assets.open(path)) {
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

    private static HttpRequest readHttpRequest(InputStream in) throws IOException {
        ByteArrayOutputStream headerBuf = new ByteArrayOutputStream(512);
        int state = 0;
        while (headerBuf.size() < MAX_HEADER_BYTES) {
            int b = in.read();
            if (b == -1) return null;
            headerBuf.write(b);
            if (state == 0 && b == '\r') state = 1;
            else if (state == 1 && b == '\n') state = 2;
            else if (state == 2 && b == '\r') state = 3;
            else if (state == 3 && b == '\n') break;
            else state = (b == '\r') ? 1 : 0;
        }
        if (state != 3) return null;

        String headerStr = headerBuf.toString(StandardCharsets.ISO_8859_1.name());
        String[] lines = headerStr.split("\r\n");
        if (lines.length == 0) return null;

        String[] parts = lines[0].split(" ");
        if (parts.length < 2) return null;

        String method = parts[0].trim();
        String target = parts[1].trim();
        String path = target;
        Map<String, String> queryParams = new HashMap<>();
        int qIdx = target.indexOf('?');
        if (qIdx >= 0) {
            path = target.substring(0, qIdx);
            String query = target.substring(qIdx + 1);
            for (String kv : query.split("&")) {
                if (kv.isEmpty()) continue;
                int eq = kv.indexOf('=');
                if (eq > 0) {
                    String k = decodeUrl(kv.substring(0, eq));
                    String v = decodeUrl(kv.substring(eq + 1));
                    queryParams.put(k, v);
                }
            }
        }

        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) {
                String k = lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String v = lines[i].substring(colon + 1).trim();
                headers.put(k, v);
            }
        }

        return new HttpRequest(method, path, queryParams, headers);
    }

    private static String decodeUrl(String raw) {
        try {
            return URLDecoder.decode(raw, StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return raw;
        }
    }

    private static void sendWsHandshake(OutputStream out, String clientKey) throws Exception {
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        byte[] digest = sha1.digest((clientKey.trim() + WS_MAGIC_GUID).getBytes(StandardCharsets.ISO_8859_1));
        String accept = Base64.getEncoder().encodeToString(digest);
        String response =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        out.write(response.getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private static String readWsTextFrame(InputStream in, WsConn conn) throws IOException {
        ByteArrayOutputStream assembled = null;
        int dataOpcode = -1;

        while (true) {
            int b0 = in.read();
            if (b0 == -1) return null;
            int b1 = in.read();
            if (b1 == -1) return null;

            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            boolean masked = (b1 & 0x80) != 0;
            long payloadLen = b1 & 0x7F;

            if (payloadLen == 126) {
                int hi = in.read();
                int lo = in.read();
                if (hi == -1 || lo == -1) return null;
                payloadLen = ((hi & 0xFF) << 8) | (lo & 0xFF);
            } else if (payloadLen == 127) {
                long len = 0;
                for (int i = 0; i < 8; i++) {
                    int b = in.read();
                    if (b == -1) return null;
                    len = (len << 8) | (b & 0xFF);
                }
                payloadLen = len;
            }

            if (payloadLen < 0 || payloadLen > MAX_WS_PAYLOAD_BYTES) {
                conn.closeQuietly(1009, "Message too big");
                return null;
            }

            byte[] mask = null;
            if (masked) {
                mask = readExact(in, 4);
            }

            byte[] payload = readExact(in, (int) payloadLen);
            if (masked) {
                for (int i = 0; i < payload.length; i++) {
                    payload[i] = (byte) (payload[i] ^ mask[i & 3]);
                }
            }

            if (opcode == 0x8) {
                // CLOSE
                conn.sendControlFrame(0x8, new byte[0]);
                return null;
            }
            if (opcode == 0x9) {
                // PING -> PONG
                conn.sendControlFrame(0xA, payload);
                continue;
            }
            if (opcode == 0xA) {
                // PONG
                continue;
            }

            if (opcode == 0x1 || opcode == 0x2) {
                if (fin && assembled == null) {
                    if (opcode == 0x1) {
                        return new String(payload, StandardCharsets.UTF_8);
                    }
                    continue;
                }
                dataOpcode = opcode;
                assembled = new ByteArrayOutputStream(payload.length);
                assembled.write(payload);
            } else if (opcode == 0x0 && assembled != null) {
                if (assembled.size() + payload.length > MAX_WS_PAYLOAD_BYTES) {
                    conn.closeQuietly(1009, "Message too big");
                    return null;
                }
                assembled.write(payload);
                if (fin) {
                    byte[] full = assembled.toByteArray();
                    assembled = null;
                    if (dataOpcode == 0x1) {
                        return new String(full, StandardCharsets.UTF_8);
                    }
                }
            }
        }
    }

    private static byte[] readExact(InputStream in, int length) throws IOException {
        byte[] buf = new byte[length];
        int offset = 0;
        while (offset < length) {
            int n = in.read(buf, offset, length - offset);
            if (n == -1) throw new EOFException("Unexpected EOF");
            offset += n;
        }
        return buf;
    }

    private static void writeCorsNoContent(OutputStream out) throws IOException {
        String resp =
            "HTTP/1.1 204 No Content\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type, Authorization\r\n" +
            "Connection: close\r\n\r\n";
        out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private static void writeHttpText(
        OutputStream out,
        int status,
        String reason,
        String contentType,
        String body
    ) throws IOException {
        writeHttpBytes(out, status, reason, contentType, body.getBytes(StandardCharsets.UTF_8), false);
    }

    private static void writeHttpBytes(
        OutputStream out,
        int status,
        String reason,
        String contentType,
        byte[] body,
        boolean headOnly
    ) throws IOException {
        String header =
            "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + body.length + "\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.ISO_8859_1));
        if (!headOnly) {
            out.write(body);
        }
        out.flush();
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private static void closeSocketQuietly(Socket socket) {
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // ignore
            }
        }
    }

    private static final class HttpRequest {
        final String method;
        final String path;
        final Map<String, String> queryParams;
        final Map<String, String> headers;

        HttpRequest(
            String method,
            String path,
            Map<String, String> queryParams,
            Map<String, String> headers
        ) {
            this.method = method;
            this.path = path;
            this.queryParams = queryParams;
            this.headers = headers;
        }
    }

    private static final class WsConn {
        final String id;
        final Socket socket;
        final OutputStream out;
        final Object writeLock = new Object();
        final AtomicBoolean open = new AtomicBoolean(true);

        WsConn(String id, Socket socket, OutputStream out) {
            this.id = id;
            this.socket = socket;
            this.out = out;
        }

        boolean isOpen() {
            return open.get() && !socket.isClosed();
        }

        void sendText(String text) {
            if (!isOpen()) return;
            byte[] data = text.getBytes(StandardCharsets.UTF_8);
            try {
                writeFrame(0x1, data);
            } catch (IOException e) {
                closeQuietly(1006, "Write failed");
            }
        }

        void sendControlFrame(int opcode, byte[] payload) {
            if (!isOpen()) return;
            try {
                writeFrame(opcode, payload);
            } catch (IOException ignored) {
                // ignore
            }
        }

        private void writeFrame(int opcode, byte[] data) throws IOException {
            synchronized (writeLock) {
                if (!open.get()) return;
                out.write(0x80 | (opcode & 0x0F));
                int len = data.length;
                if (len < 126) {
                    out.write(len);
                } else if (len <= 65535) {
                    out.write(126);
                    out.write((len >>> 8) & 0xFF);
                    out.write(len & 0xFF);
                } else {
                    out.write(127);
                    for (int shift = 56; shift >= 0; shift -= 8) {
                        out.write((int) (((long) len >>> shift) & 0xFF));
                    }
                }
                if (len > 0) {
                    out.write(data);
                }
                out.flush();
            }
        }

        void closeQuietly(int code, String reason) {
            if (!open.compareAndSet(true, false)) return;
            try {
                byte[] reasonBytes = reason != null ? reason.getBytes(StandardCharsets.UTF_8) : new byte[0];
                int maxReason = Math.min(reasonBytes.length, 120);
                byte[] body = new byte[2 + maxReason];
                body[0] = (byte) ((code >>> 8) & 0xFF);
                body[1] = (byte) (code & 0xFF);
                System.arraycopy(reasonBytes, 0, body, 2, maxReason);
                synchronized (writeLock) {
                    out.write(0x88);
                    out.write(body.length);
                    out.write(body);
                    out.flush();
                }
            } catch (Throwable ignored) {
                // ignore
            } finally {
                closeSocketQuietly(socket);
            }
        }
    }
}
