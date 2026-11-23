// Extension GNOME Shell du module « Smart Window Manager » de Powernux.
//
// Sous Wayland, seul GNOME Shell peut agir sur les fenêtres des autres applications.
// Fonctions :
//   • Always On Top : épingle la fenêtre active au premier plan, avec une bordure
//   • Organisation automatique des fenêtres du bureau courant (grille, principale 70 %, colonnes)
//   • Espaces de travail : enregistre la disposition des fenêtres et la restaure en un clic
//     (relance les applications fermées)
//
// Fichiers (écrits par Powernux / par cette extension) :
//   ~/.local/share/powernux/tools/window-pin/settings.json
//   ~/.local/share/powernux/data/window-pin/layouts.json
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OBJECT_PATH = '/org/powernux/WindowPin';
const IFACE = `
<node>
  <interface name="org.powernux.WindowPin">
    <method name="Toggle">
      <arg type="b" direction="out" name="pinned"/>
      <arg type="s" direction="out" name="title"/>
    </method>
    <method name="UnpinAll"/>
    <method name="List">
      <arg type="as" direction="out" name="titles"/>
    </method>
    <method name="Arrange"/>
    <method name="SaveLayout">
      <arg type="s" direction="in" name="name"/>
      <arg type="i" direction="out" name="windows"/>
    </method>
    <method name="RestoreLayout">
      <arg type="s" direction="in" name="id"/>
      <arg type="b" direction="out" name="found"/>
    </method>
  </interface>
</node>`;

const DATA = GLib.get_user_data_dir();
const SETTINGS_PATH = GLib.build_filenamev([DATA, 'powernux', 'tools', 'window-pin', 'settings.json']);
const LAYOUTS_PATH = GLib.build_filenamev([DATA, 'powernux', 'data', 'window-pin', 'layouts.json']);

const DEFAULTS = {showBorder: true, borderColor: '#00C2FF', arrangeMode: 'auto', gap: 8, showIndicator: true};
const BORDER = 3;
const PINNABLE = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];
const LAUNCH_TIMEOUT_MS = 20000;

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

const loadSettings = () => ({...DEFAULTS, ...readJson(SETTINGS_PATH, {})});
const loadLayouts = () => readJson(LAYOUTS_PATH, []);

// ---------- Fenêtres (compatibilité entre versions de Mutter) ----------

function isMaximized(win) {
    if (typeof win.is_maximized === 'function')
        return win.is_maximized();
    return win.get_maximized() === Meta.MaximizeFlags.BOTH;
}

function unmaximize(win) {
    try {
        win.unmaximize(Meta.MaximizeFlags.BOTH);
    } catch (e) {
        win.unmaximize();
    }
}

function maximize(win) {
    try {
        win.maximize(Meta.MaximizeFlags.BOTH);
    } catch (e) {
        win.maximize();
    }
}

function appOf(win) {
    return Shell.WindowTracker.get_default().get_window_app(win);
}

/** Fenêtres « normales » d'un bureau, hors Powernux lui-même. */
function managedWindows(workspace, monitor = null) {
    return workspace.list_windows().filter(w =>
        w.get_window_type() === Meta.WindowType.NORMAL &&
        !w.minimized &&
        !w.is_skip_taskbar() &&
        !/^powernux/i.test(w.get_wm_class() ?? '') &&
        (monitor === null || w.get_monitor() === monitor));
}

function placeWindow(win, rect) {
    if (isMaximized(win))
        unmaximize(win);
    if (win.fullscreen)
        win.unmake_fullscreen();
    win.move_resize_frame(true, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height));
}

/** Rectangles de disposition pour n fenêtres dans la zone `area`. */
function computeTiles(n, area, mode, gap) {
    const g = gap;
    const inner = {x: area.x + g, y: area.y + g, width: area.width - 2 * g, height: area.height - 2 * g};
    const cell = (x, y, w, h) => ({x, y, width: w, height: h});
    if (n === 1)
        return [cell(inner.x, inner.y, inner.width, inner.height)];

    if (mode === 'master' || (mode === 'auto' && n === 3)) {
        // Fenêtre principale à gauche (70 % en mode « principale », 50 % sinon), les autres empilées.
        const ratio = mode === 'master' ? 0.7 : 0.5;
        const mw = Math.round((inner.width - g) * ratio);
        const sw = inner.width - g - mw;
        const sh = (inner.height - g * (n - 2)) / (n - 1);
        return [cell(inner.x, inner.y, mw, inner.height),
            ...Array.from({length: n - 1}, (_, i) => cell(inner.x + mw + g, inner.y + i * (sh + g), sw, sh))];
    }

    if (mode === 'columns') {
        const w = (inner.width - g * (n - 1)) / n;
        return Array.from({length: n}, (_, i) => cell(inner.x + i * (w + g), inner.y, w, inner.height));
    }

    // Grille automatique.
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const h = (inner.height - g * (rows - 1)) / rows;
    const tiles = [];
    for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols; // dernière ligne élargie
        const w = (inner.width - g * (inRow - 1)) / inRow;
        const col = i - row * cols;
        tiles.push(cell(inner.x + col * (w + g), inner.y + row * (h + g), w, h));
    }
    return tiles;
}

function showOsd(text, iconName = 'view-pin-symbolic') {
    try {
        const icon = Gio.ThemedIcon.new(iconName);
        const osd = Main.osdWindowManager;
        if (osd.showAll)
            osd.showAll(icon, text, null, null);
        else
            osd.show(-1, icon, text);
    } catch (e) {
        logError(e, 'Powernux Smart Window Manager: OSD');
    }
}

// ---------- Always On Top ----------

/** Fenêtre épinglée + sa bordure (enfant de l'acteur de la fenêtre : suit ses mouvements). */
class PinnedWindow {
    constructor(win, settings, onLost) {
        this.win = win;
        this.frame = new St.Widget({reactive: false});
        this.badge = new St.Icon({icon_name: 'view-pin-symbolic', style_class: 'powernux-pin-badge'});
        this.frame.add_child(this.badge);
        win.get_compositor_private()?.add_child(this.frame);
        this.signals = [
            win.connect('size-changed', () => this.relayout()),
            win.connect('position-changed', () => this.relayout()),
            win.connect('notify::above', () => {
                if (!win.is_above())
                    onLost(win);
            }),
            win.connect('unmanaged', () => onLost(win)),
        ];
        this.apply(settings);
        this.relayout();
    }

    apply(settings) {
        this.frame.visible = settings.showBorder;
        this.frame.style = `border: ${BORDER}px solid ${settings.borderColor}; border-radius: 12px;`;
        this.badge.style = `background-color: ${settings.borderColor};`;
    }

    relayout() {
        const frame = this.win.get_frame_rect();
        const buffer = this.win.get_buffer_rect();
        const w = frame.width + 2 * BORDER;
        this.frame.set_position(frame.x - buffer.x - BORDER, frame.y - buffer.y - BORDER);
        this.frame.set_size(w, frame.height + 2 * BORDER);
        this.badge.set_position(w - 34, 8);
    }

    destroy() {
        this.signals.forEach(id => this.win.disconnect(id));
        this.frame.destroy();
    }
}

// ---------- Extension ----------

export default class PowernuxSmartWindows extends Extension {
    enable() {
        this._settings = loadSettings();
        this._pinned = new Map();
        this._pending = [];

        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            Toggle: () => this._toggle(),
            UnpinAll: () => this._unpinAll(),
            List: () => [...this._pinned.keys()].map(w => w.get_title() ?? ''),
            Arrange: () => this._arrange(),
            SaveLayout: name => this._saveLayout(name),
            RestoreLayout: id => this._restoreLayout(id),
        });
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);

        this._windowCreatedId = global.display.connect('window-created', (_d, win) => this._onWindowCreated(win));

        try {
            this._monitor = Gio.File.new_for_path(SETTINGS_PATH).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => {
                this._settings = loadSettings();
                this._pinned.forEach(p => p.apply(this._settings));
                this._syncIndicator();
            });
        } catch (e) {
            logError(e, 'Powernux Smart Window Manager: surveillance des réglages');
        }
        this._syncIndicator();
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
        this._monitor?.cancel();
        this._monitor = null;
        if (this._windowCreatedId)
            global.display.disconnect(this._windowCreatedId);
        this._windowCreatedId = 0;
        this._pending = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._unpinAll();
        this._pinned = null;
    }

    // ----- Always On Top -----

    _pin(win) {
        if (this._pinned.has(win))
            return;
        win.make_above();
        this._pinned.set(win, new PinnedWindow(win, this._settings, w => this._forget(w)));
    }

    _toggle() {
        const win = global.display.get_focus_window();
        if (!win || !PINNABLE.includes(win.get_window_type()))
            return [false, ''];
        const title = win.get_title() ?? '';
        if (this._pinned.has(win)) {
            this._unpin(win);
            showOsd(`Désépinglée : ${title}`);
            return [false, title];
        }
        this._pin(win);
        showOsd(`Épinglée : ${title}`);
        return [true, title];
    }

    _forget(win) {
        this._pinned?.get(win)?.destroy();
        this._pinned?.delete(win);
    }

    _unpin(win) {
        this._forget(win);
        if (win.is_above())
            win.unmake_above();
    }

    _unpinAll() {
        [...(this._pinned?.keys() ?? [])].forEach(w => this._unpin(w));
    }

    // ----- Organisation automatique -----

    _arrange() {
        const workspace = global.workspace_manager.get_active_workspace();
        const focus = global.display.get_focus_window();
        const monitor = focus?.get_monitor() ?? global.display.get_primary_monitor();
        // Fenêtre active en premier (fenêtre principale), puis les plus récemment utilisées.
        const windows = managedWindows(workspace, monitor)
            .sort((a, b) => (b === focus) - (a === focus) || b.get_user_time() - a.get_user_time());
        if (!windows.length)
            return;
        const area = workspace.get_work_area_for_monitor(monitor);
        const tiles = computeTiles(windows.length, area, this._settings.arrangeMode, this._settings.gap);
        windows.forEach((w, i) => placeWindow(w, tiles[i]));
        showOsd(`${windows.length} fenêtre(s) organisée(s)`, 'view-grid-symbolic');
    }

    // ----- Espaces de travail -----

    _saveLayout(name) {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = managedWindows(workspace)
            .sort((a, b) => a.get_user_time() - b.get_user_time()); // ordre d'empilement à restaurer
        const entries = windows.map(w => {
            const monitor = w.get_monitor();
            const area = workspace.get_work_area_for_monitor(monitor);
            const r = w.get_frame_rect();
            const app = appOf(w);
            return {
                appId: app?.get_id() ?? null,
                appName: app?.get_name() ?? w.get_wm_class() ?? 'Application',
                wmClass: w.get_wm_class(),
                title: w.get_title(),
                monitor,
                maximized: isMaximized(w),
                above: w.is_above(),
                // Position relative à la zone de travail : indépendante de la résolution.
                x: (r.x - area.x) / area.width,
                y: (r.y - area.y) / area.height,
                width: r.width / area.width,
                height: r.height / area.height,
            };
        });
        const layouts = loadLayouts();
        const clean = String(name).trim() || 'Espace de travail';
        const existing = layouts.find(l => l.name.toLowerCase() === clean.toLowerCase());
        const layout = {
            id: existing?.id ?? `${Date.now()}`,
            name: clean,
            savedAt: new Date().toISOString(),
            windows: entries,
        };
        writeJson(LAYOUTS_PATH, existing ? layouts.map(l => (l === existing ? layout : l)) : [...layouts, layout]);
        showOsd(`Espace « ${clean} » enregistré`, 'document-save-symbolic');
        this._syncIndicator();
        return entries.length;
    }

    _restoreLayout(id) {
        const layout = loadLayouts().find(l => l.id === id);
        if (!layout)
            return false;
        const workspace = global.workspace_manager.get_active_workspace();
        const used = new Set();
        const all = global.display.list_all_windows().filter(w => w.get_window_type() === Meta.WindowType.NORMAL);

        for (const entry of layout.windows) {
            const match = all.find(w => !used.has(w) &&
                ((entry.appId && appOf(w)?.get_id() === entry.appId) || (!entry.appId && w.get_wm_class() === entry.wmClass)));
            if (match) {
                used.add(match);
                this._applyEntry(match, entry, workspace);
            } else if (entry.appId) {
                // Application fermée : on la relance et on placera sa fenêtre à l'apparition.
                const app = Shell.AppSystem.get_default().lookup_app(entry.appId);
                if (app) {
                    this._pending.push({entry, appId: entry.appId, until: Date.now() + LAUNCH_TIMEOUT_MS});
                    app.open_new_window(-1);
                }
            }
        }
        showOsd(`Espace « ${layout.name} » restauré`, 'view-grid-symbolic');
        return true;
    }

    _applyEntry(win, entry, workspace) {
        if (win.minimized)
            win.unminimize();
        if (win.get_workspace() !== workspace)
            win.change_workspace(workspace);
        const monitor = Math.min(entry.monitor ?? 0, global.display.get_n_monitors() - 1);
        const area = workspace.get_work_area_for_monitor(monitor);
        if (entry.maximized) {
            win.move_to_monitor(monitor);
            maximize(win);
        } else {
            placeWindow(win, {
                x: area.x + entry.x * area.width,
                y: area.y + entry.y * area.height,
                width: entry.width * area.width,
                height: entry.height * area.height,
            });
        }
        if (entry.above)
            this._pin(win);
        else if (this._pinned.has(win))
            this._unpin(win);
        win.activate(global.get_current_time());
    }

    _onWindowCreated(win) {
        if (!this._pending.length)
            return;
        this._pending = this._pending.filter(p => p.until > Date.now());
        // Laisse l'application finir d'ouvrir sa fenêtre avant de la placer.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            const index = this._pending.findIndex(p => appOf(win)?.get_id() === p.appId);
            if (index >= 0) {
                const [pending] = this._pending.splice(index, 1);
                this._applyEntry(win, pending.entry, global.workspace_manager.get_active_workspace());
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ----- Menu dans la barre du haut -----

    _syncIndicator() {
        if (!this._settings.showIndicator) {
            this._indicator?.destroy();
            this._indicator = null;
            return;
        }
        if (!this._indicator) {
            this._indicator = new PanelMenu.Button(0.5, 'Powernux Smart Window Manager');
            this._indicator.add_child(new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'}));
            this._indicator.menu.connect('open-state-changed', (_m, open) => {
                if (open)
                    this._buildMenu();
            });
            Main.panel.addToStatusArea('powernux-smart-windows', this._indicator);
        }
        this._buildMenu();
    }

    _buildMenu() {
        const menu = this._indicator?.menu;
        if (!menu)
            return;
        menu.removeAll();
        menu.addAction('Organiser les fenêtres', () => this._arrange(), 'view-grid-symbolic');
        menu.addAction('Désépingler toutes les fenêtres', () => this._unpinAll(), 'view-pin-symbolic');
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Espaces de travail'));
        const layouts = loadLayouts();
        if (!layouts.length) {
            const item = new PopupMenu.PopupMenuItem('Aucun espace : enregistrez-en un depuis Powernux');
            item.setSensitive(false);
            menu.addMenuItem(item);
        }
        for (const layout of layouts)
            menu.addAction(`${layout.name}  ·  ${layout.windows.length} fenêtre(s)`, () => this._restoreLayout(layout.id));
    }
}
