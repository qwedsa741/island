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

pub fn run() {
    tauri::Builder::default()
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
