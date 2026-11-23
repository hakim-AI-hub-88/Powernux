//! Module Powernux « Smart File Organizer » — programme indépendant (sans fenêtre).
//!
//! 1. Rangement : classe les fichiers d'un dossier par type (Images, Documents, Code…).
//! 2. Doublons : trouve les fichiers au contenu identique et met les copies à la corbeille.
//!
//! Sécurité : rien n'est supprimé définitivement (corbeille via `gio trash`) et le dernier
//! rangement peut être annulé (`--undo`).
//!
//! Protocole :
//!   --organize-plan         propositions de rangement (JSON)
//!   --organize <catégorie>  range une catégorie       --organize-all   range tout
//!   --undo                  annule le dernier rangement
//!   --duplicates-json       groupes de doublons (JSON)
//!   --clean <empreinte>     corbeille pour les copies d'un groupe   --clean-all   tous les groupes
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, ExitCode},
    time::UNIX_EPOCH,
};

// ---------- Chemins et réglages ----------

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}
fn powernux_home() -> PathBuf {
    std::env::var("POWERNUX_HOME").map(PathBuf::from).unwrap_or_else(|_| {
        std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".local/share")).join("powernux")
    })
}
fn settings() -> Value {
    fs::read_to_string(powernux_home().join("tools/file-organizer/settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}
fn undo_path() -> PathBuf {
    powernux_home().join("data/file-organizer/last-moves.json")
}
fn expand(p: &str) -> PathBuf {
    match p.trim().strip_prefix("~") {
        Some(rest) => home().join(rest.trim_start_matches('/')),
        None => PathBuf::from(p.trim()),
    }
}
fn target_folder() -> Result<PathBuf, String> {
    let raw = settings()["folder"].as_str().unwrap_or("~/Downloads").to_string();
    let p = expand(&raw);
    if p.is_dir() { Ok(p) } else { Err(format!("Dossier introuvable : {raw} (réglage « Dossier à analyser »).")) }
}
fn pretty(p: &Path) -> String {
    match p.strip_prefix(home()) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => p.display().to_string(),
    }
}
fn size_text(bytes: u64) -> String {
    match bytes {
        b if b >= 1 << 30 => format!("{:.1} Go", b as f64 / (1u64 << 30) as f64),
        b if b >= 1 << 20 => format!("{:.1} Mo", b as f64 / (1u64 << 20) as f64),
        b if b >= 1 << 10 => format!("{} Ko", b / 1024),
        b => format!("{b} o"),
    }
}

// ---------- Rangement ----------

/// (identifiant, dossier, description, extensions)
const CATEGORIES: &[(&str, &str, &str, &[&str])] = &[
    ("images", "Images", "des images", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "tif", "tiff", "ico", "avif"]),
    ("videos", "Vidéos", "des vidéos", &["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"]),
    ("audio", "Musique", "des fichiers audio", &["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]),
    ("documents", "Documents", "des documents", &["pdf", "doc", "docx", "odt", "txt", "rtf", "md", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "csv", "epub", "tex"]),
    ("code", "Code", "du code source", &["py", "rs", "js", "ts", "tsx", "jsx", "html", "css", "scss", "json", "c", "cpp", "h", "hpp", "java", "kt", "go", "sh", "rb", "php", "sql", "ipynb", "yml", "yaml", "toml", "xml", "lua", "dart", "swift"]),
    ("archives", "Archives", "des archives", &["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst"]),
    ("installers", "Installateurs", "des installateurs", &["deb", "rpm", "appimage", "flatpakref", "exe", "msi", "iso", "dmg", "snap"]),
];
const OTHER: (&str, &str, &str) = ("other", "Autres", "d'autres fichiers");

fn category_of(path: &Path) -> (&'static str, &'static str, &'static str) {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    CATEGORIES
        .iter()
        .find(|(_, _, _, exts)| exts.contains(&ext.as_str()))
        .map(|(id, dir, what, _)| (*id, *dir, *what))
        .unwrap_or(OTHER)
}

/// Fichiers à ranger (premier niveau du dossier, hors fichiers cachés et téléchargements en cours).
fn plan(folder: &Path) -> Vec<(&'static str, &'static str, &'static str, Vec<PathBuf>)> {
    let mut groups: Vec<(&str, &str, &str, Vec<PathBuf>)> = Vec::new();
    let Ok(entries) = fs::read_dir(folder) else { return groups };
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        let partial = [".part", ".crdownload", ".download", ".tmp"].iter().any(|s| name.ends_with(s));
        if name.starts_with('.') || partial || !e.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let (id, dir, what) = category_of(&path);
        match groups.iter_mut().find(|g| g.0 == id) {
            Some(g) => g.3.push(path),
            None => groups.push((id, dir, what, vec![path])),
        }
    }
    groups.sort_by(|a, b| b.3.len().cmp(&a.3.len()));
    groups
}

fn organize_plan_json() -> Result<String, String> {
    let folder = target_folder()?;
    let items: Vec<Value> = plan(&folder)
        .into_iter()
        .map(|(id, dir, what, files)| {
            let mut names: Vec<String> =
                files.iter().filter_map(|f| f.file_name().map(|n| n.to_string_lossy().into_owned())).collect();
            names.sort();
            let sample = names.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
            let more = if names.len() > 3 { format!(" et {} autre(s)", names.len() - 3) } else { String::new() };
            json!({
                "id": id,
                "name": format!("{dir} — {} fichier(s)", files.len()),
                "description": format!(
                    "J'ai trouvé {} fichier(s) qui semblent être {what} : {sample}{more}. Destination : {}",
                    files.len(), pretty(&folder.join(dir))
                ),
            })
        })
        .collect();
    Ok(Value::Array(items).to_string())
}

/// Nom libre dans `dir` : « fichier (2).ext » si « fichier.ext » existe déjà.
fn free_name(dir: &Path, file: &Path) -> PathBuf {
    let candidate = dir.join(file.file_name().unwrap());
    if !candidate.exists() {
        return candidate;
    }
    let stem = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = file.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap()
}

fn organize(only: Option<&str>) -> Result<(), String> {
    let folder = target_folder()?;
    let mut moves: Vec<(String, String)> = Vec::new();
    for (id, dir, _, files) in plan(&folder) {
        if only.is_some_and(|o| o != id) {
            continue;
        }
        let dest_dir = folder.join(dir);
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        for f in files {
            let dest = free_name(&dest_dir, &f);
            if fs::rename(&f, &dest).is_ok() {
                moves.push((f.to_string_lossy().into_owned(), dest.to_string_lossy().into_owned()));
            }
        }
    }
    if moves.is_empty() {
        return Err("Rien à ranger.".into());
    }
    let _ = fs::create_dir_all(undo_path().parent().unwrap());
    fs::write(undo_path(), serde_json::to_string_pretty(&moves).unwrap_or_default()).map_err(|e| e.to_string())
}

fn undo() -> Result<(), String> {
    let moves: Vec<(String, String)> = fs::read_to_string(undo_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or("Aucun rangement à annuler.")?;
    let mut failed = 0;
    for (from, to) in moves.iter().rev() {
        if Path::new(from).exists() || fs::rename(to, from).is_err() {
            failed += 1;
        }
    }
    let _ = fs::remove_file(undo_path());
    // Dossiers créés par le rangement et redevenus vides (remove_dir échoue s'ils ne le sont pas).
    for (_, to) in &moves {
        if let Some(dir) = Path::new(to).parent() {
            let _ = fs::remove_dir(dir);
        }
    }
    if failed > 0 { Err(format!("{failed} fichier(s) n'ont pas pu être remis en place.")) } else { Ok(()) }
}

// ---------- Doublons ----------

fn walk(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(t) = e.file_type() else { continue };
        if t.is_file() {
            out.push(e.path());
        } else if t.is_dir() && recursive && !["node_modules", "target", ".git"].contains(&name.as_str()) {
            walk(&e.path(), recursive, out);
        }
    }
}

fn hash(path: &Path, limit: Option<usize>) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut read_total = 0;
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        read_total += n;
        if limit.is_some_and(|l| read_total >= l) {
            break;
        }
    }
    Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Groupes de fichiers identiques : taille → début du fichier → contenu complet.
fn duplicate_groups() -> Result<Vec<(String, Vec<PathBuf>, u64)>, String> {
    let folder = target_folder()?;
    let recursive = settings()["includeSubfolders"].as_bool().unwrap_or(true);
    let mut files = Vec::new();
    walk(&folder, recursive, &mut files);

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for f in files {
        if let Ok(m) = fs::metadata(&f) {
            if m.len() > 0 {
                by_size.entry(m.len()).or_default().push(f);
            }
        }
    }
    let mut groups = Vec::new();
    for (size, same_size) in by_size.into_iter().filter(|(_, v)| v.len() > 1) {
        let mut by_head: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for f in same_size {
            if let Some(h) = hash(&f, Some(64 * 1024)) {
                by_head.entry(h).or_default().push(f);
            }
        }
        for candidates in by_head.into_values().filter(|v| v.len() > 1) {
            let mut by_full: HashMap<String, Vec<PathBuf>> = HashMap::new();
            for f in candidates {
                if let Some(h) = hash(&f, None) {
                    by_full.entry(h).or_default().push(f);
                }
            }
            for (h, mut same) in by_full.into_iter().filter(|(_, v)| v.len() > 1) {
                same.sort_by_key(|p| original_score(p));
                groups.push((h, same, size));
            }
        }
    }
    groups.sort_by(|a, b| (b.2 * (b.1.len() as u64 - 1)).cmp(&(a.2 * (a.1.len() as u64 - 1))));
    Ok(groups)
}

/// L'original : nom sans marque de copie (« (1) », « copy »…), puis le plus ancien.
fn original_score(p: &Path) -> (bool, u64, usize) {
    let name = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let looks_copy = name.contains("copy") || name.contains("copie") || name.ends_with(')') || name.contains("_copy");
    let age = fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX);
    (looks_copy, age, name.len())
}

fn duplicates_json() -> Result<String, String> {
    let items: Vec<Value> = duplicate_groups()?
        .into_iter()
        .map(|(h, files, size)| {
            let keep = &files[0];
            let copies: Vec<String> = files[1..].iter().map(|f| pretty(f)).collect();
            json!({
                "id": h,
                "name": format!("{} — {} copies identiques", keep.file_name().unwrap().to_string_lossy(), files.len()),
                "description": format!(
                    "Garde : {} · Corbeille : {} · {} récupérables",
                    pretty(keep), copies.join(", "), size_text(size * (files.len() as u64 - 1))
                ),
            })
        })
        .collect();
    Ok(Value::Array(items).to_string())
}

fn trash(p: &Path) -> bool {
    Command::new("gio").args(["trash", "--"]).arg(p).status().is_ok_and(|s| s.success())
}

fn clean(only: Option<&str>) -> Result<(), String> {
    let mut failed = 0;
    let mut done = 0;
    for (h, files, _) in duplicate_groups()? {
        if only.is_some_and(|o| o != h) {
            continue;
        }
        for copy in &files[1..] {
            if trash(copy) { done += 1 } else { failed += 1 }
        }
    }
    match (done, failed) {
        (0, 0) => Err("Aucun doublon à supprimer.".into()),
        (_, 0) => Ok(()),
        (_, f) => Err(format!("{f} fichier(s) n'ont pas pu être mis à la corbeille.")),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");
    let result: Result<(), String> = match arg(1) {
        "" | "--reload" | "--quit" => {
            let status = match target_folder() {
                Ok(f) => json!({
                    "level": "ok",
                    "message": format!("Dossier analysé : {}", pretty(&f)),
                    "messageEn": format!("Analyzed folder: {}", pretty(&f)),
                }),
                Err(e) => json!({ "level": "warning", "message": e, "messageEn": e }),
            };
            let _ = fs::write(powernux_home().join("tools/file-organizer/status.json"), status.to_string());
            Ok(())
        }
        "--organize-plan" => organize_plan_json().map(|j| println!("{j}")),
        "--organize" => organize(Some(arg(2))),
        "--organize-all" => organize(None),
        "--undo" => undo(),
        "--duplicates-json" => duplicates_json().map(|j| println!("{j}")),
        "--clean" => clean(Some(arg(2))),
        "--clean-all" => clean(None),
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
