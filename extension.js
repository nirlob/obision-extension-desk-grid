/**
 * Obision Desk - Desktop Icons Extension for GNOME Shell
 *
 * This extension provides desktop icons functionality with support for
 * multiple icon sizes.
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

// Icon size presets (in pixels)
const ICON_SIZES = {
    small: 48,
    medium: 64,
    large: 96,
    xlarge: 128,
};

// Grid spacing based on icon size
const GRID_SPACING = 12;
const LABEL_HEIGHT = 40;

/**
 * Represents a single desktop icon
 */
const DesktopIcon = GObject.registerClass(
    class DesktopIcon extends St.BoxLayout {
        _init(fileInfo, extension) {
            const iconSize = extension._getIconSize();

            super._init({
                vertical: true,
                reactive: true,
                can_focus: true,
                track_hover: true,
                style_class: 'desktop-icon',
                x_align: Clutter.ActorAlign.CENTER,
            });

            this._fileInfo = fileInfo;
            this._extension = extension;
            this._iconSize = iconSize;
            this._selected = false;

            // Icon container
            this._iconContainer = new St.Bin({
                style_class: 'desktop-icon-container',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._iconContainer);

            // Create icon from file info
            this._createIcon();

            // Label
            this._label = new St.Label({
                text: this._getDisplayName(),
                style_class: 'desktop-icon-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._label);

            // Setup event handlers
            this._setupEvents();

            // Setup drag and drop
            this._setupDragAndDrop();
        }

        _createIcon() {
            try {
                const gicon = this._fileInfo.get_icon();
                if (gicon) {
                    this._icon = new St.Icon({
                        gicon: gicon,
                        icon_size: this._iconSize,
                        style_class: 'desktop-icon-image',
                    });
                } else {
                    // Fallback icon
                    this._icon = new St.Icon({
                        icon_name: 'text-x-generic',
                        icon_size: this._iconSize,
                        style_class: 'desktop-icon-image',
                    });
                }
                this._iconContainer.set_child(this._icon);
            } catch (e) {
                log(`Error creating icon: ${e}`);
            }
        }

        _getDisplayName() {
            const name = this._fileInfo.get_display_name();
            // Truncate long names
            return name.length > 20 ? name.substring(0, 17) + '...' : name;
        }

        _setupEvents() {
            // Click to select/open
            this.connect('button-press-event', (actor, event) => {
                const button = event.get_button();
                const clickCount = event.get_click_count();

                if (button === 1) {
                    // Left click
                    if (clickCount === 2) {
                        this._open();
                    } else {
                        this._select();
                    }
                    return Clutter.EVENT_STOP;
                } else if (button === 3) {
                    // Right click
                    this._showContextMenu(event);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Hover effects
            this.connect('enter-event', () => {
                if (!this._selected) {
                    this.add_style_pseudo_class('hover');
                }
            });

            this.connect('leave-event', () => {
                this.remove_style_pseudo_class('hover');
            });
        }

        _setupDragAndDrop() {
            this._draggable = DND.makeDraggable(this, {
                dragActorMaxSize: this._iconSize,
                dragActorOpacity: 200,
            });

            this._draggable.connect('drag-begin', () => {
                this.add_style_class_name('dragging');
            });

            this._draggable.connect('drag-end', () => {
                this.remove_style_class_name('dragging');
            });
        }

        _select() {
            // Deselect all other icons first
            this._extension._deselectAll();

            this._selected = true;
            this.add_style_pseudo_class('selected');
        }

        deselect() {
            this._selected = false;
            this.remove_style_pseudo_class('selected');
        }

        _open() {
            try {
                const file = this._fileInfo.get_attribute_object('standard::file');
                if (file) {
                    const appInfo = Gio.AppInfo.get_default_for_type(
                        this._fileInfo.get_content_type(),
                        false
                    );
                    if (appInfo) {
                        appInfo.launch([file], null);
                    } else {
                        // Open with default handler
                        Gio.app_info_launch_default_for_uri(file.get_uri(), null);
                    }
                }
            } catch (e) {
                log(`Error opening file: ${e}`);
            }
        }

        _showContextMenu(_event) {
            // TODO: Implement context menu
            log('Context menu requested');
        }

        updateSize(newSize) {
            this._iconSize = newSize;
            if (this._icon) {
                this._icon.set_icon_size(newSize);
            }
        }

        getFile() {
            return this._fileInfo.get_attribute_object('standard::file');
        }

        destroy() {
            if (this._draggable) {
                this._draggable = null;
            }
            super.destroy();
        }
    }
);

/**
 * Desktop grid container that manages icon layout
 */
const DesktopGrid = GObject.registerClass(
    class DesktopGrid extends St.Widget {
        _init(extension) {
            super._init({
                reactive: true,
                can_focus: true,
                layout_manager: new Clutter.BinLayout(),
            });

            this._extension = extension;
            this._icons = [];
            this._iconPositions = new Map(); // Store custom positions

            // Container for icons
            this._container = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
            });
            this.add_child(this._container);

            // Click on empty area deselects
            this.connect('button-press-event', (actor, event) => {
                const [stageX, stageY] = event.get_coords();
                const [x, y] = this.transform_stage_point(stageX, stageY);

                // Check if click is on empty space
                let clickedOnIcon = false;
                for (const icon of this._icons) {
                    const allocation = icon.get_allocation_box();
                    if (
                        x >= allocation.x1 &&
                        x <= allocation.x2 &&
                        y >= allocation.y1 &&
                        y <= allocation.y2
                    ) {
                        clickedOnIcon = true;
                        break;
                    }
                }

                if (!clickedOnIcon && event.get_button() === 1) {
                    this._extension._deselectAll();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        addIcon(icon, x, y) {
            this._icons.push(icon);
            this._container.add_child(icon);

            // Position icon
            icon.set_position(x, y);
            this._iconPositions.set(icon, { x, y });
        }

        removeIcon(icon) {
            const index = this._icons.indexOf(icon);
            if (index > -1) {
                this._icons.splice(index, 1);
                this._iconPositions.delete(icon);
                icon.destroy();
            }
        }

        clearIcons() {
            for (const icon of this._icons) {
                icon.destroy();
            }
            this._icons = [];
            this._iconPositions.clear();
        }

        getIcons() {
            return this._icons;
        }

        repositionIcons() {
            const iconSize = this._extension._getIconSize();
            const cellWidth = iconSize + GRID_SPACING * 2;
            const cellHeight = iconSize + LABEL_HEIGHT + GRID_SPACING * 2;

            const monitor = Main.layoutManager.primaryMonitor;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);

            const columns = Math.floor(workArea.width / cellWidth);

            let col = 0;
            let row = 0;

            for (const icon of this._icons) {
                const x = workArea.x + col * cellWidth + GRID_SPACING;
                const y = workArea.y + row * cellHeight + GRID_SPACING;

                icon.set_position(x, y);
                icon.updateSize(iconSize);

                col++;
                if (col >= columns) {
                    col = 0;
                    row++;
                }
            }
        }

        destroy() {
            this.clearIcons();
            super.destroy();
        }
    }
);

/**
 * Main extension class
 */
export default class ObisionExtensionDesk extends Extension {
    enable() {
        log('Obision Desk enabling...');

        this._settings = this.getSettings();
        this._icons = [];
        this._fileMonitor = null;

        // Create desktop grid
        this._grid = new DesktopGrid(this);

        // Add to layout at the bottom layer
        Main.layoutManager.addChrome(this._grid, {
            affectsInputRegion: false,
            affectsStruts: false,
            trackFullscreen: true,
        });

        // Position grid
        this._updateGridPosition();

        // Load desktop files
        this._loadDesktopFiles();

        // Monitor desktop directory for changes
        this._setupFileMonitor();

        // Connect to settings changes
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'icon-size') {
                this._grid.repositionIcons();
            }
        });

        // Monitor for monitor changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._updateGridPosition();
            this._grid.repositionIcons();
        });

        log('Obision Desk enabled');
    }

    disable() {
        log('Obision Desk disabling...');

        // Disconnect signals
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        // Stop file monitor
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }

        // Remove grid
        if (this._grid) {
            Main.layoutManager.removeChrome(this._grid);
            this._grid.destroy();
            this._grid = null;
        }

        this._settings = null;

        log('Obision Desk disabled');
    }

    _updateGridPosition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._grid) return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);

        this._grid.set_position(workArea.x, workArea.y);
        this._grid.set_size(workArea.width, workArea.height);
    }

    _getIconSize() {
        const sizeKey = this._settings.get_string('icon-size');
        return ICON_SIZES[sizeKey] || ICON_SIZES.medium;
    }

    _getDesktopPath() {
        // Try XDG user dir first
        const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        if (desktopPath) {
            return desktopPath;
        }
        // Fallback to ~/Desktop
        return GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
    }

    _loadDesktopFiles() {
        const desktopPath = this._getDesktopPath();
        const desktopDir = Gio.File.new_for_path(desktopPath);

        if (!desktopDir.query_exists(null)) {
            log(`Desktop directory does not exist: ${desktopPath}`);
            return;
        }

        try {
            const enumerator = desktopDir.enumerate_children(
                'standard::*',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            const iconSize = this._getIconSize();
            const cellWidth = iconSize + GRID_SPACING * 2;
            const cellHeight = iconSize + LABEL_HEIGHT + GRID_SPACING * 2;

            const monitor = Main.layoutManager.primaryMonitor;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            const columns = Math.floor(workArea.width / cellWidth);

            let col = 0;
            let row = 0;
            let fileInfo;

            while ((fileInfo = enumerator.next_file(null)) !== null) {
                const name = fileInfo.get_name();

                // Skip hidden files
                if (name.startsWith('.')) continue;

                // Store file reference in the file info
                const file = desktopDir.get_child(name);
                fileInfo.set_attribute_object('standard::file', file);

                const icon = new DesktopIcon(fileInfo, this);

                const x = workArea.x + col * cellWidth + GRID_SPACING;
                const y = workArea.y + row * cellHeight + GRID_SPACING;

                this._grid.addIcon(icon, x, y);

                col++;
                if (col >= columns) {
                    col = 0;
                    row++;
                }
            }
        } catch (e) {
            log(`Error loading desktop files: ${e}`);
        }
    }

    _setupFileMonitor() {
        const desktopPath = this._getDesktopPath();
        const desktopDir = Gio.File.new_for_path(desktopPath);

        if (!desktopDir.query_exists(null)) {
            return;
        }

        try {
            this._fileMonitor = desktopDir.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES,
                null
            );

            this._fileMonitor.connect('changed', (monitor, file, otherFile, eventType) => {
                // Reload icons when directory changes
                if (
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.DELETED ||
                    eventType === Gio.FileMonitorEvent.MOVED_IN ||
                    eventType === Gio.FileMonitorEvent.MOVED_OUT
                ) {
                    // Debounce reloads
                    if (this._reloadTimeout) {
                        GLib.source_remove(this._reloadTimeout);
                    }
                    this._reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        this._grid.clearIcons();
                        this._loadDesktopFiles();
                        this._reloadTimeout = null;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        } catch (e) {
            log(`Error setting up file monitor: ${e}`);
        }
    }

    _deselectAll() {
        for (const icon of this._grid.getIcons()) {
            icon.deselect();
        }
    }
}
