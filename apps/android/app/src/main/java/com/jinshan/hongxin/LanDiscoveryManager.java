package com.jinshan.hongxin;

import android.content.Context;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LAN IP enumeration + UDP broadcast beacon & listener for automatic room discovery
 * over Wi-Fi and Android personal hotspots (zero external dependencies).
 */
public final class LanDiscoveryManager {
    public static final int DISCOVERY_PORT = 30019;
    private static final String BEACON_MAGIC = "JSHX_LAN_V1";
    private static final long HOST_STALE_MS = 6500L;

    private final Context appContext;
    private final ConcurrentHashMap<String, DiscoveredEntry> discovered = new ConcurrentHashMap<>();
    private final AtomicBoolean discovering = new AtomicBoolean(false);

    private volatile ScheduledExecutorService beaconScheduler;
    private volatile int hostingPort = 0;
    private volatile String hostingName = "金山房主";
    private volatile String latestRoomsJson = "[]";

    private volatile DatagramSocket listenSocket;
    private volatile WifiManager.MulticastLock multicastLock;

    public LanDiscoveryManager(Context appContext) {
        this.appContext = appContext.getApplicationContext();
    }

    public List<String> getLocalIpv4Addresses() {
        List<IpCandidate> candidates = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces == null) return Collections.emptyList();
            while (ifaces.hasMoreElements()) {
                NetworkInterface nif = ifaces.nextElement();
                if (!nif.isUp() || nif.isLoopback() || nif.isVirtual()) continue;
                String name = nif.getName() != null ? nif.getName().toLowerCase(Locale.ROOT) : "";
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("tun") || name.startsWith("ppp") || name.startsWith("dummy")) {
                    continue;
                }
                int priority = interfacePriority(name);
                Enumeration<InetAddress> addrs = nif.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && isPrivateLanIp(ip)) {
                            candidates.add(new IpCandidate(ip, priority));
                        }
                    }
                }
            }
        } catch (Throwable ignored) {
            // ignore
        }

        candidates.sort(Comparator.comparingInt(c -> c.priority));
        List<String> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (IpCandidate c : candidates) {
            if (seen.add(c.ip)) {
                result.add(c.ip);
            }
        }
        return result;
    }

    private static int interfacePriority(String name) {
        if (name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("softap")) return 0;
        if (name.startsWith("wlan")) return 1;
        if (name.startsWith("eth")) return 2;
        if (name.startsWith("rndis") || name.startsWith("usb")) return 3;
        return 4;
    }

    private static boolean isPrivateLanIp(String ip) {
        if (ip.startsWith("192.168.") || ip.startsWith("10.")) return true;
        if (ip.startsWith("172.")) {
            String[] parts = ip.split("\\.");
            if (parts.length == 4) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        return false;
    }

    private List<InetAddress> getBroadcastTargets() {
        List<InetAddress> targets = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces != null) {
                while (ifaces.hasMoreElements()) {
                    NetworkInterface nif = ifaces.nextElement();
                    if (!nif.isUp() || nif.isLoopback()) continue;
                    for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                        InetAddress bcast = ia.getBroadcast();
                        if (bcast instanceof Inet4Address) {
                            String host = bcast.getHostAddress();
                            if (host != null && seen.add(host)) {
                                targets.add(bcast);
                            }
                        }
                    }
                }
            }
            if (seen.add("255.255.255.255")) {
                targets.add(InetAddress.getByName("255.255.255.255"));
            }
        } catch (Throwable ignored) {
            // ignore
        }
        return targets;
    }

    public synchronized void startBroadcast(int port, String hostName) {
        stopBroadcast();
        this.hostingPort = port;
        this.hostingName = (hostName != null && !hostName.trim().isEmpty()) ? hostName.trim() : "金山房主";
        ScheduledExecutorService sched = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "jinshan-lan-beacon");
            t.setDaemon(true);
            return t;
        });
        this.beaconScheduler = sched;
        sched.scheduleWithFixedDelay(this::sendBeaconPacket, 150, 1500, TimeUnit.MILLISECONDS);
    }

    public void updateRoomsSnapshot(String roomsJson) {
        if (roomsJson != null) {
            this.latestRoomsJson = roomsJson;
        }
    }

    public synchronized void stopBroadcast() {
        this.hostingPort = 0;
        ScheduledExecutorService sched = beaconScheduler;
        beaconScheduler = null;
        if (sched != null) {
            sched.shutdownNow();
        }
    }

    private void sendBeaconPacket() {
        int port = hostingPort;
        if (port <= 0) return;

        try {
            List<String> ips = getLocalIpv4Addresses();
            String primaryIp = ips.isEmpty() ? "" : ips.get(0);

            String roomId = "";
            String mode = "hongxin";
            String status = "WAITING";
            int occupied = 1;
            int humanCount = 1;
            String roomHostName = hostingName;

            try {
                JSONArray rooms = new JSONArray(latestRoomsJson);
                if (rooms.length() > 0) {
                    JSONObject first = rooms.getJSONObject(0);
                    roomId = first.optString("roomId", "");
                    mode = first.optString("mode", "hongxin");
                    status = first.optString("status", "WAITING");
                    int hostSeat = first.optInt("hostSeat", 0);
                    JSONArray seats = first.optJSONArray("seats");
                    if (seats != null) {
                        occupied = 0;
                        humanCount = 0;
                        for (int i = 0; i < seats.length(); i++) {
                            JSONObject s = seats.getJSONObject(i);
                            if (s.optBoolean("occupied", false)) {
                                occupied++;
                                if (!s.optBoolean("isBot", false)) {
                                    humanCount++;
                                }
                                if (s.optInt("seat", -1) == hostSeat) {
                                    String n = s.optString("name", "");
                                    if (!n.isEmpty()) roomHostName = n;
                                }
                            }
                        }
                    }
                }
            } catch (Throwable ignored) {
                // use default meta
            }

            JSONObject payload = new JSONObject();
            payload.put("magic", BEACON_MAGIC);
            payload.put("port", port);
            payload.put("ip", primaryIp);
            payload.put("hostName", roomHostName);
            payload.put("roomId", roomId);
            payload.put("mode", mode);
            payload.put("status", status);
            payload.put("occupied", occupied);
            payload.put("humanCount", humanCount);
            payload.put("maxSeats", 4);

            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            List<InetAddress> targets = getBroadcastTargets();
            try (DatagramSocket ds = new DatagramSocket()) {
                ds.setBroadcast(true);
                for (InetAddress target : targets) {
                    try {
                        DatagramPacket packet = new DatagramPacket(bytes, bytes.length, target, DISCOVERY_PORT);
                        ds.send(packet);
                    } catch (Throwable ignored) {
                        // continue with other interfaces
                    }
                }
            }
        } catch (Throwable ignored) {
            // ignore transient network errors
        }
    }

    public synchronized boolean startDiscovery() {
        if (discovering.get()) return true;
        discovering.set(true);
        acquireMulticastLock();

        Thread listenThread = new Thread(this::discoveryLoop, "jinshan-lan-discover");
        listenThread.setDaemon(true);
        listenThread.start();
        return true;
    }

    public synchronized void stopDiscovery() {
        discovering.set(false);
        DatagramSocket ds = listenSocket;
        listenSocket = null;
        if (ds != null) {
            try {
                ds.close();
            } catch (Throwable ignored) {
                // ignore
            }
        }
        releaseMulticastLock();
        discovered.clear();
    }

    private void discoveryLoop() {
        DatagramSocket ds = null;
        try {
            ds = new DatagramSocket(null);
            ds.setReuseAddress(true);
            ds.setBroadcast(true);
            ds.bind(new InetSocketAddress(DISCOVERY_PORT));
            ds.setSoTimeout(1000);
            this.listenSocket = ds;

            byte[] buf = new byte[2048];
            while (discovering.get() && !ds.isClosed()) {
                try {
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    ds.receive(packet);
                    String raw = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
                    String senderIp = packet.getAddress() != null ? packet.getAddress().getHostAddress() : "";
                    handleBeaconReceived(senderIp, raw);
                } catch (SocketTimeoutException ignored) {
                    pruneStale();
                }
            }
        } catch (Throwable ignored) {
            // ignore bind/stop errors
        } finally {
            if (ds != null) {
                try {
                    ds.close();
                } catch (Throwable ignored) {
                    // ignore
                }
            }
            if (listenSocket == ds) {
                listenSocket = null;
            }
        }
    }

    private void handleBeaconReceived(String senderIp, String raw) {
        try {
            JSONObject obj = new JSONObject(raw);
            if (!BEACON_MAGIC.equals(obj.optString("magic", ""))) return;
            int port = obj.optInt("port", 0);
            if (port <= 0 || port > 65535) return;

            String ip = (senderIp != null && !senderIp.isEmpty() && !senderIp.startsWith("127."))
                ? senderIp
                : obj.optString("ip", "");
            if (ip.isEmpty()) return;

            String key = ip + ":" + port;
            DiscoveredEntry entry = new DiscoveredEntry();
            entry.ip = ip;
            entry.port = port;
            entry.hostName = obj.optString("hostName", "金山房主");
            entry.roomId = obj.optString("roomId", "");
            entry.mode = obj.optString("mode", "hongxin");
            entry.status = obj.optString("status", "WAITING");
            entry.occupied = obj.optInt("occupied", 1);
            entry.humanCount = obj.optInt("humanCount", 1);
            entry.maxSeats = obj.optInt("maxSeats", 4);
            entry.lastSeenMs = System.currentTimeMillis();
            discovered.put(key, entry);
        } catch (Throwable ignored) {
            // ignore invalid datagrams
        }
    }

    private void pruneStale() {
        long cutoff = System.currentTimeMillis() - HOST_STALE_MS;
        for (Map.Entry<String, DiscoveredEntry> e : discovered.entrySet()) {
            if (e.getValue().lastSeenMs < cutoff) {
                discovered.remove(e.getKey(), e.getValue());
            }
        }
    }

    public String getDiscoveredHostsJson() {
        pruneStale();
        Set<String> myIps = new HashSet<>(getLocalIpv4Addresses());
        int myPort = hostingPort;

        JSONArray arr = new JSONArray();
        List<DiscoveredEntry> entries = new ArrayList<>(discovered.values());
        entries.sort((a, b) -> Long.compare(b.lastSeenMs, a.lastSeenMs));

        for (DiscoveredEntry e : entries) {
            boolean isSelf = myPort > 0 && e.port == myPort && myIps.contains(e.ip);
            try {
                JSONObject item = new JSONObject();
                item.put("ip", e.ip);
                item.put("port", e.port);
                item.put("url", "http://" + e.ip + ":" + e.port);
                item.put("hostName", e.hostName);
                item.put("roomId", e.roomId);
                item.put("mode", e.mode);
                item.put("status", e.status);
                item.put("occupied", e.occupied);
                item.put("humanCount", e.humanCount);
                item.put("maxSeats", e.maxSeats);
                item.put("isSelf", isSelf);
                item.put("lastSeenMs", e.lastSeenMs);
                arr.put(item);
            } catch (Throwable ignored) {
                // ignore
            }
        }
        return arr.toString();
    }

    private void acquireMulticastLock() {
        try {
            WifiManager wm = (WifiManager) appContext.getSystemService(Context.WIFI_SERVICE);
            if (wm != null && multicastLock == null) {
                WifiManager.MulticastLock lock = wm.createMulticastLock("jinshan-lan-discovery");
                lock.setReferenceCounted(false);
                lock.acquire();
                multicastLock = lock;
            }
        } catch (Throwable ignored) {
            // ignore on devices without wifi service
        }
    }

    private void releaseMulticastLock() {
        WifiManager.MulticastLock lock = multicastLock;
        multicastLock = null;
        if (lock != null) {
            try {
                if (lock.isHeld()) lock.release();
            } catch (Throwable ignored) {
                // ignore
            }
        }
    }

    public void dispose() {
        stopBroadcast();
        stopDiscovery();
    }

    private static final class IpCandidate {
        final String ip;
        final int priority;

        IpCandidate(String ip, int priority) {
            this.ip = ip;
            this.priority = priority;
        }
    }

    private static final class DiscoveredEntry {
        String ip;
        int port;
        String hostName;
        String roomId;
        String mode;
        String status;
        int occupied;
        int humanCount;
        int maxSeats;
        long lastSeenMs;
    }
}
