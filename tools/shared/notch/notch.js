// Cadre « notch » partagé par les extensions GNOME Shell de Powernux
// (Voice Typing, Focus Mode…) : panneau noir attaché en haut de l'écran
// ou sous la barre du haut, avec des coins concaves (« oreilles »).
//
// Copié dans chaque extension sous le nom notch.js (voir tools/shared/notch).
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const EAR = 16;

/** Coin concave qui raccorde le notch au bord du haut. */
function makeEar(side) {
    const area = new St.DrawingArea({width: EAR, height: EAR, reactive: false});
    area.connect('repaint', a => {
        const cr = a.get_context();
        cr.setSourceRGBA(0, 0, 0, 1);
        if (side === 'left') {
            cr.moveTo(0, 0);
            cr.lineTo(EAR, 0);
            cr.lineTo(EAR, EAR);
            cr.arcNegative(0, EAR, EAR, 0, -Math.PI / 2);
        } else {
            cr.moveTo(EAR, 0);
            cr.lineTo(0, 0);
            cr.lineTo(0, EAR);
            cr.arc(EAR, EAR, EAR, Math.PI, 1.5 * Math.PI);
        }
        cr.closePath();
        cr.fill();
        cr.$dispose();
    });
    return area;
}

/** BoxLayout vertical compatible GNOME 45 → 50 (« vertical » remplacé par « orientation »). */
export function vbox(params = {}) {
    const box = new St.BoxLayout(params);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

/**
 * Cadre du notch. Remplir `frame.panel` (St.BoxLayout) puis appeler show()/hide().
 *   anchor : 'screen' (bord haut de l'écran) ou 'panel' (sous la barre du haut)
 */
export class NotchFrame {
    constructor({width, anchor = 'screen', reactive = false, styleClass = 'pnx-notch'}) {
        this.width = width;
        this.anchor = anchor;
        this.actor = new St.Widget({reactive, visible: false, track_hover: reactive});
        this.leftEar = makeEar('left');
        this.rightEar = makeEar('right');
        this.panel = new St.BoxLayout({style_class: styleClass, width, reactive});
        this.actor.add_child(this.leftEar);
        this.actor.add_child(this.panel);
        this.actor.add_child(this.rightEar);
        Main.layoutManager.uiGroup.add_child(this.actor);
        this.panel.connect('notify::height', () => this.place());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this.place());
    }

    setWidth(width) {
        this.width = width;
        this.panel.set_width(width);
        this.place();
    }

    place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const top = this.anchor === 'panel' && Main.panel.visible ? Main.panel.height : 0;
        this.leftEar.set_position(0, 0);
        this.panel.set_position(EAR, 0);
        this.rightEar.set_position(EAR + this.width, 0);
        const total = this.width + 2 * EAR;
        this.actor.set_size(total, this.panel.height);
        this.actor.set_position(m.x + Math.floor((m.width - total) / 2), m.y + top);
        this.actor.set_pivot_point(0.5, 0);
    }

    get visible() {
        return this.actor.visible;
    }

    /** Apparition : le notch « s'ouvre » depuis le haut. */
    show() {
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        if (this.actor.visible)
            return;
        this.actor.remove_all_transitions();
        this.actor.show();
        this.place();
        this.actor.opacity = 0;
        this.actor.scale_x = 0.55;
        this.actor.scale_y = 0.35;
        this.actor.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    hide(onHidden = null) {
        this.actor.ease({
            opacity: 0,
            scale_x: 0.55,
            scale_y: 0.35,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.actor.hide();
                onHidden?.();
            },
        });
    }

    /** Petite animation de « respiration » lors d'un changement de taille. */
    bounce() {
        this.actor.remove_all_transitions();
        this.actor.scale_x = 0.96;
        this.actor.scale_y = 0.9;
        this.actor.ease({scale_x: 1, scale_y: 1, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    destroy() {
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._monitorsId = 0;
        this.actor.destroy();
    }
}
