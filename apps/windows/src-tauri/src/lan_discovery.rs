use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use socket2::{Domain, Protocol, Socket, Type};

/// Wire-compatible with Android `LanDiscoveryManager.java`.
pub const DISCOVERY_PORT: u16 = 30019;
pub const BEACON_MAGIC: &str = "JSHX_LAN_V1";
const HOST_STALE_MS: u64 = 6_500;
const BEACON_INITIAL_DELAY_MS: u64 = 150;
const BEACON_INTERVAL_MS: u64 = 1_500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredLanHost {
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub host_name: String,
    pub room_id: String,
    pub mode: String,
    pub status: String,
    pub occupied: u32,
    pub human_count: u32,
    pub max_seats: u32,
    pub is_self: bool,
    pub last_seen_ms: u64,
}

#[derive(Debug, Clone)]
struct DiscoveredEntry {
    ip: String,
    port: u16,
    host_name: String,
    room_id: String,
    mode: String,
    status: String,
    occupied: u32,
    human_count: u32,
    max_seats: u32,
    last_seen_ms: u64,
}

struct SharedDiscovery {
    beacon_running: AtomicBool,
    discovering: AtomicBool,
    hosting_port: AtomicU16,
    hosting_name: Mutex<String>,
    latest_rooms_json: Mutex<String>,
    discovered: Mutex<HashMap<String, DiscoveredEntry>>,
}

pub struct LanDiscoveryManager {
    shared: Arc<SharedDiscovery>,
    discovery_port: u16,
}

impl Default for LanDiscoveryManager {
    fn default() -> Self {
        Self::new(DISCOVERY_PORT)
    }
}

impl LanDiscoveryManager {
    pub fn new(discovery_port: u16) -> Self {
        Self {
            shared: Arc::new(SharedDiscovery {
                beacon_running: AtomicBool::new(false),
                discovering: AtomicBool::new(false),
                hosting_port: AtomicU16::new(0),
                hosting_name: Mutex::new("金山房主".to_string()),
                latest_rooms_json: Mutex::new("[]".to_string()),
                discovered: Mutex::new(HashMap::new()),
            }),
            discovery_port,
        }
    }

    pub fn get_local_ipv4_addresses(&self) -> Vec<String> {
        enumerate_local_ipv4_addresses()
    }

    pub fn start_broadcast(&self, port: u16, host_name: &str) {
        self.stop_broadcast();
        self.shared.hosting_port.store(port, Ordering::Relaxed);
        if let Ok(mut name) = self.shared.hosting_name.lock() {
            let trimmed = host_name.trim();
            *name = if trimmed.is_empty() {
                "金山房主".to_string()
            } else {
                trimmed.to_string()
            };
        }
        self.shared.beacon_running.store(true, Ordering::SeqCst);

        let shared = Arc::clone(&self.shared);
        let discovery_port = self.discovery_port;
        let _ = thread::Builder::new()
            .name("jinshan-lan-beacon".into())
            .spawn(move || {
                sleep_interruptible(&shared.beacon_running, BEACON_INITIAL_DELAY_MS);
                while shared.beacon_running.load(Ordering::SeqCst) {
                    send_beacon_packet(&shared, discovery_port);
                    sleep_interruptible(&shared.beacon_running, BEACON_INTERVAL_MS);
                }
            });
    }

    pub fn update_rooms_snapshot(&self, rooms_json: &str) {
        if let Ok(mut guard) = self.shared.latest_rooms_json.lock() {
            *guard = rooms_json.to_string();
        }
    }

    pub fn stop_broadcast(&self) {
        self.shared.beacon_running.store(false, Ordering::SeqCst);
        self.shared.hosting_port.store(0, Ordering::Relaxed);
    }

    pub fn start_discovery(&self) -> bool {
        if self
            .shared
            .discovering
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return true;
        }

        let shared = Arc::clone(&self.shared);
        let discovery_port = self.discovery_port;
        thread::Builder::new()
            .name("jinshan-lan-discover".into())
            .spawn(move || discovery_loop(shared, discovery_port))
            .is_ok()
    }

    pub fn stop_discovery(&self) {
        self.shared.discovering.store(false, Ordering::SeqCst);
        if let Ok(mut map) = self.shared.discovered.lock() {
            map.clear();
        }
    }

    pub fn get_discovered_hosts(&self) -> Vec<DiscoveredLanHost> {
        prune_stale(&self.shared);
        let my_ips: HashSet<String> = self.get_local_ipv4_addresses().into_iter().collect();
        let my_port = self.shared.hosting_port.load(Ordering::Relaxed);

        let mut entries: Vec<DiscoveredEntry> = self
            .shared
            .discovered
            .lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();

        entries.sort_by_key(|a| std::cmp::Reverse(a.last_seen_ms));

        entries
            .into_iter()
            .map(|e| {
                let is_self = my_port > 0 && e.port == my_port && my_ips.contains(&e.ip);
                DiscoveredLanHost {
                    url: format!("http://{}:{}", e.ip, e.port),
                    ip: e.ip,
                    port: e.port,
                    host_name: e.host_name,
                    room_id: e.room_id,
                    mode: e.mode,
                    status: e.status,
                    occupied: e.occupied,
                    human_count: e.human_count,
                    max_seats: e.max_seats,
                    is_self,
                    last_seen_ms: e.last_seen_ms,
                }
            })
            .collect()
    }

    pub fn dispose(&self) {
        self.stop_broadcast();
        self.stop_discovery();
    }

    #[cfg(test)]
    fn inject_raw_beacon(&self, sender_ip: &str, raw: &str) {
        handle_beacon_received(&self.shared, sender_ip, raw);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sleep_interruptible(flag: &AtomicBool, total_ms: u64) {
    let mut elapsed = 0u64;
    while elapsed < total_ms && flag.load(Ordering::SeqCst) {
        let step = (total_ms - elapsed).min(100);
        thread::sleep(Duration::from_millis(step));
        elapsed += step;
    }
}

pub fn is_private_lan_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 10 || (a == 192 && b == 168) || (a == 172 && (16..=31).contains(&b))
}

fn is_excluded_interface(lower_name: &str) -> bool {
    const EXCLUDED_PREFIXES: &[&str] = &[
        "lo",
        "rmnet",
        "ccmni",
        "tun",
        "tap",
        "utun",
        "ppp",
        "dummy",
        "docker",
        "br-",
        "virbr",
        "veth",
        "wg",
        "tailscale",
        "zt",
    ];
    if EXCLUDED_PREFIXES.iter().any(|p| lower_name.starts_with(p)) {
        return true;
    }
    const EXCLUDED_SUBSTRS: &[&str] = &[
        "vethernet",
        "wsl",
        "hyper-v",
        "vmware",
        "virtualbox",
        "vbox",
        "loopback",
        "zerotier",
        "tailscale",
        "vpn",
        "wireguard",
        "nordlynx",
        "hamachi",
    ];
    EXCLUDED_SUBSTRS.iter().any(|s| lower_name.contains(s))
}

fn interface_priority(lower_name: &str, ip: Ipv4Addr) -> u8 {
    let iface_rank = if lower_name.starts_with("ap")
        || lower_name.starts_with("swlan")
        || lower_name.starts_with("softap")
        || lower_name.contains("wi-fi")
        || lower_name.contains("wifi")
        || lower_name.starts_with("wlan")
        || lower_name.starts_with("wlp")
    {
        0
    } else if lower_name.contains("ethernet")
        || lower_name.contains("以太网")
        || lower_name.starts_with("eth")
        || lower_name.starts_with("en")
    {
        1
    } else if lower_name.starts_with("rndis") || lower_name.starts_with("usb") {
        2
    } else {
        3
    };

    // Slightly prefer 192.168.x.x over 10.x.x.x / 172.16-31.x.x within the same tier
    let ip_tiebreak = if ip.octets()[0] == 192 { 0 } else { 1 };
    iface_rank * 2 + ip_tiebreak
}

pub fn enumerate_local_ipv4_addresses() -> Vec<String> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };

    let mut primary_candidates: Vec<(u8, String)> = Vec::new();
    let mut fallback_candidates: Vec<String> = Vec::new();

    for iface in ifaces {
        if iface.is_loopback() {
            continue;
        }
        let std::net::IpAddr::V4(ip) = iface.ip() else {
            continue;
        };
        if ip.is_loopback() || ip.is_link_local() || !is_private_lan_ipv4(ip) {
            continue;
        }
        let lower = iface.name.to_lowercase();
        let ip_str = ip.to_string();
        if is_excluded_interface(&lower) {
            fallback_candidates.push(ip_str);
        } else {
            primary_candidates.push((interface_priority(&lower, ip), ip_str));
        }
    }

    primary_candidates.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for (_, ip) in primary_candidates {
        if seen.insert(ip.clone()) {
            result.push(ip);
        }
    }
    if result.is_empty() {
        for ip in fallback_candidates {
            if seen.insert(ip.clone()) {
                result.push(ip);
            }
        }
    }
    result
}

fn get_broadcast_targets() -> Vec<Ipv4Addr> {
    let mut targets = Vec::new();
    let mut seen = HashSet::new();

    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                if !is_private_lan_ipv4(v4.ip) {
                    continue;
                }
                let lower = iface.name.to_lowercase();
                if is_excluded_interface(&lower) {
                    continue;
                }
                let bcast = v4.broadcast.unwrap_or_else(|| {
                    let ip_u32 = u32::from(v4.ip);
                    let mask_u32 = u32::from(v4.netmask);
                    Ipv4Addr::from(ip_u32 | !mask_u32)
                });
                if !bcast.is_loopback() && seen.insert(bcast) {
                    targets.push(bcast);
                }
            }
        }
    }

    if seen.insert(Ipv4Addr::BROADCAST) {
        targets.push(Ipv4Addr::BROADCAST);
    }
    targets
}

pub fn build_beacon_json(
    port: u16,
    primary_ip: &str,
    default_host_name: &str,
    rooms_json: &str,
) -> String {
    let mut room_id = String::new();
    let mut mode = "hongxin".to_string();
    let mut status = "WAITING".to_string();
    let mut occupied = 1u32;
    let mut human_count = 1u32;
    let mut room_host_name = default_host_name.to_string();

    if let Ok(Value::Array(rooms)) = serde_json::from_str::<Value>(rooms_json) {
        if let Some(first) = rooms.first() {
            if let Some(v) = first.get("roomId").and_then(Value::as_str) {
                room_id = v.to_string();
            }
            if let Some(v) = first.get("mode").and_then(Value::as_str) {
                mode = v.to_string();
            }
            if let Some(v) = first.get("status").and_then(Value::as_str) {
                status = v.to_string();
            }
            let host_seat = first.get("hostSeat").and_then(Value::as_i64).unwrap_or(0);
            if let Some(Value::Array(seats)) = first.get("seats") {
                occupied = 0;
                human_count = 0;
                for seat in seats {
                    if seat.get("occupied").and_then(Value::as_bool).unwrap_or(false) {
                        occupied += 1;
                        if !seat.get("isBot").and_then(Value::as_bool).unwrap_or(false) {
                            human_count += 1;
                        }
                        if seat.get("seat").and_then(Value::as_i64).unwrap_or(-1) == host_seat {
                            if let Some(name) = seat.get("name").and_then(Value::as_str) {
                                if !name.is_empty() {
                                    room_host_name = name.to_string();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    serde_json::json!({
        "magic": BEACON_MAGIC,
        "port": port,
        "ip": primary_ip,
        "hostName": room_host_name,
        "roomId": room_id,
        "mode": mode,
        "status": status,
        "occupied": occupied,
        "humanCount": human_count,
        "maxSeats": 4,
    })
    .to_string()
}

fn send_beacon_packet(shared: &SharedDiscovery, discovery_port: u16) {
    let port = shared.hosting_port.load(Ordering::Relaxed);
    if port == 0 {
        return;
    }

    let ips = enumerate_local_ipv4_addresses();
    let primary_ip = ips.first().map(String::as_str).unwrap_or("");
    let default_name = shared
        .hosting_name
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "金山房主".to_string());
    let rooms_json = shared
        .latest_rooms_json
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "[]".to_string());

    let payload = build_beacon_json(port, primary_ip, &default_name, &rooms_json);
    let bytes = payload.as_bytes();

    let Ok(ds) = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)) else {
        return;
    };
    let _ = ds.set_broadcast(true);

    for target in get_broadcast_targets() {
        let _ = ds.send_to(bytes, SocketAddrV4::new(target, discovery_port));
    }
}

fn bind_discovery_socket(discovery_port: u16) -> Option<UdpSocket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).ok()?;
    let _ = sock.set_reuse_address(true);
    let _ = sock.set_broadcast(true);
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, discovery_port));
    sock.bind(&addr.into()).ok()?;
    let udp: UdpSocket = sock.into();
    let _ = udp.set_read_timeout(Some(Duration::from_millis(500)));
    Some(udp)
}

fn discovery_loop(shared: Arc<SharedDiscovery>, discovery_port: u16) {
    let Some(udp) = bind_discovery_socket(discovery_port) else {
        shared.discovering.store(false, Ordering::SeqCst);
        return;
    };

    let mut buf = [0u8; 2048];
    while shared.discovering.load(Ordering::SeqCst) {
        match udp.recv_from(&mut buf) {
            Ok((len, src)) => {
                if let Ok(raw) = std::str::from_utf8(&buf[..len]) {
                    let sender_ip = src.ip().to_string();
                    handle_beacon_received(&shared, &sender_ip, raw);
                }
            }
            Err(_) => {
                prune_stale(&shared);
            }
        }
    }
}

fn handle_beacon_received(shared: &SharedDiscovery, sender_ip: &str, raw: &str) {
    let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    if obj.get("magic").and_then(Value::as_str) != Some(BEACON_MAGIC) {
        return;
    }
    let Some(port_u64) = obj.get("port").and_then(Value::as_u64) else {
        return;
    };
    if port_u64 == 0 || port_u64 > 65535 {
        return;
    }
    let port = port_u64 as u16;

    let ip = if !sender_ip.is_empty() && !sender_ip.starts_with("127.") {
        sender_ip.to_string()
    } else {
        obj.get("ip")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    if ip.is_empty() {
        return;
    }

    let key = format!("{ip}:{port}");
    let entry = DiscoveredEntry {
        ip,
        port,
        host_name: obj
            .get("hostName")
            .and_then(Value::as_str)
            .unwrap_or("金山房主")
            .to_string(),
        room_id: obj
            .get("roomId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        mode: obj
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("hongxin")
            .to_string(),
        status: obj
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("WAITING")
            .to_string(),
        occupied: obj.get("occupied").and_then(Value::as_u64).unwrap_or(1) as u32,
        human_count: obj.get("humanCount").and_then(Value::as_u64).unwrap_or(1) as u32,
        max_seats: obj.get("maxSeats").and_then(Value::as_u64).unwrap_or(4) as u32,
        last_seen_ms: now_ms(),
    };

    if let Ok(mut map) = shared.discovered.lock() {
        map.insert(key, entry);
    }
}

fn prune_stale(shared: &SharedDiscovery) {
    let cutoff = now_ms().saturating_sub(HOST_STALE_MS);
    if let Ok(mut map) = shared.discovered.lock() {
        map.retain(|_, v| v.last_seen_ms >= cutoff);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beacon_json_matches_android_protocol_schema() {
        let rooms = serde_json::json!([
            {
                "roomId": "654321",
                "mode": "heixin",
                "status": "WAITING",
                "hostSeat": 0,
                "seats": [
                    { "seat": 0, "name": "老王", "occupied": true, "isBot": false },
                    { "seat": 1, "name": "机器人1", "occupied": true, "isBot": true },
                    { "seat": 2, "name": "", "occupied": false, "isBot": false },
                    { "seat": 3, "name": "", "occupied": false, "isBot": false }
                ]
            }
        ])
        .to_string();

        let raw = build_beacon_json(3005, "192.168.1.88", "默认房主", &rooms);
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["magic"], BEACON_MAGIC);
        assert_eq!(parsed["port"], 3005);
        assert_eq!(parsed["ip"], "192.168.1.88");
        assert_eq!(parsed["hostName"], "老王");
        assert_eq!(parsed["roomId"], "654321");
        assert_eq!(parsed["mode"], "heixin");
        assert_eq!(parsed["status"], "WAITING");
        assert_eq!(parsed["occupied"], 2);
        assert_eq!(parsed["humanCount"], 1);
        assert_eq!(parsed["maxSeats"], 4);
    }

    #[test]
    fn discovery_parses_beacons_and_filters_private_ips() {
        assert!(is_private_lan_ipv4(Ipv4Addr::new(192, 168, 1, 10)));
        assert!(is_private_lan_ipv4(Ipv4Addr::new(10, 0, 0, 5)));
        assert!(is_private_lan_ipv4(Ipv4Addr::new(172, 20, 10, 2)));
        assert!(!is_private_lan_ipv4(Ipv4Addr::new(172, 32, 0, 1)));
        assert!(!is_private_lan_ipv4(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(is_excluded_interface("vethernet (wsl)"));
        assert!(!is_excluded_interface("wi-fi"));

        let mgr = LanDiscoveryManager::new(0);
        let beacon = build_beacon_json(3001, "192.168.43.1", "安卓房主", "[]");
        mgr.inject_raw_beacon("192.168.43.1", &beacon);
        // Invalid magic is ignored
        mgr.inject_raw_beacon("192.168.43.2", r#"{"magic":"OTHER","port":3001}"#);

        let hosts = mgr.get_discovered_hosts();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].ip, "192.168.43.1");
        assert_eq!(hosts[0].port, 3001);
        assert_eq!(hosts[0].url, "http://192.168.43.1:3001");
        assert_eq!(hosts[0].host_name, "安卓房主");
    }

    #[test]
    fn udp_discovery_listener_receives_live_beacon_packet() {
        // Reserve a free ephemeral port for isolated UDP testing
        let probe = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
        let test_port = probe.local_addr().unwrap().port();
        drop(probe);

        let mgr = LanDiscoveryManager::new(test_port);
        assert!(mgr.start_discovery());
        thread::sleep(Duration::from_millis(80));

        let sender = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
        let beacon = build_beacon_json(3009, "192.168.8.12", "Windows房主", "[]");
        sender
            .send_to(
                beacon.as_bytes(),
                SocketAddrV4::new(Ipv4Addr::LOCALHOST, test_port),
            )
            .unwrap();

        let mut found = Vec::new();
        for _ in 0..20 {
            found = mgr.get_discovered_hosts();
            if !found.is_empty() {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }

        mgr.dispose();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].ip, "192.168.8.12");
        assert_eq!(found[0].port, 3009);
        assert_eq!(found[0].host_name, "Windows房主");
    }
}
