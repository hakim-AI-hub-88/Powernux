//! Module Powernux « AI Face Assistant » — programme indépendant (sans fenêtre).
//!
//! L'extension GNOME Shell embarquée affiche le visage animé dans un notch. Ce programme :
//!   • analyse un texte d'erreur avec le fournisseur d'IA choisi (Groq, OpenAI, Gemini, Mistral,
//!     OpenRouter, Ollama local ou API personnalisée — toutes au format « chat completions »
//!     compatible OpenAI) et renvoie {summary, fix, mood}
//!   • ajoute des faits collectés sur le système (ex. processus qui occupe un port)
//!   • surveille le journal système (option) et fait apparaître le visage en cas d'erreur
//!
//! Protocole :
//!   (aucun) / --reload        installe/active l'extension, (re)lance la surveillance
//!   --analyze                 raccourci : analyse la sélection (via l'extension)
//!   --ask-file <f> <source>   analyse le texte du fichier, JSON sur la sortie standard
//!   --demo                    exemple avec une erreur Docker
//!   --watch                   (interne) surveillance du journal
//!   --quit / --uninstall      arrête la surveillance, désactive / supprime l'extension
use powernux_gnome_extension::{notify, powernux_home, Extension, RELOGIN, RELOGIN_EN};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, ExitCode, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

const EXT: Extension = Extension {
    tool_id: "ai-face",
    uuid: "powernux-ai-face@powernux",
    dbus_path: "/org/powernux/AIFace",
    dbus_iface: "org.powernux.AIFace",
    files: &[
        ("metadata.json", include_str!("../extension/metadata.json")),
        ("extension.js", include_str!("../extension/extension.js")),
        ("stylesheet.css", include_str!("../extension/stylesheet.css")),
        ("notch.js", include_str!("../../shared/notch/notch.js")),
    ],
};

/// (adresse « chat completions », modèle par défaut, réglage de la clé) par fournisseur.
fn provider_info(provider: &str) -> (&'static str, &'static str, &'static str) {
    match provider {
        "openai" => ("https://api.openai.com/v1/chat/completions", "gpt-4o-mini", "openaiApiKey"),
        "gemini" => ("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-2.5-flash", "geminiApiKey"),
        "mistral" => ("https://api.mistral.ai/v1/chat/completions", "mistral-small-latest", "mistralApiKey"),
        "openrouter" => ("https://openrouter.ai/api/v1/chat/completions", "meta-llama/llama-3.3-70b-instruct", "openrouterApiKey"),
        "ollama" => ("http://localhost:11434/v1/chat/completions", "llama3.2", ""),
        "custom" => ("", "", "customApiKey"),
        _ => ("https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile", "groqApiKey"),
    }
}

struct Endpoint {
    url: String,
    model: String,
    auth: Option<(&'static str, String)>,
    name: String,
}

/// Fournisseur configuré : adresse, modèle, authentification.
fn endpoint() -> Result<Endpoint, String> {
    let s = settings();
    let get = |k: &str| s[k].as_str().unwrap_or("").trim().to_string();
    let provider = if get("provider").is_empty() { "groq".to_string() } else { get("provider") };
    let (default_url, default_model, key_setting) = provider_info(&provider);
    let key = if key_setting.is_empty() { String::new() } else { get(key_setting) };

    let (url, mut model, auth_mode) = match provider.as_str() {
        "custom" => (get("customUrl"), get("customModel"), if get("customAuth").is_empty() { "bearer".into() } else { get("customAuth") }),
        "ollama" => (default_url.to_string(), get("ollamaModel"), "none".to_string()),
        _ => (default_url.to_string(), String::new(), "bearer".to_string()),
    };
    if url.is_empty() {
        return Err("Adresse de l'API manquante (mode développeur avancé).".into());
    }
    if !get("model").is_empty() {
        model = get("model");
    }
    if model.is_empty() {
        model = default_model.to_string();
    }
    if auth_mode != "none" && key.is_empty() {
        return Err("Ajoutez la clé API du fournisseur choisi dans les réglages du module.".into());
    }
    let auth = match auth_mode.as_str() {
        "none" => None,
        "raw" => Some(("authorization", key)),
        "x-api-key" => Some(("x-api-key", key)),
        _ => Some(("authorization", format!("Bearer {key}"))),
    };
    Ok(Endpoint { url, model, auth, name: provider })
}

const SYSTEM_PROMPT: &str = "Tu es Powernux AI, l'assistant Linux intégré au bureau de l'utilisateur (Ubuntu, GNOME). \
On te transmet un texte (le plus souvent un message d'erreur) et parfois des faits collectés sur le système. \
Identifie la cause la plus probable et la correction, en t'appuyant sur les faits fournis quand ils existent. \
Réponds en français, à la première personne, avec un ton naturel et bref, par exemple : \
« J'ai trouvé le problème. Le port 8080 est déjà utilisé par node (PID 4312). » \
summary : une ou deux phrases, 220 caractères au maximum, sans markdown. \
fix : une seule commande shell utile pour corriger, ou une chaîne vide si aucune commande sûre ne convient ; \
ne propose jamais de commande qui supprime des données. \
mood : « found » si la cause est claire, « unsure » si tu n'es pas certain, « info » si le texte n'est pas une erreur \
(explique-le alors simplement). \
Réponds uniquement avec un objet JSON de la forme {\"summary\": \"…\", \"fix\": \"…\", \"mood\": \"found\"}, sans texte autour.";

fn settings() -> Value {
    EXT.settings()
}

fn pid_path() -> PathBuf {
    powernux_home().join("data/ai-face/watch.pid")
}

fn gvariant_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

// ---------- Faits collectés sur le système ----------

/// Ports mentionnés dans un texte d'erreur de type « déjà utilisé ».
fn ports_in(text: &str) -> Vec<u16> {
    let lower = text.to_lowercase();
    if !["already in use", "already allocated", "address in use", "bind", "eaddrinuse", "port"]
        .iter()
        .any(|k| lower.contains(k))
    {
        return Vec::new();
    }
    let mut ports = Vec::new();
    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == ':' || (i >= 4 && text.chars().skip(i.saturating_sub(5)).take(5).collect::<String>().to_lowercase().contains("port")) {
            let digits: String = bytes[i + 1..].iter().skip_while(|c| **c == ' ').take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(p) = digits.parse::<u16>() {
                if p >= 20 && !ports.contains(&p) {
                    ports.push(p);
                }
            }
        }
        i += 1;
    }
    ports.truncate(3);
    ports
}

fn run_quiet(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).stderr(Stdio::null()).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !s.is_empty()).then_some(s)
}

/// Faits en lecture seule (aucune modification du système).
fn gather_facts(text: &str) -> String {
    let mut facts = Vec::new();
    for port in ports_in(text) {
        let filter = format!("sport = :{port}");
        match run_quiet("ss", &["-H", "-ltnp", &filter]) {
            Some(out) => facts.push(format!("Processus en écoute sur le port {port} (ss -ltnp) :\n{out}")),
            None => facts.push(format!("Aucun processus local visible en écoute sur le port {port} (ss -ltnp).")),
        }
        let publish = format!("publish={port}");
        if let Some(out) = run_quiet("docker", &["ps", "--filter", &publish, "--format", "{{.Names}} ({{.Image}}) {{.Ports}}"]) {
            facts.push(format!("Conteneurs Docker publiant le port {port} :\n{out}"));
        }
    }
    facts.join("\n\n")
}

// ---------- Appel au fournisseur d'IA ----------

/// Extrait {summary, fix, mood} de la réponse du modèle (tolère les blocs ```json).
fn parse_answer(content: &str) -> Value {
    let trimmed = content.trim();
    let json_part = match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(a), Some(b)) if b > a => &trimmed[a..=b],
        _ => trimmed,
    };
    let parsed: Value = serde_json::from_str(json_part).unwrap_or(Value::Null);
    let summary = parsed["summary"].as_str().map(str::to_string).unwrap_or_else(|| trimmed.chars().take(300).collect());
    let mood = match parsed["mood"].as_str() {
        Some(m @ ("found" | "unsure" | "info")) => m.to_string(),
        _ => "found".to_string(),
    };
    json!({ "summary": summary, "fix": parsed["fix"].as_str().unwrap_or(""), "mood": mood })
}

fn ask(text: &str) -> Result<Value, String> {
    let ep = endpoint()?;
    let facts = gather_facts(text);
    let mut content = format!("Texte à analyser :\n<texte>\n{text}\n</texte>");
    if !facts.is_empty() {
        content.push_str(&format!("\n\nFaits collectés sur le système :\n<faits>\n{facts}\n</faits>"));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .user_agent("Powernux-AIFace/1.1")
        .build()
        .map_err(|e| e.to_string())?;

    // Réponse JSON demandée ; si le fournisseur ne connaît pas « response_format », on réessaie sans.
    for json_mode in [true, false] {
        let mut body = json!({
            "model": ep.model,
            "temperature": 0.2,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": content }
            ]
        });
        if json_mode {
            body["response_format"] = json!({ "type": "json_object" });
        }
        let mut req = client.post(&ep.url).json(&body);
        if let Some((name, value)) = &ep.auth {
            req = req.header(*name, value.clone());
        }
        let resp = req.send().map_err(|e| {
            if e.is_timeout() {
                "L'IA ne répond pas (délai dépassé).".to_string()
            } else if ep.name == "ollama" {
                "Ollama ne répond pas : vérifiez qu'il est installé et lancé (ollama serve).".to_string()
            } else {
                "Pas de connexion au fournisseur d'IA.".to_string()
            }
        })?;
        let status = resp.status();
        let data: Value = resp.text().ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        // Message d'erreur : {"error": {"message"}} (OpenAI…) ou [{"error": {"message"}}] (Gemini).
        let detail = data
            .pointer("/error/message")
            .or_else(|| data.pointer("/0/error/message"))
            .or_else(|| data.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let bad_key = detail.to_lowercase().contains("api key");
        if status.as_u16() == 400 && json_mode && !bad_key {
            continue;
        }
        if !status.is_success() {
            return Err(match status.as_u16() {
                _ if bad_key => "Clé API invalide : vérifiez-la dans Powernux.".into(),
                401 | 403 => "Clé API invalide : vérifiez-la dans Powernux.".into(),
                404 => format!("Modèle ou adresse introuvable (404). {detail}").trim().to_string(),
                429 => "Limite du fournisseur atteinte : réessayez dans un instant.".into(),
                code => format!("Erreur du fournisseur ({code}) {detail}").trim().to_string(),
            });
        }
        let answer = data.pointer("/choices/0/message/content").and_then(Value::as_str).ok_or("Réponse vide de l'IA.")?;
        return Ok(parse_answer(answer));
    }
    Err("Le fournisseur a refusé la requête (400).".into())
}

/// Affiche une réponse dans le notch (ou une notification si l'extension n'est pas chargée).
fn show(answer: &Value, source: &str) {
    let mut a = answer.clone();
    a["source"] = json!(source);
    if EXT.dbus_call("Show", &[&gvariant_str(&a.to_string())]).is_err() {
        notify("dialog-information-symbolic", &format!("Powernux AI — {source}"), a["summary"].as_str().unwrap_or(""));
    }
}

fn analyze_and_show(text: &str, source: &str) {
    let _ = EXT.dbus_call("Thinking", &[&gvariant_str(source)]);
    match ask(text) {
        Ok(answer) => show(&answer, source),
        Err(e) => show(&json!({ "summary": e, "fix": "", "mood": "error" }), source),
    }
}

// ---------- Surveillance du journal ----------

fn watch_list() -> Vec<String> {
    settings()["watchList"]
        .as_str()
        .unwrap_or("docker, dockerd, containerd")
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Service concerné par une entrée du journal, s'il est surveillé.
fn watched_source(entry: &Value, list: &[String]) -> Option<String> {
    let ident = entry["SYSLOG_IDENTIFIER"].as_str().unwrap_or("").to_lowercase();
    let unit = entry["_SYSTEMD_UNIT"].as_str().or(entry["UNIT"].as_str()).unwrap_or("").to_lowercase();
    let unit_name = unit.trim_end_matches(".service").to_string();
    let message = entry["MESSAGE"].as_str().unwrap_or("").to_lowercase();
    for name in list {
        if ident == *name || unit_name == *name || (ident == "systemd" && message.contains(&format!("{name}."))) {
            return Some(name.clone());
        }
    }
    None
}

fn pretty_source(name: &str) -> String {
    match name {
        "docker" | "dockerd" => "Docker".into(),
        "containerd" => "containerd".into(),
        "postgresql" | "postgres" => "PostgreSQL".into(),
        other => {
            let mut c = other.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    }
}

fn watch() {
    let _ = fs::create_dir_all(pid_path().parent().unwrap());
    let _ = fs::write(pid_path(), std::process::id().to_string());
    let Ok(mut child) = Command::new("journalctl")
        .args(["-f", "-n", "0", "-o", "json", "-p", "warning"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel::<(String, String)>();
    std::thread::spawn(move || {
        let list = watch_list();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(entry) = serde_json::from_str::<Value>(&line) else { continue };
            let priority: u8 = entry["PRIORITY"].as_str().and_then(|p| p.parse().ok()).unwrap_or(6);
            let message = entry["MESSAGE"].as_str().unwrap_or("").to_string();
            let lower = message.to_lowercase();
            let failure = priority <= 3 || lower.contains("failed") || lower.contains("error");
            if let (true, Some(source)) = (failure, watched_source(&entry, &list)) {
                let _ = tx.send((source, message));
            }
        }
    });

    // Regroupe les lignes d'une même panne (2 s) et limite à une analyse / 2 min par service.
    let mut last: HashMap<String, Instant> = HashMap::new();
    while let Ok((source, first)) = rx.recv() {
        let mut lines = vec![first];
        let deadline = Instant::now() + Duration::from_secs(2);
        while let Ok((s, l)) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            if s == source && lines.len() < 30 {
                lines.push(l);
            }
        }
        if last.get(&source).is_some_and(|t| t.elapsed() < Duration::from_secs(120)) {
            continue;
        }
        last.insert(source.clone(), Instant::now());
        analyze_and_show(&lines.join("\n"), &pretty_source(&source));
    }
    let _ = child.kill();
}

fn stop_watch() {
    if let Ok(pid) = fs::read_to_string(pid_path()) {
        let pid = pid.trim();
        // Vérifie qu'il s'agit bien de notre processus avant de l'arrêter.
        let cmdline = fs::read_to_string(format!("/proc/{pid}/cmdline")).unwrap_or_default();
        if cmdline.contains("powernux-ai-face") && cmdline.contains("--watch") {
            let _ = Command::new("kill").arg(pid).status();
        }
        let _ = fs::remove_file(pid_path());
    }
}

fn start() {
    stop_watch();
    let active = match EXT.install_and_enable() {
        Ok(a) => a,
        Err(e) => {
            EXT.write_status("error", &e, &e);
            return;
        }
    };
    let s = settings();
    if s["watchErrors"].as_bool().unwrap_or(false) {
        if let Ok(exe) = std::env::current_exe() {
            let _ = Command::new(exe).arg("--watch").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
        }
    }
    if let Err(e) = endpoint() {
        let en = if e.contains("Adresse") {
            "Custom provider: enter the API address (advanced developer mode).".to_string()
        } else {
            "Add the API key of the selected AI provider in the settings below to enable the assistant.".to_string()
        };
        EXT.write_status("warning", &e, &en);
    } else if !active {
        EXT.write_status("warning", RELOGIN, RELOGIN_EN);
    } else {
        EXT.write_status(
            "ok",
            "Prêt : sélectionnez une erreur et appuyez sur Win + Shift + A.",
            "Ready: select an error and press Win + Shift + A.",
        );
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or("");
    match arg(1) {
        "" | "--reload" => start(),
        "--watch" => watch(),
        "--analyze" => {
            if EXT.dbus_call("Analyze", &[]).is_err() {
                notify("dialog-information-symbolic", "Powernux AI n'est pas encore actif", RELOGIN);
            }
        }
        "--ask-file" => {
            let text = fs::read_to_string(arg(2)).unwrap_or_default();
            let _ = fs::remove_file(arg(2));
            match ask(text.trim()) {
                Ok(answer) => println!("{answer}"),
                Err(e) => {
                    eprint!("{e}");
                    return ExitCode::FAILURE;
                }
            }
        }
        "--demo" => analyze_and_show(
            "docker: Error response from daemon: driver failed programming external connectivity on endpoint web \
             (3f2a…): Bind for 0.0.0.0:8080 failed: port is already allocated.",
            "Docker",
        ),
        "--quit" => {
            stop_watch();
            EXT.disable();
        }
        "--uninstall" => {
            stop_watch();
            EXT.uninstall();
        }
        other => {
            eprint!("Argument inconnu : {other}");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_ports() {
        assert_eq!(ports_in("Bind for 0.0.0.0:8080 failed: port is already allocated"), vec![8080]);
        assert_eq!(ports_in("Error: listen EADDRINUSE: address already in use :::3000"), vec![3000]);
        assert!(ports_in("Segmentation fault at 0x0").is_empty());
        let a = parse_answer("```json\n{\"summary\": \"Le port est pris.\", \"fix\": \"kill 12\", \"mood\": \"found\"}\n```");
        assert_eq!(a["summary"], "Le port est pris.");
        assert_eq!(a["fix"], "kill 12");
        let b = parse_answer("Réponse en texte simple");
        assert_eq!(b["summary"], "Réponse en texte simple");
        assert_eq!(b["mood"], "found");
        println!("faits port 1420 :\n{}", gather_facts("address already in use :1420"));
    }
}
