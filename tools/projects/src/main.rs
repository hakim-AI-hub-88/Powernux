//! Module Powernux « Project Dashboard » — programme indépendant (sans fenêtre).
//!
//! Détecte les projets dans les dossiers configurés, reconnaît leurs technologies et
//! leur date de dernière modification, et les ouvre (VS Code, terminal, lancement).
//!
//! Protocole :
//!   (aucun)                 rien à démarrer (écrit status.json)
//!   --projects-json         liste des projets (JSON pour Powernux)
//!   --add-project <chemin>  ajoute un projet hors des dossiers analysés
//!   --run <chemin>          lance le projet dans un terminal (npm run dev, cargo run…)
//!   --open-code <chemin>    --open-terminal <chemin>    --open-folder <chemin>
//!   --reload / --quit       rien à faire
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, ExitCode, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const IGNORED: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", ".venv", "venv", "__pycache__", ".next", ".cache", "vendor",
];
const MARKERS: &[&str] = &[
    ".git", "Cargo.toml", "package.json", "pyproject.toml", "requirements.txt", "setup.py", "go.mod", "pom.xml",
    "build.gradle", "composer.json", "Gemfile", "CMakeLists.txt", "Makefile", "deno.json",
];

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}
fn powernux_home() -> PathBuf {
    std::env::var("POWERNUX_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".local/share")).join("powernux")
    })
}
fn settings() -> Value {
    fs::read_to_string(powernux_home().join("tools/projects/settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}
fn extra_path() -> PathBuf {
    powernux_home().join("data/projects/extra.json")
}

fn expand(p: &str) -> PathBuf {
    let p = p.trim();
    match p.strip_prefix("~") {
        Some(rest) => home().join(rest.trim_start_matches('/')),
        None => PathBuf::from(p),
    }
}

fn pretty(p: &Path) -> String {
    let h = home();
    match p.strip_prefix(&h) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => p.display().to_string(),
    }
}

fn is_project(dir: &Path) -> bool {
    MARKERS.iter().any(|m| dir.join(m).exists())
}

/// Projets d'un dossier racine (le dossier lui-même ou ses sous-dossiers, 2 niveaux).
fn scan(root: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if is_project(root) {
        out.push(root.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || IGNORED.contains(&name.as_str()) {
            continue;
        }
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            scan(&e.path(), depth - 1, out);
        }
    }
}

fn read_json(p: &Path) -> Value {
    fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

/// Technologies détectées : « Rust + Tauri + React ».
fn stack(dir: &Path) -> Vec<&'static str> {
    let mut s = Vec::new();
    let has = |f: &str| dir.join(f).exists();
    if has("Cargo.toml") || has("src-tauri/Cargo.toml") {
        s.push("Rust");
    }
    if has("src-tauri/tauri.conf.json") || has("tauri.conf.json") {
        s.push("Tauri");
    }
    if has("package.json") {
        let pkg = read_json(&dir.join("package.json"));
        let dep = |n: &str| pkg["dependencies"].get(n).is_some() || pkg["devDependencies"].get(n).is_some();
        if dep("next") {
            s.push("Next.js");
        } else if dep("react") {
            s.push("React");
        } else if dep("vue") {
            s.push("Vue");
        } else if dep("svelte") {
            s.push("Svelte");
        } else if dep("electron") {
            s.push("Electron");
        }
        s.push(if has("tsconfig.json") { "TypeScript" } else { "JavaScript" });
    }
    if has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("main.py") || has("manage.py") {
        s.push("Python");
    }
    if has("go.mod") {
        s.push("Go");
    }
    if has("pom.xml") || has("build.gradle") {
        s.push("Java");
    }
    if has("composer.json") {
        s.push("PHP");
    }
    if has("Gemfile") {
        s.push("Ruby");
    }
    if has("CMakeLists.txt") {
        s.push("C/C++");
    }
    if has("Dockerfile") || has("docker-compose.yml") {
        s.push("Docker");
    }
    s
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Date de dernière modification : fichier le plus récent (dossiers lourds ignorés).
fn last_modified(dir: &Path) -> u64 {
    let mut newest = 0;
    let mut budget = 4000;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            budget -= 1;
            if budget == 0 {
                return newest;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if IGNORED.contains(&name.as_str()) {
                continue;
            }
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                stack.push(e.path());
            } else {
                newest = newest.max(mtime(&e.path()));
            }
        }
    }
    newest
}

fn humanize(ts: u64) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Comparaison par jour civil (approximation UTC + décalage local via `date`).
    let days = now.saturating_sub(ts) / 86_400;
    match days {
        _ if ts == 0 => "inconnue".into(),
        0 => "aujourd'hui".into(),
        1 => "hier".into(),
        2..=6 => format!("il y a {days} jours"),
        7..=29 => format!("il y a {} semaine(s)", days / 7),
        30..=364 => format!("il y a {} mois", days / 30),
        _ => format!("il y a {} an(s)", days / 365),
    }
}

fn all_projects() -> Vec<PathBuf> {
    let settings = settings();
    let roots = settings["roots"].as_str().unwrap_or("~/Documents/Projet, ~/Projets, ~/Projects, ~/dev, ~/code");
    let mut found = Vec::new();
    for root in roots.split(',').filter(|r| !r.trim().is_empty()) {
        let root = expand(root);
        if root.is_dir() {
            if is_project(&root) {
                found.push(root);
            } else {
                scan(&root, 2, &mut found);
            }
        }
    }
    let extra: Vec<String> = serde_json::from_value(read_json(&extra_path())).unwrap_or_default();
    found.extend(extra.iter().map(PathBuf::from).filter(|p| p.is_dir()));
    found.sort();
    found.dedup();
    // Un projet imbriqué dans un autre (ex. src-tauri) n'est pas listé séparément.
    let copy = found.clone();
    found.retain(|p| !copy.iter().any(|q| q != p && p.starts_with(q)));
    found
}

fn projects_json() -> String {
    let mut items: Vec<(u64, Value)> = all_projects()
        .into_iter()
        .map(|p| {
            let ts = last_modified(&p);
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let tech = stack(&p);
            let tech = if tech.is_empty() { "Projet".to_string() } else { tech.join(" + ") };
            let desc = format!("{tech} · Dernière modification : {} · {}", humanize(ts), pretty(&p));
            (ts, json!({ "id": p.to_string_lossy(), "name": name, "description": desc }))
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0));
    Value::Array(items.into_iter().map(|(_, v)| v).collect()).to_string()
}

/// Commande de lancement selon le type de projet.
fn run_command(dir: &Path) -> Option<String> {
    let has = |f: &str| dir.join(f).exists();
    if has("package.json") {
        let pkg = read_json(&dir.join("package.json"));
        let scripts = &pkg["scripts"];
        let pm = if has("pnpm-lock.yaml") { "pnpm" } else if has("yarn.lock") { "yarn" } else { "npm" };
        let install = if has("node_modules") { String::new() } else { format!("{pm} install && ") };
        for (script, cmd) in [("tauri", "tauri dev"), ("dev", "dev"), ("start", "start")] {
            if scripts.get(script).is_some() {
                return Some(format!("{install}{pm} run {cmd}"));
            }
        }
    }
    if has("Cargo.toml") {
        return Some("cargo run".into());
    }
    if has("manage.py") {
        return Some("python3 manage.py runserver".into());
    }
    for f in ["main.py", "app.py"] {
        if has(f) {
            return Some(format!("python3 {f}"));
        }
    }
    if has("go.mod") {
        return Some("go run .".into());
    }
    if has("Makefile") {
        return Some("make".into());
    }
    None
}

fn which(cmd: &str) -> bool {
    std::env::var("PATH").unwrap_or_default().split(':').any(|d| Path::new(d).join(cmd).is_file())
}

/// Lance un programme détaché (sans bloquer Powernux).
fn spawn(cmd: &str, args: &[&str]) -> Result<(), String> {
    Command::new(cmd)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Impossible de lancer {cmd} : {e}"))
}

/// Ouvre un terminal dans `dir`, en exécutant éventuellement `command`.
fn terminal(dir: &Path, command: Option<&str>) -> Result<(), String> {
    let d = dir.to_string_lossy();
    let shell = command.map(|c| format!("{c}; exec bash"));
    if which("ptyxis") {
        return match &shell {
            Some(s) => spawn("ptyxis", &["--new-window", "-d", &d, "-x", &format!("bash -lc '{}'", s.replace('\'', "'\\''"))]),
            None => spawn("ptyxis", &["--new-window", "-d", &d]),
        };
    }
    if which("gnome-terminal") {
        let wd = format!("--working-directory={d}");
        return match &shell {
            Some(s) => spawn("gnome-terminal", &[&wd, "--", "bash", "-lc", s]),
            None => spawn("gnome-terminal", &[&wd]),
        };
    }
    if which("kgx") {
        return spawn("kgx", &["--working-directory", &d]);
    }
    Err("Aucun terminal trouvé (ptyxis, gnome-terminal, kgx).".into())
}

fn project_arg(raw: &str) -> Result<PathBuf, String> {
    let p = expand(raw);
    if p.is_dir() { Ok(p) } else { Err(format!("Dossier introuvable : {raw}")) }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");

    let result: Result<(), String> = match arg(1) {
        "" => {
            let n = all_projects().len();
            let status = json!({
                "level": "ok",
                "message": format!("{n} projet(s) trouvé(s)."),
                "messageEn": format!("{n} project(s) found."),
            });
            let _ = fs::write(powernux_home().join("tools/projects/status.json"), status.to_string());
            Ok(())
        }
        "--projects-json" => {
            println!("{}", projects_json());
            Ok(())
        }
        "--add-project" => project_arg(arg(2)).and_then(|p| {
            let mut extra: Vec<String> = serde_json::from_value(read_json(&extra_path())).unwrap_or_default();
            let p = p.canonicalize().unwrap_or(p).to_string_lossy().into_owned();
            if !extra.contains(&p) {
                extra.push(p);
            }
            let _ = fs::create_dir_all(extra_path().parent().unwrap());
            fs::write(extra_path(), serde_json::to_string_pretty(&extra).unwrap_or_default()).map_err(|e| e.to_string())
        }),
        "--run" => project_arg(arg(2)).and_then(|p| match run_command(&p) {
            Some(cmd) => terminal(&p, Some(&cmd)),
            None => terminal(&p, None),
        }),
        "--open-code" => project_arg(arg(2)).and_then(|p| {
            let editor = settings()["editor"].as_str().unwrap_or("code").to_string();
            if editor == "code" && which("code") {
                spawn("code", &[&p.to_string_lossy()])
            } else {
                spawn("xdg-open", &[&p.to_string_lossy()])
            }
        }),
        "--open-terminal" => project_arg(arg(2)).and_then(|p| terminal(&p, None)),
        "--open-folder" => project_arg(arg(2)).and_then(|p| spawn("gio", &["open", &p.to_string_lossy()])),
        "--reload" | "--quit" => Ok(()),
        other => Err(format!("Argument inconnu : {other}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprint!("{e}");
            ExitCode::FAILURE
        }
    }
}
