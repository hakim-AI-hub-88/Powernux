//! Module Powernux « Voice Typing » — dictée vocale (programme indépendant, sans fenêtre).
//!
//! L'extension GNOME Shell embarquée gère le raccourci maintenu, le notch animé,
//! l'enregistrement du micro et le collage automatique. Ce programme l'installe et
//! se charge de la transcription (appel à l'API de reconnaissance vocale).
//!
//! Protocole :
//!   (aucun)                 installe/active l'extension, écrit status.json
//!   --transcribe <wav>      envoie l'audio à l'API, écrit le texte sur la sortie standard
//!   --reload                met à jour status.json (ex. clé API ajoutée)
//!   --quit / --uninstall    désactive / supprime l'extension
use powernux_gnome_extension::{Extension, RELOGIN, RELOGIN_EN};
use serde_json::Value;
use std::{fs, path::Path, process::ExitCode, time::Duration};

const EXT: Extension = Extension {
    tool_id: "voice-typing",
    uuid: "powernux-voice-typing@powernux",
    dbus_path: "/org/powernux/VoiceTyping",
    dbus_iface: "org.powernux.VoiceTyping",
    files: &[
        ("metadata.json", include_str!("../extension/metadata.json")),
        ("extension.js", include_str!("../extension/extension.js")),
        ("stylesheet.css", include_str!("../extension/stylesheet.css")),
        ("notch.js", include_str!("../../shared/notch/notch.js")),
    ],
};

fn setting<'a>(settings: &'a Value, key: &str) -> &'a str {
    settings.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Raccourci lisible : "<Super>e" → "Win + E".
fn readable(accel: &str) -> String {
    let mut parts = Vec::new();
    let mut rest = accel;
    while let (Some(a), Some(b)) = (rest.find('<'), rest.find('>')) {
        parts.push(match &rest[a + 1..b] {
            "Super" => "Win".to_string(),
            m => m.to_string(),
        });
        rest = &rest[b + 1..];
    }
    parts.push(rest.to_uppercase());
    parts.join(" + ")
}

/// Fournisseur choisi et sa clé (« apiKey » sert aussi d'ancienne clé commune).
fn provider_key(settings: &Value) -> (String, String) {
    let provider = setting(settings, "provider").to_string();
    let provider = if provider.is_empty() { "groq".to_string() } else { provider };
    let legacy = setting(settings, "apiKey").trim().to_string();
    let key = match provider.as_str() {
        "openai" => setting(settings, "openaiApiKey").trim().to_string(),
        "assemblyai" => setting(settings, "assemblyaiApiKey").trim().to_string(),
        "custom" => setting(settings, "customApiKey").trim().to_string(),
        _ => legacy.clone(),
    };
    // Compatibilité : avant la version 1.2, une seule clé servait à Groq et OpenAI.
    let key = if key.is_empty() && provider == "openai" { legacy } else { key };
    (provider, key)
}

fn update_status(active: bool) {
    let settings = EXT.settings();
    let (provider, key) = provider_key(&settings);
    let needs_key = !(provider == "custom" && setting(&settings, "customAuth") == "none");
    if provider == "custom" && setting(&settings, "customUrl").trim().is_empty() {
        EXT.write_status(
            "warning",
            "Fournisseur personnalisé : indiquez l'adresse de l'API (mode développeur avancé).",
            "Custom provider: enter the API address (advanced developer mode).",
        );
    } else if needs_key && key.is_empty() {
        EXT.write_status(
            "warning",
            "Ajoutez la clé API du service choisi dans les réglages ci-dessous pour activer la dictée.",
            "Add the API key of the selected service in the settings below to enable dictation.",
        );
    } else if !active {
        EXT.write_status("warning", RELOGIN, RELOGIN_EN);
    } else {
        let shortcut = readable(setting(&settings, "shortcut"));
        EXT.write_status(
            "ok",
            &format!("Prêt : maintenez {shortcut}, parlez, puis relâchez."),
            &format!("Ready: hold {shortcut}, speak, then release."),
        );
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("Powernux-VoiceTyping/1.2")
        .build()
        .map_err(|e| e.to_string())
}

fn network_error(e: reqwest::Error) -> String {
    if e.is_timeout() { "Le service ne répond pas (délai dépassé).".into() } else { "Pas de connexion au service de transcription.".into() }
}

/// Lit la réponse JSON et traduit les erreurs HTTP en messages clairs.
fn read_json(resp: reqwest::blocking::Response) -> Result<Value, String> {
    let status = resp.status();
    let body: Value = resp.text().ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body);
    }
    let detail = body
        .pointer("/error/message")
        .or_else(|| body.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("");
    Err(match status.as_u16() {
        401 | 403 => "Clé API invalide : vérifiez-la dans Powernux.".to_string(),
        404 => format!("Adresse de l'API introuvable (404). {detail}").trim().to_string(),
        429 => "Limite du service atteinte : réessayez dans un instant.".to_string(),
        code => format!("Erreur du service ({code}) {detail}").trim().to_string(),
    })
}

/// En-tête d'authentification : (nom, valeur), ou None.
fn auth_header(mode: &str, key: &str) -> Option<(&'static str, String)> {
    match mode {
        "none" => None,
        "raw" => Some(("authorization", key.to_string())),
        "x-api-key" => Some(("x-api-key", key.to_string())),
        _ => Some(("authorization", format!("Bearer {key}"))),
    }
}

/// API compatible OpenAI : POST multipart (file, model, language).
fn transcribe_openai_like(url: &str, model: &str, auth: Option<(&str, String)>, language: &str, audio: Vec<u8>) -> Result<String, String> {
    let file = reqwest::blocking::multipart::Part::bytes(audio)
        .file_name("dictation.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::blocking::multipart::Form::new().part("file", file).text("response_format", "json");
    if !model.is_empty() {
        form = form.text("model", model.to_string());
    }
    if !language.is_empty() && language != "auto" {
        form = form.text("language", language.to_string());
    }
    let mut req = client()?.post(url).multipart(form);
    if let Some((name, value)) = auth {
        req = req.header(name, value);
    }
    let body = read_json(req.send().map_err(network_error)?)?;
    Ok(body.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string())
}

/// API AssemblyAI : envoi du fichier (/v2/upload), création de la transcription
/// (/v2/transcript), puis interrogation jusqu'à « completed ».
fn transcribe_assemblyai(base: &str, model: &str, auth: Option<(&str, String)>, language: &str, audio: Vec<u8>) -> Result<String, String> {
    let base = base.trim_end_matches('/');
    let http = client()?;
    let with_auth = |req: reqwest::blocking::RequestBuilder| match &auth {
        Some((name, value)) => req.header(*name, value.clone()),
        None => req,
    };

    let upload = read_json(
        with_auth(http.post(format!("{base}/v2/upload")))
            .header("content-type", "application/octet-stream")
            .body(audio)
            .send()
            .map_err(network_error)?,
    )?;
    let audio_url = upload["upload_url"].as_str().ok_or("Envoi de l'audio impossible.")?;

    let mut request = serde_json::json!({ "audio_url": audio_url });
    if language.is_empty() || language == "auto" {
        request["language_detection"] = Value::Bool(true);
    } else {
        request["language_code"] = Value::String(language.to_string());
    }
    if !model.is_empty() {
        request["speech_model"] = Value::String(model.to_string());
    }
    let created = read_json(
        with_auth(http.post(format!("{base}/v2/transcript")))
            .header("content-type", "application/json")
            .body(request.to_string())
            .send()
            .map_err(network_error)?,
    )?;
    let id = created["id"].as_str().ok_or("Transcription impossible à créer.")?.to_string();

    // Dictée courte : on interroge souvent (toutes les 700 ms), au plus 90 s.
    let deadline = std::time::Instant::now() + Duration::from_secs(90);
    loop {
        let transcript = read_json(with_auth(http.get(format!("{base}/v2/transcript/{id}"))).send().map_err(network_error)?)?;
        match transcript["status"].as_str() {
            Some("completed") => return Ok(transcript["text"].as_str().unwrap_or("").trim().to_string()),
            Some("error") => {
                return Err(format!("Échec de la transcription : {}", transcript["error"].as_str().unwrap_or("erreur inconnue")));
            }
            _ if std::time::Instant::now() > deadline => return Err("Le service ne répond pas (délai dépassé).".into()),
            _ => std::thread::sleep(Duration::from_millis(700)),
        }
    }
}

/// Envoie le fichier audio au service choisi et renvoie le texte.
fn transcribe(path: &Path) -> Result<String, String> {
    let settings = EXT.settings();
    let (provider, key) = provider_key(&settings);
    let language = setting(&settings, "language").to_string();
    let custom_auth = setting(&settings, "customAuth");
    if key.is_empty() && !(provider == "custom" && custom_auth == "none") {
        return Err("Clé API manquante : ajoutez-la dans Powernux.".into());
    }
    let audio = fs::read(path).map_err(|_| "Enregistrement introuvable.".to_string())?;
    let bearer = auth_header("bearer", &key);

    match provider.as_str() {
        "openai" => transcribe_openai_like(
            "https://api.openai.com/v1/audio/transcriptions",
            "gpt-4o-mini-transcribe",
            bearer,
            &language,
            audio,
        ),
        "assemblyai" => transcribe_assemblyai("https://api.assemblyai.com", "", auth_header("raw", &key), &language, audio),
        "custom" => {
            let url = setting(&settings, "customUrl").trim();
            if url.is_empty() {
                return Err("Adresse de l'API manquante (mode développeur avancé).".into());
            }
            let model = setting(&settings, "customModel").trim();
            let auth = auth_header(if custom_auth.is_empty() { "bearer" } else { custom_auth }, &key);
            if setting(&settings, "customFormat") == "assemblyai" {
                transcribe_assemblyai(url, model, auth, &language, audio)
            } else {
                transcribe_openai_like(url, model, auth, &language, audio)
            }
        }
        _ => transcribe_openai_like(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            "whisper-large-v3-turbo",
            bearer,
            &language,
            audio,
        ),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        None => match EXT.install_and_enable() {
            Ok(active) => update_status(active),
            Err(e) => EXT.write_status("error", &e, &e),
        },
        Some("--transcribe") => {
            let Some(path) = args.get(2) else {
                eprintln!("Usage : --transcribe <fichier.wav>");
                return ExitCode::FAILURE;
            };
            let result = transcribe(Path::new(path));
            // L'enregistrement n'est pas conservé.
            let _ = fs::remove_file(path);
            match result {
                Ok(text) => print!("{text}"),
                Err(e) => {
                    eprint!("{e}");
                    return ExitCode::FAILURE;
                }
            }
        }
        Some("--reload") => update_status(EXT.is_active()),
        Some("--quit") => EXT.disable(),
        Some("--uninstall") => EXT.uninstall(),
        Some(other) => eprintln!("Argument inconnu : {other}"),
    }
    ExitCode::SUCCESS
}
