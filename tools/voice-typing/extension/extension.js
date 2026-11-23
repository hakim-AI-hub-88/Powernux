// Extension GNOME Shell du module « Voice Typing » de Powernux.
//
// Sous Wayland, seul GNOME Shell peut capter un raccourci maintenu, afficher une surcouche
// sans voler le focus et simuler un collage (Ctrl+V) dans l'application active.
//
//   Maintenir le raccourci → notch + enregistrement   Relâcher → transcription
//   Appui court            → mode mains libres (ré-appuyer pour terminer)
//   Fin                    → texte copié dans le presse-papiers + collé automatiquement
//
// La transcription (appel à l'API) est faite par le programme du module :
//   ~/.local/share/powernux/tools/voice-typing/powernux-voice-typing --transcribe <fichier.wav>
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {NotchFrame, vbox} from './notch.js';

const OBJECT_PATH = '/org/powernux/VoiceTyping';
const IFACE = `
<node>
  <interface name="org.powernux.VoiceTyping">
    <method name="Toggle"/>
    <method name="Status">
      <arg type="s" direction="out" name="state"/>
    </method>
  </interface>
</node>`;

const TOOL_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'powernux', 'tools', 'voice-typing']);
const BINARY = GLib.build_filenamev([TOOL_DIR, 'powernux-voice-typing']);
const RECORDING = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'powernux-voice-typing.wav']);

const DEFAULTS = {shortcut: '<Super>e', autoPaste: true, pasteKeys: 'ctrl-v'};
const BARS = 44;
const NOTCH_WIDTH = 560;
const HOLD_MS = 350;          // en dessous : appui court → mains libres
const MIN_RECORDING_MS = 500;
const MAX_RECORDING_S = 120;
const WAVES_HEIGHT = 30;

function loadSettings() {
    try {
        const file = Gio.File.new_for_path(GLib.build_filenamev([TOOL_DIR, 'settings.json']));
        const [ok, bytes] = file.load_contents(null);
        if (ok)
            return {...DEFAULTS, ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch (e) {
        // valeurs par défaut
    }
    return {...DEFAULTS};
}

/** Modificateurs du raccourci (pour détecter le relâchement). */
function modifierMask(accel) {
    let mask = 0;
    const s = accel.toLowerCase();
    if (s.includes('<super>'))
        mask |= Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;
    if (s.includes('<ctrl>') || s.includes('<control>') || s.includes('<primary>'))
        mask |= Clutter.ModifierType.CONTROL_MASK;
    if (s.includes('<alt>'))
        mask |= Clutter.ModifierType.MOD1_MASK;
    if (s.includes('<shift>'))
        mask |= Clutter.ModifierType.SHIFT_MASK;
    return mask;
}

function currentModifiers() {
    const [, , mods] = global.get_pointer();
    return mods;
}

const nowMs = () => GLib.get_monotonic_time() / 1000;

/** Raccourci lisible : "<Super>e" → "Win + E". */
function readableShortcut(accel) {
    const mods = [...accel.matchAll(/<([^>]+)>/g)].map(m => (m[1].toLowerCase() === 'super' ? 'Win' : m[1]));
    const key = accel.replace(/<[^>]+>/g, '');
    return [...mods, key.length === 1 ? key.toUpperCase() : key].join(' + ');
}

/** Couleur d'une barre de l'onde : dégradé orange → rose → violet → cyan. */
const WAVE_STOPS = [[255, 138, 76], [255, 79, 163], [139, 124, 255], [0, 194, 255]];
function waveColor(f) {
    const pos = f * (WAVE_STOPS.length - 1);
    const i = Math.min(WAVE_STOPS.length - 2, Math.floor(pos));
    const t = pos - i;
    const [a, b] = [WAVE_STOPS[i], WAVE_STOPS[i + 1]];
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Notch en haut de l'écran (style « dynamic island ») :
 *   [tuile icône]  Titre  [badge]                     ● REC
 *                  Sous-titre
 *                  ▁▃▅▇▅▃▁ onde colorée ▁▃▅▇▅▃▁
 *                  0:07  ━━━━━━━━──────────────  -1:53
 */
class Notch {
    constructor() {
        this.frame = new NotchFrame({width: NOTCH_WIDTH, anchor: 'screen'});
        this.actor = this.frame.actor;
        this.panel = this.frame.panel;
        // Tuile à gauche (comme une pochette d'album).
        this.tile = new St.Bin({style_class: 'pnx-tile', y_align: Clutter.ActorAlign.START});
        this.tileIcon = new St.Icon({icon_name: 'audio-input-microphone-symbolic', style_class: 'pnx-tile-icon'});
        this.tile.set_child(this.tileIcon);

        // Colonne principale.
        const column = vbox({style_class: 'pnx-column', x_expand: true});
        const titleRow = new St.BoxLayout({style_class: 'pnx-title-row'});
        this.title = new St.Label({style_class: 'pnx-title', text: 'Dictée en cours', y_align: Clutter.ActorAlign.CENTER});
        this.badge = new St.Label({style_class: 'pnx-badge', text: 'AUTO', y_align: Clutter.ActorAlign.CENTER});
        this.rec = new St.Label({style_class: 'pnx-rec', text: '● REC', x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        titleRow.add_child(this.title);
        titleRow.add_child(this.badge);
        titleRow.add_child(this.rec);
        this.subtitle = new St.Label({style_class: 'pnx-subtitle', text: ''});
        this.subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this.waves = new St.BoxLayout({style_class: 'pnx-waves', x_align: Clutter.ActorAlign.START});
        this.waves.set_height(WAVES_HEIGHT);
        this.bars = [];
        for (let i = 0; i < BARS; i++) {
            const bar = new St.Widget({style_class: 'pnx-bar', y_align: Clutter.ActorAlign.CENTER, height: 4});
            bar.style = `background-color: ${waveColor(i / (BARS - 1))};`;
            this.bars.push(bar);
            this.waves.add_child(bar);
        }

        const progressRow = new St.BoxLayout({style_class: 'pnx-progress-row'});
        this.elapsed = new St.Label({style_class: 'pnx-time', text: '0:00', y_align: Clutter.ActorAlign.CENTER});
        this.track = new St.Widget({style_class: 'pnx-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.fill = new St.Widget({style_class: 'pnx-fill'});
        this.track.add_child(this.fill);
        this.remaining = new St.Label({style_class: 'pnx-time', text: '', y_align: Clutter.ActorAlign.CENTER});
        progressRow.add_child(this.elapsed);
        progressRow.add_child(this.track);
        progressRow.add_child(this.remaining);
        this.progressRow = progressRow;

        column.add_child(titleRow);
        column.add_child(this.subtitle);
        column.add_child(this.waves);
        column.add_child(progressRow);
        this.panel.add_child(this.tile);
        this.panel.add_child(column);


        this.mode = 'recording';
        this.level = 0;
        this.shortcut = 'Win + E';
        this._smooth = 0;
        this._startedAt = 0;
        this._timer = 0;
    }

    /** Raccourci et langue affichés. */
    configure(settings) {
        this.shortcut = readableShortcut(settings.shortcut || DEFAULTS.shortcut);
        const lang = settings.language && settings.language !== 'auto' ? settings.language : 'auto';
        this.badge.text = lang.toUpperCase();
    }

    show() {
        this.frame.show();
        if (!this._timer)
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => this._tick());
    }

    hide() {
        this.frame.hide(() => {
            if (this._timer) {
                GLib.source_remove(this._timer);
                this._timer = 0;
            }
        });
    }

    /** mode : 'recording' | 'handsfree' | 'processing' | 'done' | 'error' ; detail : texte du sous-titre. */
    setMode(mode, detail = '') {
        const previous = this.mode;
        this.mode = mode;
        const recording = mode === 'recording' || mode === 'handsfree';
        if (recording && previous !== 'recording' && previous !== 'handsfree') {
            this._startedAt = nowMs();
            this._smooth = 0;
        }
        const content = {
            recording: ['Dictée en cours', `Parlez… relâchez ${this.shortcut} pour terminer`, 'audio-input-microphone-symbolic'],
            handsfree: ['Dictée mains libres', `Appuyez sur ${this.shortcut} pour terminer`, 'audio-input-microphone-symbolic'],
            processing: ['Transcription…', 'Conversion de votre voix en texte', 'content-loading-symbolic'],
            done: [detail.startsWith('«') ? 'Collé' : 'Copié', detail, 'object-select-symbolic'],
            error: ['Oups', detail, 'dialog-warning-symbolic'],
        }[mode];
        this.title.text = content[0];
        this.subtitle.text = mode === 'done' || mode === 'error' ? detail : content[1];
        this.tileIcon.icon_name = content[2];

        for (const c of ['done', 'error', 'processing'])
            this.tile.remove_style_class_name(c);
        if (['done', 'error', 'processing'].includes(mode))
            this.tile.add_style_class_name(mode);
        this.rec.visible = recording;
        this.waves.visible = recording || mode === 'processing';
        this.progressRow.visible = recording;
        this.title.remove_style_class_name('error');
        if (mode === 'error')
            this.title.add_style_class_name('error');
    }

    _tick() {
        const t = nowMs();
        const mid = (BARS - 1) / 2;
        if (this.mode === 'recording' || this.mode === 'handsfree') {
            this._smooth += (this.level - this._smooth) * 0.35;
            const ms = t - this._startedAt;
            const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            const secs = Math.floor(ms / 1000);
            this.elapsed.text = fmt(secs);
            this.remaining.text = `-${fmt(Math.max(0, MAX_RECORDING_S - secs))}`;
            this.fill.set_size(Math.round(this.track.width * Math.min(1, ms / (MAX_RECORDING_S * 1000))), this.track.height);
            this.rec.opacity = 140 + Math.round(115 * (0.5 + 0.5 * Math.sin(t * 0.006)));
            this.bars.forEach((bar, i) => {
                const center = 1 - (Math.abs(i - mid) / mid) * 0.55;
                const wobble = Math.abs(Math.sin(t * 0.011 + i * 0.75) * Math.cos(t * 0.006 + i * 1.3));
                const h = 3 + this._smooth * (WAVES_HEIGHT - 3) * center * (0.3 + 0.7 * wobble);
                bar.set_height(Math.round(Math.min(WAVES_HEIGHT, Math.max(3, h))));
                bar.opacity = 255;
            });
        } else if (this.mode === 'processing') {
            // Onde qui défile pendant la transcription.
            this.bars.forEach((bar, i) => {
                const wave = 0.5 + 0.5 * Math.sin(t * 0.009 - i * 0.35);
                bar.set_height(Math.round(3 + wave * 12));
                bar.opacity = 110 + Math.round(wave * 145);
            });
        }
        return GLib.SOURCE_CONTINUE;
    }

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this.frame.destroy();
    }
}

/** Enregistrement du micro (GStreamer) en WAV 16 kHz mono + niveau sonore. */
class Recorder {
    constructor(onLevel) {
        this._onLevel = onLevel;
        this._pipeline = null;
    }

    start(path) {
        this.cancel();
        try {
            GLib.unlink(path);
        } catch (e) {
            // pas de fichier précédent
        }
        this._pipeline = Gst.parse_launch(
            'autoaudiosrc ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! ' +
            'level interval=50000000 post-messages=true ! wavenc ! ' +
            `filesink location="${path}"`);
        const bus = this._pipeline.get_bus();
        bus.add_signal_watch();
        this._busId = bus.connect('message', (_bus, msg) => this._onMessage(msg));
        if (this._pipeline.set_state(Gst.State.PLAYING) === Gst.StateChangeReturn.FAILURE)
            throw new Error('Micro indisponible');
    }

    _onMessage(msg) {
        if (msg.type === Gst.MessageType.ELEMENT) {
            const s = msg.get_structure();
            if (s?.get_name() === 'level') {
                // « rms=(double){ -32.1 } » ou « rms=(GValueArray)< -32.1 > »
                const m = /rms=\([^)]*\)\s*[{<]\s*(-?[\d.]+(?:e[-+]?\d+)?|-inf)/i.exec(s.to_string());
                const db = m && m[1] !== '-inf' ? parseFloat(m[1]) : -100;
                this._onLevel(Math.min(1, Math.max(0, (db + 55) / 40)));
            }
        } else if (msg.type === Gst.MessageType.EOS) {
            this._eosResolve?.();
        } else if (msg.type === Gst.MessageType.ERROR) {
            const [err] = msg.parse_error();
            logError(err, 'Powernux Voice Typing: GStreamer');
            this._eosResolve?.();
        }
    }

    /** Termine proprement le fichier WAV (EOS), au plus 2 s. */
    stop() {
        if (!this._pipeline)
            return Promise.resolve();
        return new Promise(resolve => {
            let timeoutId = 0;
            this._eosResolve = () => {
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                this._eosResolve = null;
                this.cancel();
                resolve();
            };
            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                timeoutId = 0;
                this._eosResolve?.();
                return GLib.SOURCE_REMOVE;
            });
            this._pipeline.send_event(Gst.Event.new_eos());
        });
    }

    cancel() {
        if (!this._pipeline)
            return;
        const bus = this._pipeline.get_bus();
        if (this._busId)
            bus.disconnect(this._busId);
        bus.remove_signal_watch();
        this._busId = 0;
        this._pipeline.set_state(Gst.State.NULL);
        this._pipeline = null;
    }
}

export default class PowernuxVoiceTyping extends Extension {
    enable() {
        Gst.init(null);
        this._settings = loadSettings();
        this._state = 'idle';
        this._sources = new Set();
        this._notch = new Notch();
        this._notch.configure(this._settings);
        this._recorder = new Recorder(level => {
            this._notch.level = level;
        });
        this._keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

        this._grab();
        this._acceleratorId = global.display.connect('accelerator-activated', (_d, action) => {
            if (action === this._action)
                this._onShortcut();
        });

        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            Toggle: () => this._onShortcut(),
            Status: () => this._state,
        });
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);

        try {
            const file = Gio.File.new_for_path(GLib.build_filenamev([TOOL_DIR, 'settings.json']));
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => {
                const previous = this._settings.shortcut;
                this._settings = loadSettings();
                this._notch?.configure(this._settings);
                if (this._settings.shortcut !== previous) {
                    this._ungrab();
                    this._grab();
                }
            });
        } catch (e) {
            logError(e, 'Powernux Voice Typing: surveillance des réglages');
        }
    }

    disable() {
        this._monitor?.cancel();
        this._monitor = null;
        this._dbus?.unexport();
        this._dbus = null;
        if (this._acceleratorId)
            global.display.disconnect(this._acceleratorId);
        this._acceleratorId = 0;
        this._ungrab();
        this._sources.forEach(id => GLib.source_remove(id));
        this._sources.clear();
        this._recorder?.cancel();
        this._recorder = null;
        this._notch?.destroy();
        this._notch = null;
        this._keyboard = null;
    }

    // ---------- Raccourci ----------

    _grab() {
        const accel = this._settings.shortcut || DEFAULTS.shortcut;
        const flags = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT ?? Meta.KeyBindingFlags.NONE;
        const action = global.display.grab_accelerator(accel, flags);
        if (action === Meta.KeyBindingAction.NONE) {
            Main.notify('Powernux Voice Typing', `Le raccourci ${accel} est déjà utilisé : choisissez-en un autre dans Powernux.`);
            this._action = 0;
            return;
        }
        this._action = action;
        this._bindingName = Meta.external_binding_name_for_action(action);
        Main.wm.allowKeybinding(this._bindingName, Shell.ActionMode.ALL);
    }

    _ungrab() {
        if (!this._action)
            return;
        global.display.ungrab_accelerator(this._action);
        Main.wm.allowKeybinding(this._bindingName, Shell.ActionMode.NONE);
        this._action = 0;
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            const result = fn();
            if (result !== GLib.SOURCE_CONTINUE)
                this._sources.delete(id);
            return result;
        });
        this._sources.add(id);
        return id;
    }

    _clearSources() {
        this._sources.forEach(id => GLib.source_remove(id));
        this._sources.clear();
    }

    _onShortcut() {
        if (this._state === 'recording') {
            if (this._handsFree)
                this._finish();
            return; // répétition pendant l'appui long : ignorée
        }
        if (this._state === 'processing')
            return;
        this._startRecording();
    }

    // ---------- Enregistrement ----------

    _startRecording() {
        this._clearSources();
        try {
            this._recorder.start(RECORDING);
        } catch (e) {
            this._fail(e.message);
            return;
        }
        this._state = 'recording';
        this._handsFree = false;
        this._startedAt = nowMs();
        this._notch.setMode('recording');
        this._notch.show();

        const mask = modifierMask(this._settings.shortcut || DEFAULTS.shortcut);
        if (mask === 0) {
            this._setHandsFree();
        } else {
            // Relâchement du raccourci = fin de la dictée (ou mains libres si appui court).
            this._later(30, () => {
                if (this._state !== 'recording')
                    return GLib.SOURCE_REMOVE;
                if ((currentModifiers() & mask) !== 0)
                    return GLib.SOURCE_CONTINUE;
                if (nowMs() - this._startedAt < HOLD_MS)
                    this._setHandsFree();
                else
                    this._finish();
                return GLib.SOURCE_REMOVE;
            });
        }
        this._later(MAX_RECORDING_S * 1000, () => {
            this._finish();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setHandsFree() {
        this._handsFree = true;
        this._notch.setMode('handsfree');
    }

    async _finish() {
        if (this._state !== 'recording')
            return;
        this._state = 'processing';
        this._clearSources();
        const duration = nowMs() - this._startedAt;
        this._notch.setMode('processing');
        await this._recorder.stop();
        if (duration < MIN_RECORDING_MS) {
            this._fail('Trop court : maintenez le raccourci en parlant.');
            return;
        }
        this._transcribe();
    }

    _transcribe() {
        let proc;
        try {
            proc = Gio.Subprocess.new([BINARY, '--transcribe', RECORDING],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            this._fail('Module Voice Typing introuvable : réinstallez-le depuis Powernux.');
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            if (this._state !== 'processing')
                return;
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                const text = (stdout ?? '').trim();
                if (p.get_successful() && text)
                    this._deliver(text);
                else if (p.get_successful())
                    this._fail('Aucune parole détectée.');
                else
                    this._fail((stderr ?? '').trim() || 'Transcription impossible.');
            } catch (e) {
                this._fail(e.message);
            }
        });
    }

    // ---------- Résultat ----------

    _deliver(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        const paste = this._settings.autoPaste;
        const preview = text.length > 70 ? `${text.slice(0, 67)}…` : text;
        // « … » = collé ; sans guillemets = seulement copié.
        this._notch.setMode('done', paste ? `« ${preview} »` : `${preview} — copié dans le presse-papiers`);
        if (paste)
            this._pasteWhenReleased(Date.now());
        this._state = 'idle';
        this._later(1800, () => {
            this._notch.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Attend que les touches soient relâchées (sinon Super+Ctrl+V…), puis colle. */
    _pasteWhenReleased(since) {
        this._later(120, () => {
            const busy = currentModifiers() & (Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK |
                Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SHIFT_MASK);
            if (busy && Date.now() - since < 1500)
                return GLib.SOURCE_CONTINUE;
            this._sendPaste();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendPaste() {
        const keys = this._settings.pasteKeys === 'ctrl-shift-v'
            ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
            : [Clutter.KEY_Control_L, Clutter.KEY_v];
        const t = GLib.get_monotonic_time();
        keys.forEach(k => this._keyboard.notify_keyval(t, k, Clutter.KeyState.PRESSED));
        [...keys].reverse().forEach(k => this._keyboard.notify_keyval(t, k, Clutter.KeyState.RELEASED));
    }

    _fail(message) {
        this._recorder?.cancel();
        this._state = 'idle';
        this._notch.setMode('error', message);
        this._notch.show();
        this._later(3500, () => {
            this._notch.hide();
            return GLib.SOURCE_REMOVE;
        });
    }
}
