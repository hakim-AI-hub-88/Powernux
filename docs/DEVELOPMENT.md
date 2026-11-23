# Powernux — Guide développeur

Le centre de contrôle des outils de productivité pour Linux : une plateforme modulaire où chaque outil s'installe et s'active à la demande.

## Application principale

Tauri 2 + React + TypeScript :

- **Dashboard** — vue d'ensemble, accès rapide, feuille de route
- **Tools Manager** — catalogue des outils : Download, Remove, ON / OFF
- **Settings** — thème, couleur d'accent, barre latérale compacte (stockés localement)
- **About** — présentation du projet, développeur, liens

## Architecture des modules (Plugin System)

Powernux Core ne contient aucun outil. Chaque outil est un **programme indépendant**,
publié dans un catalogue (`registry/registry.json`) et installé à la demande.

```
                       Powernux Core
                            |
   ---------------------------------------------------
   |                |                |               |
Clipboard      Smart Window    Voice Typing      AI Assistant
Manager        Manager         (dictée)          (bientôt)
```

- **Download** : télécharge l'archive → vérifie le SHA-256 → installe dans
  `~/.local/share/powernux/tools/<id>/` → active.
- **Remove** : arrête le module, supprime ses raccourcis, ses fichiers et ses données.
- **ON / OFF** : démarre / arrête le module et ses raccourcis globaux (GNOME).

Chaque module contient un `manifest.json` (réglages, raccourcis, actions, hooks) : Powernux
génère automatiquement sa page de réglages. Protocole d'un module : `--reload`, `--quit`,
les arguments de ses actions (ex. `--show`), ses `collections` (listes gérées par le module,
ex. espaces de travail) et `hooks.uninstall` (appelé lors de « Remove »).
Types de réglages : `toggle`, `select`, `shortcut`, `text`, `secret` (clé API, fichiers en 0600).
Formulaires de collection (`create.fields`) : `text`, `number`, `toggle`, `select`, `apps` (applications installées), avec `showIf`.
Un module peut écrire `tools/<id>/status.json` (`{level, message}`) pour informer l'utilisateur.

| Module | Type | Rôle |
|---|---|---|
| `tools/clipboard` | Tauri (fenêtre) | Historique du presse-papiers (`Super+Shift+V`) |
| `tools/window-pin` | Rust + extension GNOME Shell | Smart Window Manager : Always On Top (`Win+Shift+T`), organisation auto (`Win+Shift+O`), espaces de travail |
| `tools/voice-typing` | Rust + extension GNOME Shell | Dictée vocale (`Win+E` maintenu) : notch animé, transcription, collage auto |
| `tools/ai-face` | Rust + extension GNOME Shell | Visage IA animé (notch) qui explique les erreurs (Groq, OpenAI, Gemini, Mistral, OpenRouter, Ollama) (`Win+Shift+A` sur une sélection, surveillance du journal) |
| `tools/focus-mode` | Rust + extension GNOME Shell | Modes de concentration et Pomodoro, notch sous la barre du haut (`Win+Shift+F` pause) |
| `tools/screenshot` | Rust | Capture d'écran GNOME sur `Win+Shift+S` |
| `tools/projects` | Rust | Project Dashboard : projets, technologies, VS Code / terminal / lancement |
| `tools/file-organizer` | Rust | Rangement de dossier par type + doublons (corbeille, annulation) |
| `tools/shared/notch` | JavaScript | Cadre « notch » commun aux extensions GNOME Shell |
| `tools/shared/gnome-extension` | bibliothèque Rust | Code commun des modules à extension GNOME Shell |

### Démarrage à l'ouverture de session

Quand au moins un outil est actif, Powernux crée `~/.config/autostart/powernux-tools.desktop`,
qui lance `powernux --autostart` : ce mode démarre uniquement les outils actifs, sans fenêtre ni
moteur web, puis se termine (~0,5 s). L'application complète ne s'ouvre que pour gérer les outils.
Option : Settings → Démarrage.

### Créer / publier un module

```bash
npm run package:clipboard     # compile tools/clipboard, crée l'archive, met à jour registry.json
npm run package:window-pin
npm run package:voice-typing
```

En développement, Powernux lit le registre local `registry/registry.json`.
En production, l'adresse du registre GitHub se règle dans `src-tauri/src/tools/mod.rs`
(`RELEASE_REGISTRY`) ou dans Settings → Source des outils.

## Lancer

```bash
npm install
npm run tauri dev
```

## Structure

```
src/
├── App.tsx              navigation entre les pages
├── components/          Sidebar, icônes
├── pages/               Dashboard, ToolsManager, Settings, About
├── data/app.ts          infos de l'app
├── lib/api.ts           appels au backend (système de modules)
└── state/               préférences de l'interface, état des outils
src-tauri/src/tools/     système de modules : registre, installation, activation
tools/clipboard/         module Clipboard Manager (programme indépendant)
tools/window-pin/        module Smart Window Manager (programme + extension GNOME Shell)
tools/voice-typing/      module Voice Typing (programme + extension GNOME Shell)
tools/shared/            code partagé entre modules
registry/                catalogue des outils + archives (packages/)
```

## Vie privée et sécurité

- **Vie privée** : ce qui reste sur l'ordinateur et ce qui part vers un service → [PRIVACY.md](PRIVACY.md)
- **Sécurité** : outils signés (Ed25519), CSP stricte, clés API dans le trousseau GNOME → [SECURITY.md](SECURITY.md)
- **Licence** : [MIT](LICENSE) · composants tiers : [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

### Publier un outil (mainteneur)

Les archives sont signées par `tools/signer` (`powernux-sign`). La clé privée est dans
`~/.config/powernux-signing/tools.key` (ou la variable `POWERNUX_SIGNING_KEY` en CI) et ne doit
jamais être ajoutée au dépôt. `npm run package:<outil>` compile, signe et met à jour le catalogue.
