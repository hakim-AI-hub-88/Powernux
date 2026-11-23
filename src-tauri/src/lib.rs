#[macro_use]
mod prefs;
mod secrets;
mod shortcut;
mod tools;

use tauri::Manager;
use tools::ToolsManager;

/// Mode léger lancé à l'ouverture de session : démarre les outils actifs puis quitte
/// (aucune fenêtre, aucun moteur web chargé).
pub fn autostart() {
    ToolsManager::new().start_enabled();
    // Laisse aux modules le temps de se détacher avant de quitter.
    std::thread::sleep(std::time::Duration::from_millis(500));
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Une seule instance de Powernux : relancer l'app ramène la fenêtre existante.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let manager = ToolsManager::new();
            manager.set_app(app.handle().clone());
            manager.migrate_secrets();
            // Les modules sont des programmes indépendants : ils continuent de tourner
            // quand Powernux est fermé. Au démarrage, on relance ceux qui sont actifs.
            manager.start_enabled();
            manager.sync_autostart();
            app.manage(manager);
            show_main(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tools::tools_list,
            tools::tool_install,
            tools::tool_remove,
            tools::tool_set_enabled,
            tools::tool_set_setting,
            tools::tool_action,
            tools::shortcut_conflict,
            tools::set_registry_url,
            tools::tool_collection_list,
            tools::tool_collection_action,
            tools::system_apps,
            tools::set_autostart,
            tools::uninstall_all,
            tools::check_app_update,
            tools::install_app_update,
            prefs::prefs_get,
            prefs::prefs_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
