use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, Size, State, UserAttentionType, WebviewWindow,
    WindowEvent,
};
use tauri_plugin_window_state::StateFlags;

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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    pub platform: String,
    pub arch: String,
    pub version: String,
    pub app_name: String,
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
fn force_close_app(app: AppHandle, state: State<'_, MatchGuardState>) {
    state.in_active_match.store(false, Ordering::Relaxed);
    app.exit(0);
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

    tauri::Builder::default()
        .manage(MatchGuardState::default())
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
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let guard = window.state::<MatchGuardState>();
                if guard.in_active_match.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
                }
            }
        })
        .setup(|app| {
            setup_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
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
