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
    use std::sync::{Mutex, OnceLock};
    use tauri::WebviewWindow;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::{CreateEllipticRgn, SetWindowRgn},
        UI::WindowsAndMessaging::{
            CallNextHookEx, GetMessageW, GetWindowRect, IsWindowVisible, SetForegroundWindow,
            SetWindowPos, SetWindowsHookExW, ShowWindow, MSG, MSLLHOOKSTRUCT, SWP_NOACTIVATE,
            SWP_NOSIZE, SWP_NOZORDER, SW_RESTORE, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP,
            WM_MOUSEMOVE,
        },
    };

    static BALL_WINDOW: OnceLock<isize> = OnceLock::new();
    static DRAG_STATE: OnceLock<Mutex<Option<DragState>>> = OnceLock::new();
    static MAIN_WINDOW: OnceLock<isize> = OnceLock::new();
    static HOOK_STARTED: OnceLock<()> = OnceLock::new();

    struct DragState {
        cursor: POINT,
        window_x: i32,
        window_y: i32,
        moved: bool,
    }

    fn point_is_inside_ball(point: POINT, left: i32, top: i32) -> bool {
        let x = point.x - left - 32;
        let y = point.y - top - 32;
        x * x + y * y <= 28 * 28
    }

    unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code < 0 {
            return CallNextHookEx(None, code, wparam, lparam);
        }

        let message = wparam.0 as u32;
        let mouse = &*(lparam.0 as *const MSLLHOOKSTRUCT);

        if message == WM_LBUTTONDOWN {
            let Some(ball) = BALL_WINDOW.get().copied() else {
                return CallNextHookEx(None, code, wparam, lparam);
            };
            let ball = HWND(ball as _);
            if !IsWindowVisible(ball).as_bool() {
                return CallNextHookEx(None, code, wparam, lparam);
            }
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(ball, &mut rect);
            if !point_is_inside_ball(mouse.pt, rect.left, rect.top) {
                return CallNextHookEx(None, code, wparam, lparam);
            }
            *DRAG_STATE.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(DragState {
                cursor: mouse.pt,
                window_x: rect.left,
                window_y: rect.top,
                moved: false,
            });
            return LRESULT(1);
        }

        if message == WM_MOUSEMOVE {
            if let Some(state) = DRAG_STATE
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap()
                .as_mut()
            {
                let delta_x = mouse.pt.x - state.cursor.x;
                let delta_y = mouse.pt.y - state.cursor.y;
                state.moved |= delta_x.abs() >= 3 || delta_y.abs() >= 3;
                if state.moved {
                    if let Some(ball) = BALL_WINDOW.get() {
                        let _ = SetWindowPos(
                            HWND(*ball as _),
                            None,
                            state.window_x + delta_x,
                            state.window_y + delta_y,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                        );
                    }
                }
                return LRESULT(1);
            }
        }

        if message == WM_LBUTTONUP {
            let drag = DRAG_STATE
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap()
                .take();
            if let Some(state) = drag {
                if !state.moved {
                    if let Some(main) = MAIN_WINDOW.get() {
                        let main = HWND(*main as _);
                        let _ = ShowWindow(main, SW_RESTORE);
                        let _ = SetForegroundWindow(main);
                    }
                }
                return LRESULT(1);
            }
        }

        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn install(
        window: &WebviewWindow,
        main_window: Option<&WebviewWindow>,
    ) -> tauri::Result<()> {
        let hwnd = window.hwnd()?;
        let _ = BALL_WINDOW.set(hwnd.0 as isize);
        if let Some(main_window) = main_window {
            let _ = MAIN_WINDOW.set(main_window.hwnd()?.0 as isize);
        }
        unsafe {
            // The platform imposes a larger minimum WebView window than the
            // floating control itself. A real native region removes the unused
            // rectangle from both rendering and hit-testing.
            let region = CreateEllipticRgn(4, 4, 60, 60);
            SetWindowRgn(hwnd, Some(region), true);
        }

        HOOK_STARTED.get_or_init(|| {
            std::thread::spawn(|| unsafe {
                let Ok(hook) = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) else {
                    return;
                };
                let mut message = MSG::default();
                while GetMessageW(&mut message, None, 0, 0).as_bool() {}
                let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
            });
        });
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
                let main_window = app.get_webview_window("main");
                floating_ball::install(&window, main_window.as_ref())?;
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
