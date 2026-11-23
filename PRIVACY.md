# Privacy / Vie privée

*[Français ci-dessous](#français)*

Powernux has **no account, no analytics and no telemetry**. Your data stays on your computer,
except in the cases listed below — each one depends on a tool you chose to install and configure.

| What | Where it goes | When |
|---|---|---|
| Tool catalog and tool downloads | **GitHub** (github.com, raw.githubusercontent.com) — your IP address is visible to GitHub | When you open the Tools Manager or install / update a tool |
| Update check | **GitHub API** — your IP address is visible to GitHub | When Powernux starts |
| **Voice Typing**: your voice recording | The transcription service **you selected** (Groq, OpenAI, AssemblyAI or your own server) | Only while you hold the shortcut. The recording is deleted right after transcription |
| **AI Face Assistant**: the text you analyze | The AI provider **you selected** (Groq, OpenAI, Google Gemini, Mistral, OpenRouter, your own server — or **Ollama, which stays on your computer**) | When you press the shortcut on a selection, or — only if you turned it on — when a watched service fails (its error lines are sent) |
| **Clipboard Manager**: your copy history | **Nowhere.** Stored only on this computer | — |
| Notes, workspaces, focus statistics, settings | **Nowhere.** Stored only on this computer | — |

**What is stored on your computer**
- Preferences: `~/.config/powernux/preferences.json`
- Tools and their data: `~/.local/share/powernux/`
- API keys: in the **GNOME Keyring** (encrypted), never in plain text files when the keyring is available.
- Clipboard Manager ignores content marked as secret by password managers (KeePassXC, etc.) and can clear its history automatically.

**Remove everything**: Settings → *Uninstall everything* deletes all tools, their data, keyboard shortcuts,
GNOME extensions, stored keys and startup entries. Then run `sudo apt remove powernux`.

The services you connect to (Groq, OpenAI, AssemblyAI, Google, Mistral, OpenRouter, GitHub) have their own
privacy policies.

---

## Français

Powernux n'a **ni compte, ni statistiques d'utilisation, ni télémétrie**. Vos données restent sur votre
ordinateur, sauf dans les cas ci-dessous — chacun dépend d'un outil que vous avez choisi d'installer et de configurer.

| Quoi | Où ça part | Quand |
|---|---|---|
| Catalogue et téléchargement des outils | **GitHub** — votre adresse IP est visible par GitHub | À l'ouverture du gestionnaire d'outils, à l'installation ou la mise à jour d'un outil |
| Recherche de mise à jour | **API GitHub** — votre adresse IP est visible par GitHub | Au démarrage de Powernux |
| **Voice Typing** : l'enregistrement de votre voix | Le service de transcription **que vous avez choisi** (Groq, OpenAI, AssemblyAI ou votre serveur) | Seulement pendant que vous maintenez le raccourci. L'enregistrement est supprimé juste après |
| **AI Face Assistant** : le texte analysé | Le fournisseur d'IA **que vous avez choisi** (Groq, OpenAI, Google Gemini, Mistral, OpenRouter, votre serveur — ou **Ollama, qui reste sur votre ordinateur**) | Quand vous appuyez sur le raccourci, ou — seulement si vous l'avez activé — quand un service surveillé échoue |
| **Clipboard Manager** : l'historique | **Nulle part.** Uniquement sur cet ordinateur | — |
| Notes, espaces de travail, statistiques de concentration, réglages | **Nulle part.** Uniquement sur cet ordinateur | — |

**Ce qui est stocké sur votre ordinateur**
- Préférences : `~/.config/powernux/preferences.json`
- Outils et leurs données : `~/.local/share/powernux/`
- Clés API : dans le **trousseau GNOME** (chiffré), jamais dans des fichiers en clair quand le trousseau est disponible.
- Clipboard Manager ignore les contenus marqués « secret » par les gestionnaires de mots de passe (KeePassXC…) et peut effacer son historique automatiquement.

**Tout supprimer** : Paramètres → *Tout désinstaller* supprime les outils, leurs données, les raccourcis clavier,
les extensions GNOME, les clés enregistrées et le démarrage automatique. Ensuite : `sudo apt remove powernux`.

Les services auxquels vous vous connectez (Groq, OpenAI, AssemblyAI, Google, Mistral, OpenRouter, GitHub) ont leurs
propres politiques de confidentialité.
