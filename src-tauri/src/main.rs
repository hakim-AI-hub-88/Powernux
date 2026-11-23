// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Ouverture de session : démarre seulement les outils actifs, sans interface.
    if std::env::args().any(|a| a == "--autostart") {
        powernux_lib::autostart();
        return;
    }
    powernux_lib::run()
}
