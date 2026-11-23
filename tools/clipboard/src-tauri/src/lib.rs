//! Module Powernux « Clipboard Manager » — programme indépendant.
//!
//! Protocole avec Powernux Core (arguments en ligne de commande) :
//!   (aucun)           démarre en arrière-plan
//!   --show            affiche / masque la fenêtre du presse-papiers
//!   --reload          relit settings.json
//!   --clear-history   efface l'historique (sauf épinglés)
//!   --quit            arrête le module
//! Une seule instance tourne : les lancements suivants transmettent leurs arguments.
//!
//! Fichiers (POWERNUX_HOME = $XDG_DATA_HOME/powernux) :
//!   POWERNUX_HOME/tools/clipboard/settings.json   écrit par Powernux Core
//!   POWERNUX_HOME/data/clipboard/history.json     historique
//!
//! Sous GNOME Wayland, la lecture en arrière-plan passe par XWayland (arboard / X11).
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

const TOOL_ID: &str = "clipboard";
const MAX_TEXT_LEN: usize = 100_000;
const UPDATED: &str = "clipboard://updated";
const SHOWN: &str = "clipboard://shown";

// ---------- Chemins ----------

fn powernux_home() -> PathBuf {
    if let Ok(p) = std::env::var("POWERNUX_HOME") {
        return PathBuf::from(p);
    }
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/share"));
    base.join("powernux")
}
fn settings_path() -> PathBuf {
    powernux_home().join("tools").join(TOOL_ID).join("settings.json")
}
fn history_path() -> PathBuf {
    powernux_home().join("data").join(TOOL_ID).join("history.json")
}

// ---------- Réglages ----------

#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    max_items: usize,
    save_history: bool,
    /// Ignore les copies marquées « secret » par les gestionnaires de mots de passe.
    ignore_secrets: bool,
    /// Efface les éléments non épinglés plus anciens que N minutes (0 = jamais).
    auto_clear: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self { max_items: 50, save_history: true, ignore_secrets: true, auto_clear: 0 }
    }
}

// ---------- Détection des mots de passe ----------

/// Formats signalant un contenu secret (KeePassXC, KDE, gestionnaires compatibles).
const SECRET_TARGETS: &[&str] = &["x-kde-passwordManagerHint", "application/x-kde-passwordManagerHint"];

/// Interroge le propriétaire du presse-papiers (X11 / XWayland) sur les formats proposés.
struct TargetProbe {
    conn: x11rb::rust_connection::RustConnection,
    window: u32,
    clipboard: u32,
    targets: u32,
    property: u32,
}

impl TargetProbe {
    fn new() -> Option<Self> {
        use x11rb::{connection::Connection, protocol::xproto::*, COPY_DEPTH_FROM_PARENT};
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen)?.root;
        let window = conn.generate_id().ok()?;
        conn.create_window(COPY_DEPTH_FROM_PARENT, window, root, 0, 0, 1, 1, 0, WindowClass::INPUT_ONLY, 0, &CreateWindowAux::new())
            .ok()?;
        let atom = |name: &str| conn.intern_atom(false, name.as_bytes()).ok()?.reply().ok().map(|r| r.atom);
        let (clipboard, targets, property) = (atom("CLIPBOARD")?, atom("TARGETS")?, atom("POWERNUX_TARGETS")?);
        Some(Self { conn, window, clipboard, targets, property })
    }

    /// Le contenu actuel du presse-papiers est-il marqué comme secret ?
    fn is_secret(&self) -> Option<bool> {
        use x11rb::{connection::Connection, protocol::xproto::*, protocol::Event, CURRENT_TIME};
        self.conn.convert_selection(self.window, self.clipboard, self.targets, self.property, CURRENT_TIME).ok()?;
        self.conn.flush().ok()?;
        let deadline = std::time::Instant::now() + Duration::from_millis(300);
        loop {
            match self.conn.poll_for_event().ok()? {
                Some(Event::SelectionNotify(e)) if e.requestor == self.window => {
                    if e.property == x11rb::NONE {
                        return Some(false);
                    }
                    break;
                }
                Some(_) => {}
                None if std::time::Instant::now() > deadline => return None,
                None => thread::sleep(Duration::from_millis(5)),
            }
        }
        let reply = self.conn.get_property(true, self.window, self.property, AtomEnum::ATOM, 0, 1024).ok()?.reply().ok()?;
        let atoms: Vec<u32> = reply.value32()?.collect();
        for atom in atoms {
            if let Ok(Ok(name)) = self.conn.get_atom_name(atom).map(|c| c.reply()) {
                if SECRET_TARGETS.contains(&String::from_utf8_lossy(&name.name).as_ref()) {
                    return Some(true);
                }
            }
        }
        Some(false)
    }
}

/// Efface les éléments non épinglés plus anciens que la durée choisie.
fn auto_clear(state: &AppState) -> bool {
    let minutes = state.settings.lock().unwrap().auto_clear;
    if minutes == 0 {
        return false;
    }
    let limit = now_ms().saturating_sub(minutes * 60_000);
    let mut history = state.history.lock().unwrap();
    let before = history.len();
    history.retain(|i| i.pinned || i.timestamp >= limit);
    history.len() != before
}
fn load_settings() -> Settings {
    fs::read_to_string(settings_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

// ---------- Historique ----------

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    id: u64,
    text: String,
    pinned: bool,
    timestamp: u64,
}

struct AppState {
    settings: Mutex<Settings>,
    history: Mutex<Vec<ClipItem>>,
    clipboard: Mutex<Option<arboard::Clipboard>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn load_history() -> Vec<ClipItem> {
    fs::read_to_string(history_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn persist(state: &AppState) {
    let path = history_path();
    if state.settings.lock().unwrap().save_history {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&*state.history.lock().unwrap()) {
            let _ = fs::write(path, json);
        }
    } else {
        let _ = fs::remove_file(path);
    }
}

fn trim(history: &mut Vec<ClipItem>, max: usize) {
    while history.len() > max {
        match history.iter().rposition(|i| !i.pinned) {
            Some(pos) => {
                history.remove(pos);
            }
            None => break,
        }
    }
}

fn push(state: &AppState, text: String) -> bool {
    let max = state.settings.lock().unwrap().max_items;
    let mut history = state.history.lock().unwrap();
    if history.first().is_some_and(|i| i.text == text) {
        return false;
    }
    let pinned = match history.iter().position(|i| i.text == text) {
        Some(pos) => history.remove(pos).pinned,
        None => false,
    };
    let ts = now_ms();
    let id = history.iter().map(|i| i.id).max().unwrap_or(0).max(ts) + 1;
    history.insert(0, ClipItem { id, text, pinned, timestamp: ts });
    trim(&mut history, max);
    true
}

fn start_watcher(app: AppHandle, state: Arc<AppState>) {
    thread::spawn(move || {
        let mut last: Option<String> = None;
        let mut probe: Option<TargetProbe> = None;
        let mut tick: u64 = 0;
        loop {
            thread::sleep(Duration::from_millis(500));
            tick += 1;
            // Effacement automatique : vérifié toutes les 30 s.
            if tick % 60 == 0 && auto_clear(&state) {
                persist(&state);
                let _ = app.emit(UPDATED, ());
            }
            let text = {
                let mut cb = state.clipboard.lock().unwrap();
                if cb.is_none() {
                    *cb = arboard::Clipboard::new().ok();
                }
                cb.as_mut().and_then(|c| c.get_text().ok())
            };
            let Some(text) = text else { continue };
            if last.as_deref() == Some(text.as_str()) {
                continue;
            }
            last = Some(text.clone());
            if text.trim().is_empty() || text.len() > MAX_TEXT_LEN {
                continue;
            }
            // Mot de passe copié depuis un gestionnaire : jamais enregistré.
            if state.settings.lock().unwrap().ignore_secrets {
                if probe.is_none() {
                    probe = TargetProbe::new();
                }
                match probe.as_ref().and_then(TargetProbe::is_secret) {
                    Some(true) => continue,
                    Some(false) => {}
                    None => probe = None, // connexion perdue : recréée au prochain élément
                }
            }
            if push(&state, text) {
                persist(&state);
                let _ = app.emit(UPDATED, ());
            }
        }
    });
}

// ---------- Fenêtre ----------

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
            let _ = app.emit(SHOWN, ());
        }
    }
}

fn hide_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

fn clear_history(app: &AppHandle, state: &AppState) {
    state.history.lock().unwrap().retain(|i| i.pinned);
    persist(state);
    let _ = app.emit(UPDATED, ());
}

/// Traite les arguments reçus (au démarrage ou depuis une autre instance).
fn handle_args(app: &AppHandle, args: &[String]) {
    let state = app.state::<Arc<AppState>>();
    for arg in args.iter().skip(1) {
        match arg.as_str() {
            "--show" => toggle_window(app),
            "--quit" => app.exit(0),
            "--clear-history" => clear_history(app, &state),
            "--reload" => {
                let s = load_settings();
                *state.settings.lock().unwrap() = s.clone();
                trim(&mut state.history.lock().unwrap(), s.max_items);
                auto_clear(&state);
                persist(&state);
                let _ = app.emit(UPDATED, ());
            }
            _ => {}
        }
    }
}

// ---------- Commandes appelées par la fenêtre ----------

type St<'a> = State<'a, Arc<AppState>>;

#[tauri::command]
fn history(state: St) -> Vec<ClipItem> {
    state.history.lock().unwrap().clone()
}

#[tauri::command]
fn use_item(app: AppHandle, state: St, id: u64) -> Result<(), String> {
    let text = state.history.lock().unwrap().iter().find(|i| i.id == id).map(|i| i.text.clone());
    let text = text.ok_or("Élément introuvable")?;
    {
        let mut cb = state.clipboard.lock().unwrap();
        if cb.is_none() {
            *cb = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
        }
        cb.as_mut().unwrap().set_text(text).map_err(|e| e.to_string())?;
    }
    hide_window(&app);
    Ok(())
}

fn mutate(app: &AppHandle, state: &AppState, f: impl FnOnce(&mut Vec<ClipItem>)) {
    f(&mut state.history.lock().unwrap());
    persist(state);
    let _ = app.emit(UPDATED, ());
}

#[tauri::command]
fn delete_item(app: AppHandle, state: St, id: u64) {
    mutate(&app, &state, |h| h.retain(|i| i.id != id));
}

#[tauri::command]
fn toggle_pin(app: AppHandle, state: St, id: u64) {
    mutate(&app, &state, |h| {
        if let Some(i) = h.iter_mut().find(|i| i.id == id) {
            i.pinned = !i.pinned;
        }
    });
}

#[tauri::command]
fn clear(app: AppHandle, state: St) {
    clear_history(&app, &state);
}

#[tauri::command]
fn hide(app: AppHandle) {
    hide_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| handle_args(app, &args)))
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            // Première instance lancée seulement pour s'arrêter ou vider l'historique.
            if args.iter().any(|a| a == "--quit") {
                std::process::exit(0);
            }
            let settings = load_settings();
            let history = if settings.save_history { load_history() } else { Vec::new() };
            let state = Arc::new(AppState {
                settings: Mutex::new(settings),
                history: Mutex::new(history),
                clipboard: Mutex::new(None),
            });
            app.manage(state.clone());
            start_watcher(app.handle().clone(), state);
            handle_args(app.handle(), &args);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![history, use_item, delete_item, toggle_pin, clear, hide])
        .run(tauri::generate_context!())
        .expect("error while running powernux-clipboard");
}
