// @ts-nocheck
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
import Cairo from 'gi://cairo';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Icon sizes based on cell count (cols x rows)
// Base icon size fits in 1 cell, larger icons span multiple cells
// Format: 'WxH' where W=columns, H=rows
const ICON_CELL_SIZES = {
    '1x1': { cols: 1, rows: 1 },
    '2x1': { cols: 2, rows: 1 },
    '1x2': { cols: 1, rows: 2 },
    '2x2': { cols: 2, rows: 2 },
    '3x1': { cols: 3, rows: 1 },
    '1x3': { cols: 1, rows: 3 },
    '3x2': { cols: 3, rows: 2 },
    '2x3': { cols: 2, rows: 3 },
    '3x3': { cols: 3, rows: 3 },
    '4x1': { cols: 4, rows: 1 },
    '1x4': { cols: 1, rows: 4 },
    '4x2': { cols: 4, rows: 2 },
    '2x4': { cols: 2, rows: 4 },
    '4x4': { cols: 4, rows: 4 },
};

// Minimum icon size in pixels (for very small cells)
const MIN_ICON_SIZE = 24;

// Fixed label height for icon labels
const LABEL_HEIGHT = 40;

// Padding inside each cell (percentage of cell size)
const CELL_PADDING_RATIO = 0.15;

/**
 * Represents a single desktop icon or widget
 * 
 * Two modes:
 * - Icon (default): Flat, simple, traditional desktop icon
 * - Widget: Has elevation/shadow, can notify, "floats" above desktop
 */
const DesktopIcon = GObject.registerClass(
    class DesktopIcon extends St.BoxLayout {
        _init(fileInfo, extension, fileName) {
            // Get cell size for this icon (cols x rows)
            this._cellSize = extension._getIconCellSize(fileName);
            // Calculate actual icon size in pixels based on cell dimensions
            // Use the minimum dimension to keep icon square within its space
            const baseIconSize = extension._getBaseIconSize();
            const iconSize = Math.min(this._cellSize.cols, this._cellSize.rows) * baseIconSize;

            // Calculate widget size to exactly fit the cells
            const cellWidth = extension._getCellWidth();
            const cellHeight = extension._getCellHeight();
            const widgetWidth = cellWidth * this._cellSize.cols;
            const widgetHeight = cellHeight * this._cellSize.rows;

            super._init({
                vertical: true,
                reactive: true,
                can_focus: true,
                track_hover: true,
                style_class: 'desktop-icon',
                x_align: Clutter.ActorAlign.CENTER,
                // Fix widget size to cell dimensions
                width: widgetWidth,
                height: widgetHeight,
            });

            this._fileInfo = fileInfo;
            this._extension = extension;
            this._fileName = fileName;
            this._iconSize = iconSize;
            this._selected = false;
            this._dragging = false;

            // Check if this is a widget (has special capabilities)
            this._isWidget = extension._isIconWidget(fileName);

            // Apply widget or icon styles
            if (this._isWidget) {
                this.add_style_class_name('widget-mode');
                this._applyElevationStyle();
                this._applyBackgroundStyle();
            } else {
                // Normal icons are flat with no background
                this.add_style_class_name('elevation-0');
                this.add_style_class_name('bg-none');
                this._elevation = 0;
                this._background = 'none';
            }

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
        }

        // Check if this icon is in widget mode
        get isWidget() {
            return this._isWidget || false;
        }

        // Convert this icon to a widget
        setWidgetMode(enabled) {
            this._isWidget = enabled;
            this._extension._setIconWidget(this._fileName, enabled);

            if (enabled) {
                this.add_style_class_name('widget-mode');
                this._applyElevationStyle();
                this._applyBackgroundStyle();
            } else {
                this.remove_style_class_name('widget-mode');
                // Reset to flat icon
                for (let i = 0; i <= 3; i++) {
                    this.remove_style_class_name(`elevation-${i}`);
                }
                this.add_style_class_name('elevation-0');
                const bgClasses = ['bg-none', 'bg-light', 'bg-dark', 'bg-accent'];
                for (const cls of bgClasses) {
                    this.remove_style_class_name(cls);
                }
                this.add_style_class_name('bg-none');
                this._elevation = 0;
                this._background = 'none';
                // Remove any badge
                this._hideBadge();
            }
        }

        _applyElevationStyle() {
            // Only apply if widget
            if (!this._isWidget) return;

            // Remove any existing elevation classes
            for (let i = 0; i <= 3; i++) {
                this.remove_style_class_name(`elevation-${i}`);
            }
            // Get elevation for this icon
            const elevation = this._extension._getIconElevation(this._fileName);
            this.add_style_class_name(`elevation-${elevation}`);
            this._elevation = elevation;
        }

        _applyBackgroundStyle() {
            // Only apply if widget
            if (!this._isWidget) return;

            // Remove any existing background classes
            const bgClasses = ['bg-none', 'bg-light', 'bg-dark', 'bg-accent'];
            for (const cls of bgClasses) {
                this.remove_style_class_name(cls);
            }
            // Get background for this icon
            const background = this._extension._getIconBackground(this._fileName);
            this.add_style_class_name(`bg-${background}`);
            this._background = background;
        }

        setElevation(level) {
            // Only widgets can have elevation > 0
            if (!this._isWidget && level > 0) {
                this.setWidgetMode(true);
            }
            for (let i = 0; i <= 3; i++) {
                this.remove_style_class_name(`elevation-${i}`);
            }
            this.add_style_class_name(`elevation-${level}`);
            this._elevation = level;
        }

        setBackground(style) {
            const bgClasses = ['bg-none', 'bg-light', 'bg-dark', 'bg-accent'];
            for (const cls of bgClasses) {
                this.remove_style_class_name(cls);
            }
            this.add_style_class_name(`bg-${style}`);
            this._background = style;
        }

        // ===== Notification System =====
        // Multi-level notification system from silent to critical
        // Only widgets can send notifications (popups). Normal icons can only have badges.

        /**
         * Notification levels (from least to most intrusive):
         * - 'silent'   : Only shows badge, no animation (check icon manually)
         * - 'subtle'   : Badge + soft glow in place (doesn't move)
         * - 'normal'   : Small popup near the icon position
         * - 'attention': Popup moves to center of screen
         * - 'critical' : Center popup with pulse animation
         */

        /**
         * Make this icon notify with configurable intrusiveness
         * @param {Object} options - Notification options
         * @param {string} options.message - Optional message to show
         * @param {string} options.level - 'silent', 'subtle', 'normal', 'attention', 'critical'
         * @param {number} options.duration - Auto-dismiss time in ms (0 = manual dismiss)
         * @param {number} options.badgeCount - Number to show in badge (0 = no badge number)
         * @param {string} options.badgeIcon - Icon name for badge (optional)
         */
        notify(options = {}) {
            const {
                message = null,
                level = 'normal',
                duration = 5000,
                badgeCount = 0,
                badgeIcon = null,
            } = options;

            // Map old urgency values to new levels for backward compatibility
            let actualLevel = level;
            if (level === 'low') actualLevel = 'subtle';
            if (level === 'high') actualLevel = 'attention';

            // Check Do Not Disturb mode - force everything to silent
            const dnd = this._extension._settings.get_boolean('do-not-disturb');
            if (dnd && actualLevel !== 'silent') {
                actualLevel = 'silent';
            }

            // Check max notification level setting
            const maxLevel = this._extension._settings.get_string('max-notification-level');
            const levelOrder = ['silent', 'subtle', 'normal', 'attention', 'critical'];
            const maxIndex = levelOrder.indexOf(maxLevel);
            const currentIndex = levelOrder.indexOf(actualLevel);
            if (currentIndex > maxIndex) {
                actualLevel = maxLevel;
            }

            // Non-widgets can only show badges (silent/subtle)
            if (!this._isWidget && !['silent', 'subtle'].includes(actualLevel)) {
                // Auto-convert to widget if trying to send popup notification
                this.setWidgetMode(true);
            }

            // Don't stack notifications - update existing one
            if (this._isNotifying && actualLevel !== 'silent') {
                this.dismissNotification();
            }

            this._isNotifying = true;
            this._notifyLevel = actualLevel;

            // Handle based on level
            switch (actualLevel) {
                case 'silent':
                    this._notifySilent(badgeCount, badgeIcon, duration);
                    break;
                case 'subtle':
                    this._notifySubtle(message, badgeCount, duration);
                    break;
                case 'normal':
                    this._notifyNormal(message, badgeCount, duration);
                    break;
                case 'attention':
                    this._notifyAttention(message, badgeCount, duration);
                    break;
                case 'critical':
                    this._notifyCritical(message, badgeCount, duration);
                    break;
                default:
                    this._notifyNormal(message, badgeCount, duration);
            }
        }

        // Level 1: Silent - Just badge, no visual disturbance
        _notifySilent(badgeCount, badgeIcon, duration) {
            this._showBadge(badgeCount, badgeIcon, 'silent');

            if (duration > 0) {
                this._notifyTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
                    this._hideBadge();
                    this._isNotifying = false;
                    this._notifyTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        // Level 2: Subtle - Badge + soft glow effect in place
        _notifySubtle(message, badgeCount, duration) {
            this._showBadge(badgeCount, null, 'subtle');

            // Add glow effect
            this.add_style_class_name('notify-glow');

            // Store message for tooltip/hover
            this._pendingMessage = message;

            if (duration > 0) {
                this._notifyTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
                    this.dismissNotification();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        // Level 3: Normal - Small popup near the icon
        _notifyNormal(message, badgeCount, duration) {
            const [absX, absY] = this.get_transformed_position();

            this._createNotifyPopup(message, 'normal', badgeCount);

            // Position near the icon (slightly above and to the right)
            const popupX = absX + this.width / 2;
            const popupY = absY - 20;

            this._notifyClone.set_position(absX, absY);
            this._notifyClone.set_scale(0.5, 0.5);
            this._notifyClone.set_opacity(0);

            Main.uiGroup.add_child(this._notifyClone);

            // Animate to position near icon
            this._notifyClone.ease({
                x: popupX,
                y: popupY,
                scale_x: 1,
                scale_y: 1,
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            this._setupNotifyInteraction(duration);
        }

        // Level 4: Attention - Popup at center of screen
        _notifyAttention(message, badgeCount, duration) {
            const [absX, absY] = this.get_transformed_position();

            this._createNotifyPopup(message, 'attention', badgeCount);

            // Calculate center of screen
            const monitor = Main.layoutManager.primaryMonitor;
            const targetX = monitor.x + (monitor.width - this.width) / 2;
            const targetY = monitor.y + (monitor.height - this.height) / 2 - 50;

            this._notifyClone.set_position(absX, absY);
            this._notifyClone.set_scale(0.8, 0.8);
            this._notifyClone.set_opacity(0);

            Main.uiGroup.add_child(this._notifyClone);

            // Hide original icon
            this.set_opacity(100);

            // Animate to center with scale
            this._notifyClone.ease({
                x: targetX,
                y: targetY,
                scale_x: 1.3,
                scale_y: 1.3,
                opacity: 255,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });

            this._setupNotifyInteraction(duration);
        }

        // Level 5: Critical - Center popup with pulse
        _notifyCritical(message, badgeCount, duration) {
            const [absX, absY] = this.get_transformed_position();

            this._createNotifyPopup(message, 'critical', badgeCount);

            // Calculate center of screen
            const monitor = Main.layoutManager.primaryMonitor;
            const targetX = monitor.x + (monitor.width - this.width) / 2;
            const targetY = monitor.y + (monitor.height - this.height) / 2 - 50;

            this._notifyClone.set_position(absX, absY);
            this._notifyClone.set_scale(0.8, 0.8);
            this._notifyClone.set_opacity(0);

            Main.uiGroup.add_child(this._notifyClone);

            // Hide original icon
            this.set_opacity(50);

            // Animate to center with bigger scale
            this._notifyClone.ease({
                x: targetX,
                y: targetY,
                scale_x: 1.5,
                scale_y: 1.5,
                opacity: 255,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
                onComplete: () => {
                    this._startPulseAnimation();
                }
            });

            // Critical: default to manual dismiss (duration 0)
            this._setupNotifyInteraction(duration === 5000 ? 0 : duration);
        }

        // Helper: Create the popup widget
        _createNotifyPopup(message, level, badgeCount) {
            this._notifyClone = new St.BoxLayout({
                vertical: true,
                reactive: true,
                style_class: `desktop-icon notifying level-${level}`,
                x_align: Clutter.ActorAlign.CENTER,
            });

            // Apply elevation based on level
            const elevationMap = { normal: 2, attention: 3, critical: 3 };
            this._notifyClone.add_style_class_name(`elevation-${elevationMap[level] || 2}`);
            this._notifyClone.add_style_class_name(`bg-${level === 'critical' ? 'accent' : 'dark'}`);

            // Clone icon
            const iconClone = new St.Icon({
                gicon: this._icon.gicon,
                icon_size: this._iconSize,
                style_class: 'desktop-icon-image',
            });
            const iconContainer = new St.Bin({
                style_class: 'desktop-icon-container',
                x_align: Clutter.ActorAlign.CENTER,
            });
            iconContainer.set_child(iconClone);
            this._notifyClone.add_child(iconContainer);

            // Clone label
            const labelClone = new St.Label({
                text: this._label.text,
                style_class: 'desktop-icon-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._notifyClone.add_child(labelClone);

            // Add message if provided
            if (message) {
                const msgLabel = new St.Label({
                    text: message,
                    style_class: 'desktop-icon-notify-message',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                this._notifyClone.add_child(msgLabel);
                this._notifyClone.add_style_class_name('has-message');
            }

            // Add badge
            if (badgeCount > 0 || level === 'critical') {
                const badge = new St.Label({
                    text: badgeCount > 0 ? String(badgeCount) : '!',
                    style_class: `desktop-icon-badge badge-${level}`,
                });
                this._notifyClone.add_child(badge);
            }
        }

        // Helper: Show badge on the icon itself
        _showBadge(count, icon, level) {
            // Remove existing badge
            this._hideBadge();

            if (count > 0 || level === 'subtle') {
                this._badge = new St.Label({
                    text: count > 0 ? String(count > 99 ? '99+' : count) : '•',
                    style_class: `desktop-icon-badge badge-${level}`,
                });
                // Position badge at top-right of icon
                this._badge.set_position(this.width - 20, -5);
                this.add_child(this._badge);
            }
        }

        _hideBadge() {
            if (this._badge) {
                this._badge.destroy();
                this._badge = null;
            }
        }

        // Helper: Setup click to dismiss and auto-timeout
        _setupNotifyInteraction(duration) {
            // Click to dismiss and optionally open
            this._notifyClickId = this._notifyClone.connect('button-press-event', (actor, event) => {
                const button = event.get_button();
                this.dismissNotification();
                if (button === 1) {
                    // Left click - open the file
                    this._open();
                }
                return Clutter.EVENT_STOP;
            });

            // Auto-dismiss after duration
            if (duration > 0) {
                this._notifyTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
                    this.dismissNotification();
                    this._notifyTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        _startPulseAnimation() {
            if (!this._notifyClone) return;

            // Subtle scale pulse
            this._notifyClone.ease({
                scale_x: 1.6,
                scale_y: 1.6,
                duration: 600,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                onComplete: () => {
                    if (!this._notifyClone || !this._isNotifying) return;
                    this._notifyClone.ease({
                        scale_x: 1.5,
                        scale_y: 1.5,
                        duration: 600,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                        onComplete: () => {
                            if (this._isNotifying) {
                                this._startPulseAnimation();
                            }
                        }
                    });
                }
            });
        }

        dismissNotification() {
            if (!this._isNotifying) return;

            this._isNotifying = false;

            // Cancel timeout
            if (this._notifyTimeoutId) {
                GLib.source_remove(this._notifyTimeoutId);
                this._notifyTimeoutId = null;
            }

            // Disconnect click handler
            if (this._notifyClickId && this._notifyClone) {
                this._notifyClone.disconnect(this._notifyClickId);
                this._notifyClickId = null;
            }

            // Get original position
            const [absX, absY] = this.get_transformed_position();

            if (this._notifyClone) {
                // Animate back to original position
                this._notifyClone.ease({
                    x: absX,
                    y: absY,
                    scale_x: 1,
                    scale_y: 1,
                    opacity: 0,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        if (this._notifyClone) {
                            this._notifyClone.destroy();
                            this._notifyClone = null;
                        }
                        // Show original icon
                        this.set_opacity(255);
                    }
                });
            } else {
                this.set_opacity(255);
            }
        }

        // Check if this icon is currently notifying
        get isNotifying() {
            return this._isNotifying || false;
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
            // Variables for drag
            this._dragStartX = 0;
            this._dragStartY = 0;
            this._iconStartX = 0;
            this._iconStartY = 0;
            this._lastClickTime = 0;

            // Click/drag handling
            this.connect('button-press-event', (actor, event) => {
                const button = event.get_button();

                if (button === 1) {
                    // Check for double-click first
                    const now = GLib.get_monotonic_time();
                    if (this._lastClickTime && (now - this._lastClickTime) < 400000) {
                        // Double click (400ms threshold)
                        this._lastClickTime = 0;
                        this._open();
                        return Clutter.EVENT_STOP;
                    }
                    this._lastClickTime = now;

                    // Left click - start potential drag via extension's global handler
                    const [stageX, stageY] = event.get_coords();
                    this._extension._startIconDrag(this, stageX, stageY);

                    this._select();
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
                if (!this._selected && !this._dragging) {
                    this.add_style_pseudo_class('hover');
                }
            });

            this.connect('leave-event', () => {
                if (!this._dragging) {
                    this.remove_style_pseudo_class('hover');
                }
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

        _showContextMenu(event) {
            // Close any existing menu
            this._closeContextMenu();

            // Create popup menu
            this._contextMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);

            // Open item
            const openItem = new PopupMenu.PopupMenuItem('Open');
            openItem.connect('activate', () => {
                this._open();
            });
            this._contextMenu.addMenuItem(openItem);

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Icon Size submenu (in cells)
            const sizeSubMenu = new PopupMenu.PopupSubMenuMenuItem('Icon Size');

            const currentCellSize = this._extension._getCustomIconCellSize(this._fileName);

            // Square sizes
            const squareSizes = [
                { key: '1x1', label: '1×1' },
                { key: '2x2', label: '2×2' },
                { key: '3x3', label: '3×3' },
                { key: '4x4', label: '4×4' },
            ];

            // Wide sizes (horizontal)
            const wideSizes = [
                { key: '2x1', label: '2×1 (wide)' },
                { key: '3x1', label: '3×1 (wide)' },
                { key: '4x1', label: '4×1 (banner)' },
                { key: '3x2', label: '3×2 (wide)' },
                { key: '4x2', label: '4×2 (wide)' },
            ];

            // Tall sizes (vertical)
            const tallSizes = [
                { key: '1x2', label: '1×2 (tall)' },
                { key: '1x3', label: '1×3 (tall)' },
                { key: '1x4', label: '1×4 (tower)' },
                { key: '2x3', label: '2×3 (tall)' },
                { key: '2x4', label: '2×4 (tall)' },
            ];

            // Add square sizes
            for (const size of squareSizes) {
                const item = new PopupMenu.PopupMenuItem(size.label);
                if (currentCellSize === size.key) {
                    item.setOrnament(PopupMenu.Ornament.CHECK);
                }
                item.connect('activate', () => {
                    this._extension._setCustomIconCellSize(this._fileName, size.key);
                    this._cellSize = ICON_CELL_SIZES[size.key];
                    const newIconSize = this._extension._getIconPixelSize(this._cellSize);
                    this.updateSize(newIconSize);
                });
                sizeSubMenu.menu.addMenuItem(item);
            }

            sizeSubMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Wide submenu
            const wideSubMenu = new PopupMenu.PopupSubMenuMenuItem('↔ Wide');
            for (const size of wideSizes) {
                const item = new PopupMenu.PopupMenuItem(size.label);
                if (currentCellSize === size.key) {
                    item.setOrnament(PopupMenu.Ornament.CHECK);
                }
                item.connect('activate', () => {
                    this._extension._setCustomIconCellSize(this._fileName, size.key);
                    this._cellSize = ICON_CELL_SIZES[size.key];
                    const newIconSize = this._extension._getIconPixelSize(this._cellSize);
                    this.updateSize(newIconSize);
                });
                wideSubMenu.menu.addMenuItem(item);
            }
            sizeSubMenu.menu.addMenuItem(wideSubMenu);

            // Tall submenu
            const tallSubMenu = new PopupMenu.PopupSubMenuMenuItem('↕ Tall');
            for (const size of tallSizes) {
                const item = new PopupMenu.PopupMenuItem(size.label);
                if (currentCellSize === size.key) {
                    item.setOrnament(PopupMenu.Ornament.CHECK);
                }
                item.connect('activate', () => {
                    this._extension._setCustomIconCellSize(this._fileName, size.key);
                    this._cellSize = ICON_CELL_SIZES[size.key];
                    const newIconSize = this._extension._getIconPixelSize(this._cellSize);
                    this.updateSize(newIconSize);
                });
                tallSubMenu.menu.addMenuItem(item);
            }
            sizeSubMenu.menu.addMenuItem(tallSubMenu);

            // Reset to default option
            sizeSubMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const resetItem = new PopupMenu.PopupMenuItem('Reset to Default (1×1)');
            resetItem.connect('activate', () => {
                this._extension._removeCustomIconCellSize(this._fileName);
                this._cellSize = { cols: 1, rows: 1 };
                const baseSize = this._extension._getBaseIconSize();
                this.updateSize(baseSize);
            });
            sizeSubMenu.menu.addMenuItem(resetItem);

            this._contextMenu.addMenuItem(sizeSubMenu);

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Widget mode toggle
            const widgetItem = new PopupMenu.PopupMenuItem(
                this._isWidget ? '📌 Convert to Icon (flat)' : '🔮 Convert to Widget'
            );
            widgetItem.connect('activate', () => {
                this.setWidgetMode(!this._isWidget);
            });
            this._contextMenu.addMenuItem(widgetItem);

            // Only show these options for widgets
            if (this._isWidget) {
                // Elevation submenu (visual z-depth) - only for widgets
                const elevationSubMenu = new PopupMenu.PopupSubMenuMenuItem('↕️ Elevation');
                const currentElevation = this._elevation || 0;
                const elevations = [
                    { level: 0, label: 'Flat (no shadow)' },
                    { level: 1, label: 'Low' },
                    { level: 2, label: 'Medium' },
                    { level: 3, label: 'High (floating)' },
                ];

                for (const elev of elevations) {
                    const item = new PopupMenu.PopupMenuItem(elev.label);
                    if (currentElevation === elev.level) {
                        item.setOrnament(PopupMenu.Ornament.CHECK);
                    }
                    item.connect('activate', () => {
                        this._extension._setIconElevation(this._fileName, elev.level);
                        this.setElevation(elev.level);
                    });
                    elevationSubMenu.menu.addMenuItem(item);
                }
                this._contextMenu.addMenuItem(elevationSubMenu);

                // Background submenu - only for widgets
                const bgSubMenu = new PopupMenu.PopupSubMenuMenuItem('🎨 Background');
                const currentBg = this._background || 'none';
                const backgrounds = [
                    { key: 'none', label: 'None' },
                    { key: 'light', label: 'Light (frosted)' },
                    { key: 'dark', label: 'Dark' },
                    { key: 'accent', label: 'Accent color' },
                ];

                for (const bg of backgrounds) {
                    const item = new PopupMenu.PopupMenuItem(bg.label);
                    if (currentBg === bg.key) {
                        item.setOrnament(PopupMenu.Ornament.CHECK);
                    }
                    item.connect('activate', () => {
                        this._extension._setIconBackground(this._fileName, bg.key);
                        this.setBackground(bg.key);
                    });
                    bgSubMenu.menu.addMenuItem(item);
                }
                this._contextMenu.addMenuItem(bgSubMenu);

                this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                // Test Notification submenu - only for widgets
                const notifySubMenu = new PopupMenu.PopupSubMenuMenuItem('🔔 Test Notification');

                // Silent - just badge
                const notifySilent = new PopupMenu.PopupMenuItem('🔕 Silent (badge only)');
                notifySilent.connect('activate', () => {
                    this.notify({
                        level: 'silent',
                        badgeCount: 3,
                        duration: 10000,
                    });
                });
                notifySubMenu.menu.addMenuItem(notifySilent);

                // Subtle - glow in place
                const notifySubtle = new PopupMenu.PopupMenuItem('✨ Subtle (glow)');
                notifySubtle.connect('activate', () => {
                    this.notify({
                        message: 'Something happened...',
                        level: 'subtle',
                        badgeCount: 1,
                        duration: 5000,
                    });
                });
                notifySubMenu.menu.addMenuItem(notifySubtle);

                // Normal - popup near icon
                const notifyNormal = new PopupMenu.PopupMenuItem('📍 Normal (near icon)');
                notifyNormal.connect('activate', () => {
                    this.notify({
                        message: 'New update available',
                        level: 'normal',
                        duration: 4000,
                    });
                });
                notifySubMenu.menu.addMenuItem(notifyNormal);

                // Attention - center screen
                const notifyAttention = new PopupMenu.PopupMenuItem('👀 Attention (center)');
                notifyAttention.connect('activate', () => {
                    this.notify({
                        message: 'This needs your attention!',
                        level: 'attention',
                        badgeCount: 5,
                        duration: 5000,
                    });
                });
                notifySubMenu.menu.addMenuItem(notifyAttention);

                // Critical - center + pulse
                const notifyCritical = new PopupMenu.PopupMenuItem('🚨 Critical (urgent)');
                notifyCritical.connect('activate', () => {
                    this.notify({
                        message: '⚠️ Critical alert! Click to dismiss.',
                        level: 'critical',
                        duration: 0, // Manual dismiss
                    });
                });
                notifySubMenu.menu.addMenuItem(notifyCritical);

                this._contextMenu.addMenuItem(notifySubMenu);
            } // End of widget-only options

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Delete item
            const deleteItem = new PopupMenu.PopupMenuItem('Move to Trash');
            deleteItem.connect('activate', () => {
                this._moveToTrash();
            });
            this._contextMenu.addMenuItem(deleteItem);

            // Add to UI group (above windows)
            Main.uiGroup.add_child(this._contextMenu.actor);

            // Get mouse position in stage coordinates
            const [stageX, stageY] = event.get_coords();

            // Get work area (excludes panels/dash)
            const monitor = Main.layoutManager.primaryMonitor;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);

            // Open menu first to get its size
            this._contextMenu.open();

            // Get menu dimensions
            const menuWidth = this._contextMenu.actor.width;
            const menuHeight = this._contextMenu.actor.height;

            // Calculate position according to rules:
            // 1. If menu fits below mouse: top-left corner at mouse position
            // 2. If menu doesn't fit below but fits above: bottom-left corner at mouse position
            // 3. If menu doesn't fit either way: center vertically on mouse position

            let menuX = stageX;
            let menuY;

            const spaceBelow = (workArea.y + workArea.height) - stageY;
            const spaceAbove = stageY - workArea.y;

            if (menuHeight <= spaceBelow) {
                // Case 1: Fits below - top-left corner at mouse
                menuY = stageY;
            } else if (menuHeight <= spaceAbove) {
                // Case 2: Fits above - bottom-left corner at mouse
                menuY = stageY - menuHeight;
            } else {
                // Case 3: Doesn't fit either way - center on mouse
                menuY = stageY - menuHeight / 2;
            }

            // Handle horizontal positioning
            const spaceRight = (workArea.x + workArea.width) - stageX;
            if (menuWidth > spaceRight) {
                // Open to the left of cursor (right edge at mouse)
                menuX = stageX - menuWidth;
            }

            // Final clamp to work area bounds
            menuX = Math.max(workArea.x, Math.min(menuX, workArea.x + workArea.width - menuWidth));
            menuY = Math.max(workArea.y, Math.min(menuY, workArea.y + workArea.height - menuHeight));

            this._contextMenu.actor.set_position(menuX, menuY);

            // Store menu reference for submenu check
            const contextMenu = this._contextMenu;

            // Close menu when clicking outside
            this._menuCaptureId = global.stage.connect('captured-event', (actor, capturedEvent) => {
                if (capturedEvent.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [clickX, clickY] = capturedEvent.get_coords();

                    // Check if click is inside main menu
                    const [menuActorX, menuActorY] = contextMenu.actor.get_transformed_position();
                    const menuW = contextMenu.actor.width;
                    const menuH = contextMenu.actor.height;

                    const insideMainMenu = clickX >= menuActorX && clickX <= menuActorX + menuW &&
                        clickY >= menuActorY && clickY <= menuActorY + menuH;

                    // Check if click is inside any open submenu
                    let insideSubmenu = false;
                    for (const item of contextMenu._getMenuItems()) {
                        if (item instanceof PopupMenu.PopupSubMenuMenuItem && item.menu.isOpen) {
                            const subActor = item.menu.actor;
                            const [subX, subY] = subActor.get_transformed_position();
                            const subW = subActor.width;
                            const subH = subActor.height;

                            if (clickX >= subX && clickX <= subX + subW &&
                                clickY >= subY && clickY <= subY + subH) {
                                insideSubmenu = true;
                                break;
                            }
                        }
                    }

                    if (!insideMainMenu && !insideSubmenu) {
                        this._closeContextMenu();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Close menu when a window gets focus (clicking on an app)
            this._menuFocusId = global.display.connect('notify::focus-window', () => {
                const focusWindow = global.display.get_focus_window();
                // Only close if a real window gets focus
                if (focusWindow) {
                    this._closeContextMenu();
                }
            });
        }

        _closeContextMenu() {
            if (this._menuCaptureId) {
                global.stage.disconnect(this._menuCaptureId);
                this._menuCaptureId = null;
            }
            if (this._menuFocusId) {
                global.display.disconnect(this._menuFocusId);
                this._menuFocusId = null;
            }
            if (this._contextMenu) {
                this._contextMenu.close();
                this._contextMenu.destroy();
                this._contextMenu = null;
            }
        }

        _moveToTrash() {
            try {
                const file = this.getFile();
                if (file) {
                    file.trash(null);
                }
            } catch (e) {
                log(`Error moving to trash: ${e}`);
            }
        }

        updateSize(newSize) {
            this._iconSize = newSize;
            if (this._icon) {
                this._icon.set_icon_size(newSize);
            }

            // Update widget size to match new cell dimensions
            const cellWidth = this._extension._getCellWidth();
            const cellHeight = this._extension._getCellHeight();
            const widgetWidth = cellWidth * this._cellSize.cols;
            const widgetHeight = cellHeight * this._cellSize.rows;
            this.set_size(widgetWidth, widgetHeight);
        }

        getFile() {
            return this._fileInfo.get_attribute_object('standard::file');
        }

        getFileName() {
            return this._fileName;
        }

        destroy() {
            // Clean up context menu
            this._closeContextMenu();

            // Clean up notification if active
            if (this._isNotifying) {
                if (this._notifyTimeoutId) {
                    GLib.source_remove(this._notifyTimeoutId);
                    this._notifyTimeoutId = null;
                }
                if (this._notifyClone) {
                    this._notifyClone.destroy();
                    this._notifyClone = null;
                }
            }
            super.destroy();
        }
    }
);

/**
 * Grid overlay that draws the visual grid lines/dots
 */
const GridOverlay = GObject.registerClass(
    class GridOverlay extends St.DrawingArea {
        _init(extension) {
            super._init({
                reactive: false,
            });

            this._extension = extension;
            this.connect('repaint', this._onRepaint.bind(this));
        }

        _onRepaint() {
            const settings = this._extension._settings;
            if (!settings.get_boolean('grid-visible')) {
                return;
            }

            const cr = this.get_context();
            const [width, height] = this.get_surface_size();
            const cellWidth = this._extension._getCellWidth();
            const cellHeight = this._extension._getCellHeight();

            // Parse color
            const colorStr = settings.get_string('grid-color');
            const color = this._parseColor(colorStr);
            cr.setSourceRGBA(color.r, color.g, color.b, color.a);

            const lineWidth = settings.get_int('grid-line-width');
            cr.setLineWidth(lineWidth);

            const dotsOnly = settings.get_boolean('grid-dots-only');
            const pattern = settings.get_string('grid-line-pattern');

            if (dotsOnly) {
                this._drawDots(cr, width, height, cellWidth, cellHeight, lineWidth);
            } else {
                this._drawLines(cr, width, height, cellWidth, cellHeight, pattern);
            }

            cr.$dispose();
        }

        _parseColor(colorStr) {
            // Parse CSS color format: rgba(r,g,b,a) or rgb(r,g,b) or hex
            const rgbaMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (rgbaMatch) {
                return {
                    r: parseInt(rgbaMatch[1]) / 255,
                    g: parseInt(rgbaMatch[2]) / 255,
                    b: parseInt(rgbaMatch[3]) / 255,
                    a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
                };
            }
            // Default fallback
            return { r: 1, g: 1, b: 1, a: 0.3 };
        }

        _drawDots(cr, width, height, cellWidth, cellHeight, dotSize) {
            const radius = Math.max(dotSize, 2);

            for (let x = cellWidth; x < width; x += cellWidth) {
                for (let y = cellHeight; y < height; y += cellHeight) {
                    cr.arc(x, y, radius, 0, 2 * Math.PI);
                    cr.fill();
                }
            }
        }

        _drawLines(cr, width, height, cellWidth, cellHeight, pattern) {
            // Set dash pattern
            if (pattern === 'dashed') {
                cr.setDash([10, 5], 0);
            } else if (pattern === 'dotted') {
                cr.setDash([2, 4], 0);
            }
            // 'solid' = no dash

            // Vertical lines
            for (let x = cellWidth; x < width; x += cellWidth) {
                cr.moveTo(x, 0);
                cr.lineTo(x, height);
            }

            // Horizontal lines
            for (let y = cellHeight; y < height; y += cellHeight) {
                cr.moveTo(0, y);
                cr.lineTo(width, y);
            }

            cr.stroke();
        }

        refresh() {
            this.queue_repaint();
        }
    }
);

/**
 * Desktop grid container that manages icon layout
 */
const DesktopGrid = GObject.registerClass(
    class DesktopGrid extends St.Widget {
        _init(extension) {
            // Use NULL layout manager - we position children manually
            super._init({
                reactive: true,
                can_focus: true,
            });

            this._extension = extension;
            this._icons = [];

            // Click on empty area deselects
            this.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    this._extension._deselectAll();
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        addIcon(icon, x, y) {
            this._icons.push(icon);
            this.add_child(icon);

            // Position icon using fixed coordinates
            icon.set_position(x, y);
        }

        removeIcon(icon) {
            const index = this._icons.indexOf(icon);
            if (index > -1) {
                this._icons.splice(index, 1);
                icon.destroy();
            }
        }

        clearIcons() {
            for (const icon of this._icons) {
                icon.destroy();
            }
            this._icons = [];
        }

        getIcons() {
            return this._icons;
        }

        repositionIcons() {
            const cellWidth = this._extension._getCellWidth();
            const cellHeight = this._extension._getCellHeight();
            const iconSize = this._extension._getIconSize();
            const columns = this._extension._settings.get_int('grid-columns');

            let col = 0;
            let row = 0;

            for (const icon of this._icons) {
                const x = col * cellWidth;
                const y = row * cellHeight;

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
        this._fileMonitor = null;
        this._iconPositions = {}; // Cache for icon positions

        // Initialize cell grid (bidimensional array)
        this._cells = null;

        // Load saved positions
        this._loadIconPositions();

        // Setup global drag handler (single listener for all icons)
        this._setupGlobalDragHandler();

        // Create grid overlay (draws lines/dots)
        this._gridOverlay = new GridOverlay(this);

        // Create desktop grid
        this._grid = new DesktopGrid(this);

        // Add to background group (behind windows)
        // This ensures the grid and icons are at desktop level, not above windows
        Main.layoutManager._backgroundGroup.add_child(this._gridOverlay);
        Main.layoutManager._backgroundGroup.add_child(this._grid);

        // Position grid and overlay
        this._updateGridPosition();

        // Build cell grid structure
        this._buildCellGrid();

        // Load desktop files
        this._loadDesktopFiles();

        // Monitor desktop directory for changes
        this._setupFileMonitor();

        // Connect to settings changes
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'icon-size') {
                this._buildCellGrid();
                this._reloadIcons();
                this._gridOverlay.refresh();
            } else if (key === 'grid-columns' || key === 'grid-rows') {
                // Grid dimensions changed - rebuild cell grid
                this._buildCellGrid();
                this._reloadIcons();
                this._gridOverlay.refresh();
            } else if (key.startsWith('grid-') || key === 'use-grid') {
                this._gridOverlay.refresh();
            }
        });

        // Monitor for monitor changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._updateGridPosition();
            this._buildCellGrid();
            this._reloadIcons();
        });

        log('Obision Desk enabled');
    }

    disable() {
        log('Obision Desk disabling...');

        // Cleanup global drag handler
        this._cleanupGlobalDragHandler();

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

        // Remove grid overlay
        if (this._gridOverlay) {
            Main.layoutManager._backgroundGroup.remove_child(this._gridOverlay);
            this._gridOverlay.destroy();
            this._gridOverlay = null;
        }

        // Remove grid
        if (this._grid) {
            Main.layoutManager._backgroundGroup.remove_child(this._grid);
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

        log(`[Obision] WorkArea: x=${workArea.x}, y=${workArea.y}, w=${workArea.width}, h=${workArea.height}`);
        log(`[Obision] Monitor: w=${monitor.width}, h=${monitor.height}`);

        // Position grid overlay
        if (this._gridOverlay) {
            this._gridOverlay.set_position(workArea.x, workArea.y);
            this._gridOverlay.set_size(workArea.width, workArea.height);
            this._gridOverlay.refresh();
        }

        // Position icon container
        this._grid.set_position(workArea.x, workArea.y);
        this._grid.set_size(workArea.width, workArea.height);

        // Rebuild cell grid when position changes
        this._buildCellGrid();
    }

    /**
     * Build the bidimensional cell grid structure
     * Each cell contains: x, y, width, height, icon reference, occupied status
     */
    _buildCellGrid() {
        const columns = this._settings.get_int('grid-columns');
        const rows = this._settings.get_int('grid-rows');
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();

        // Initialize 2D array
        this._cells = [];

        for (let col = 0; col < columns; col++) {
            this._cells[col] = [];
            for (let row = 0; row < rows; row++) {
                this._cells[col][row] = {
                    col: col,
                    row: row,
                    x: col * cellWidth,
                    y: row * cellHeight,
                    width: cellWidth,
                    height: cellHeight,
                    icon: null,
                    occupied: false,
                };
            }
        }

        log(`[Obision] Cell grid built: ${columns}x${rows}, cell size: ${cellWidth}x${cellHeight}`);
    }

    /**
     * Get cell at column, row
     */
    getCell(col, row) {
        if (!this._cells) return null;
        if (col < 0 || row < 0) return null;
        if (col >= this._cells.length) return null;
        if (row >= this._cells[col].length) return null;
        return this._cells[col][row];
    }

    /**
     * Get cell at pixel coordinates
     */
    getCellAtPixel(x, y) {
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        const col = Math.floor(x / cellWidth);
        const row = Math.floor(y / cellHeight);
        return this.getCell(col, row);
    }

    /**
     * Place icon in cell (marks cells as occupied for multi-cell icons)
     */
    placeIconInCell(icon, col, row) {
        const cellSize = icon._cellSize || { cols: 1, rows: 1 };

        // Mark all cells this icon occupies
        for (let dc = 0; dc < cellSize.cols; dc++) {
            for (let dr = 0; dr < cellSize.rows; dr++) {
                const cell = this.getCell(col + dc, row + dr);
                if (cell) {
                    cell.occupied = true;
                    cell.icon = icon;
                }
            }
        }

        // Position the icon at the cell's pixel position
        const cell = this.getCell(col, row);
        if (cell) {
            icon.set_position(cell.x, cell.y);
        }
    }

    /**
     * Remove icon from its cells
     */
    removeIconFromCells(icon) {
        if (!this._cells) return;

        const columns = this._settings.get_int('grid-columns');
        const rows = this._settings.get_int('grid-rows');

        for (let col = 0; col < columns; col++) {
            for (let row = 0; row < rows; row++) {
                const cell = this._cells[col][row];
                if (cell.icon === icon) {
                    cell.icon = null;
                    cell.occupied = false;
                }
            }
        }
    }

    /**
     * Check if cells are free for placing an icon
     */
    areCellsFree(col, row, cellSize, excludeIcon = null) {
        const cols = cellSize.cols || 1;
        const rows = cellSize.rows || 1;

        for (let dc = 0; dc < cols; dc++) {
            for (let dr = 0; dr < rows; dr++) {
                const cell = this.getCell(col + dc, row + dr);
                if (!cell) return false; // Out of bounds
                if (cell.occupied && cell.icon !== excludeIcon) return false;
            }
        }
        return true;
    }

    /**
     * Find first free cell that can fit the icon
     */
    findFreeCell(cellSize, excludeIcon = null) {
        const columns = this._settings.get_int('grid-columns');
        const rows = this._settings.get_int('grid-rows');

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                if (this.areCellsFree(col, row, cellSize, excludeIcon)) {
                    return { col, row };
                }
            }
        }
        return null;
    }

    /**
     * Find nearest free cell to target position
     */
    findNearestFreeCell(targetCol, targetRow, cellSize, excludeIcon = null) {
        // Try target cell first
        if (this.areCellsFree(targetCol, targetRow, cellSize, excludeIcon)) {
            return { col: targetCol, row: targetRow };
        }

        // Spiral search
        const maxRadius = 20;
        for (let radius = 1; radius <= maxRadius; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;

                    const col = targetCol + dc;
                    const row = targetRow + dr;

                    if (col < 0 || row < 0) continue;

                    if (this.areCellsFree(col, row, cellSize, excludeIcon)) {
                        return { col, row };
                    }
                }
            }
        }
        return null;
    }

    _getCellWidth() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return 80;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const columns = this._settings.get_int('grid-columns');
        return Math.floor(workArea.width / columns);
    }

    _getCellHeight() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return 100;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const rows = this._settings.get_int('grid-rows');
        return Math.floor(workArea.height / rows);
    }

    _getBaseIconSize() {
        // Base icon size is the size that fits in a single cell
        // Account for padding and label
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        const padding = Math.floor(Math.min(cellWidth, cellHeight) * CELL_PADDING_RATIO);
        const availableHeight = cellHeight - LABEL_HEIGHT - padding * 2;
        const availableWidth = cellWidth - padding * 2;
        return Math.max(MIN_ICON_SIZE, Math.min(availableWidth, availableHeight));
    }

    _getIconPixelSize(cellSize) {
        // Calculate pixel size for an icon based on cell dimensions
        // cellSize is {cols, rows} - use minimum dimension to keep icon square
        const baseSize = this._getBaseIconSize();
        const cells = typeof cellSize === 'object'
            ? Math.min(cellSize.cols, cellSize.rows)
            : cellSize;
        return Math.max(MIN_ICON_SIZE, baseSize * cells);
    }

    _getCellSize() {
        // Alias for _getCellWidth for backward compatibility
        return this._getCellWidth();
    }

    _getIconSize() {
        // Return base icon size (1x1 cell icon size)
        return this._getBaseIconSize();
    }

    _snapToGrid(x, y, icon = null) {
        const cellWidth = this._getCellSize();
        const cellHeight = this._getCellHeight();

        // If icon provided, use its center for snapping
        let snapX = x;
        let snapY = y;
        if (icon && icon._cellSize) {
            // Add half the icon's width/height to get center point
            const iconWidth = cellWidth * icon._cellSize.cols;
            const iconHeight = cellHeight * icon._cellSize.rows;
            snapX = x + iconWidth / 2;
            snapY = y + iconHeight / 2;
        }

        // Determine which cell the center point is in
        const col = Math.floor(snapX / cellWidth);
        const row = Math.floor(snapY / cellHeight);

        return {
            x: col * cellWidth,
            y: row * cellHeight,
            col: col,
            row: row,
        };
    }

    _isCellOccupied(col, row, excludeIcon = null) {
        const cellWidth = this._getCellSize();
        const cellHeight = this._getCellHeight();

        for (const icon of this._grid.getIcons()) {
            if (icon === excludeIcon) continue;

            const iconCol = Math.round(icon.x / cellWidth);
            const iconRow = Math.round(icon.y / cellHeight);
            const iconCellSize = icon._cellSize || { cols: 1, rows: 1 };
            const iconCols = iconCellSize.cols || 1;
            const iconRows = iconCellSize.rows || 1;

            // Check if (col, row) falls within this icon's cell range
            if (col >= iconCol && col < iconCol + iconCols &&
                row >= iconRow && row < iconRow + iconRows) {
                return true;
            }
        }
        return false;
    }

    _areCellsFree(startCol, startRow, cellSize, excludeIcon = null) {
        // Check if all cells needed for an icon of given size are free
        // cellSize is {cols, rows}
        const cols = typeof cellSize === 'object' ? cellSize.cols : cellSize;
        const rows = typeof cellSize === 'object' ? cellSize.rows : cellSize;

        for (let dc = 0; dc < cols; dc++) {
            for (let dr = 0; dr < rows; dr++) {
                if (this._isCellOccupied(startCol + dc, startRow + dr, excludeIcon)) {
                    return false;
                }
            }
        }
        return true;
    }

    _findNearestFreeCell(targetCol, targetRow, excludeIcon = null) {
        // Get the cell size of the icon being placed
        const iconCellSize = excludeIcon?._cellSize || { cols: 1, rows: 1 };

        // Spiral search for nearest free cell block
        const maxRadius = 20;

        for (let radius = 0; radius <= maxRadius; radius++) {
            for (let dc = -radius; dc <= radius; dc++) {
                for (let dr = -radius; dr <= radius; dr++) {
                    if (radius > 0 && Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;

                    const col = targetCol + dc;
                    const row = targetRow + dr;

                    if (col < 0 || row < 0) continue;

                    // Check if all required cells are free
                    if (this._areCellsFree(col, row, iconCellSize, excludeIcon)) {
                        return { col, row };
                    }
                }
            }
        }
        return null;
    }

    // ===== Public Notification API =====

    /**
     * Send a notification to a desktop icon by filename
     * @param {string} fileName - The name of the file on the desktop
     * @param {Object} options - Notification options (message, urgency, duration, pulse)
     * @returns {boolean} - True if notification was sent
     */
    notifyIcon(fileName, options = {}) {
        const icon = this._findIconByName(fileName);
        if (icon) {
            icon.notify(options);
            return true;
        }
        log(`Obision Desk: Icon not found for notification: ${fileName}`);
        return false;
    }

    /**
     * Dismiss notification on a specific icon
     * @param {string} fileName - The name of the file
     */
    dismissIconNotification(fileName) {
        const icon = this._findIconByName(fileName);
        if (icon) {
            icon.dismissNotification();
        }
    }

    /**
     * Dismiss all active notifications
     */
    dismissAllNotifications() {
        for (const icon of this._grid.getIcons()) {
            if (icon.isNotifying) {
                icon.dismissNotification();
            }
        }
    }

    /**
     * Find an icon by its filename
     * @param {string} fileName - The filename to search for
     * @returns {DesktopIcon|null}
     */
    _findIconByName(fileName) {
        for (const icon of this._grid.getIcons()) {
            if (icon.getFileName() === fileName) {
                return icon;
            }
        }
        return null;
    }

    _getDefaultCellSize() {
        const sizeKey = this._settings.get_string('icon-size');
        return ICON_CELL_SIZES[sizeKey] || { cols: 1, rows: 1 };
    }

    // Cell-based size methods
    _getIconCellSize(fileName) {
        const customSize = this._getCustomIconCellSize(fileName);
        if (customSize) {
            return ICON_CELL_SIZES[customSize] || { cols: 1, rows: 1 };
        }
        return this._getDefaultCellSize(); // Use default from settings
    }

    _getCustomIconCellSize(fileName) {
        try {
            const json = this._settings.get_string('custom-icon-sizes');
            const customSizes = JSON.parse(json) || {};
            return customSizes[fileName] || null;
        } catch (e) {
            return null;
        }
    }

    _setCustomIconCellSize(fileName, cellSizeKey) {
        try {
            const json = this._settings.get_string('custom-icon-sizes');
            const customSizes = JSON.parse(json) || {};
            customSizes[fileName] = cellSizeKey;
            this._settings.set_string('custom-icon-sizes', JSON.stringify(customSizes));
        } catch (e) {
            log(`Error saving custom icon cell size: ${e}`);
        }
    }

    _removeCustomIconCellSize(fileName) {
        try {
            const json = this._settings.get_string('custom-icon-sizes');
            const customSizes = JSON.parse(json) || {};
            delete customSizes[fileName];
            this._settings.set_string('custom-icon-sizes', JSON.stringify(customSizes));
        } catch (e) {
            log(`Error removing custom icon cell size: ${e}`);
        }
    }

    // ===== Elevation Methods =====

    _getIconElevation(fileName) {
        try {
            const json = this._settings.get_string('icon-elevations');
            const elevations = JSON.parse(json) || {};
            if (elevations[fileName] !== undefined) {
                return elevations[fileName];
            }
            // Return default elevation
            return this._settings.get_int('default-elevation');
        } catch (e) {
            return 0;
        }
    }

    _setIconElevation(fileName, level) {
        try {
            const json = this._settings.get_string('icon-elevations');
            const elevations = JSON.parse(json) || {};
            if (level === this._settings.get_int('default-elevation')) {
                // If setting to default, remove custom setting
                delete elevations[fileName];
            } else {
                elevations[fileName] = level;
            }
            this._settings.set_string('icon-elevations', JSON.stringify(elevations));
        } catch (e) {
            log(`Error saving icon elevation: ${e}`);
        }
    }

    // ===== Background Methods =====

    _getIconBackground(fileName) {
        try {
            const json = this._settings.get_string('icon-backgrounds');
            const backgrounds = JSON.parse(json) || {};
            if (backgrounds[fileName]) {
                return backgrounds[fileName];
            }
            // Return default background
            return this._settings.get_string('default-background');
        } catch (e) {
            return 'none';
        }
    }

    _setIconBackground(fileName, style) {
        try {
            const json = this._settings.get_string('icon-backgrounds');
            const backgrounds = JSON.parse(json) || {};
            const defaultBg = this._settings.get_string('default-background');
            if (style === defaultBg) {
                // If setting to default, remove custom setting
                delete backgrounds[fileName];
            } else {
                backgrounds[fileName] = style;
            }
            this._settings.set_string('icon-backgrounds', JSON.stringify(backgrounds));
        } catch (e) {
            log(`Error saving icon background: ${e}`);
        }
    }

    // ===== Widget Mode Methods =====

    _isIconWidget(fileName) {
        try {
            const json = this._settings.get_string('icon-widgets');
            const widgets = JSON.parse(json) || {};
            return widgets[fileName] === true;
        } catch (e) {
            return false;
        }
    }

    _setIconWidget(fileName, isWidget) {
        try {
            const json = this._settings.get_string('icon-widgets');
            const widgets = JSON.parse(json) || {};
            if (isWidget) {
                widgets[fileName] = true;
            } else {
                delete widgets[fileName];
            }
            this._settings.set_string('icon-widgets', JSON.stringify(widgets));
        } catch (e) {
            log(`Error saving widget mode: ${e}`);
        }
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

    _loadIconPositions() {
        try {
            const json = this._settings.get_string('icon-positions');
            this._iconPositions = JSON.parse(json) || {};
        } catch (e) {
            this._iconPositions = {};
        }
    }

    // ===== Global Drag System =====
    // Single stage listener handles all icon dragging

    _setupGlobalDragHandler() {
        this._dragIcon = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._iconStartX = 0;
        this._iconStartY = 0;
        this._isDragging = false;
        this._dragOriginalX = 0;
        this._dragOriginalY = 0;

        this._stageEventId = global.stage.connect('captured-event',
            this._onGlobalCapturedEvent.bind(this));
    }

    _cleanupGlobalDragHandler() {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = null;
        }
        this._dragIcon = null;
    }

    _startIconDrag(icon, stageX, stageY) {
        // Cancel any previous drag
        this._cancelDrag();

        log(`[Obision] _startIconDrag: ${icon._fileName} at stage (${stageX}, ${stageY}), icon pos (${icon.x}, ${icon.y})`);

        this._dragIcon = icon;
        this._dragStartX = stageX;
        this._dragStartY = stageY;
        this._iconStartX = icon.x;
        this._iconStartY = icon.y;
        this._isDragging = false;
    }

    _onGlobalCapturedEvent(actor, event) {
        // No icon being tracked
        if (!this._dragIcon) {
            return Clutter.EVENT_PROPAGATE;
        }

        // Safety check - verify icon is still valid
        try {
            if (!this._dragIcon.get_parent()) {
                this._dragIcon = null;
                return Clutter.EVENT_PROPAGATE;
            }
        } catch (e) {
            this._dragIcon = null;
            return Clutter.EVENT_PROPAGATE;
        }

        const type = event.type();

        if (type === Clutter.EventType.MOTION) {
            // Check if mouse button is still pressed
            const state = event.get_state();
            const buttonPressed = (state & Clutter.ModifierType.BUTTON1_MASK) !== 0;

            if (!buttonPressed) {
                // Button was released but we missed the event
                log(`[Obision] Motion: button not pressed, ending drag`);
                this._endDrag();
                return Clutter.EVENT_PROPAGATE;
            }

            const [stageX, stageY] = event.get_coords();
            const dx = stageX - this._dragStartX;
            const dy = stageY - this._dragStartY;

            // Start actual drag if moved more than 5 pixels
            if (!this._isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                log(`[Obision] Starting actual drag, delta (${dx}, ${dy})`);
                this._isDragging = true;
                this._dragIcon._dragging = true;
                this._dragIcon.add_style_class_name('dragging');

                // Save original position for rollback
                this._dragOriginalX = this._dragIcon.x;
                this._dragOriginalY = this._dragIcon.y;

                // Raise icon to top
                const parent = this._dragIcon.get_parent();
                if (parent)
                    parent.set_child_above_sibling(this._dragIcon, null);

                // Reset to eliminate jump
                this._dragStartX = stageX;
                this._dragStartY = stageY;
                this._iconStartX = this._dragIcon.x;
                this._iconStartY = this._dragIcon.y;
            }

            if (this._isDragging) {
                // Check if mouse hit screen edge - cancel and return
                const monitor = Main.layoutManager.primaryMonitor;
                if (stageX <= 0 || stageX >= monitor.width - 1 ||
                    stageY <= 0 || stageY >= monitor.height - 1) {
                    this._cancelDrag();
                    return Clutter.EVENT_STOP;
                }

                // Move icon
                const currentDx = stageX - this._dragStartX;
                const currentDy = stageY - this._dragStartY;
                this._dragIcon.set_position(
                    this._iconStartX + currentDx,
                    this._iconStartY + currentDy
                );
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.BUTTON_RELEASE) {
            if (this._dragIcon) {
                log(`[Obision] Button release, wasDragging: ${this._isDragging}`);
                const wasDragging = this._isDragging;
                this._endDrag();
                return wasDragging ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _cancelDrag() {
        if (!this._dragIcon) return;

        const icon = this._dragIcon;
        const wasDragging = this._isDragging;

        // Reset state
        this._dragIcon = null;
        this._isDragging = false;

        if (wasDragging) {
            icon._dragging = false;
            icon.remove_style_class_name('dragging');

            // Animate back to original position
            icon.ease({
                x: this._dragOriginalX,
                y: this._dragOriginalY,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _endDrag() {
        if (!this._dragIcon) return;

        const icon = this._dragIcon;
        const wasDragging = this._isDragging;

        // Reset state first
        this._dragIcon = null;
        this._isDragging = false;

        if (wasDragging) {
            icon._dragging = false;
            icon.remove_style_class_name('dragging');

            const useGrid = this._settings.get_boolean('use-grid');

            if (useGrid && this._cells) {
                // Remove icon from old cells
                this.removeIconFromCells(icon);

                // Get icon center position to determine target cell
                const cellWidth = this._getCellWidth();
                const cellHeight = this._getCellHeight();
                const iconCols = icon._cellSize?.cols || 1;
                const iconRows = icon._cellSize?.rows || 1;

                // Use icon center for determining cell
                const centerX = icon.x + (cellWidth * iconCols) / 2;
                const centerY = icon.y + (cellHeight * iconRows) / 2;

                const targetCol = Math.floor(centerX / cellWidth);
                const targetRow = Math.floor(centerY / cellHeight);

                log(`[Obision] Drop: icon at (${icon.x}, ${icon.y}), center (${centerX}, ${centerY}), target cell (${targetCol}, ${targetRow})`);

                // Find free cell (target or nearest)
                const freeCell = this.findNearestFreeCell(targetCol, targetRow, icon._cellSize || { cols: 1, rows: 1 }, icon);

                if (freeCell) {
                    const cell = this.getCell(freeCell.col, freeCell.row);
                    if (cell) {
                        log(`[Obision] Placing in cell (${freeCell.col}, ${freeCell.row}) at pixel (${cell.x}, ${cell.y})`);

                        // Animate to cell position
                        icon.ease({
                            x: cell.x,
                            y: cell.y,
                            duration: 150,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                // Mark cells as occupied
                                this.placeIconInCell(icon, freeCell.col, freeCell.row);
                                this._saveIconPosition(icon._fileName, cell.x, cell.y);
                            }
                        });
                        return;
                    }
                }

                // No free cell, return to original
                log(`[Obision] No free cell, returning to original`);
                icon.ease({
                    x: this._dragOriginalX,
                    y: this._dragOriginalY,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        // Re-place in original cell
                        const origCell = this.getCellAtPixel(this._dragOriginalX, this._dragOriginalY);
                        if (origCell) {
                            this.placeIconInCell(icon, origCell.col, origCell.row);
                        }
                    }
                });
            } else {
                // Free positioning mode (no grid)
                this._saveIconPosition(icon._fileName, icon.x, icon.y);
            }
        }
    }

    _findCollidingIcon(draggedIcon, x, y) {
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();

        for (const otherIcon of this._grid.getIcons()) {
            if (otherIcon === draggedIcon) continue;

            // Check bounding box overlap
            const overlapX = Math.abs(x - otherIcon.x) < cellWidth;
            const overlapY = Math.abs(y - otherIcon.y) < cellHeight;

            if (overlapX && overlapY) {
                return otherIcon;
            }
        }
        return null;
    }

    _findNearestFreePosition(draggedIcon, targetIcon, dropX, dropY) {
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        const bounds = this._getValidBounds();

        // 8 positions around the target icon (adjacent cells)
        const offsets = [
            { dx: cellWidth, dy: 0 },        // right
            { dx: -cellWidth, dy: 0 },       // left
            { dx: 0, dy: cellHeight },       // below
            { dx: 0, dy: -cellHeight },      // above
            { dx: cellWidth, dy: -cellHeight },   // top-right
            { dx: -cellWidth, dy: -cellHeight },  // top-left
            { dx: cellWidth, dy: cellHeight },    // bottom-right
            { dx: -cellWidth, dy: cellHeight },   // bottom-left
        ];

        // Sort by distance to drop position
        offsets.sort((a, b) => {
            const posA = { x: targetIcon.x + a.dx, y: targetIcon.y + a.dy };
            const posB = { x: targetIcon.x + b.dx, y: targetIcon.y + b.dy };
            const distA = Math.hypot(posA.x - dropX, posA.y - dropY);
            const distB = Math.hypot(posB.x - dropX, posB.y - dropY);
            return distA - distB;
        });

        for (const offset of offsets) {
            const testX = targetIcon.x + offset.dx;
            const testY = targetIcon.y + offset.dy;

            // Check bounds
            if (testX < 0 || testX > bounds.maxX || testY < 0 || testY > bounds.maxY) {
                continue;
            }

            // Check if position is free
            if (!this._findCollidingIcon(draggedIcon, testX, testY)) {
                return { x: testX, y: testY };
            }
        }

        return null; // No free position found
    }

    _getValidBounds() {
        // Use grid dimensions since icons are positioned relative to grid
        const grid = this._grid;
        if (!grid) {
            return { maxX: 800, maxY: 600 }; // Fallback
        }
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        const maxX = grid.width - cellWidth;
        const maxY = grid.height - cellHeight;
        return { maxX: Math.max(0, maxX), maxY: Math.max(0, maxY) };
    }

    _saveIconPosition(fileName, x, y) {
        const bounds = this._getValidBounds();
        const clampedX = Math.max(0, Math.min(x, bounds.maxX));
        const clampedY = Math.max(0, Math.min(y, bounds.maxY));

        this._iconPositions[fileName] = { x: clampedX, y: clampedY };
        try {
            this._settings.set_string('icon-positions', JSON.stringify(this._iconPositions));
        } catch (e) {
            log(`Error saving icon position: ${e}`);
        }
    }

    _getIconPosition(fileName, defaultX, defaultY) {
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();

        if (this._iconPositions[fileName]) {
            const saved = this._iconPositions[fileName];
            const bounds = this._getValidBounds();

            // Snap saved position to current grid
            const col = Math.round(saved.x / cellWidth);
            const row = Math.round(saved.y / cellHeight);

            // Clamp to valid range
            const x = Math.max(0, Math.min(col * cellWidth, bounds.maxX));
            const y = Math.max(0, Math.min(row * cellHeight, bounds.maxY));
            return { x, y };
        }

        // Snap default position to grid too
        const col = Math.round(defaultX / cellWidth);
        const row = Math.round(defaultY / cellHeight);
        return { x: col * cellWidth, y: row * cellHeight };
    }

    /**
     * Reload all icons (clear and re-add)
     */
    _reloadIcons() {
        // Save current icon positions before clearing
        for (const icon of this._grid.getIcons()) {
            this._saveIconPosition(icon._fileName, icon.x, icon.y);
        }

        // Clear icons and cell grid
        this._grid.clearIcons();
        this._buildCellGrid();

        // Reload from desktop
        this._loadDesktopFiles();
    }

    _loadDesktopFiles() {
        const desktopPath = this._getDesktopPath();
        const desktopDir = Gio.File.new_for_path(desktopPath);

        if (!desktopDir.query_exists(null)) {
            return;
        }

        try {
            const enumerator = desktopDir.enumerate_children(
                'standard::*',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let fileInfo;

            while ((fileInfo = enumerator.next_file(null)) !== null) {
                const name = fileInfo.get_name();

                // Skip hidden files
                if (name.startsWith('.')) continue;

                // Store file reference in the file info
                const file = desktopDir.get_child(name);
                fileInfo.set_attribute_object('standard::file', file);

                // Create icon first to know its cell size
                const icon = new DesktopIcon(fileInfo, this, name);
                const iconCellSize = icon._cellSize || { cols: 1, rows: 1 };

                // Try to get saved position
                let targetCol = 0;
                let targetRow = 0;

                if (this._iconPositions[name]) {
                    const saved = this._iconPositions[name];
                    const cellWidth = this._getCellWidth();
                    const cellHeight = this._getCellHeight();
                    targetCol = Math.floor(saved.x / cellWidth);
                    targetRow = Math.floor(saved.y / cellHeight);
                }

                // Find a free cell (saved position or first available)
                let freeCell = null;
                if (this.areCellsFree(targetCol, targetRow, iconCellSize)) {
                    freeCell = { col: targetCol, row: targetRow };
                } else {
                    freeCell = this.findFreeCell(iconCellSize);
                }

                if (freeCell) {
                    const cell = this.getCell(freeCell.col, freeCell.row);
                    if (cell) {
                        this._grid.addIcon(icon, cell.x, cell.y);
                        this.placeIconInCell(icon, freeCell.col, freeCell.row);
                        log(`[Obision] Loaded ${name} at cell (${freeCell.col}, ${freeCell.row})`);
                    }
                } else {
                    // No free cell, add at 0,0 (shouldn't happen normally)
                    this._grid.addIcon(icon, 0, 0);
                    log(`[Obision] Warning: No free cell for ${name}`);
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
