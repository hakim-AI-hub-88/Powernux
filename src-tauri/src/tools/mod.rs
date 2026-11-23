//! Système de modules de Powernux.
//!
//! Powernux Core ne contient aucun outil : chaque outil est un programme indépendant,
//! publié dans un registre (registry.json) et installé dans
//! `POWERNUX_HOME/tools/<id>/` (POWERNUX_HOME = ~/.local/share/powernux).
//!
//! Protocole d'un module (arguments de son exécutable) :
//!   (aucun) démarrer · --reload relire settings.json · --quit s'arrêter · + actions du manifest
//! Un module peut écrire `tools/<id>/status.json` ({level, message}) pour informer l'utilisateur.
pub mod installer;
pub mod manifest;

use crate::shortcut;
use manifest::{is_newer, platform, valid_entry, valid_id, CollectionItem, Manifest, Registry, ToolStatus};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
const PROGRESS_EVENT: &str = "tools://progress";
const CHANGED_EVENT: &str = "tools://changed";

/// Dépôt GitHub du projet (catalogue des outils et versions de l'application).
pub const GITHUB_REPO: &str = "hakim-AI-hub-88/Powernux";
/// Registre utilisé en production.
const RELEASE_REGISTRY: &str = "https://raw.githubusercontent.com/hakim-AI-hub-88/Powernux/main/registry/registry.json";

fn default_registry() -> String {
    if let Ok(url) = std::env::var("POWERNUX_REGISTRY") {
        return url;
    }
    if cfg!(debug_assertions) {
        // En développement : registre local du dépôt (rempli par `npm run package:<outil>`).
        concat!(env!("CARGO_MANIFEST_DIR"), "/../registry/registry.json").to_string()
    } else {
        RELEASE_REGISTRY.to_string()
    }
}

pub fn powernux_home() -> PathBuf {
    if let Ok(p) = std::env::var("POWERNUX_HOME") {
        return PathBuf::from(p);
    }
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/share"));
    base.join("powernux")
}

/// Écrit un fichier lisible uniquement par l'utilisateur (il peut contenir des clés API).
fn write_private(path: &std::path::Path, content: &str) {
    let _ = fs::write(path, content);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

// ---------- État persistant (installed.json) ----------

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct CoreState {
    registry_url: Option<String>,
    tools: BTreeMap<String, InstalledTool>,
    /// Démarrer les outils actifs à l'ouverture de session (None = oui).
    autostart: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledTool {
    version: String,
    enabled: bool,
    #[serde(default)]
    settings: Map<String, Value>,
}

pub struct ToolsManager {
    home: PathBuf,
    state: Mutex<CoreState>,
    registry: Mutex<Option<Registry>>,
    busy: Mutex<HashSet<String>>,
    app: OnceLock<AppHandle>,
}

impl ToolsManager {
    pub fn new() -> Self {
        let home = powernux_home();
        let state = fs::read_to_string(home.join("installed.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            home,
            state: Mutex::new(state),
            registry: Mutex::new(None),
            busy: Mutex::new(HashSet::new()),
            app: OnceLock::new(),
        }
    }

    pub fn set_app(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    fn status(&self, id: &str) -> Option<ToolStatus> {
        fs::read_to_string(self.tool_dir(id).join("status.json")).ok().and_then(|s| serde_json::from_str(&s).ok())
    }

    fn tools_dir(&self) -> PathBuf {
        self.home.join("tools")
    }
    /// Dossier d'un outil. L'identifiant est toujours validé avant d'arriver ici ;
    /// par sécurité, un identifiant invalide donne un dossier inexistant et inoffensif.
    fn tool_dir(&self, id: &str) -> PathBuf {
        if valid_id(id) { self.tools_dir().join(id) } else { self.tools_dir().join(".invalid") }
    }

    fn save(&self, state: &CoreState) {
        let _ = fs::create_dir_all(&self.home);
        if let Ok(json) = serde_json::to_string_pretty(state) {
            write_private(&self.home.join("installed.json"), &json);
        }
    }

    fn registry_url(&self) -> String {
        self.state.lock().unwrap().registry_url.clone().unwrap_or_else(default_registry)
    }

    fn manifest(&self, id: &str) -> Option<Manifest> {
        if !valid_id(id) {
            return None;
        }
        installer::read_manifest(&self.tool_dir(id)).ok().filter(|m| m.id == id && valid_entry(&m.entry))
    }

    /// Valeurs des réglages : valeurs enregistrées, complétées par les valeurs par défaut.
    fn settings_values(manifest: &Manifest, saved: &Map<String, Value>) -> Map<String, Value> {
        manifest
            .settings
            .iter()
            .map(|s| (s.key.clone(), saved.get(&s.key).cloned().unwrap_or_else(|| s.default.clone())))
            .collect()
    }

    /// Valeurs pour l'interface : une clé secrète n'est jamais renvoyée (seulement le marqueur).
    fn public_values(manifest: &Manifest, saved: &Map<String, Value>) -> Map<String, Value> {
        let mut values = Self::settings_values(manifest, saved);
        for def in manifest.settings.iter().filter(|d| d.kind == "secret") {
            if values.get(&def.key).and_then(Value::as_str).is_some_and(|v| !v.is_empty()) {
                values.insert(def.key.clone(), Value::String(crate::secrets::MARKER.into()));
            }
        }
        values
    }

    /// Ancienne version : clés en clair dans les fichiers → déplacées dans le trousseau GNOME.
    pub fn migrate_secrets(&self) {
        let ids: Vec<String> = self.state.lock().unwrap().tools.keys().cloned().collect();
        for id in ids {
            let Some(manifest) = self.manifest(&id) else { continue };
            let mut changed = false;
            {
                let mut state = self.state.lock().unwrap();
                let Some(tool) = state.tools.get_mut(&id) else { continue };
                for def in manifest.settings.iter().filter(|d| d.kind == "secret") {
                    let Some(plain) = tool.settings.get(&def.key).and_then(Value::as_str).map(str::to_string) else { continue };
                    if !plain.is_empty() && plain != crate::secrets::MARKER && crate::secrets::store(&id, &def.key, &plain) {
                        tool.settings.insert(def.key.clone(), Value::String(crate::secrets::MARKER.into()));
                        changed = true;
                    }
                }
                if changed {
                    self.save(&state);
                }
            }
            if changed {
                let saved = self.state.lock().unwrap().tools.get(&id).map(|t| t.settings.clone()).unwrap_or_default();
                self.write_settings(&id, &Self::settings_values(&manifest, &saved));
            }
        }
    }

    /// Écrit `tools/<id>/settings.json`, lu par le module.
    fn write_settings(&self, id: &str, values: &Map<String, Value>) {
        // Langue de l'interface transmise aux modules (« _uiLanguage »).
        let mut values = values.clone();
        values.insert("_uiLanguage".into(), Value::String(crate::prefs::language()));
        write_private(&self.tool_dir(id).join("settings.json"), &serde_json::to_string_pretty(&values).unwrap_or_default());
    }

    fn spawn(&self, id: &str, manifest: &Manifest, args: &[String]) -> Result<std::process::Child, String> {
        let exe = self.tool_dir(id).join(&manifest.entry);
        Command::new(&exe)
            .args(args)
            .env("POWERNUX_HOME", &self.home)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| crate::tr!("Impossible de lancer {} : {e}", "Cannot start {}: {e}", exe.display()))
    }

    /// Lance l'exécutable du module avec des arguments (processus détaché).
    fn run(&self, id: &str, manifest: &Manifest, args: &[String]) -> Result<(), String> {
        let mut child = self.spawn(id, manifest, args)?;
        let app = self.app.get().cloned();
        // Récupère le processus à sa fin (pas de zombie) et rafraîchit l'interface :
        // le module a pu mettre à jour son status.json.
        std::thread::spawn(move || {
            let _ = child.wait();
            if let Some(app) = app {
                let _ = app.emit(CHANGED_EVENT, ());
            }
        });
        Ok(())
    }

    /// Lance le module, attend sa fin et renvoie sa sortie standard (erreur = sortie d'erreur).
    fn run_capture(&self, id: &str, manifest: &Manifest, args: &[String]) -> Result<String, String> {
        let exe = self.tool_dir(id).join(&manifest.entry);
        let out = Command::new(&exe)
            .args(args)
            .env("POWERNUX_HOME", &self.home)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| crate::tr!("Impossible de lancer {} : {e}", "Cannot start {}: {e}", exe.display()))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if err.is_empty() { crate::tr!("L'outil a signalé une erreur.", "The tool reported an error.") } else { err })
        }
    }

    /// Lance le module et attend sa fin (au plus `timeout`).
    fn run_and_wait(&self, id: &str, manifest: &Manifest, args: &[String], timeout: Duration) {
        let Ok(mut child) = self.spawn(id, manifest, args) else { return };
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    fn register_shortcuts(&self, id: &str, manifest: &Manifest, values: &Map<String, Value>) -> Result<(), String> {
        shortcut::unregister_prefix(&format!("{id}-"))?;
        let exe = self.tool_dir(id).join(&manifest.entry);
        for (n, sc) in manifest.shortcuts.iter().enumerate() {
            let Some(accel) = values.get(&sc.setting).and_then(Value::as_str) else { continue };
            if accel.is_empty() {
                continue;
            }
            let command = std::iter::once(format!("\"{}\"", exe.display()))
                .chain(sc.args.iter().map(|a| format!("\"{a}\"")))
                .collect::<Vec<_>>()
                .join(" ");
            shortcut::register(&format!("{id}-{n}"), &sc.name, &command, accel)?;
        }
        Ok(())
    }

    /// Active : raccourcis + démarrage du module.
    fn activate(&self, id: &str) -> Result<(), String> {
        let manifest = self.manifest(id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
        let saved = self.state.lock().unwrap().tools.get(id).map(|t| t.settings.clone()).unwrap_or_default();
        let values = Self::settings_values(&manifest, &saved);
        self.write_settings(id, &values);
        let _ = fs::remove_file(self.tool_dir(id).join("status.json"));
        if shortcut::is_gnome() {
            self.register_shortcuts(id, &manifest, &values)?;
        }
        self.run(id, &manifest, &[])
    }

    /// Désactive : suppression des raccourcis + arrêt du module.
    fn deactivate(&self, id: &str) -> Result<(), String> {
        shortcut::unregister_prefix(&format!("{id}-"))?;
        if let Some(manifest) = self.manifest(id) {
            let _ = self.run(id, &manifest, &["--quit".into()]);
        }
        Ok(())
    }

    /// Fichier ~/.config/autostart/powernux-tools.desktop : présent seulement si l'option est
    /// active et qu'au moins un outil est activé. Il lance `powernux --autostart` (sans interface).
    pub fn sync_autostart(&self) {
        let (wanted, any_enabled) = {
            let state = self.state.lock().unwrap();
            (state.autostart.unwrap_or(true), state.tools.values().any(|t| t.enabled))
        };
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
        let config = std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".config"));
        let file = config.join("autostart").join("powernux-tools.desktop");
        if !(wanted && any_enabled) {
            let _ = fs::remove_file(file);
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        let desktop = format!(
            "[Desktop Entry]\nType=Application\nName=Powernux — outils\n\
             Comment=Démarre les outils Powernux actifs (sans ouvrir l'application)\n\
             Exec=\"{}\" --autostart\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        );
        let _ = fs::create_dir_all(file.parent().unwrap());
        let _ = fs::write(file, desktop);
    }

    /// Au démarrage de Powernux : relance les modules actifs.
    pub fn start_enabled(&self) {
        // Ancien raccourci de la version où le presse-papiers était intégré à Powernux.
        let _ = shortcut::unregister_prefix("clipboard/");
        let enabled: Vec<String> =
            self.state.lock().unwrap().tools.iter().filter(|(_, t)| t.enabled).map(|(id, _)| id.clone()).collect();
        for id in enabled {
            let _ = self.activate(&id);
        }
    }
}

// ---------- Vue envoyée à l'interface ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolView {
    id: String,
    name: String,
    description: String,
    category: String,
    icon: String,
    author: Option<String>,
    /// Version disponible dans le registre.
    latest_version: Option<String>,
    installed_version: Option<String>,
    installed: bool,
    enabled: bool,
    /// Une archive existe pour cette plateforme.
    downloadable: bool,
    download_size: u64,
    update_available: bool,
    /// Version minimale de Powernux non atteinte.
    requires_powernux: Option<String>,
    manifest: Option<Manifest>,
    settings: Map<String, Value>,
    /// Message du module (status.json), ex. action requise.
    status: Option<ToolStatus>,
    /// Traductions du catalogue (outil non installé) ou du manifest.
    i18n: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsList {
    tools: Vec<ToolView>,
    registry_url: String,
    registry_error: Option<String>,
    autostart: bool,
    core_version: &'static str,
    platform: String,
    gnome: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    /// "download" | "verify" | "install" | "activate" | "done" | "error"
    stage: &'a str,
    downloaded: u64,
    total: u64,
    message: Option<String>,
}

fn emit_progress(app: &AppHandle, id: &str, stage: &str, downloaded: u64, total: u64, message: Option<String>) {
    let _ = app.emit(PROGRESS_EVENT, Progress { id, stage, downloaded, total, message });
}

fn build_list(m: &ToolsManager, registry_error: Option<String>) -> ToolsList {
    let registry = m.registry.lock().unwrap().clone();
    let state = m.state.lock().unwrap().clone();
    let plat = platform();
    let mut tools: Vec<ToolView> = Vec::new();

    for r in registry.iter().flat_map(|r| r.tools.iter()) {
        let installed = state.tools.get(&r.id);
        let manifest = installed.and_then(|_| m.manifest(&r.id));
        let package = r.packages.get(&plat);
        let requires = r
            .min_powernux_version
            .as_ref()
            .filter(|min| is_newer(min, CORE_VERSION))
            .cloned();
        tools.push(ToolView {
            id: r.id.clone(),
            name: r.name.clone(),
            description: r.description.clone(),
            category: r.category.clone(),
            icon: r.icon.clone(),
            author: r.author.clone(),
            latest_version: r.version.clone(),
            installed_version: installed.map(|t| t.version.clone()),
            installed: installed.is_some(),
            enabled: installed.is_some_and(|t| t.enabled),
            downloadable: package.is_some() && r.version.is_some(),
            download_size: package.map(|p| p.size).unwrap_or(0),
            update_available: match (installed, &r.version) {
                (Some(i), Some(v)) => package.is_some() && is_newer(v, &i.version),
                _ => false,
            },
            requires_powernux: requires,
            settings: manifest
                .as_ref()
                .map(|mf| ToolsManager::public_values(mf, &installed.unwrap().settings))
                .unwrap_or_default(),
            status: installed.filter(|t| t.enabled).and_then(|_| m.status(&r.id)),
            i18n: if r.i18n.is_null() { manifest.as_ref().map(|mf| mf.i18n.clone()).unwrap_or(Value::Null) } else { r.i18n.clone() },
            manifest,
        });
    }

    // Outils installés absents du registre (hors ligne ou retirés du catalogue).
    for (id, t) in &state.tools {
        if tools.iter().any(|v| &v.id == id) {
            continue;
        }
        let Some(mf) = m.manifest(id) else { continue };
        tools.push(ToolView {
            id: id.clone(),
            name: mf.name.clone(),
            description: mf.description.clone(),
            category: mf.category.clone(),
            icon: mf.icon.clone(),
            author: mf.author.clone(),
            latest_version: None,
            installed_version: Some(t.version.clone()),
            installed: true,
            enabled: t.enabled,
            downloadable: false,
            download_size: 0,
            update_available: false,
            requires_powernux: None,
            settings: ToolsManager::public_values(&mf, &t.settings),
            status: if t.enabled { m.status(id) } else { None },
            i18n: mf.i18n.clone(),
            manifest: Some(mf),
        });
    }

    ToolsList {
        tools,
        registry_url: m.registry_url(),
        registry_error,
        autostart: m.state.lock().unwrap().autostart.unwrap_or(true),
        core_version: CORE_VERSION,
        platform: plat,
        gnome: shortcut::is_gnome(),
    }
}

type Mgr<'a> = State<'a, ToolsManager>;

struct BusyGuard<'a>(&'a ToolsManager, String);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.busy.lock().unwrap().remove(&self.1);
    }
}
fn lock_tool<'a>(m: &'a ToolsManager, id: &str) -> Result<BusyGuard<'a>, String> {
    if !valid_id(id) {
        return Err(crate::tr!("Identifiant d'outil invalide.", "Invalid tool identifier."));
    }
    if !m.busy.lock().unwrap().insert(id.to_string()) {
        return Err(crate::tr!("Une opération est déjà en cours pour cet outil.", "An operation is already running for this tool."));
    }
    Ok(BusyGuard(m, id.to_string()))
}

// ---------- Commandes ----------

/// Liste des outils (registre + installés). `refresh` force le rechargement du registre.
#[tauri::command]
pub async fn tools_list(m: Mgr<'_>, refresh: bool) -> Result<ToolsList, String> {
    let mut error = None;
    if refresh || m.registry.lock().unwrap().is_none() {
        match installer::fetch_registry(&m.registry_url()).await {
            Ok(r) => *m.registry.lock().unwrap() = Some(r),
            Err(e) => error = Some(e),
        }
    }
    Ok(build_list(&m, error))
}

/// Télécharge → vérifie → installe → active. Sert aussi pour les mises à jour.
#[tauri::command]
pub async fn tool_install(app: AppHandle, m: Mgr<'_>, id: String) -> Result<(), String> {
    let _guard = lock_tool(&m, &id)?;
    let result = install_inner(&app, &m, &id).await;
    match &result {
        Ok(()) => emit_progress(&app, &id, "done", 0, 0, None),
        Err(e) => emit_progress(&app, &id, "error", 0, 0, Some(e.clone())),
    }
    m.sync_autostart();
    let _ = app.emit(CHANGED_EVENT, ());
    result
}

async fn install_inner(app: &AppHandle, m: &ToolsManager, id: &str) -> Result<(), String> {
    let registry_url = m.registry_url();
    let (entry, package) = {
        let reg = m.registry.lock().unwrap();
        let entry = reg
            .as_ref()
            .and_then(|r| r.tools.iter().find(|t| t.id == id))
            .cloned()
            .ok_or_else(|| crate::tr!("Outil absent du catalogue.", "Tool not found in the catalog."))?;
        let package = entry.packages.get(&platform()).cloned().ok_or_else(|| crate::tr!("Pas d'archive pour {}.", "No package for {}.", platform()))?;
        (entry, package)
    };
    if let Some(min) = entry.min_powernux_version.as_ref().filter(|min| is_newer(min, CORE_VERSION)) {
        return Err(crate::tr!("Cet outil nécessite Powernux {min} ou plus récent.", "This tool requires Powernux {min} or newer."));
    }

    // 1. Téléchargement
    let url = installer::resolve(&registry_url, &package.url)?;
    emit_progress(app, id, "download", 0, package.size, None);
    let data = installer::fetch(&url, |done, total| {
        emit_progress(app, id, "download", done, if total > 0 { total } else { package.size }, None)
    })
    .await?;

    // 2. Vérification
    emit_progress(app, id, "verify", 0, 0, None);
    installer::verify(&data, &package)?;
    installer::verify_signature(&data, &package)?;

    // 3. Installation (le module en cours d'exécution est arrêté pendant une mise à jour)
    emit_progress(app, id, "install", 0, 0, None);
    let was_installed = m.state.lock().unwrap().tools.contains_key(id);
    if was_installed {
        m.deactivate(id)?;
        std::thread::sleep(Duration::from_millis(300));
    }
    let manifest = installer::install(&data, &m.tools_dir(), id)?;
    {
        let mut state = m.state.lock().unwrap();
        let settings = state.tools.get(id).map(|t| t.settings.clone()).unwrap_or_default();
        state.tools.insert(id.to_string(), InstalledTool { version: manifest.version.clone(), enabled: true, settings });
        m.save(&state);
    }

    // 4. Activation
    emit_progress(app, id, "activate", 0, 0, None);
    m.activate(id)
}

/// Supprime l'outil : arrêt, raccourcis, fichiers et données.
#[tauri::command]
pub fn tool_remove(app: AppHandle, m: Mgr, id: String) -> Result<(), String> {
    let _guard = lock_tool(&m, &id)?;
    m.deactivate(&id)?;
    if let Some(manifest) = m.manifest(&id) {
        for def in manifest.settings.iter().filter(|d| d.kind == "secret") {
            crate::secrets::delete(&id, &def.key);
        }
        // Nettoyage propre au module (ex. extension GNOME Shell).
        if !manifest.hooks.uninstall.is_empty() {
            m.run_and_wait(&id, &manifest, &manifest.hooks.uninstall, Duration::from_secs(10));
        }
    }
    let _ = fs::remove_dir_all(m.tool_dir(&id));
    let _ = fs::remove_dir_all(m.home.join("data").join(&id));
    {
        let mut state = m.state.lock().unwrap();
        state.tools.remove(&id);
        m.save(&state);
    }
    m.sync_autostart();
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

/// ON / OFF.
#[tauri::command]
pub fn tool_set_enabled(app: AppHandle, m: Mgr, id: String, enabled: bool) -> Result<(), String> {
    let _guard = lock_tool(&m, &id)?;
    {
        let mut state = m.state.lock().unwrap();
        let tool = state.tools.get_mut(&id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
        tool.enabled = enabled;
        m.save(&state);
    }
    let result = if enabled { m.activate(&id) } else { m.deactivate(&id) };
    m.sync_autostart();
    if result.is_err() && enabled {
        let mut state = m.state.lock().unwrap();
        if let Some(t) = state.tools.get_mut(&id) {
            t.enabled = false;
        }
        m.save(&state);
    }
    let _ = app.emit(CHANGED_EVENT, ());
    result
}

/// Modifie un réglage déclaré dans le manifest.
#[tauri::command]
pub fn tool_set_setting(app: AppHandle, m: Mgr, id: String, key: String, value: Value) -> Result<(), String> {
    let manifest = m.manifest(&id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
    let def = manifest.settings.iter().find(|s| s.key == key).ok_or_else(|| crate::tr!("Réglage inconnu", "Unknown setting"))?;
    let valid = match def.kind.as_str() {
        "toggle" => value.is_boolean(),
        "select" => def.options.iter().any(|o| o.value == value),
        "shortcut" => value.as_str().is_some_and(|s| !s.is_empty()),
        "text" | "secret" => value.as_str().is_some_and(|s| s.len() <= 4096),
        _ => false,
    };
    if !valid {
        return Err(crate::tr!("Valeur invalide pour ce réglage.", "Invalid value for this setting."));
    }

    // Clé API : dans le trousseau GNOME (repli sur le fichier, protégé en 0600, si le trousseau est absent).
    let value = if def.kind == "secret" {
        let plain = value.as_str().unwrap_or("").trim().to_string();
        if plain.is_empty() {
            crate::secrets::delete(&id, &key);
            Value::String(String::new())
        } else if crate::secrets::store(&id, &key, &plain) {
            Value::String(crate::secrets::MARKER.into())
        } else {
            Value::String(plain)
        }
    } else {
        value
    };

    let (enabled, values) = {
        let mut state = m.state.lock().unwrap();
        let tool = state.tools.get_mut(&id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
        tool.settings.insert(key.clone(), value);
        let values = ToolsManager::settings_values(&manifest, &tool.settings);
        let enabled = tool.enabled;
        m.save(&state);
        (enabled, values)
    };
    m.write_settings(&id, &values);
    if enabled {
        if def.kind == "shortcut" && shortcut::is_gnome() {
            m.register_shortcuts(&id, &manifest, &values)?;
        }
        m.run(&id, &manifest, &["--reload".into()])?;
    }
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

/// Exécute une action déclarée dans le manifest (ex. « Ouvrir le presse-papiers »).
#[tauri::command]
pub fn tool_action(m: Mgr, id: String, action: String) -> Result<(), String> {
    let manifest = m.manifest(&id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
    if !m.state.lock().unwrap().tools.get(&id).is_some_and(|t| t.enabled) {
        return Err(crate::tr!("Activez l'outil pour utiliser cette action.", "Turn the tool on to use this action."));
    }
    let def = manifest.actions.iter().find(|a| a.id == action).ok_or_else(|| crate::tr!("Action inconnue", "Unknown action"))?;
    m.run(&id, &manifest, &def.args)
}

/// Raccourci déjà utilisé par le système ou une autre application ?
#[tauri::command]
pub fn shortcut_conflict(id: String, shortcut: String) -> Option<String> {
    shortcut::find_conflict(&shortcut, &id)
}

/// Change la source du catalogue (None = source par défaut).
#[tauri::command]
pub fn set_registry_url(app: AppHandle, m: Mgr, url: Option<String>) {
    {
        let mut state = m.state.lock().unwrap();
        state.registry_url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
        m.save(&state);
    }
    *m.registry.lock().unwrap() = None;
    let _ = app.emit(CHANGED_EVENT, ());
}

// ---------- Collections (listes gérées par un module) ----------

fn enabled_manifest(m: &ToolsManager, id: &str) -> Result<Manifest, String> {
    let manifest = m.manifest(id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
    if !m.state.lock().unwrap().tools.get(id).is_some_and(|t| t.enabled) {
        return Err(crate::tr!("Activez l'outil pour utiliser cette fonction.", "Turn the tool on to use this feature."));
    }
    Ok(manifest)
}

/// Éléments d'une collection (ex. espaces de travail enregistrés).
#[tauri::command]
pub async fn tool_collection_list(app: AppHandle, id: String, collection: String) -> Result<Vec<CollectionItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let m = app.state::<ToolsManager>();
        let manifest = m.manifest(&id).ok_or_else(|| crate::tr!("Outil non installé", "Tool not installed"))?;
        let def = manifest.collections.iter().find(|c| c.id == collection).ok_or_else(|| crate::tr!("Collection inconnue", "Unknown collection"))?;
        let out = m.run_capture(&id, &manifest, &def.list)?;
        serde_json::from_str(out.trim()).map_err(|e| crate::tr!("Réponse de l'outil invalide : {e}", "Invalid response from the tool: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Action sur une collection : création (`value`) ou action sur un élément (`item`).
#[tauri::command]
pub async fn tool_collection_action(
    app: AppHandle,
    id: String,
    collection: String,
    action: String,
    item: Option<String>,
    value: Option<String>,
    json: Option<Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let m = app.state::<ToolsManager>();
        let manifest = enabled_manifest(&m, &id)?;
        let def = manifest.collections.iter().find(|c| c.id == collection).ok_or_else(|| crate::tr!("Collection inconnue", "Unknown collection"))?;
        let args = if action == "create" {
            def.create.as_ref().ok_or_else(|| crate::tr!("Création impossible", "Cannot create"))?.args.clone()
        } else {
            def.item_actions.iter().find(|a| a.id == action).ok_or_else(|| crate::tr!("Action inconnue", "Unknown action"))?.args.clone()
        };
        let item = item.unwrap_or_default();
        let value = value.unwrap_or_default();
        let json = json.map(|j| j.to_string()).unwrap_or_default();
        let args: Vec<String> =
            args.iter().map(|a| a.replace("{id}", &item).replace("{value}", &value).replace("{json}", &json)).collect();
        m.run_capture(&id, &manifest, &args).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- Applications installées (champ « apps » des formulaires) ----------

#[derive(Serialize)]
pub struct DesktopApp {
    id: String,
    name: String,
}

/// Applications visibles du menu (fichiers .desktop), triées par nom.
#[tauri::command]
pub async fn system_apps() -> Vec<DesktopApp> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
        let data_home = std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".local/share"));
        let mut dirs = vec![data_home.join("applications")];
        let system = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
        dirs.extend(system.split(':').filter(|d| !d.is_empty()).map(|d| PathBuf::from(d).join("applications")));
        dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
        dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
        dirs.push(data_home.join("flatpak/exports/share/applications"));

        let mut apps: BTreeMap<String, DesktopApp> = BTreeMap::new();
        for dir in dirs {
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let id = entry.file_name().to_string_lossy().into_owned();
                if !id.ends_with(".desktop") || apps.contains_key(&id) {
                    continue;
                }
                let Ok(text) = fs::read_to_string(entry.path()) else { continue };
                let (mut name, mut name_fr, mut hidden, mut app, mut in_entry) = (None, None, false, false, false);
                for line in text.lines() {
                    if line.starts_with('[') {
                        in_entry = line == "[Desktop Entry]";
                        continue;
                    }
                    if !in_entry {
                        continue;
                    }
                    if let Some(v) = line.strip_prefix("Name=") {
                        name.get_or_insert(v.to_string());
                    } else if let (false, Some(v)) = (crate::prefs::is_en(), line.strip_prefix("Name[fr]=")) {
                        name_fr.get_or_insert(v.to_string());
                    } else if line == "NoDisplay=true" || line == "Hidden=true" {
                        hidden = true;
                    } else if line == "Type=Application" {
                        app = true;
                    }
                }
                if let (false, true, Some(n)) = (hidden, app, name_fr.or(name)) {
                    apps.insert(id.clone(), DesktopApp { id, name: n });
                }
            }
        }
        let mut list: Vec<DesktopApp> = apps.into_values().collect();
        list.sort_by_key(|a| a.name.to_lowercase());
        list
    })
    .await
    .unwrap_or_default()
}

/// Démarrage automatique des outils à l'ouverture de session.
#[tauri::command]
pub fn set_autostart(app: AppHandle, m: Mgr, enabled: bool) {
    {
        let mut state = m.state.lock().unwrap();
        state.autostart = Some(enabled);
        m.save(&state);
    }
    m.sync_autostart();
    let _ = app.emit(CHANGED_EVENT, ());
}

// ---------- Tout désinstaller ----------

/// Supprime tous les outils, leurs données, clés, raccourcis, extensions GNOME et le démarrage
/// automatique, puis les préférences. Il ne reste ensuite qu'à faire `sudo apt remove powernux`.
#[tauri::command]
pub fn uninstall_all(app: AppHandle, m: Mgr) -> Result<(), String> {
    let ids: Vec<String> = m.state.lock().unwrap().tools.keys().cloned().collect();
    for id in &ids {
        let _ = m.deactivate(id);
        if let Some(manifest) = m.manifest(id) {
            for def in manifest.settings.iter().filter(|d| d.kind == "secret") {
                crate::secrets::delete(id, &def.key);
            }
            if !manifest.hooks.uninstall.is_empty() {
                m.run_and_wait(id, &manifest, &manifest.hooks.uninstall, Duration::from_secs(10));
            }
        }
    }
    // Tous les raccourcis Powernux (outils, espaces de travail…).
    let _ = shortcut::unregister_prefix("");
    {
        let mut state = m.state.lock().unwrap();
        *state = CoreState::default();
    }
    m.sync_autostart(); // aucun outil : le fichier de démarrage est supprimé
    // Données (outils, historiques, notes…) : uniquement le dossier « powernux ».
    if m.home.file_name().is_some_and(|n| n == "powernux") {
        let _ = fs::remove_dir_all(&m.home);
    }
    if let Some(dir) = crate::prefs::path().parent() {
        let _ = fs::remove_dir_all(dir);
    }
    *m.registry.lock().unwrap() = None;
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

// ---------- Mises à jour de Powernux ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    current: &'static str,
    latest: Option<String>,
    available: bool,
    /// .deb de la dernière version.
    url: Option<String>,
    /// Empreinte « sha256:… » publiée par GitHub.
    digest: Option<String>,
    page: Option<String>,
}

/// Compare la version installée à la dernière version publiée sur GitHub.
#[tauri::command]
pub async fn check_app_update() -> Result<AppUpdate, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Powernux/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let resp = client
        .get(&url)
        .header("accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| crate::tr!("Pas de connexion à GitHub.", "Cannot reach GitHub."))?;
    let none = AppUpdate { current: CORE_VERSION, latest: None, available: false, url: None, digest: None, page: None };
    if resp.status().as_u16() == 404 {
        return Ok(none); // aucune version publiée pour l'instant
    }
    if !resp.status().is_success() {
        return Err(crate::tr!("GitHub a répondu {}.", "GitHub answered {}.", resp.status()));
    }
    let release: Value = serde_json::from_str(&resp.text().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let latest = release["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let deb = release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| n.ends_with("_amd64.deb"))));
    Ok(AppUpdate {
        current: CORE_VERSION,
        available: !latest.is_empty() && is_newer(&latest, CORE_VERSION) && deb.is_some(),
        url: deb.and_then(|d| d["browser_download_url"].as_str().map(String::from)),
        digest: deb.and_then(|d| d["digest"].as_str().map(String::from)),
        page: release["html_url"].as_str().map(String::from),
        latest: Some(latest).filter(|l| !l.is_empty()),
    })
}

/// Télécharge le .deb (GitHub uniquement), vérifie son empreinte, puis l'ouvre dans le
/// Centre d'applications pour l'installation.
#[tauri::command]
pub async fn install_app_update(url: String, digest: Option<String>) -> Result<(), String> {
    let allowed = format!("https://github.com/{GITHUB_REPO}/releases/download/");
    if !url.starts_with(&allowed) || !url.ends_with(".deb") || url.contains("..") {
        return Err(crate::tr!("Adresse de mise à jour refusée.", "Update address refused."));
    }
    let data = installer::fetch(&url, |_, _| {}).await?;
    if let Some(expected) = digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        use sha2::{Digest, Sha256};
        let hash: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
        if !hash.eq_ignore_ascii_case(expected) {
            return Err(crate::tr!("Le fichier téléchargé est corrompu.", "The downloaded file is corrupted."));
        }
    }
    let downloads = Command::new("xdg-user-dir")
        .arg("DOWNLOAD")
        .output()
        .ok()
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Downloads"));
    let name = url.rsplit('/').next().unwrap_or("powernux.deb");
    let file = downloads.join(name);
    fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    fs::write(&file, &data).map_err(|e| e.to_string())?;
    Command::new("gio")
        .arg("open")
        .arg(&file)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
