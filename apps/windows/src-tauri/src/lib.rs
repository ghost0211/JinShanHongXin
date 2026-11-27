mod lan_discovery;
mod lan_server;
mod ota;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, Size, State, UserAttentionType, WebviewWindow,
    WindowEvent,
};
use tauri_plugin_window_state::StateFlags;

use crate::lan_discovery::{DiscoveredLanHost, LanDiscoveryManager};
use crate::lan_server::{AssetLoader, LanHostServer};
use crate::ota::{
    FetchTextResult, OtaActionResult, OtaAssets, OtaManager, OtaTaskStatus, OtaVersionInfo,
};

pub const DEFAULT_WINDOW_WIDTH: f64 = 1280.0;
pub const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;
pub const MIN_WINDOW_WIDTH: f64 = 960.0;
pub const MIN_WINDOW_HEIGHT: f64 = 600.0;
pub const APP_DISPLAY_NAME: &str = "金山打红心 · 打黑心";
pub const CLOSE_REQUESTED_EVENT: &str = "jinshan://close-requested";

pub struct MatchGuardState {
    pub in_active_match: AtomicBool,
}

impl Default for MatchGuardState {
    fn default() -> Self {
        Self {
            in_active_match: AtomicBool::new(false),
        }
    }
}

pub struct LanState {
    pub server: LanHostServer,
    pub discovery: Arc<LanDiscoveryManager>,
}

impl LanState {
    fn new(asset_loader: AssetLoader) -> Self {
        let discovery = Arc::new(LanDiscoveryManager::default());
        let disc_for_cb = Arc::clone(&discovery);
        let server = LanHostServer::new(
            asset_loader,
            Some(Arc::new(move |rooms_json| {
                disc_for_cb.update_rooms_snapshot(rooms_json);
            })),
        );
        Self { server, discovery }
    }

    pub fn shutdown(&self) {
        self.discovery.dispose();
        self.server.stop();
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    pub platform: String,
    pub arch: String,
    pub version: String,
    pub app_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanHostStartResult {
    pub ok: bool,
    pub port: u16,
    pub host_token: String,
    pub ips: Vec<String>,
    pub primary_ip: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanHostStatus {
    pub running: bool,
    pub port: u16,
    pub host_token: String,
    pub ips: Vec<String>,
    pub primary_ip: String,
    pub guest_count: usize,
}

pub fn build_desktop_info(version: &str) -> DesktopInfo {
    DesktopInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: version.to_string(),
        app_name: APP_DISPLAY_NAME.to_string(),
    }
}

fn restore_and_focus_main_window<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn make_tauri_asset_loader(app_handle: AppHandle) -> AssetLoader {
    let dev_dist_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../client/dist");
    Arc::new(move |rel_path: &str| {
        if let Some(asset) = app_handle.asset_resolver().get(rel_path.to_string()) {
            return Some(asset.bytes.to_vec());
        }
        // Dev fallback when `frontendDist` is served from Vite instead of embedded assets
        let disk_path = dev_dist_dir.join(rel_path);
        std::fs::read(disk_path).ok()
    })
}

#[tauri::command]
fn get_desktop_info(app: AppHandle) -> DesktopInfo {
    let version = app.package_info().version.to_string();
    build_desktop_info(&version)
}

#[tauri::command]
fn is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
fn reset_window_size(window: WebviewWindow) -> Result<(), String> {
    if window.is_fullscreen().unwrap_or(false) {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
    }
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())?;
    }
    window
        .set_size(Size::Logical(LogicalSize::new(
            DEFAULT_WINDOW_WIDTH,
            DEFAULT_WINDOW_HEIGHT,
        )))
        .map_err(|e| e.to_string())?;
    window.center().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn request_user_attention(window: WebviewWindow, urgent: bool) -> Result<bool, String> {
    if window.is_focused().unwrap_or(false) {
        return Ok(false);
    }
    let kind = if urgent {
        UserAttentionType::Critical
    } else {
        UserAttentionType::Informational
    };
    window
        .request_user_attention(Some(kind))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn clear_user_attention(window: WebviewWindow) -> Result<(), String> {
    window
        .request_user_attention(None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_active_match_guard(state: State<'_, MatchGuardState>, active: bool) {
    state.in_active_match.store(active, Ordering::Relaxed);
}

#[tauri::command]
fn force_close_app(
    app: AppHandle,
    state: State<'_, MatchGuardState>,
    lan: State<'_, LanState>,
) {
    state.in_active_match.store(false, Ordering::Relaxed);
    lan.shutdown();
    app.exit(0);
}

#[tauri::command]
fn lan_get_local_ips(lan: State<'_, LanState>) -> Vec<String> {
    lan.discovery.get_local_ipv4_addresses()
}

#[tauri::command]
fn lan_start_host(
    lan: State<'_, LanState>,
    preferred_port: u16,
    host_name: String,
) -> LanHostStartResult {
    match lan.server.start(preferred_port) {
        Ok(port) => {
            lan.discovery.start_broadcast(port, &host_name);
            let ips = lan.discovery.get_local_ipv4_addresses();
            let primary_ip = ips.first().cloned().unwrap_or_default();
            LanHostStartResult {
                ok: true,
                port,
                host_token: lan.server.host_token(),
                ips,
                primary_ip,
                error: None,
            }
        }
        Err(err) => LanHostStartResult {
            ok: false,
            port: 0,
            host_token: String::new(),
            ips: Vec::new(),
            primary_ip: String::new(),
            error: Some(format!("启动局域网服务失败：{err}")),
        },
    }
}

#[tauri::command]
fn lan_stop_host(lan: State<'_, LanState>) {
    lan.discovery.stop_broadcast();
    lan.server.stop();
}

#[tauri::command]
fn lan_get_host_status(lan: State<'_, LanState>) -> LanHostStatus {
    let ips = lan.discovery.get_local_ipv4_addresses();
    let primary_ip = ips.first().cloned().unwrap_or_default();
    LanHostStatus {
        running: lan.server.is_running(),
        port: lan.server.port(),
        host_token: lan.server.host_token(),
        ips,
        primary_ip,
        guest_count: lan.server.guest_count(),
    }
}

#[tauri::command]
fn lan_start_discovery(lan: State<'_, LanState>) -> bool {
    lan.discovery.start_discovery()
}

#[tauri::command]
fn lan_stop_discovery(lan: State<'_, LanState>) {
    lan.discovery.stop_discovery();
}

#[tauri::command]
fn lan_get_discovered_hosts(lan: State<'_, LanState>) -> Vec<DiscoveredLanHost> {
    lan.discovery.get_discovered_hosts()
}

#[tauri::command]
fn ota_get_version_info(ota: State<'_, OtaManager>) -> OtaVersionInfo {
    ota.version_info()
}

#[tauri::command]
fn ota_fetch_text_url(ota: State<'_, OtaManager>, url: String) -> FetchTextResult {
    ota.fetch_text_url(&url)
}

#[tauri::command]
fn ota_start_install(
    ota: State<'_, OtaManager>,
    version: String,
    download_url: String,
    expected_sha256: String,
) -> OtaActionResult {
    ota.start_install(&version, &download_url, &expected_sha256)
}

#[tauri::command]
fn ota_get_task_status(ota: State<'_, OtaManager>) -> OtaTaskStatus {
    ota.task_status()
}

#[tauri::command]
fn ota_confirm_boot_ready(ota: State<'_, OtaManager>) {
    ota.confirm_boot_ready();
}

#[tauri::command]
fn ota_clear_bundle(ota: State<'_, OtaManager>) -> bool {
    ota.clear_ota()
}

#[tauri::command]
fn ota_open_external_url(url: String) -> bool {
    ota::open_external_url(&url)
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let fullscreen_item =
        MenuItem::with_id(app, "fullscreen", "切换全屏 (F11)", true, None::<&str>)?;
    let reset_item =
        MenuItem::with_id(app, "reset_size", "重置窗口大小 (1280×800)", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出金山打红心", true, None::<&str>)?;

    let tray_menu = Menu::with_items(
        app,
        &[
            &show_item,
            &fullscreen_item,
            &reset_item,
            &separator,
            &quit_item,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&tray_menu)
        .tooltip(APP_DISPLAY_NAME)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_and_focus_main_window(app),
            "fullscreen" => {
                if let Some(window) = app.get_webview_window("main") {
                    let next = !window.is_fullscreen().unwrap_or(false);
                    let _ = window.set_fullscreen(next);
                }
            }
            "reset_size" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = reset_window_size(window);
                }
            }
            "quit" => {
                if let Some(guard) = app.try_state::<MatchGuardState>() {
                    guard.in_active_match.store(false, Ordering::Relaxed);
                }
                if let Some(lan) = app.try_state::<LanState>() {
                    lan.shutdown();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_and_focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    if let Err(err) = tray_builder.build(app) {
        eprintln!("[jinshan-windows] system tray unavailable, continuing without tray: {err}");
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_state_flags =
        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::DECORATIONS;

    let mut context = tauri::generate_context!();
    let native_version = context.package_info().version.to_string();
    let ota_manager = OtaManager::new(&native_version);
    let (ota_assets, fallback_slot) = OtaAssets::new(ota_manager.active_dir_handle());
    let prev_assets = context.set_assets(Box::new(ota_assets));
    let _ = fallback_slot.set(prev_assets);

    tauri::Builder::default()
        .manage(MatchGuardState::default())
        .manage(ota_manager)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_and_focus_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_desktop_info,
            is_fullscreen,
            toggle_fullscreen,
            reset_window_size,
            request_user_attention,
            clear_user_attention,
            set_active_match_guard,
            force_close_app,
            lan_get_local_ips,
            lan_start_host,
            lan_stop_host,
            lan_get_host_status,
            lan_start_discovery,
            lan_stop_discovery,
            lan_get_discovered_hosts,
            ota_get_version_info,
            ota_fetch_text_url,
            ota_start_install,
            ota_get_task_status,
            ota_confirm_boot_ready,
            ota_clear_bundle,
            ota_open_external_url,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let guard = window.state::<MatchGuardState>();
                    if guard.in_active_match.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
                    } else if let Some(lan) = window.try_state::<LanState>() {
                        lan.shutdown();
                    }
                }
                WindowEvent::Destroyed => {
                    if let Some(lan) = window.try_state::<LanState>() {
                        lan.shutdown();
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            let asset_loader = make_tauri_asset_loader(app.handle().clone());
            app.manage(LanState::new(asset_loader));
            setup_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(context)
        .expect("error while running 金山打红心 desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_info_uses_runtime_platform_and_version() {
        let info = build_desktop_info("0.1.0");
        assert_eq!(info.version, "0.1.0");
        assert_eq!(info.app_name, APP_DISPLAY_NAME);
        assert_eq!(info.platform, std::env::consts::OS);
        assert_eq!(info.arch, std::env::consts::ARCH);
    }

    #[test]
    fn default_window_bounds_exceed_minimum_bounds() {
        const {
            assert!(DEFAULT_WINDOW_WIDTH >= MIN_WINDOW_WIDTH);
            assert!(DEFAULT_WINDOW_HEIGHT >= MIN_WINDOW_HEIGHT);
            assert!(DEFAULT_WINDOW_WIDTH > DEFAULT_WINDOW_HEIGHT);
        }
    }

    #[test]
    fn match_guard_defaults_to_inactive() {
        let state = MatchGuardState::default();
        assert!(!state.in_active_match.load(Ordering::Relaxed));
        state.in_active_match.store(true, Ordering::Relaxed);
        assert!(state.in_active_match.load(Ordering::Relaxed));
    }
}
