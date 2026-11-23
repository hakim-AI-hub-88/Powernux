// Extension GNOME Shell du module « AI Face Assistant » de Powernux.
//
// Un visage IA animé apparaît dans un notch en haut de l'écran pour expliquer une erreur :
//   « J'ai trouvé le problème. Le port 8080 est déjà utilisé par node (PID 4312). »
//
// Déclencheurs :
//   • Analyze()  — raccourci : analyse le texte sélectionné (ou le presse-papiers)
//   • Thinking() / Show() — appelés par le programme du module (surveillance des erreurs)
// L'appel à l'IA est fait par : powernux-ai-face --ask-file <fichier> <source>
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {NotchFrame, vbox} from './notch.js';

const OBJECT_PATH = '/org/powernux/AIFace';
const IFACE = `
<node>
  <interface name="org.powernux.AIFace">
    <method name="Analyze"/>
    <method name="Thinking">
      <arg type="s" direction="in" name="source"/>
    </method>
    <method name="Show">
      <arg type="s" direction="in" name="answer"/>
    </method>
    <method name="Hide"/>
  </interface>
</node>`;

const TOOL_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'powernux', 'tools', 'ai-face']);
const BINARY = GLib.build_filenamev([TOOL_DIR, 'powernux-ai-face']);
const SELECTION_FILE = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'powernux-ai-face-selection.txt']);
const DEFAULTS = {showSeconds: 12};
const WIDTH = 640;
const FACE_W = 190;
const FACE_H = 124;
const MAX_INPUT = 20000;

const nowMs = () => GLib.get_monotonic_time() / 1000;

function readSettings() {
    try {
        const [ok, bytes] = Gio.File.new_for_path(GLib.build_filenamev([TOOL_DIR, 'settings.json'])).load_contents(null);
        if (ok)
            return {...DEFAULTS, ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch (e) {
        // valeurs par défaut
    }
    return {...DEFAULTS};
}

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

/** Couleur du visage selon l'humeur. */
const MOODS = {
    thinking: [0.55, 0.49, 1.0],
    found: [0.0, 0.76, 1.0],
    info: [0.0, 0.76, 1.0],
    unsure: [1.0, 0.71, 0.28],
    error: [1.0, 0.42, 0.6],
};

/** Visage holographique dessiné au Cairo : yeux qui clignent, bouche qui parle, anneaux. */
class Face {
    constructor() {
        this.actor = new St.DrawingArea({width: FACE_W, height: FACE_H, x_align: Clutter.ActorAlign.CENTER});
        this.mood = 'thinking';
        this.speaking = false;
        this._blinkAt = nowMs() + 2500;
        this.actor.connect('repaint', a => this._paint(a));
    }

    _paint(area) {
        const cr = area.get_context();
        const t = nowMs();
        const [w, h] = area.get_surface_size();
        const cx = w / 2;
        const cy = h / 2 + 4;
        const [r, g, b] = MOODS[this.mood] ?? MOODS.found;

        // Halo
        for (let i = 5; i > 0; i--) {
            cr.setSourceRGBA(r, g, b, 0.018 * i);
            cr.arc(cx, cy, 30 + i * 9, 0, 2 * Math.PI);
            cr.fill();
        }
        // Anneaux en rotation
        cr.setLineWidth(1.4);
        for (let i = 0; i < 2; i++) {
            const radius = 50 + i * 9;
            const start = (t * (i ? -0.0011 : 0.0016)) % (2 * Math.PI);
            cr.setSourceRGBA(r, g, b, i ? 0.35 : 0.6);
            for (let k = 0; k < 3; k++) {
                cr.newSubPath();
                cr.arc(cx, cy, radius, start + k * 2.1, start + k * 2.1 + 1.1);
                cr.stroke();
            }
        }
        // Lignes de balayage (effet hologramme)
        cr.setLineWidth(1);
        for (let y = cy - 40; y < cy + 40; y += 5) {
            cr.setSourceRGBA(r, g, b, 0.05);
            cr.moveTo(cx - 40, y + ((t * 0.02) % 5));
            cr.lineTo(cx + 40, y + ((t * 0.02) % 5));
            cr.stroke();
        }

        // Clignement
        if (t > this._blinkAt + 140)
            this._blinkAt = t + 2200 + Math.random() * 2600;
        const blinking = t > this._blinkAt;
        const eyeH = blinking ? 2.5 : 17;
        // Regard : vers le haut en réfléchissant, léger balancement sinon.
        const lookX = this.mood === 'thinking' ? 4 * Math.sin(t * 0.004) : 2 * Math.sin(t * 0.0013);
        const lookY = this.mood === 'thinking' ? -5 : 0;

        for (const side of [-1, 1]) {
            const ex = cx + side * 21 + lookX;
            const ey = cy - 9 + lookY;
            for (let i = 3; i > 0; i--) {
                cr.setSourceRGBA(r, g, b, 0.08 * i);
                roundedRect(cr, ex - 6 - i * 2, ey - eyeH / 2 - i * 2, 12 + i * 4, eyeH + i * 4, 8);
                cr.fill();
            }
            cr.setSourceRGBA(0.85 + r * 0.15, 0.95, 1, 1);
            roundedRect(cr, ex - 6, ey - eyeH / 2, 12, eyeH, 6);
            cr.fill();
        }

        // Bouche
        cr.setLineWidth(3);
        cr.setLineCap(1); // ROUND
        cr.setSourceRGBA(0.85 + r * 0.15, 0.95, 1, 0.95);
        const my = cy + 16;
        if (this.speaking) {
            const open = 2 + 7 * Math.abs(Math.sin(t * 0.018) * Math.cos(t * 0.007));
            cr.save();
            cr.translate(cx, my);
            cr.scale(13, open);
            cr.arc(0, 0, 1, 0, 2 * Math.PI);
            cr.restore();
            cr.fill();
        } else if (this.mood === 'thinking') {
            cr.arc(cx + 2, my, 4, 0, 2 * Math.PI);
            cr.stroke();
            // Points qui tournent autour du visage
            for (let k = 0; k < 3; k++) {
                const a = t * 0.004 + k * 0.5;
                cr.setSourceRGBA(r, g, b, 0.9 - k * 0.25);
                cr.arc(cx + Math.cos(a) * 62, cy + Math.sin(a) * 50, 3, 0, 2 * Math.PI);
                cr.fill();
            }
        } else if (this.mood === 'unsure' || this.mood === 'error') {
            cr.moveTo(cx - 12, my + 2);
            cr.lineTo(cx + 12, my - 1);
            cr.stroke();
        } else {
            cr.arc(cx, my - 10, 15, 0.22 * Math.PI, 0.78 * Math.PI); // sourire ◡
            cr.stroke();
        }
        cr.$dispose();
    }
}

class FaceNotch {
    constructor() {
        this.frame = new NotchFrame({width: WIDTH, anchor: 'screen', reactive: true, styleClass: 'pnx-ai'});
        const column = vbox({style_class: 'pnx-ai-column', x_expand: true});
        const row = new St.BoxLayout({style_class: 'pnx-ai-row'});

        // Gauche : source de l'erreur
        const left = vbox({style_class: 'pnx-ai-side', y_align: Clutter.ActorAlign.CENTER});
        this.sourceTile = new St.Bin({style_class: 'pnx-ai-tile'});
        this.sourceIcon = new St.Icon({icon_name: 'dialog-error-symbolic', style_class: 'pnx-ai-tile-icon'});
        this.sourceTile.set_child(this.sourceIcon);
        this.source = new St.Label({style_class: 'pnx-ai-source'});
        this.when = new St.Label({style_class: 'pnx-ai-muted', text: "à l'instant"});
        left.add_child(this.sourceTile);
        left.add_child(this.source);
        left.add_child(this.when);

        // Centre : visage
        this.face = new Face();
        const center = vbox({x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        center.add_child(this.face.actor);
        this.name = new St.Label({style_class: 'pnx-ai-name', text: 'Powernux AI', x_align: Clutter.ActorAlign.CENTER});
        center.add_child(this.name);

        // Droite : actions
        const right = vbox({style_class: 'pnx-ai-side', y_align: Clutter.ActorAlign.CENTER});
        this.copyButton = this._button('edit-copy-symbolic', 'Copier la commande', () => this._copyFix());
        right.add_child(this.copyButton);
        right.add_child(this._button('window-close-symbolic', 'Fermer', () => this.hide()));

        row.add_child(left);
        row.add_child(center);
        row.add_child(right);

        this.caption = new St.Label({style_class: 'pnx-ai-caption', x_align: Clutter.ActorAlign.CENTER});
        this.caption.clutter_text.line_wrap = true;
        this.caption.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.caption.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.fix = new St.Label({style_class: 'pnx-ai-fix', x_align: Clutter.ActorAlign.CENTER, visible: false});
        this.fix.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;

        column.add_child(row);
        column.add_child(this.caption);
        column.add_child(this.fix);
        this.frame.panel.add_child(column);

        this._full = '';
        this._shown = 0;
        this._timer = 0;
        this._hideId = 0;
        this.frame.actor.connect('notify::hover', () => this._scheduleHide());
    }

    _button(icon, label, onClick) {
        const box = new St.BoxLayout({style_class: 'pnx-ai-button-box'});
        box.add_child(new St.Icon({icon_name: icon, style_class: 'pnx-ai-button-icon'}));
        box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'pnx-ai-button', child: box, can_focus: false});
        button.connect('clicked', onClick);
        return button;
    }

    _copyFix() {
        if (this._fixText) {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._fixText);
            this.copyButton.child.get_child_at_index(1).text = 'Copiée ✓';
        }
    }

    _start() {
        this.frame.show();
        if (!this._timer)
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => this._tick());
    }

    _tick() {
        // Effet machine à écrire, la bouche bouge pendant que le texte s'écrit.
        if (this._shown < this._full.length) {
            this._shown = Math.min(this._full.length, this._shown + 2);
            this.caption.text = this._full.slice(0, this._shown);
            this.face.speaking = true;
        } else {
            this.face.speaking = false;
        }
        this.face.actor.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    }

    thinking(source) {
        this._cancelHide();
        this.face.mood = 'thinking';
        this._setSource(source);
        this._full = 'Je regarde ça…';
        this._shown = 0;
        this._fixText = '';
        this.fix.visible = false;
        this.copyButton.visible = false;
        this._start();
    }

    show(answer) {
        this.face.mood = answer.mood || 'found';
        if (answer.source)
            this._setSource(answer.source);
        this._full = answer.summary || '';
        this._shown = 0;
        this._fixText = answer.fix || '';
        this.fix.text = this._fixText ? `$ ${this._fixText}` : '';
        this.fix.visible = Boolean(this._fixText);
        this.copyButton.visible = Boolean(this._fixText);
        this.copyButton.child.get_child_at_index(1).text = 'Copier la commande';
        this._start();
        this.frame.bounce();
        const seconds = Number(readSettings().showSeconds) || DEFAULTS.showSeconds;
        this._hideAfter = seconds * 1000 + this._full.length * 35;
        this._scheduleHide();
    }

    _setSource(source) {
        this.source.text = source || 'Sélection';
        const s = (source || '').toLowerCase();
        this.sourceIcon.icon_name = s.includes('docker') || s.includes('container')
            ? 'network-server-symbolic'
            : s.includes('sélection') ? 'edit-select-all-symbolic' : 'dialog-error-symbolic';
        this.when.text = new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
    }

    _cancelHide() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
    }

    _scheduleHide() {
        this._cancelHide();
        if (!this._hideAfter || this.frame.actor.hover || this.face.mood === 'thinking')
            return;
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._hideAfter, () => {
            this._hideId = 0;
            this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    hide() {
        this._cancelHide();
        this._hideAfter = 0;
        this.frame.hide(() => {
            if (this._timer)
                GLib.source_remove(this._timer);
            this._timer = 0;
        });
    }

    destroy() {
        this._cancelHide();
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this.frame.destroy();
    }
}

export default class PowernuxAIFace extends Extension {
    enable() {
        this._notch = new FaceNotch();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            Analyze: () => this._analyzeSelection(),
            Thinking: source => this._notch.thinking(source),
            Show: json => {
                try {
                    this._notch.show(JSON.parse(json));
                } catch (e) {
                    logError(e, 'Powernux AI Face: réponse invalide');
                }
            },
            Hide: () => this._notch.hide(),
        });
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
        this._notch?.destroy();
        this._notch = null;
    }

    /** Texte sélectionné (sélection primaire), sinon presse-papiers. */
    _analyzeSelection() {
        const clipboard = St.Clipboard.get_default();
        clipboard.get_text(St.ClipboardType.PRIMARY, (_c, primary) => {
            if (primary?.trim()) {
                this._ask(primary, 'Sélection');
                return;
            }
            clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c2, copied) => {
                if (copied?.trim())
                    this._ask(copied, 'Presse-papiers');
                else
                    this._notch.show({mood: 'info', source: 'Powernux AI',
                        summary: 'Sélectionnez un texte (par exemple une erreur dans le terminal), puis appuyez de nouveau sur le raccourci.'});
            });
        });
    }

    _ask(text, source) {
        this._notch.thinking(source);
        try {
            GLib.file_set_contents(SELECTION_FILE, text.slice(0, MAX_INPUT));
            const proc = Gio.Subprocess.new([BINARY, '--ask-file', SELECTION_FILE, source],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    if (p.get_successful())
                        this._notch?.show({...JSON.parse(stdout), source});
                    else
                        this._notch?.show({mood: 'error', source, summary: (stderr || '').trim() || 'Analyse impossible.'});
                } catch (e) {
                    this._notch?.show({mood: 'error', source, summary: e.message});
                }
            });
        } catch (e) {
            this._notch.show({mood: 'error', source, summary: 'Module introuvable : réinstallez AI Face Assistant depuis Powernux.'});
        }
    }
}
