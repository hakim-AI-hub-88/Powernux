// Extension GNOME Shell du module « Focus Mode » de Powernux.
//
// Session de concentration (minuteur simple ou Pomodoro) :
//   • ouvre les applications du mode, réduit les autres fenêtres (option)
//   • coupe les notifications (« Ne pas déranger ») et les rétablit à la fin
//   • réduit les fenêtres des applications bloquées pendant les phases de travail
//   • notch sous la barre du haut : compact, s'agrandit au survol (commandes + calendrier)
//
// Fichiers : ~/.local/share/powernux/tools/focus-mode/settings.json (réglages)
//            ~/.local/share/powernux/data/focus-mode/stats.json     (statistiques)
//            ~/.local/share/powernux/data/focus-mode/state.json     (état « Ne pas déranger » à rétablir)
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {NotchFrame, vbox} from './notch.js';

const OBJECT_PATH = '/org/powernux/FocusMode';
const IFACE = `
<node>
  <interface name="org.powernux.FocusMode">
    <method name="StartSession">
      <arg type="s" direction="in" name="mode"/>
      <arg type="b" direction="out" name="started"/>
    </method>
    <method name="Stop"/>
    <method name="TogglePause"/>
    <method name="Skip"/>
    <method name="Status">
      <arg type="s" direction="out" name="status"/>
    </method>
  </interface>
</node>`;

const DATA = GLib.get_user_data_dir();
const SETTINGS_PATH = GLib.build_filenamev([DATA, 'powernux', 'tools', 'focus-mode', 'settings.json']);
const STATS_PATH = GLib.build_filenamev([DATA, 'powernux', 'data', 'focus-mode', 'stats.json']);
const STATE_PATH = GLib.build_filenamev([DATA, 'powernux', 'data', 'focus-mode', 'state.json']);
const DEFAULTS = {playSound: true, notchStyle: 'compact'};

const COMPACT_WIDTH = 320;
const EXPANDED_WIDTH = 660;
const PHASES = {
    work: {label: 'Concentration', icon: 'alarm-symbolic', style: 'work'},
    short: {label: 'Pause courte', icon: 'emoji-nature-symbolic', style: 'break'},
    long: {label: 'Pause longue', icon: 'emoji-nature-symbolic', style: 'break'},
};

// ---------- Fichiers ----------

function readJson(path, fallback) {
    try {
        const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
        if (ok)
            return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        // absent ou invalide
    }
    return fallback;
}

function writeJson(path, value) {
    const file = Gio.File.new_for_path(path);
    try {
        file.get_parent().make_directory_with_parents(null);
    } catch (e) {
        // existe déjà
    }
    file.replace_contents(new TextEncoder().encode(JSON.stringify(value, null, 2)), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

function deleteFile(path) {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (e) {
        // absent
    }
}

const todayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fmt = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const nowMs = () => GLib.get_monotonic_time() / 1000;

function controlButton(iconName, onClick) {
    const button = new St.Button({
        style_class: 'pnx-ctl',
        child: new St.Icon({icon_name: iconName, style_class: 'pnx-ctl-icon'}),
        can_focus: false,
    });
    button.connect('clicked', onClick);
    return button;
}

// ---------- Notch ----------

/**
 * Compact :  ● Étude IA ······················ 42:13
 * Agrandi :  [tuile] Étude IA                 │  nov.  L M M J V S D
 *                    Concentration · 2/4      │  2026  17 18 19 20 21 22 23
 *                    0:34 ━━━━━━─────── 24:26 │  ◷ 2 sessions aujourd'hui
 *                       ⏮   ⏸   ⏭   ■         │    1 h 45 de concentration
 */
class FocusNotch {
    constructor(ext) {
        this.ext = ext;
        this.frame = new NotchFrame({width: COMPACT_WIDTH, anchor: 'panel', reactive: true, styleClass: 'pnx-focus'});
        this.expanded = false;

        // --- Compact ---
        this.compact = new St.BoxLayout({style_class: 'pnx-compact', x_expand: true});
        this.dot = new St.Widget({style_class: 'pnx-dot work', y_align: Clutter.ActorAlign.CENTER});
        this.compactName = new St.Label({style_class: 'pnx-compact-name', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        this.compactTime = new St.Label({style_class: 'pnx-compact-time', y_align: Clutter.ActorAlign.CENTER});
        this.compact.add_child(this.dot);
        this.compact.add_child(this.compactName);
        this.compact.add_child(this.compactTime);

        // --- Agrandi ---
        this.full = new St.BoxLayout({style_class: 'pnx-full', x_expand: true, visible: false});
        this.tile = new St.Bin({style_class: 'pnx-focus-tile work', y_align: Clutter.ActorAlign.CENTER});
        this.tileIcon = new St.Icon({icon_name: PHASES.work.icon, style_class: 'pnx-focus-tile-icon'});
        this.tile.set_child(this.tileIcon);

        const main = vbox({style_class: 'pnx-focus-main', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.title = new St.Label({style_class: 'pnx-focus-title'});
        this.subtitle = new St.Label({style_class: 'pnx-focus-subtitle'});
        const progress = new St.BoxLayout({style_class: 'pnx-focus-progress'});
        this.elapsed = new St.Label({style_class: 'pnx-time', y_align: Clutter.ActorAlign.CENTER});
        this.track = new St.Widget({style_class: 'pnx-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.fill = new St.Widget({style_class: 'pnx-fill'});
        this.track.add_child(this.fill);
        this.remaining = new St.Label({style_class: 'pnx-time', y_align: Clutter.ActorAlign.CENTER});
        progress.add_child(this.elapsed);
        progress.add_child(this.track);
        progress.add_child(this.remaining);
        const controls = new St.BoxLayout({style_class: 'pnx-controls', x_align: Clutter.ActorAlign.CENTER});
        this.playButton = controlButton('media-playback-pause-symbolic', () => ext.togglePause());
        controls.add_child(controlButton('media-skip-backward-symbolic', () => ext.restartPhase()));
        controls.add_child(this.playButton);
        controls.add_child(controlButton('media-skip-forward-symbolic', () => ext.skip()));
        controls.add_child(controlButton('media-playback-stop-symbolic', () => ext.stop()));
        main.add_child(this.title);
        main.add_child(this.subtitle);
        main.add_child(progress);
        main.add_child(controls);

        const divider = new St.Widget({style_class: 'pnx-divider', y_expand: true});

        // Calendrier de la semaine + statistiques du jour.
        const side = vbox({style_class: 'pnx-side', y_align: Clutter.ActorAlign.CENTER});
        const calendar = new St.BoxLayout({style_class: 'pnx-calendar'});
        const monthBox = vbox({style_class: 'pnx-month-box'});
        this.month = new St.Label({style_class: 'pnx-month'});
        this.year = new St.Label({style_class: 'pnx-year'});
        monthBox.add_child(this.month);
        monthBox.add_child(this.year);
        calendar.add_child(monthBox);
        this.days = [];
        for (let i = 0; i < 7; i++) {
            const col = vbox({style_class: 'pnx-day'});
            const letter = new St.Label({style_class: 'pnx-day-letter', x_align: Clutter.ActorAlign.CENTER});
            const number = new St.Label({style_class: 'pnx-day-number', x_align: Clutter.ActorAlign.CENTER});
            const mark = new St.Widget({style_class: 'pnx-day-mark', x_align: Clutter.ActorAlign.CENTER});
            col.add_child(letter);
            col.add_child(number);
            col.add_child(mark);
            calendar.add_child(col);
            this.days.push({letter, number, mark});
        }
        const stats = new St.BoxLayout({style_class: 'pnx-stats', x_align: Clutter.ActorAlign.CENTER});
        stats.add_child(new St.Icon({icon_name: 'x-office-calendar-symbolic', style_class: 'pnx-stats-icon'}));
        const statsText = vbox();
        this.statsTitle = new St.Label({style_class: 'pnx-stats-title'});
        this.statsSub = new St.Label({style_class: 'pnx-stats-sub'});
        statsText.add_child(this.statsTitle);
        statsText.add_child(this.statsSub);
        stats.add_child(statsText);
        side.add_child(calendar);
        side.add_child(stats);

        this.full.add_child(this.tile);
        this.full.add_child(main);
        this.full.add_child(divider);
        this.full.add_child(side);

        this.frame.panel.add_child(this.compact);
        this.frame.panel.add_child(this.full);

        // Survol : agrandir ; sortie : revenir en compact.
        this.frame.actor.connect('notify::hover', () => this._onHover());
        this.frame.panel.connect('button-press-event', () => {
            this.setExpanded(!this.expanded);
            return Clutter.EVENT_STOP;
        });
    }

    _onHover() {
        if (this._collapseId) {
            GLib.source_remove(this._collapseId);
            this._collapseId = 0;
        }
        if (this.frame.actor.hover) {
            this.setExpanded(true);
        } else if (!this.ext.alwaysExpanded()) {
            this._collapseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
                this._collapseId = 0;
                this.setExpanded(false);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    setExpanded(expanded) {
        if (this.ext.alwaysExpanded())
            expanded = true;
        if (expanded === this.expanded)
            return;
        this.expanded = expanded;
        this.compact.visible = !expanded;
        this.full.visible = expanded;
        this.frame.setWidth(expanded ? EXPANDED_WIDTH : COMPACT_WIDTH);
        if (expanded)
            this.refreshCalendar();
        this.frame.bounce();
    }

    /** Agrandit le notch quelques secondes (changement de phase). */
    peek(seconds = 6) {
        this.setExpanded(true);
        if (this._peekId)
            GLib.source_remove(this._peekId);
        this._peekId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._peekId = 0;
            if (!this.frame.actor.hover)
                this.setExpanded(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    refreshCalendar() {
        const now = new Date();
        this.month.text = now.toLocaleDateString('fr-FR', {month: 'short'});
        this.year.text = String(now.getFullYear());
        const stats = readJson(STATS_PATH, {});
        // Semaine du lundi au dimanche.
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        const letters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
        this.days.forEach((d, i) => {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            d.letter.text = letters[i];
            d.number.text = String(day.getDate());
            const isToday = todayKey(day) === todayKey(now);
            if (isToday)
                d.number.add_style_class_name('today');
            else
                d.number.remove_style_class_name('today');
            d.mark.opacity = stats[todayKey(day)]?.minutes ? 255 : 0;
        });
        const today = stats[todayKey(now)] ?? {sessions: 0, minutes: 0};
        this.statsTitle.text = today.sessions ? `${today.sessions} session(s) aujourd'hui` : 'Première session du jour';
        const h = Math.floor(today.minutes / 60);
        const m = today.minutes % 60;
        this.statsSub.text = today.minutes ? `${h ? `${h} h ` : ''}${m} min de concentration` : 'Bon courage !';
    }

    update(session) {
        const phase = session.phases[session.index];
        const info = PHASES[phase.kind];
        const remaining = session.remainingMs();
        const total = phase.minutes * 60000;
        const elapsed = total - remaining;
        const step = session.pomodoro
            ? ` · ${session.phases.slice(0, session.index + 1).filter(p => p.kind === 'work').length}/${session.workCount}`
            : '';

        for (const c of ['work', 'break', 'paused']) {
            this.dot.remove_style_class_name(c);
            this.tile.remove_style_class_name(c);
        }
        const style = session.paused ? 'paused' : info.style;
        this.dot.add_style_class_name(style);
        this.tile.add_style_class_name(style);

        this.compactName.text = session.paused ? `${session.name} · en pause` : session.name;
        this.compactTime.text = fmt(remaining);
        this.title.text = session.name;
        this.subtitle.text = `${session.paused ? 'En pause' : info.label}${step}`;
        this.tileIcon.icon_name = session.paused ? 'media-playback-pause-symbolic' : info.icon;
        this.elapsed.text = fmt(elapsed);
        this.remaining.text = `-${fmt(remaining)}`;
        this.fill.set_size(Math.round(this.track.width * Math.min(1, elapsed / total)), this.track.height);
        this.playButton.child.icon_name = session.paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
    }

    showDone(text) {
        this.compactName.text = text;
        this.compactTime.text = '';
        this.title.text = text;
        this.subtitle.text = 'Session terminée';
    }

    destroy() {
        for (const id of [this._collapseId, this._peekId]) {
            if (id)
                GLib.source_remove(id);
        }
        this.frame.destroy();
    }
}

// ---------- Session ----------

class Session {
    constructor(mode) {
        this.name = mode.name || 'Concentration';
        this.mode = mode;
        this.pomodoro = Boolean(mode.pomodoro);
        this.phases = [];
        if (this.pomodoro) {
            const cycles = Math.max(1, mode.cycles || 4);
            for (let c = 1; c <= cycles; c++) {
                this.phases.push({kind: 'work', minutes: mode.work || 25});
                if (c < cycles)
                    this.phases.push(c % 4 === 0 ? {kind: 'long', minutes: mode.longBreak || 15} : {kind: 'short', minutes: mode.shortBreak || 5});
            }
        } else {
            this.phases.push({kind: 'work', minutes: mode.duration || 90});
        }
        this.workCount = this.phases.filter(p => p.kind === 'work').length;
        this.index = 0;
        this.paused = false;
        this.workMs = 0;     // temps de travail effectif (statistiques)
        this.startPhase();
    }

    get phase() {
        return this.phases[this.index];
    }

    startPhase() {
        this.endsAt = nowMs() + this.phase.minutes * 60000;
        this.pausedRemaining = 0;
        this._lastTick = nowMs();
    }

    remainingMs() {
        return this.paused ? this.pausedRemaining : Math.max(0, this.endsAt - nowMs());
    }

    tick() {
        const t = nowMs();
        if (!this.paused && this.phase.kind === 'work')
            this.workMs += t - this._lastTick;
        this._lastTick = t;
    }

    togglePause() {
        if (this.paused) {
            this.endsAt = nowMs() + this.pausedRemaining;
            this._lastTick = nowMs();
        } else {
            this.pausedRemaining = this.remainingMs();
        }
        this.paused = !this.paused;
    }
}

export default class PowernuxFocusMode extends Extension {
    enable() {
        this._settings = {...DEFAULTS, ...readJson(SETTINGS_PATH, {})};
        this._session = null;
        this._notch = null;
        this._restoreNotifications(); // session interrompue (redémarrage de GNOME…)

        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            StartSession: json => this.start(JSON.parse(json)),
            Stop: () => this.stop(),
            TogglePause: () => this.togglePause(),
            Skip: () => this.skip(),
            Status: () => JSON.stringify(this._session
                ? {active: true, name: this._session.name, phase: this._session.phase.kind, paused: this._session.paused}
                : {active: false}),
        });
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
        this._windowCreatedId = global.display.connect('window-created', (_d, win) => this._onWindowCreated(win));

        try {
            this._monitor = Gio.File.new_for_path(SETTINGS_PATH).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => {
                this._settings = {...DEFAULTS, ...readJson(SETTINGS_PATH, {})};
                this._notch?.setExpanded(this.alwaysExpanded());
            });
        } catch (e) {
            logError(e, 'Powernux Focus Mode: surveillance des réglages');
        }
    }

    disable() {
        this.stop(false);
        this._dbus?.unexport();
        this._dbus = null;
        this._monitor?.cancel();
        this._monitor = null;
        if (this._windowCreatedId)
            global.display.disconnect(this._windowCreatedId);
        this._windowCreatedId = 0;
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
        this._notch?.destroy();
        this._notch = null;
    }

    alwaysExpanded() {
        return this._settings.notchStyle === 'expanded';
    }

    // ----- Démarrage / arrêt -----

    start(mode) {
        if (this._session)
            this.stop(false);
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }

        // Fenêtres : réduire les autres, puis ouvrir les applications du mode.
        const modeApps = new Set(mode.apps ?? []);
        if (mode.minimizeOthers) {
            for (const win of global.workspace_manager.get_active_workspace().list_windows()) {
                const id = Shell.WindowTracker.get_default().get_window_app(win)?.get_id();
                if (!modeApps.has(id) && !/^powernux/i.test(win.get_wm_class() ?? ''))
                    win.minimize();
            }
        }
        const appSystem = Shell.AppSystem.get_default();
        for (const id of modeApps)
            appSystem.lookup_app(id)?.activate();

        // Notifications coupées (valeur précédente mémorisée sur disque).
        if (mode.dnd) {
            const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            writeJson(STATE_PATH, {showBanners: settings.get_boolean('show-banners')});
            settings.set_boolean('show-banners', false);
        }

        this._session = new Session(mode);
        this._applyBlocking();

        if (!this._notch)
            this._notch = new FocusNotch(this);
        this._notch.frame.show();
        this._notch.setExpanded(true);
        this._notch.peek(5);
        this._tick();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => this._tick());
        return true;
    }

    /** Fin de session (ou arrêt manuel). */
    stop(completed = false) {
        if (!this._session)
            return;
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._session.tick();
        this._recordStats(this._session, completed);
        const name = this._session.name;
        this._session = null;
        this._restoreNotifications();

        if (this._notch) {
            this._notch.showDone(completed ? `${name} : terminé, bravo !` : `${name} : arrêté`);
            this._notch.peek(4);
            this._hideId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                this._hideId = 0;
                this._notch?.frame.hide();
                return GLib.SOURCE_REMOVE;
            });
        }
        if (completed)
            Main.notify('Powernux Focus Mode', `Session « ${name} » terminée. Bravo !`);
    }

    togglePause() {
        if (!this._session)
            return;
        this._session.togglePause();
        this._tick();
    }

    skip() {
        if (this._session)
            this._nextPhase(false);
    }

    restartPhase() {
        if (!this._session)
            return;
        this._session.paused = false;
        this._session.startPhase();
        this._tick();
    }

    // ----- Minuteur -----

    _tick() {
        const session = this._session;
        if (!session)
            return GLib.SOURCE_REMOVE;
        session.tick();
        if (!session.paused && session.remainingMs() <= 0) {
            this._nextPhase(true);
            return this._session ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        }
        this._notch?.update(session);
        return GLib.SOURCE_CONTINUE;
    }

    _nextPhase(natural) {
        const session = this._session;
        if (natural && this._settings.playSound) {
            try {
                global.display.get_sound_player().play_from_theme('complete', 'Phase terminée', null);
            } catch (e) {
                // pas de son disponible
            }
        }
        if (session.index >= session.phases.length - 1) {
            this.stop(natural);
            return;
        }
        session.index++;
        session.paused = false;
        session.startPhase();
        this._applyBlocking();
        this._notch?.update(session);
        this._notch?.peek(6);
    }

    // ----- Distractions -----

    _isBlocked(win) {
        const session = this._session;
        if (!session || session.phase.kind !== 'work')
            return false;
        const id = Shell.WindowTracker.get_default().get_window_app(win)?.get_id();
        return Boolean(id && (session.mode.blockApps ?? []).includes(id));
    }

    _applyBlocking() {
        for (const win of global.display.list_all_windows()) {
            if (this._isBlocked(win))
                win.minimize();
        }
    }

    _onWindowCreated(win) {
        if (!this._session)
            return;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            if (this._isBlocked(win)) {
                win.minimize();
                Main.osdWindowManager.showAll?.(Gio.ThemedIcon.new('action-unavailable-symbolic'),
                    'Bloqué pendant la concentration', null, null);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreNotifications() {
        const state = readJson(STATE_PATH, null);
        if (state && typeof state.showBanners === 'boolean') {
            new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'}).set_boolean('show-banners', state.showBanners);
            deleteFile(STATE_PATH);
        }
    }

    _recordStats(session, completed) {
        const minutes = Math.round(session.workMs / 60000);
        if (minutes < 1 && !completed)
            return;
        const stats = readJson(STATS_PATH, {});
        const key = todayKey();
        const day = stats[key] ?? {sessions: 0, minutes: 0};
        day.sessions += 1;
        day.minutes += minutes;
        stats[key] = day;
        writeJson(STATS_PATH, stats);
    }
}
