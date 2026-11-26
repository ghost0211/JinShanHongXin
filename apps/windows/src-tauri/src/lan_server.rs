use std::collections::HashMap;
use std::io::{self, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::Engine as _;
use serde_json::Value;
use socket2::{Domain, Protocol, Socket, Type};

const WS_MAGIC_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_WS_PAYLOAD_BYTES: usize = 256 * 1024;

pub type AssetLoader = Arc<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;
pub type RoomsSnapshotCallback = Arc<dyn Fn(&str) + Send + Sync>;

struct WsConn {
    stream: Mutex<TcpStream>,
    open: AtomicBool,
}

impl WsConn {
    fn new(stream: TcpStream) -> Self {
        Self {
            stream: Mutex::new(stream),
            open: AtomicBool::new(true),
        }
    }

    fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }

    fn send_text(&self, text: &str) {
        if !self.is_open() {
            return;
        }
        if self.write_frame(0x1, text.as_bytes()).is_err() {
            self.close_quietly(1006, "Write failed");
        }
    }

    fn send_control(&self, opcode: u8, payload: &[u8]) {
        if !self.is_open() {
            return;
        }
        let _ = self.write_frame(opcode, payload);
    }

    fn write_frame(&self, opcode: u8, data: &[u8]) -> io::Result<()> {
        let Ok(mut stream) = self.stream.lock() else {
            return Err(io::Error::other("lock poisoned"));
        };
        if !self.open.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut header = Vec::with_capacity(10);
        header.push(0x80 | (opcode & 0x0F));
        let len = data.len();
        if len < 126 {
            header.push(len as u8);
        } else if len <= 65_535 {
            header.push(126);
            header.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            header.push(127);
            header.extend_from_slice(&(len as u64).to_be_bytes());
        }
        stream.write_all(&header)?;
        if !data.is_empty() {
            stream.write_all(data)?;
        }
        stream.flush()
    }

    fn close_quietly(&self, code: u16, reason: &str) {
        if self
            .open
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        if let Ok(mut stream) = self.stream.lock() {
            let reason_bytes = reason.as_bytes();
            let max_reason = reason_bytes.len().min(120);
            let mut body = Vec::with_capacity(2 + max_reason);
            body.extend_from_slice(&code.to_be_bytes());
            body.extend_from_slice(&reason_bytes[..max_reason]);
            let mut frame = Vec::with_capacity(2 + body.len());
            frame.push(0x88);
            frame.push(body.len() as u8);
            frame.extend_from_slice(&body);
            let _ = stream.write_all(&frame);
            let _ = stream.flush();
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    }
}

struct SharedServer {
    running: AtomicBool,
    bound_port: AtomicU16,
    next_peer_seq: AtomicU64,
    rooms_count: AtomicUsize,
    host_token: Mutex<String>,
    rooms_json: Mutex<String>,
    host_conn: Mutex<Option<Arc<WsConn>>>,
    guest_conns: Mutex<HashMap<String, Arc<WsConn>>>,
    asset_loader: AssetLoader,
    on_rooms_snapshot: Option<RoomsSnapshotCallback>,
}

/// Zero-dependency embedded HTTP + RFC 6455 WebSocket relay server,
/// wire-compatible with Android `LanHostServer.java`.
pub struct LanHostServer {
    shared: Arc<SharedServer>,
    lifecycle_lock: Mutex<()>,
}

impl LanHostServer {
    pub fn new(
        asset_loader: AssetLoader,
        on_rooms_snapshot: Option<RoomsSnapshotCallback>,
    ) -> Self {
        Self {
            shared: Arc::new(SharedServer {
                running: AtomicBool::new(false),
                bound_port: AtomicU16::new(0),
                next_peer_seq: AtomicU64::new(0),
                rooms_count: AtomicUsize::new(0),
                host_token: Mutex::new(String::new()),
                rooms_json: Mutex::new("[]".to_string()),
                host_conn: Mutex::new(None),
                guest_conns: Mutex::new(HashMap::new()),
                asset_loader,
                on_rooms_snapshot,
            }),
            lifecycle_lock: Mutex::new(()),
        }
    }

    pub fn start(&self, preferred_port: u16) -> io::Result<u16> {
        let _guard = self.lifecycle_lock.lock().unwrap();
        if self.shared.running.load(Ordering::SeqCst) {
            let port = self.shared.bound_port.load(Ordering::Relaxed);
            if port > 0 {
                return Ok(port);
            }
        }

        let listener = bind_port_with_fallback(if preferred_port > 0 {
            preferred_port
        } else {
            3001
        })?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;

        let token = generate_token_hex();
        *self.shared.host_token.lock().unwrap() = token;
        *self.shared.rooms_json.lock().unwrap() = "[]".to_string();
        self.shared.rooms_count.store(0, Ordering::Relaxed);
        self.shared.bound_port.store(port, Ordering::Relaxed);
        self.shared.running.store(true, Ordering::SeqCst);

        let shared = Arc::clone(&self.shared);
        thread::Builder::new()
            .name("jinshan-lan-accept".into())
            .spawn(move || accept_loop(listener, shared))?;

        Ok(port)
    }

    pub fn stop(&self) {
        let _guard = self.lifecycle_lock.lock().unwrap();
        self.shared.running.store(false, Ordering::SeqCst);
        self.shared.bound_port.store(0, Ordering::Relaxed);
        self.shared.rooms_count.store(0, Ordering::Relaxed);
        if let Ok(mut t) = self.shared.host_token.lock() {
            t.clear();
        }
        if let Ok(mut r) = self.shared.rooms_json.lock() {
            *r = "[]".to_string();
        }

        if let Ok(mut hc_guard) = self.shared.host_conn.lock() {
            if let Some(hc) = hc_guard.take() {
                hc.close_quietly(1001, "Host stopped");
            }
        }

        if let Ok(mut guests) = self.shared.guest_conns.lock() {
            for (_, conn) in guests.drain() {
                conn.close_quietly(1001, "Host stopped");
            }
        }
    }

    pub fn is_running(&self) -> bool {
        self.shared.running.load(Ordering::SeqCst) && self.shared.bound_port.load(Ordering::Relaxed) > 0
    }

    pub fn port(&self) -> u16 {
        self.shared.bound_port.load(Ordering::Relaxed)
    }

    pub fn host_token(&self) -> String {
        self.shared
            .host_token
            .lock()
            .map(|t| t.clone())
            .unwrap_or_default()
    }

    pub fn guest_count(&self) -> usize {
        self.shared
            .guest_conns
            .lock()
            .map(|g| g.len())
            .unwrap_or(0)
    }
}

fn bind_port_with_fallback(preferred_port: u16) -> io::Result<TcpListener> {
    let end = preferred_port.saturating_add(20);
    for port in preferred_port..end {
        if let Ok(listener) = bind_reuse_tcp(port) {
            return Ok(listener);
        }
    }
    bind_reuse_tcp(0)
}

fn bind_reuse_tcp(port: u16) -> io::Result<TcpListener> {
    let sock = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
    sock.set_reuse_address(true)?;
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port));
    sock.bind(&addr.into())?;
    sock.listen(64)?;
    Ok(sock.into())
}

fn generate_token_hex() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    let mut out = String::with_capacity(32);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn accept_loop(listener: TcpListener, shared: Arc<SharedServer>) {
    while shared.running.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _peer)) => {
                let shared_conn = Arc::clone(&shared);
                let _ = thread::Builder::new()
                    .name("jinshan-lan-io".into())
                    .spawn(move || handle_client(stream, shared_conn));
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => {
                if !shared.running.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    query_params: HashMap<String, String>,
    headers: HashMap<String, String>,
}

fn handle_client(mut stream: TcpStream, shared: Arc<SharedServer>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));

    let Ok(read_clone) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::with_capacity(8192, read_clone);

    let Ok(Some(req)) = read_http_request(&mut reader) else {
        return;
    };

    if req.method.eq_ignore_ascii_case("OPTIONS") {
        let _ = write_cors_no_content(&mut stream);
        return;
    }

    let upgrade = req.headers.get("upgrade").map(String::as_str);
    let ws_key = req.headers.get("sec-websocket-key").map(String::as_str);

    if let (Some(upg), Some(key)) = (upgrade, ws_key) {
        if upg.eq_ignore_ascii_case("websocket") {
            if req.path == "/host" {
                handle_host_ws(stream, reader, &req, key, shared);
                return;
            }
            if req.path == "/ws" {
                handle_guest_ws(stream, reader, key, shared);
                return;
            }
            let _ = write_http_text(
                &mut stream,
                404,
                "Not Found",
                "application/json; charset=utf-8",
                r#"{"error":"Not Found"}"#,
            );
            return;
        }
    }

    let is_head = req.method.eq_ignore_ascii_case("HEAD");
    if !req.method.eq_ignore_ascii_case("GET") && !is_head {
        let _ = write_http_text(
            &mut stream,
            405,
            "Method Not Allowed",
            "application/json; charset=utf-8",
            r#"{"error":"Method Not Allowed"}"#,
        );
        return;
    }

    let _ = handle_http_get(&req, &mut stream, is_head, &shared);
}

fn is_loopback_peer(stream: &TcpStream) -> bool {
    stream
        .peer_addr()
        .map(|addr| match addr.ip() {
            IpAddr::V4(v4) => v4.is_loopback(),
            IpAddr::V6(v6) => v6.is_loopback(),
        })
        .unwrap_or(false)
}

fn handle_host_ws(
    mut stream: TcpStream,
    mut reader: BufReader<TcpStream>,
    req: &HttpRequest,
    ws_key: &str,
    shared: Arc<SharedServer>,
) {
    let expected_token = shared
        .host_token
        .lock()
        .map(|t| t.clone())
        .unwrap_or_default();
    let supplied_token = req.query_params.get("token").map(String::as_str).unwrap_or("");
    if !is_loopback_peer(&stream) || expected_token.is_empty() || expected_token != supplied_token {
        let _ = write_http_text(
            &mut stream,
            403,
            "Forbidden",
            "application/json; charset=utf-8",
            r#"{"error":"Forbidden"}"#,
        );
        return;
    }

    if send_ws_handshake(&mut stream, ws_key).is_err() {
        return;
    }
    let _ = reader.get_ref().set_read_timeout(None);

    let conn = Arc::new(WsConn::new(stream));
    {
        let mut hc_guard = shared.host_conn.lock().unwrap();
        let prev = hc_guard.replace(Arc::clone(&conn));
        drop(hc_guard);
        if let Some(old) = prev {
            old.close_quietly(1000, "Replaced by new host bridge");
        }
    }

    // Notify the freshly attached host bridge about any already-open guests
    let existing_peers: Vec<String> = shared
        .guest_conns
        .lock()
        .map(|g| g.keys().cloned().collect())
        .unwrap_or_default();
    for peer_id in existing_peers {
        send_host_bridge_event(&shared, "PEER_OPEN", &peer_id, None);
    }

    while shared.running.load(Ordering::SeqCst) && conn.is_open() {
        match read_ws_text_frame(&mut reader, &conn) {
            Ok(Some(frame)) => handle_host_control_frame(&shared, &frame),
            _ => break,
        }
    }

    {
        let mut hc_guard = shared.host_conn.lock().unwrap();
        if hc_guard.as_ref().is_some_and(|cur| Arc::ptr_eq(cur, &conn)) {
            *hc_guard = None;
        }
    }
    conn.close_quietly(1000, "Host bridge closed");
}

fn handle_host_control_frame(shared: &SharedServer, raw: &str) {
    let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    let msg_type = obj.get("type").and_then(Value::as_str).unwrap_or("");
    match msg_type {
        "SEND" => {
            let peer_id = obj.get("peerId").and_then(Value::as_str).unwrap_or("");
            let payload = obj.get("payload").and_then(Value::as_str).unwrap_or("");
            let guest = shared
                .guest_conns
                .lock()
                .ok()
                .and_then(|g| g.get(peer_id).cloned());
            if let Some(conn) = guest {
                conn.send_text(payload);
            }
        }
        "CLOSE" => {
            let peer_id = obj.get("peerId").and_then(Value::as_str).unwrap_or("");
            let code = obj.get("code").and_then(Value::as_u64).unwrap_or(1000) as u16;
            let reason = obj.get("reason").and_then(Value::as_str).unwrap_or("");
            let guest = shared
                .guest_conns
                .lock()
                .ok()
                .and_then(|mut g| g.remove(peer_id));
            if let Some(conn) = guest {
                conn.close_quietly(code, reason);
            }
        }
        "ROOMS_SNAPSHOT" => {
            if let Some(rooms @ Value::Array(arr)) = obj.get("rooms") {
                let serialized = rooms.to_string();
                if let Ok(mut guard) = shared.rooms_json.lock() {
                    *guard = serialized.clone();
                }
                shared.rooms_count.store(arr.len(), Ordering::Relaxed);
                if let Some(cb) = &shared.on_rooms_snapshot {
                    cb(&serialized);
                }
            }
        }
        _ => {}
    }
}

fn handle_guest_ws(
    mut stream: TcpStream,
    mut reader: BufReader<TcpStream>,
    ws_key: &str,
    shared: Arc<SharedServer>,
) {
    if send_ws_handshake(&mut stream, ws_key).is_err() {
        return;
    }
    let _ = reader.get_ref().set_read_timeout(None);

    let seq = shared.next_peer_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let peer_id = format!("g{seq}");
    let conn = Arc::new(WsConn::new(stream));

    if let Ok(mut guests) = shared.guest_conns.lock() {
        guests.insert(peer_id.clone(), Arc::clone(&conn));
    }
    send_host_bridge_event(&shared, "PEER_OPEN", &peer_id, None);

    while shared.running.load(Ordering::SeqCst) && conn.is_open() {
        match read_ws_text_frame(&mut reader, &conn) {
            Ok(Some(frame)) => send_host_bridge_event(&shared, "PEER_MSG", &peer_id, Some(&frame)),
            _ => break,
        }
    }

    if let Ok(mut guests) = shared.guest_conns.lock() {
        if guests.get(&peer_id).is_some_and(|cur| Arc::ptr_eq(cur, &conn)) {
            guests.remove(&peer_id);
        }
    }
    conn.close_quietly(1000, "Guest disconnected");
    send_host_bridge_event(&shared, "PEER_CLOSE", &peer_id, None);
}

fn send_host_bridge_event(
    shared: &SharedServer,
    event_type: &str,
    peer_id: &str,
    payload: Option<&str>,
) {
    let hc = shared.host_conn.lock().ok().and_then(|g| g.clone());
    let Some(conn) = hc else {
        return;
    };
    if !conn.is_open() {
        return;
    }
    let mut obj = serde_json::Map::new();
    obj.insert("type".to_string(), Value::String(event_type.to_string()));
    obj.insert("peerId".to_string(), Value::String(peer_id.to_string()));
    if let Some(p) = payload {
        obj.insert("payload".to_string(), Value::String(p.to_string()));
    }
    conn.send_text(&Value::Object(obj).to_string());
}

fn handle_http_get(
    req: &HttpRequest,
    stream: &mut TcpStream,
    head_only: bool,
    shared: &SharedServer,
) -> io::Result<()> {
    let path = req.path.as_str();
    if path == "/api/health" || path == "/health" {
        let port = shared.bound_port.load(Ordering::Relaxed);
        let rooms = shared.rooms_count.load(Ordering::Relaxed);
        let json = format!(r#"{{"ok":true,"lanHost":true,"port":{port},"rooms":{rooms}}}"#);
        return write_http_bytes(
            stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            json.as_bytes(),
            head_only,
        );
    }
    if path == "/api/rooms" {
        let rooms_json = shared
            .rooms_json
            .lock()
            .map(|r| r.clone())
            .unwrap_or_else(|_| "[]".to_string());
        let json = format!(r#"{{"rooms":{rooms_json}}}"#);
        return write_http_bytes(
            stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            json.as_bytes(),
            head_only,
        );
    }
    if path == "/api/history" {
        return write_http_bytes(
            stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            br#"{"matches":[]}"#,
            head_only,
        );
    }
    if path == "/api/leaderboard" {
        return write_http_bytes(
            stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            br#"{"users":[]}"#,
            head_only,
        );
    }
    if path.starts_with("/api/") {
        return write_http_bytes(
            stream,
            404,
            "Not Found",
            "application/json; charset=utf-8",
            br#"{"error":"Not Found"}"#,
            head_only,
        );
    }

    let rel_path = if path.is_empty() || path == "/" {
        "index.html"
    } else {
        path.strip_prefix('/').unwrap_or(path)
    };

    if rel_path.contains("..") || rel_path.contains('\\') {
        return write_http_text(
            stream,
            403,
            "Forbidden",
            "text/plain; charset=utf-8",
            "Forbidden",
        );
    }

    let mut resolved_path = rel_path;
    let mut data = (shared.asset_loader)(rel_path);
    if data.is_none() && !rel_path.contains('.') {
        data = (shared.asset_loader)("index.html");
        resolved_path = "index.html";
    }

    let Some(bytes) = data else {
        return write_http_text(
            stream,
            404,
            "Not Found",
            "text/plain; charset=utf-8",
            "Not Found",
        );
    };

    write_http_bytes(
        stream,
        200,
        "OK",
        guess_mime_type(resolved_path),
        &bytes,
        head_only,
    )
}

fn read_http_request<R: Read>(reader: &mut R) -> io::Result<Option<HttpRequest>> {
    let mut header_buf = Vec::with_capacity(512);
    let mut state = 0u8;
    let mut byte = [0u8; 1];

    while header_buf.len() < MAX_HEADER_BYTES {
        let n = reader.read(&mut byte)?;
        if n == 0 {
            return Ok(None);
        }
        let b = byte[0];
        header_buf.push(b);
        state = match (state, b) {
            (0, b'\r') => 1,
            (1, b'\n') => 2,
            (2, b'\r') => 3,
            (3, b'\n') => {
                state = 4;
                break;
            }
            (_, b'\r') => 1,
            _ => 0,
        };
    }

    if state != 4 {
        return Ok(None);
    }

    let header_str = String::from_utf8_lossy(&header_buf);
    let mut lines = header_str.split("\r\n");
    let Some(request_line) = lines.next() else {
        return Ok(None);
    };
    let mut parts = request_line.split_whitespace();
    let Some(method) = parts.next() else {
        return Ok(None);
    };
    let Some(target) = parts.next() else {
        return Ok(None);
    };

    let (path, query_params) = match target.split_once('?') {
        Some((p, q)) => {
            let mut params = HashMap::new();
            for kv in q.split('&') {
                if kv.is_empty() {
                    continue;
                }
                if let Some((k, v)) = kv.split_once('=') {
                    params.insert(percent_decode(k), percent_decode(v));
                }
            }
            (p.to_string(), params)
        }
        None => (target.to_string(), HashMap::new()),
    };

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    Ok(Some(HttpRequest {
        method: method.to_string(),
        path,
        query_params,
        headers,
    }))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    out.push((hi << 4) | lo);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Minimal RFC 3174 SHA-1 used exclusively for RFC 6455 Sec-WebSocket-Accept handshake.
fn sha1_digest(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x6745_2301;
    let mut h1: u32 = 0xEFCD_AB89;
    let mut h2: u32 = 0x98BA_DCFE;
    let mut h3: u32 = 0x1032_5476;
    let mut h4: u32 = 0xC3D2_E1F0;

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.as_chunks::<64>().0 {
        let mut w = [0u32; 80];
        for (i, &word) in chunk.as_chunks::<4>().0.iter().enumerate() {
            w[i] = u32::from_be_bytes(word);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let (mut a, mut b, mut c, mut d, mut e) = (h0, h1, h2, h3, h4);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1u32),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDCu32),
                _ => (b ^ c ^ d, 0xCA62_C1D6u32),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

pub fn compute_ws_accept_key(client_key: &str) -> String {
    let combined = format!("{}{WS_MAGIC_GUID}", client_key.trim());
    let digest = sha1_digest(combined.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

fn send_ws_handshake(stream: &mut TcpStream, client_key: &str) -> io::Result<()> {
    let accept = compute_ws_accept_key(client_key);
    let resp = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(resp.as_bytes())?;
    stream.flush()
}

fn read_ws_text_frame<R: Read>(reader: &mut R, conn: &WsConn) -> io::Result<Option<String>> {
    let mut assembled: Option<Vec<u8>> = None;
    let mut data_opcode: u8 = 0;

    loop {
        let mut head = [0u8; 2];
        if reader.read_exact(&mut head).is_err() {
            return Ok(None);
        }

        let fin = (head[0] & 0x80) != 0;
        let opcode = head[0] & 0x0F;
        let masked = (head[1] & 0x80) != 0;
        let len_code = head[1] & 0x7F;

        let payload_len: usize = if len_code < 126 {
            len_code as usize
        } else if len_code == 126 {
            let mut ext = [0u8; 2];
            if reader.read_exact(&mut ext).is_err() {
                return Ok(None);
            }
            u16::from_be_bytes(ext) as usize
        } else {
            let mut ext = [0u8; 8];
            if reader.read_exact(&mut ext).is_err() {
                return Ok(None);
            }
            let len64 = u64::from_be_bytes(ext);
            if len64 > MAX_WS_PAYLOAD_BYTES as u64 {
                conn.close_quietly(1009, "Message too big");
                return Ok(None);
            }
            len64 as usize
        };

        if payload_len > MAX_WS_PAYLOAD_BYTES {
            conn.close_quietly(1009, "Message too big");
            return Ok(None);
        }

        let mut mask = [0u8; 4];
        if masked && reader.read_exact(&mut mask).is_err() {
            return Ok(None);
        }

        let mut payload = vec![0u8; payload_len];
        if payload_len > 0 && reader.read_exact(&mut payload).is_err() {
            return Ok(None);
        }

        if masked {
            for (i, b) in payload.iter_mut().enumerate() {
                *b ^= mask[i & 3];
            }
        }

        match opcode {
            0x8 => {
                conn.send_control(0x8, &[]);
                return Ok(None);
            }
            0x9 => {
                conn.send_control(0xA, &payload);
                continue;
            }
            0xA => continue,
            0x1 | 0x2 => {
                if fin && assembled.is_none() {
                    if opcode == 0x1 {
                        return Ok(Some(String::from_utf8_lossy(&payload).into_owned()));
                    }
                    continue;
                }
                data_opcode = opcode;
                assembled = Some(payload);
            }
            0x0 => {
                if let Some(buf) = assembled.as_mut() {
                    if buf.len() + payload.len() > MAX_WS_PAYLOAD_BYTES {
                        conn.close_quietly(1009, "Message too big");
                        return Ok(None);
                    }
                    buf.extend_from_slice(&payload);
                    if fin {
                        let full = assembled.take().unwrap_or_default();
                        if data_opcode == 0x1 {
                            return Ok(Some(String::from_utf8_lossy(&full).into_owned()));
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn write_cors_no_content(stream: &mut TcpStream) -> io::Result<()> {
    let resp = "HTTP/1.1 204 No Content\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
        Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
        Connection: close\r\n\r\n";
    stream.write_all(resp.as_bytes())?;
    stream.flush()
}

fn write_http_text(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &str,
) -> io::Result<()> {
    write_http_bytes(stream, status, reason, content_type, body.as_bytes(), false)
}

fn write_http_bytes(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) -> io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-cache\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    if !head_only {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn guess_mime_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".webmanifest") {
        "application/manifest+json; charset=utf-8"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn http_get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();
        resp
    }

    fn ws_connect(port: u16, path: &str) -> TcpStream {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let req = format!(
            "GET {path} HTTP/1.1\r\n\
             Host: 127.0.0.1\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = [0u8; 512];
        let mut got = Vec::new();
        loop {
            let n = s.read(&mut buf).unwrap();
            assert!(n > 0);
            got.extend_from_slice(&buf[..n]);
            if got.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        let header = String::from_utf8_lossy(&got);
        assert!(header.contains("101 Switching Protocols"), "unexpected: {header}");
        assert!(header.contains("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        s
    }

    fn ws_send_masked_text(s: &mut TcpStream, text: &str) {
        let data = text.as_bytes();
        let mask = [0x12u8, 0x34, 0x56, 0x78];
        let mut frame = Vec::with_capacity(14 + data.len());
        frame.push(0x81);
        if data.len() < 126 {
            frame.push(0x80 | (data.len() as u8));
        } else {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(data.len() as u16).to_be_bytes());
        }
        frame.extend_from_slice(&mask);
        for (i, &b) in data.iter().enumerate() {
            frame.push(b ^ mask[i & 3]);
        }
        s.write_all(&frame).unwrap();
        s.flush().unwrap();
    }

    fn ws_read_server_text(s: &mut TcpStream) -> String {
        let mut head = [0u8; 2];
        s.read_exact(&mut head).unwrap();
        assert_eq!(head[0] & 0x0F, 0x1);
        let len_code = head[1] & 0x7F;
        let len: usize = if len_code < 126 {
            len_code as usize
        } else {
            let mut ext = [0u8; 2];
            s.read_exact(&mut ext).unwrap();
            u16::from_be_bytes(ext) as usize
        };
        let mut payload = vec![0u8; len];
        s.read_exact(&mut payload).unwrap();
        String::from_utf8(payload).unwrap()
    }

    #[test]
    fn rfc6455_websocket_accept_matches_spec_vector() {
        // RFC 6455 Section 1.3 official test vector
        assert_eq!(
            compute_ws_accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn http_assets_api_and_ws_host_guest_relay_end_to_end() {
        let loader: AssetLoader = Arc::new(|path| match path {
            "index.html" => Some(b"<html>JinShan</html>".to_vec()),
            "app.js" => Some(b"console.log('ok');".to_vec()),
            _ => None,
        });
        let snapshot_seen = Arc::new(Mutex::new(String::new()));
        let snapshot_clone = Arc::clone(&snapshot_seen);

        let server = LanHostServer::new(
            loader,
            Some(Arc::new(move |rooms| {
                *snapshot_clone.lock().unwrap() = rooms.to_string();
            })),
        );
        let port = server.start(0).unwrap();
        let token = server.host_token();
        assert_eq!(token.len(), 32);

        // Static asset + SPA fallback + traversal guard + health
        let html = http_get(port, "/");
        assert!(html.contains("200 OK") && html.contains("<html>JinShan</html>"));
        let bad = http_get(port, "/../secret.txt");
        assert!(bad.contains("403 Forbidden"));
        let health = http_get(port, "/api/health");
        assert!(health.contains("\"lanHost\":true"));

        // Invalid token rejected on /host
        let forbidden = http_get(port, "/host?token=wrong");
        assert!(!forbidden.contains("101 Switching Protocols"));

        // Connect host bridge + guest WebSocket and verify bidirectional relay + ROOMS_SNAPSHOT
        let mut host = ws_connect(port, &format!("/host?token={token}"));
        let mut guest = ws_connect(port, "/ws");

        let open_ev: Value = serde_json::from_str(&ws_read_server_text(&mut host)).unwrap();
        assert_eq!(open_ev["type"], "PEER_OPEN");
        let peer_id = open_ev["peerId"].as_str().unwrap().to_string();

        ws_send_masked_text(&mut guest, r#"{"type":"PING","ts":123}"#);
        let msg_ev: Value = serde_json::from_str(&ws_read_server_text(&mut host)).unwrap();
        assert_eq!(msg_ev["type"], "PEER_MSG");
        assert_eq!(msg_ev["peerId"], peer_id);
        assert_eq!(msg_ev["payload"], r#"{"type":"PING","ts":123}"#);

        let send_cmd = serde_json::json!({
            "type": "SEND",
            "peerId": peer_id,
            "payload": r#"{"type":"PONG","ts":123}"#
        })
        .to_string();
        ws_send_masked_text(&mut host, &send_cmd);
        assert_eq!(ws_read_server_text(&mut guest), r#"{"type":"PONG","ts":123}"#);

        let snap_cmd = serde_json::json!({
            "type": "ROOMS_SNAPSHOT",
            "rooms": [{ "roomId": "888888", "mode": "hongxin", "status": "WAITING" }]
        })
        .to_string();
        ws_send_masked_text(&mut host, &snap_cmd);
        thread::sleep(Duration::from_millis(60));

        let rooms_resp = http_get(port, "/api/rooms");
        assert!(rooms_resp.contains("888888"));
        assert!(snapshot_seen.lock().unwrap().contains("888888"));
        assert_eq!(server.guest_count(), 1);

        server.stop();
        assert!(!server.is_running());
    }
}
