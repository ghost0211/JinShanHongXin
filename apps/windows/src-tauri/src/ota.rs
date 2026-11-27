use std::borrow::Cow;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedOtaState {
    active_version: String,
    active_dir: String,
    pending_verification: bool,
    native_version: String,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaVersionInfo {
    pub platform: String,
    pub native_version: String,
    pub ota_version: Option<String>,
    pub ota_active: bool,
    pub supports_ota: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaTaskStatus {
    pub state: String,
    pub version: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress: u8,
    pub error: String,
}

impl Default for OtaTaskStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            version: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            progress: 0,
            error: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchTextResult {
    pub ok: bool,
    pub status: u16,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaActionResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct OtaInner {
    ota_root: PathBuf,
    bundles_dir: PathBuf,
    staging_dir: PathBuf,
    state_file: PathBuf,
    native_version: String,
    active_dir: Arc<RwLock<Option<PathBuf>>>,
    active_version: Mutex<Option<String>>,
    pending_verification: Mutex<bool>,
    task: Mutex<OtaTaskStatus>,
}

#[derive(Clone)]
pub struct OtaManager {
    inner: Arc<OtaInner>,
}

pub struct OtaAssets<R: Runtime> {
    active_dir: Arc<RwLock<Option<PathBuf>>>,
    fallback: Arc<OnceLock<Box<dyn Assets<R>>>>,
}

impl<R: Runtime> OtaAssets<R> {
    pub fn new(active_dir: Arc<RwLock<Option<PathBuf>>>) -> (Self, Arc<OnceLock<Box<dyn Assets<R>>>>) {
        let fallback = Arc::new(OnceLock::new());
        let assets = Self {
            active_dir,
            fallback: Arc::clone(&fallback),
        };
        (assets, fallback)
    }
}

impl<R: Runtime> Assets<R> for OtaAssets<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Ok(guard) = self.active_dir.read() {
            if let Some(dir) = guard.as_ref() {
                if let Some(rel) = sanitize_rel_path(key.as_ref()) {
                    let candidate = dir.join(rel);
                    if let (Ok(base_canon), Ok(file_canon)) =
                        (dir.canonicalize(), candidate.canonicalize())
                    {
                        if file_canon.starts_with(&base_canon) && file_canon.is_file() {
                            if let Ok(bytes) = fs::read(&file_canon) {
                                return Some(Cow::Owned(bytes));
                            }
                        }
                    }
                }
            }
        }
        self.fallback.get().and_then(|fb| fb.get(key))
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        if let Some(fb) = self.fallback.get() {
            fb.iter()
        } else {
            Box::new(std::iter::empty())
        }
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        if let Some(fb) = self.fallback.get() {
            fb.csp_hashes(html_path)
        } else {
            Box::new(std::iter::empty())
        }
    }
}

impl OtaManager {
    pub fn new(native_version: &str) -> Self {
        let ota_root = resolve_ota_root();
        let bundles_dir = ota_root.join("bundles");
        let staging_dir = ota_root.join("staging");
        let state_file = ota_root.join("state.json");
        let manager = Self {
            inner: Arc::new(OtaInner {
                ota_root,
                bundles_dir,
                staging_dir,
                state_file,
                native_version: strip_leading_v(native_version).to_string(),
                active_dir: Arc::new(RwLock::new(None)),
                active_version: Mutex::new(None),
                pending_verification: Mutex::new(false),
                task: Mutex::new(OtaTaskStatus::default()),
            }),
        };
        manager.load_initial_state();
        manager
    }

    pub fn active_dir_handle(&self) -> Arc<RwLock<Option<PathBuf>>> {
        Arc::clone(&self.inner.active_dir)
    }

    fn load_initial_state(&self) {
        let Ok(raw) = fs::read_to_string(&self.inner.state_file) else {
            return;
        };
        let Ok(saved) = serde_json::from_str::<PersistedOtaState>(&raw) else {
            self.clear_ota_files();
            return;
        };
        let saved_ver = strip_leading_v(&saved.active_version).to_string();
        if saved_ver.is_empty() || saved.active_dir.is_empty() {
            self.clear_ota_files();
            return;
        }
        // Native installer upgrade supersedes older or equal OTA bundle
        if compare_semver(&saved_ver, &self.inner.native_version) <= 0 {
            self.clear_ota_files();
            return;
        }
        // Anti-brick rollback: previous cold boot never confirmed ready
        if saved.pending_verification {
            self.clear_ota_files();
            return;
        }

        let dir = self.inner.bundles_dir.join(&saved.active_dir);
        let index_html = dir.join("index.html");
        if !dir.is_dir() || !index_html.is_file() {
            self.clear_ota_files();
            return;
        }

        if let Ok(mut guard) = self.inner.active_dir.write() {
            *guard = Some(dir);
        }
        if let Ok(mut ver) = self.inner.active_version.lock() {
            *ver = Some(saved_ver.clone());
        }
        if let Ok(mut pending) = self.inner.pending_verification.lock() {
            *pending = true;
        }
        let _ = self.persist_state(&saved_ver, &saved.active_dir, true);
    }

    pub fn version_info(&self) -> OtaVersionInfo {
        let ota_version = self
            .inner
            .active_version
            .lock()
            .ok()
            .and_then(|v| v.clone());
        OtaVersionInfo {
            platform: std::env::consts::OS.to_string(),
            native_version: self.inner.native_version.clone(),
            ota_active: ota_version.is_some(),
            ota_version,
            supports_ota: true,
        }
    }

    pub fn task_status(&self) -> OtaTaskStatus {
        self.inner
            .task
            .lock()
            .map(|t| t.clone())
            .unwrap_or_default()
    }

    pub fn confirm_boot_ready(&self) {
        let should_persist = {
            let Ok(mut pending) = self.inner.pending_verification.lock() else {
                return;
            };
            if *pending {
                *pending = false;
                true
            } else {
                false
            }
        };
        if !should_persist {
            return;
        }
        let active_ver = self
            .inner
            .active_version
            .lock()
            .ok()
            .and_then(|v| v.clone());
        let dir_name = self
            .inner
            .active_dir
            .read()
            .ok()
            .and_then(|d| d.as_ref().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())));
        if let (Some(ver), Some(dir)) = (active_ver, dir_name) {
            let _ = self.persist_state(&ver, &dir, false);
        }
    }

    pub fn clear_ota(&self) -> bool {
        self.clear_ota_files();
        if let Ok(mut task) = self.inner.task.lock() {
            *task = OtaTaskStatus::default();
        }
        true
    }

    fn clear_ota_files(&self) {
        if let Ok(mut guard) = self.inner.active_dir.write() {
            *guard = None;
        }
        if let Ok(mut ver) = self.inner.active_version.lock() {
            *ver = None;
        }
        if let Ok(mut pending) = self.inner.pending_verification.lock() {
            *pending = false;
        }
        let _ = fs::remove_file(&self.inner.state_file);
        let _ = fs::remove_dir_all(&self.inner.bundles_dir);
        let _ = fs::remove_dir_all(&self.inner.staging_dir);
    }

    pub fn fetch_text_url(&self, url: &str) -> FetchTextResult {
        if !is_valid_http_url(url) {
            return FetchTextResult {
                ok: false,
                status: 0,
                body: String::new(),
                error: Some("不支持的请求地址".to_string()),
            };
        }
        let ua = format!("JinShanHongXin-Desktop/{}", self.inner.native_version);
        let output = hidden_command(curl_program())
            .args([
                "-fsSL",
                "--max-time",
                "15",
                "--connect-timeout",
                "10",
                "--user-agent",
                &ua,
                "--",
                url.trim(),
            ])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                if out.stdout.len() > MAX_TEXT_BYTES {
                    return FetchTextResult {
                        ok: false,
                        status: 0,
                        body: String::new(),
                        error: Some("响应内容超过大小限制".to_string()),
                    };
                }
                match String::from_utf8(out.stdout) {
                    Ok(body) => FetchTextResult {
                        ok: true,
                        status: 200,
                        body,
                        error: None,
                    },
                    Err(_) => FetchTextResult {
                        ok: false,
                        status: 0,
                        body: String::new(),
                        error: Some("响应编码不是有效的 UTF-8".to_string()),
                    },
                }
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                FetchTextResult {
                    ok: false,
                    status: 0,
                    body: String::new(),
                    error: Some(if stderr.is_empty() {
                        "请求更新清单失败".to_string()
                    } else {
                        stderr
                    }),
                }
            }
            Err(err) => FetchTextResult {
                ok: false,
                status: 0,
                body: String::new(),
                error: Some(format!("无法调用系统网络工具：{err}")),
            },
        }
    }

    pub fn start_install(
        &self,
        raw_version: &str,
        download_url: &str,
        expected_sha256: &str,
    ) -> OtaActionResult {
        let version = strip_leading_v(raw_version).to_string();
        let url = download_url.trim().to_string();
        let expected = expected_sha256.trim().to_ascii_lowercase();

        if version.is_empty() || !is_valid_http_url(&url) {
            return OtaActionResult {
                ok: false,
                error: Some("热更新参数无效".to_string()),
            };
        }

        {
            let Ok(mut task) = self.inner.task.lock() else {
                return OtaActionResult {
                    ok: false,
                    error: Some("更新状态锁异常".to_string()),
                };
            };
            if matches!(
                task.state.as_str(),
                "downloading" | "verifying" | "extracting"
            ) {
                return OtaActionResult {
                    ok: false,
                    error: Some("已有热更新任务正在进行中".to_string()),
                };
            }
            *task = OtaTaskStatus {
                state: "downloading".to_string(),
                version: version.clone(),
                downloaded_bytes: 0,
                total_bytes: 0,
                progress: 12,
                error: String::new(),
            };
        }

        let manager = self.clone();
        thread::spawn(move || {
            if let Err(msg) = manager.run_install_worker(&version, &url, &expected) {
                if let Ok(mut task) = manager.inner.task.lock() {
                    task.state = "error".to_string();
                    task.error = msg;
                }
            }
        });

        OtaActionResult {
            ok: true,
            error: None,
        }
    }

    fn run_install_worker(
        &self,
        version: &str,
        download_url: &str,
        expected_sha256: &str,
    ) -> Result<(), String> {
        fs::create_dir_all(&self.inner.ota_root)
            .map_err(|e| format!("无法创建热更新目录：{e}"))?;
        let tmp_zip = self.inner.ota_root.join("tmp-bundle.zip");
        let _ = fs::remove_file(&tmp_zip);

        let ua = format!("JinShanHongXin-Desktop/{}", self.inner.native_version);
        let dl_out = hidden_command(curl_program())
            .args([
                "-fsSL",
                "--max-time",
                "60",
                "--connect-timeout",
                "10",
                "--user-agent",
                &ua,
                "-o",
            ])
            .arg(&tmp_zip)
            .arg("--")
            .arg(download_url)
            .output()
            .map_err(|e| format!("启动下载失败：{e}"))?;

        if !dl_out.status.success() {
            let _ = fs::remove_file(&tmp_zip);
            let stderr = String::from_utf8_lossy(&dl_out.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "下载热更新包失败，请检查网络或切换加速镜像".to_string()
            } else {
                format!("下载失败：{stderr}")
            });
        }

        let meta = fs::metadata(&tmp_zip).map_err(|e| format!("读取下载文件失败：{e}"))?;
        if meta.len() == 0 || meta.len() > MAX_BUNDLE_BYTES {
            let _ = fs::remove_file(&tmp_zip);
            return Err("热更新包体积异常，已取消安装".to_string());
        }

        if let Ok(mut task) = self.inner.task.lock() {
            task.state = "verifying".to_string();
            task.downloaded_bytes = meta.len();
            task.total_bytes = meta.len();
            task.progress = 75;
        }

        let zip_bytes = fs::read(&tmp_zip).map_err(|e| format!("读取热更新包失败：{e}"))?;
        let actual_hash = sha256_hex(&zip_bytes);
        if !expected_sha256.is_empty() && actual_hash != expected_sha256 {
            let _ = fs::remove_file(&tmp_zip);
            return Err("热更新包 SHA-256 校验不通过，请重试".to_string());
        }

        if let Ok(mut task) = self.inner.task.lock() {
            task.state = "extracting".to_string();
            task.progress = 88;
        }

        let safe_dir_name = format!(
            "v{}",
            version
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                })
                .collect::<String>()
        );
        let stage_dir = self.inner.staging_dir.join(&safe_dir_name);
        let _ = fs::remove_dir_all(&stage_dir);
        fs::create_dir_all(&stage_dir).map_err(|e| format!("创建临时解压目录失败：{e}"))?;

        let extract_out = hidden_command(tar_program())
            .arg("-xf")
            .arg(&tmp_zip)
            .arg("-C")
            .arg(&stage_dir)
            .output()
            .map_err(|e| format!("启动解压工具失败：{e}"))?;
        let _ = fs::remove_file(&tmp_zip);

        if !extract_out.status.success() {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err("解压热更新包失败，文件可能已损坏".to_string());
        }

        validate_extracted_tree(&stage_dir)?;
        let index_html = stage_dir.join("index.html");
        if !index_html.is_file() || fs::metadata(&index_html).map(|m| m.len()).unwrap_or(0) == 0 {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err("热更新包缺少有效的 index.html".to_string());
        }

        fs::create_dir_all(&self.inner.bundles_dir)
            .map_err(|e| format!("创建版本目录失败：{e}"))?;
        let final_dir = self.inner.bundles_dir.join(&safe_dir_name);
        let _ = fs::remove_dir_all(&final_dir);
        fs::rename(&stage_dir, &final_dir).map_err(|e| {
            let _ = fs::remove_dir_all(&stage_dir);
            format!("提交热更新目录失败：{e}")
        })?;

        if let Ok(mut guard) = self.inner.active_dir.write() {
            *guard = Some(final_dir);
        }
        if let Ok(mut ver) = self.inner.active_version.lock() {
            *ver = Some(version.to_string());
        }
        if let Ok(mut pending) = self.inner.pending_verification.lock() {
            *pending = false;
        }
        self.persist_state(version, &safe_dir_name, false)?;
        self.prune_old_bundles(&safe_dir_name);

        if let Ok(mut task) = self.inner.task.lock() {
            task.state = "ready".to_string();
            task.progress = 100;
            task.error.clear();
        }
        Ok(())
    }

    fn persist_state(
        &self,
        version: &str,
        dir_name: &str,
        pending: bool,
    ) -> Result<(), String> {
        fs::create_dir_all(&self.inner.ota_root)
            .map_err(|e| format!("无法创建热更新目录：{e}"))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let state = PersistedOtaState {
            active_version: version.to_string(),
            active_dir: dir_name.to_string(),
            pending_verification: pending,
            native_version: self.inner.native_version.clone(),
            updated_at: now,
        };
        let raw = serde_json::to_string_pretty(&state)
            .map_err(|e| format!("序列化更新状态失败：{e}"))?;
        let tmp_path = self.inner.ota_root.join("state.json.tmp");
        fs::write(&tmp_path, raw.as_bytes()).map_err(|e| format!("写入更新状态失败：{e}"))?;
        if fs::rename(&tmp_path, &self.inner.state_file).is_err() {
            fs::write(&self.inner.state_file, raw.as_bytes())
                .map_err(|e| format!("保存更新状态失败：{e}"))?;
            let _ = fs::remove_file(&tmp_path);
        }
        Ok(())
    }

    fn prune_old_bundles(&self, keep_dir_name: &str) {
        let Ok(entries) = fs::read_dir(&self.inner.bundles_dir) else {
            return;
        };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy() != keep_dir_name {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

pub fn open_external_url(url: &str) -> bool {
    let trimmed = url.trim();
    if !is_valid_http_url(trimmed) {
        return false;
    }
    #[cfg(windows)]
    {
        hidden_command("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .is_ok()
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(trimmed).spawn().is_ok()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(trimmed).spawn().is_ok()
    }
}

fn curl_program() -> &'static str {
    #[cfg(windows)]
    {
        "curl.exe"
    }
    #[cfg(not(windows))]
    {
        "curl"
    }
}

fn tar_program() -> &'static str {
    #[cfg(windows)]
    {
        "tar.exe"
    }
    #[cfg(not(windows))]
    {
        "tar"
    }
}

fn hidden_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn resolve_ota_root() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.trim().is_empty() {
                return PathBuf::from(local).join("com.jinshan.hongxin").join("ota");
            }
        }
        if let Ok(roaming) = std::env::var("APPDATA") {
            if !roaming.trim().is_empty() {
                return PathBuf::from(roaming)
                    .join("com.jinshan.hongxin")
                    .join("ota");
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return PathBuf::from(xdg).join("com.jinshan.hongxin").join("ota");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.trim().is_empty() {
                return PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join("com.jinshan.hongxin")
                    .join("ota");
            }
        }
    }
    std::env::temp_dir().join("com.jinshan.hongxin-ota")
}

fn validate_extracted_tree(root: &Path) -> Result<(), String> {
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("无法校验解压目录：{e}"))?;
    let mut stack = vec![canon_root.clone()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("读取解压目录失败：{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取解压文件失败：{e}"))?;
            let path = entry.path();
            let meta = fs::symlink_metadata(&path)
                .map_err(|e| format!("校验文件类型失败：{e}"))?;
            if meta.file_type().is_symlink() {
                return Err("热更新包包含不允许的符号链接".to_string());
            }
            let canon = path
                .canonicalize()
                .map_err(|e| format!("校验文件路径失败：{e}"))?;
            if !canon.starts_with(&canon_root) {
                return Err("热更新包包含越界路径".to_string());
            }
            if meta.is_dir() {
                stack.push(canon);
            }
        }
    }
    Ok(())
}

pub fn sanitize_rel_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_start_matches('/');
    let normalized = if trimmed.is_empty() {
        "index.html"
    } else {
        trimmed
    };
    if normalized.contains('\\') || normalized.contains("..") {
        return None;
    }
    let mut out = PathBuf::new();
    for comp in Path::new(normalized).components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        out.push("index.html");
    }
    Some(out)
}

pub fn is_valid_http_url(url: &str) -> bool {
    let t = url.trim();
    (t.starts_with("https://") || t.starts_with("http://"))
        && !t.chars().any(|c| c.is_control() || c.is_whitespace())
}

fn strip_leading_v(s: &str) -> &str {
    let t = s.trim();
    t.strip_prefix('v')
        .or_else(|| t.strip_prefix('V'))
        .unwrap_or(t)
        .trim()
}

pub fn compare_semver(a: &str, b: &str) -> i32 {
    let pa = parse_semver_core(a);
    let pb = parse_semver_core(b);
    for i in 0..3 {
        if pa[i] != pb[i] {
            return if pa[i] > pb[i] { 1 } else { -1 };
        }
    }
    0
}

fn parse_semver_core(s: &str) -> [u32; 3] {
    let mut out = [0u32; 3];
    let clean = strip_leading_v(s);
    let core = clean.split('-').next().unwrap_or(clean);
    for (idx, part) in core.split('.').take(3).enumerate() {
        out[idx] = part.trim().parse::<u32>().unwrap_or(0);
    }
    out
}

/// Pure-Rust FIPS 180-4 SHA-256 hex digest (zero external crates).
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = Vec::with_capacity((data.len() + 9).div_ceil(64) * 64);
    padded.extend_from_slice(data);
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = String::with_capacity(64);
    for word in h {
        out.push_str(&format!("{word:08x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_nist_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn semver_comparison_handles_v_prefix_and_prerelease() {
        assert_eq!(compare_semver("v0.3.1", "0.3.0"), 1);
        assert_eq!(compare_semver("0.3.0", "v0.3.0"), 0);
        assert_eq!(compare_semver("0.2.9", "0.3.0"), -1);
        assert_eq!(compare_semver("1.0.0-beta.1", "0.9.9"), 1);
    }

    #[test]
    fn sanitize_rel_path_blocks_traversal() {
        assert_eq!(
            sanitize_rel_path("/assets/index.js"),
            Some(PathBuf::from("assets/index.js"))
        );
        assert_eq!(sanitize_rel_path("/"), Some(PathBuf::from("index.html")));
        assert_eq!(sanitize_rel_path("../secret.txt"), None);
        assert_eq!(sanitize_rel_path("a\\b"), None);
    }

    #[test]
    fn http_url_validation_rejects_non_http_and_spaces() {
        assert!(is_valid_http_url(
            "https://github.com/ghost0211/JinShanHongXin/releases/latest"
        ));
        assert!(!is_valid_http_url("file:///etc/passwd"));
        assert!(!is_valid_http_url("https://example.com/a b"));
    }
}
