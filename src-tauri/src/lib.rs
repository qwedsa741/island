mod commands;
mod database;
mod models;
mod storage;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "windows")]
mod floating_ball {
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };
    use tauri::WebviewWindow;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{CreateEllipticRgn, SetWindowRgn},
        UI::WindowsAndMessaging::{
            CallWindowProcW, EnumChildWindows, GetAncestor, GetClassNameW, GetCursorPos,
            GetWindowRect, SetWindowLongPtrW, SetWindowPos, GA_ROOT, GWLP_WNDPROC,
            SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, WM_LBUTTONDOWN, WM_LBUTTONUP,
            WM_MOUSEMOVE, WNDPROC,
        },
    };
    use windows::core::BOOL;

    static WEBVIEW_PREVIOUS_PROCS: OnceLock<Mutex<HashMap<isize, isize>>> = OnceLock::new();
    static DRAG_STATE: OnceLock<Mutex<Option<DragState>>> = OnceLock::new();

    struct DragState {
        root: isize,
        cursor: POINT,
        window_x: i32,
        window_y: i32,
    }

    unsafe extern "system" fn render_window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_LBUTTONDOWN {
            let root = GetAncestor(hwnd, GA_ROOT);
            let mut cursor = POINT::default();
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetCursorPos(&mut cursor);
            let _ = GetWindowRect(root, &mut rect);
            let state = DragState {
                root: root.0 as isize,
                cursor,
                window_x: rect.left,
                window_y: rect.top,
            };
            *DRAG_STATE.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(state);
            return LRESULT(0);
        }

        if message == WM_MOUSEMOVE {
            if let Some(state) = DRAG_STATE
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap()
                .as_ref()
            {
                let mut cursor = POINT::default();
                let _ = GetCursorPos(&mut cursor);
                let _ = SetWindowPos(
                    HWND(state.root as _),
                    None,
                    state.window_x + cursor.x - state.cursor.x,
                    state.window_y + cursor.y - state.cursor.y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
                return LRESULT(0);
            }
        }

        if message == WM_LBUTTONUP {
            *DRAG_STATE.get_or_init(|| Mutex::new(None)).lock().unwrap() = None;
            return LRESULT(0);
        }

        let previous = WEBVIEW_PREVIOUS_PROCS
            .get()
            .and_then(|procedures| procedures.lock().ok()?.get(&(hwnd.0 as isize)).copied())
            .unwrap_or_default();
        if previous != 0 {
            let procedure: WNDPROC = Some(std::mem::transmute(previous));
            return CallWindowProcW(procedure, hwnd, message, wparam, lparam);
        }
        LRESULT(0)
    }

    unsafe extern "system" fn find_webview_windows(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let mut class_name = [0u16; 64];
        let length = GetClassNameW(hwnd, &mut class_name);
        if length > 0 {
            let class_name = String::from_utf16_lossy(&class_name[..length as usize]);
            if class_name.starts_with("Chrome_") {
                (*(parameter.0 as *mut Vec<HWND>)).push(hwnd);
            }
        }
        BOOL(1)
    }

    pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
        let hwnd = window.hwnd()?;
        unsafe {
            // The platform imposes a larger minimum WebView window than the
            // floating control itself. A real native region removes the unused
            // rectangle from both rendering and hit-testing.
            let region = CreateEllipticRgn(4, 4, 60, 60);
            SetWindowRgn(hwnd, Some(region), true);

            let mut webview_windows = Vec::<HWND>::new();
            let _ = EnumChildWindows(
                Some(hwnd),
                Some(find_webview_windows),
                LPARAM((&mut webview_windows as *mut Vec<HWND>) as isize),
            );
            let procedures = WEBVIEW_PREVIOUS_PROCS.get_or_init(|| Mutex::new(HashMap::new()));
            for webview_window in webview_windows {
                let previous = SetWindowLongPtrW(
                    webview_window,
                    GWLP_WNDPROC,
                    render_window_proc as *const () as usize as isize,
                );
                if previous != 0 {
                    if let Ok(mut procedures) = procedures.lock() {
                        procedures.insert(webview_window.0 as isize, previous);
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        // Keep one authoritative process. Launching Island again must restore
        // the existing library window instead of leaving an invisible process
        // and a second floating island behind.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let toggle =
                        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyI);
                    if shortcut == &toggle && event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("island") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("IslandData");
            storage::ensure_data_layout(&data_dir)?;
            let pool = tauri::async_runtime::block_on(async {
                let pool = database::connect(&data_dir.join("database/island.db")).await?;
                database::integrity_check(&pool).await?;
                database::recover_interrupted_jobs(&pool).await?;
                anyhow::Ok(pool)
            })?;
            app.manage(commands::AppState {
                pool,
                data_dir,
                import_lock: tokio::sync::Mutex::new(()),
            });

            let open_library =
                MenuItem::with_id(app, "open-library", "打开资料库", true, None::<&str>)?;
            let toggle_island = MenuItem::with_id(
                app,
                "toggle-island",
                "显示 / 隐藏悬浮岛",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "退出 Island", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_library, &toggle_island, &quit])?;
            TrayIconBuilder::new()
                .tooltip("Island")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open-library" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toggle-island" => {
                        if let Some(window) = app.get_webview_window("island") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyI);
            app.global_shortcut().register(shortcut)?;

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("island") {
                floating_ball::install(&window)?;
            }

            // The floating island is intentionally always-on-top, but it must not
            // become the only visible surface at launch. Explicitly surface the
            // library here because some Windows/WebView2 startup paths can leave
            // the configured `visible: true` main window behind the island.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_files,
            commands::capture_url,
            commands::capture_webpage,
            commands::capture_text,
            commands::list_items,
            commands::search_items,
            commands::get_item,
            commands::list_spaces,
            commands::create_space,
            commands::update_space_membership,
            commands::list_item_spaces,
            commands::list_item_tags,
            commands::set_item_tags,
            commands::list_smart_views,
            commands::create_smart_view,
            commands::update_item,
            commands::trash_items,
            commands::restore_items,
            commands::delete_items_permanently,
            commands::open_item,
            commands::open_reader,
            commands::open_live_reader,
            commands::get_reader_resource,
            commands::list_snapshot_versions,
            commands::reveal_item,
            commands::backup_database,
            commands::export_library,
            commands::get_settings,
            commands::update_settings,
            commands::library_stats,
            commands::list_jobs,
            commands::retry_job,
            commands::show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("Island failed to start");
}
