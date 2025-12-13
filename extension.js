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
import Pango from 'gi://Pango';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';

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
 * Represents a single desktop icon
 */
const DesktopIcon = GObject.registerClass(
    class DesktopIcon extends St.BoxLayout {
        _init(fileInfo, extension, fileName) {
            // Get cell size for this icon (cols x rows)
            this._cellSize = extension._getIconCellSize(fileName);

            // Calculate widget size to exactly fit the cells
            const cellWidth = extension._getCellWidth();
            const cellHeight = extension._getCellHeight();
            const widgetWidth = cellWidth * this._cellSize.cols;
            const widgetHeight = cellHeight * this._cellSize.rows;

            // Calculate icon size based on available space
            // For the icon image, use the minimum dimension to keep it square
            // Account for label height and internal spacing
            const internalSpacing = 8; // Minimal spacing for visual comfort
            const labelHeight = LABEL_HEIGHT;
            const availableWidth = widgetWidth - internalSpacing;
            const availableHeight = widgetHeight - labelHeight - internalSpacing;
            const iconSize = Math.max(MIN_ICON_SIZE, Math.min(availableWidth, availableHeight));

            super._init({
                reactive: true,
                can_focus: true,
                track_hover: false,
                style_class: 'desktop-icon',
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

            // Apply background style to the main widget
            this._applyBackgroundStyle();

            // Inner container to group icon+label and center them together
            this._innerBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._innerBox);

            // Icon container
            this._iconContainer = new St.Bin({
                style_class: 'desktop-icon-container',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._innerBox.add_child(this._iconContainer);

            // Create icon from file info
            this._createIcon();

            // Apply elevation to the icon image only
            this._applyElevationStyle();

            // Calculate font size proportionally to cell size
            // For larger icons (2x2, 3x3, 4x4, etc.), use larger fonts  
            const baseFontSize = 12;
            const cellSizeMultiplier = Math.max(this._cellSize.cols, this._cellSize.rows);
            // Progressive scaling: 1x1=12px, 2x2=17px, 3x3=23px, 4x4=30px
            const fontSize = Math.round(baseFontSize + (cellSizeMultiplier - 1) * 5 + (cellSizeMultiplier > 2 ? 3 : 0));

            // Label - St.Label handles wrapping automatically with width constraint
            this._label = new St.Label({
                text: this._getDisplayName(),
                style_class: 'desktop-icon-label',
                style: `font-size: ${fontSize}px;`,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                width: widgetWidth - 8,
            });
            // Configure wrapping for 2 lines
            this._label.clutter_text.set_line_wrap(true);
            this._label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            this._label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            this._label.clutter_text.set_single_line_mode(false);
            // Set max lines to 2 and ellipsize at the end
            this._label.clutter_text.set_max_length(-1); // unlimited chars
            const clutterText = this._label.clutter_text;
            clutterText.ellipsize = Pango.EllipsizeMode.END;
            // Calculate height for exactly 2 lines
            const lineHeight = Math.ceil(fontSize * 1.2);
            this._label.set_style(`font-size: ${fontSize}px; max-height: ${lineHeight * 2 + 4}px;`);
            this._innerBox.add_child(this._label);

            // Setup event handlers
            this._setupEvents();
        }

        _applyElevationStyle() {
            if (!this._icon) return;
            // Get elevation for this icon
            const elevation = this._extension._getIconElevation(this._fileName);
            this._elevation = elevation;

            // Apply icon-shadow based on elevation level (bottom-right direction)
            let shadowStyle = '';
            switch (elevation) {
                case 1:
                    shadowStyle = 'icon-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);';
                    break;
                case 2:
                    shadowStyle = 'icon-shadow: 4px 4px 8px rgba(0, 0, 0, 0.6);';
                    break;
                case 3:
                    shadowStyle = 'icon-shadow: 6px 6px 12px rgba(0, 0, 0, 0.7);';
                    break;
                default:
                    shadowStyle = '';
            }

            if (shadowStyle) {
                this._icon.set_style(shadowStyle);
            }
        } _applyBackgroundStyle() {
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
            if (!this._icon) return;
            this._elevation = level;

            // Apply icon-shadow based on elevation level (bottom-right direction)
            let shadowStyle = '';
            switch (level) {
                case 1:
                    shadowStyle = 'icon-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);';
                    break;
                case 2:
                    shadowStyle = 'icon-shadow: 4px 4px 8px rgba(0, 0, 0, 0.7);';
                    break;
                case 3:
                    shadowStyle = 'icon-shadow: 6px 6px 12px rgba(0, 0, 0, 0.7);';
                    break;
                default:
                    shadowStyle = '';
            }

            if (shadowStyle) {
                this._icon.set_style(shadowStyle);
            } else {
                this._icon.set_style('');
            }
        } setBackground(style) {
            const bgClasses = ['bg-none', 'bg-light', 'bg-dark', 'bg-accent'];
            for (const cls of bgClasses) {
                this.remove_style_class_name(cls);
            }
            this.add_style_class_name(`bg-${style}`);
            this._background = style;
        }

        _createIcon() {
            try {
                let gicon = null;
                let iconName = null;

                // Check for special icons first
                const isTrash = this._fileInfo.get_attribute_boolean('special::is-trash');
                const isHome = this._fileInfo.get_attribute_boolean('special::is-home');
                const fileType = this._fileInfo.get_file_type();

                if (isTrash) {
                    iconName = 'user-trash-full';
                } else if (isHome) {
                    iconName = 'user-home';
                } else if (fileType === Gio.FileType.DIRECTORY) {
                    // For folders, use folder icon directly
                    iconName = 'folder';
                } else {
                    // Check if it's a .desktop file
                    const fileName = this._fileInfo.get_name();
                    if (fileName && fileName.endsWith('.desktop')) {
                        try {
                            const file = this._fileInfo.get_attribute_object('standard::file');
                            if (file && file.get_path()) {
                                const desktopAppInfo = Gio.DesktopAppInfo.new_from_filename(file.get_path());
                                if (desktopAppInfo) {
                                    gicon = desktopAppInfo.get_icon();
                                }
                            }
                        } catch (e) {
                            log(`Error reading .desktop file: ${e}`);
                        }
                    }

                    // Fallback to content type icon
                    if (!gicon) {
                        let contentType = this._fileInfo.get_content_type();
                        // Always try to guess from filename for better detection
                        if (fileName) {
                            const [guessedType, certain] = Gio.content_type_guess(fileName, null);
                            if (guessedType) {
                                contentType = guessedType;
                            }
                        }
                        if (contentType) {
                            const appInfo = Gio.AppInfo.get_default_for_type(contentType, false);
                            gicon = appInfo ? appInfo.get_icon() : Gio.content_type_get_icon(contentType);
                        }
                    }

                    // Final fallback to file's standard icon
                    if (!gicon) {
                        gicon = this._fileInfo.get_icon();
                    }
                }

                // Extract icon name from GIcon, preferring non-symbolic variants
                let finalIconName = iconName;
                if (!finalIconName && gicon && gicon.constructor.name === 'GThemedIcon') {
                    const names = gicon.get_names ? gicon.get_names() : [];

                    // Find first non-symbolic icon name
                    for (const name of names) {
                        if (name && !name.endsWith('-symbolic')) {
                            finalIconName = name;
                            break;
                        }
                    }

                    // If only symbolic variants exist, remove -symbolic suffix
                    if (!finalIconName && names.length > 0) {
                        finalIconName = names[0].replace('-symbolic', '');
                    }
                }

                // Create icon
                if (finalIconName) {
                    this._icon = new St.Icon({
                        icon_name: finalIconName,
                        icon_size: this._iconSize,
                        style_class: 'desktop-icon-image',
                        fallback_icon_name: 'application-x-executable',
                    });
                } else if (gicon) {
                    this._icon = new St.Icon({
                        gicon: gicon,
                        icon_size: this._iconSize,
                        style_class: 'desktop-icon-image',
                        fallback_icon_name: 'application-x-executable',
                    });
                } else {
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
            // Check if it's the Home folder
            const isHome = this._fileInfo.get_attribute_boolean('special::is-home');
            if (isHome) {
                // Get the real user name (full name) from /etc/passwd or use username as fallback
                try {
                    const userName = GLib.get_real_name();
                    // GLib.get_real_name() returns "Unknown" if not set, fallback to username
                    if (userName && userName !== 'Unknown') {
                        return userName;
                    }
                } catch (e) {
                    log(`Error getting real name: ${e}`);
                }
                // Fallback to username
                return GLib.get_user_name();
            }

            // For .desktop files, get the app name from the file
            const fileName = this._fileInfo.get_name();
            if (fileName && fileName.endsWith('.desktop')) {
                try {
                    const file = this._fileInfo.get_attribute_object('standard::file');
                    if (file) {
                        const desktopAppInfo = Gio.DesktopAppInfo.new_from_filename(file.get_path());
                        if (desktopAppInfo) {
                            const appName = desktopAppInfo.get_display_name();
                            if (appName) {
                                // Allow up to ~60 chars for 2 lines (~30 per line)
                                return appName.length > 60 ? appName.substring(0, 57) + '...' : appName;
                            }
                        }
                    }
                } catch (e) {
                    log(`Error getting .desktop display name: ${e}`);
                }
            }

            const name = this._fileInfo.get_display_name();
            // Allow up to ~60 chars for 2 lines (~30 per line)
            if (name.length > 60) {
                return name.substring(0, 57) + '...';
            }
            return name;
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
                    const singleClick = this._extension._settings.get_boolean('single-click');

                    if (singleClick) {
                        // Single click mode - open immediately
                        this._open();
                        return Clutter.EVENT_STOP;
                    } else {
                        // Double click mode - check for double-click first
                        const now = GLib.get_monotonic_time();
                        if (this._lastClickTime && (now - this._lastClickTime) < 400000) {
                            // Double click (400ms threshold)
                            this._lastClickTime = 0;
                            this._open();
                            return Clutter.EVENT_STOP;
                        }
                        this._lastClickTime = now;

                        // Left click - start potential drag via extension's global handler
                        // Don't select yet - wait until button release to know if it was a drag
                        const [stageX, stageY] = event.get_coords();
                        this._extension._startIconDrag(this, stageX, stageY);

                        return Clutter.EVENT_STOP;
                    }
                } else if (button === 3) {
                    // Right click
                    this._showContextMenu(event);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _select() {
            // Deselect all other icons first
            this._extension._deselectAll();

            this._selected = true;
            // Apply selected style with system accent color
            const accentColor = this._extension._getAccentColor();
            this.set_style(`background-color: ${accentColor};`);
        }

        deselect() {
            this._selected = false;
            // Remove selected style
            this.set_style('');
        }

        _open() {
            try {
                // Get file from fileInfo
                let file = this._fileInfo.get_attribute_object('standard::file');

                // If file attribute not available, construct from path
                if (!file) {
                    const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
                    const fileName = this._fileInfo.get_name();
                    const filePath = GLib.build_filenamev([desktopPath, fileName]);
                    file = Gio.File.new_for_path(filePath);
                }

                // Check if it's a .desktop file - launch the application
                const fileName = this._fileInfo.get_name();
                if (fileName && fileName.endsWith('.desktop')) {
                    try {
                        const desktopAppInfo = Gio.DesktopAppInfo.new_from_filename(file.get_path());
                        if (desktopAppInfo) {
                            desktopAppInfo.launch([], null);
                            return;
                        }
                    } catch (e) {
                        log(`Error launching .desktop file: ${e}`);
                    }
                }

                // Check for special icons
                const isTrash = this._fileInfo.get_attribute_boolean('special::is-trash');
                if (isTrash) {
                    // Open trash folder with file manager
                    Gio.app_info_launch_default_for_uri('trash:///', null);
                    return;
                }

                // Regular file/folder - open with default app
                const contentType = this._fileInfo.get_content_type();
                if (contentType) {
                    const appInfo = Gio.AppInfo.get_default_for_type(contentType, false);
                    if (appInfo) {
                        appInfo.launch([file], null);
                        return;
                    }
                }

                // Fallback: Open with default handler
                Gio.app_info_launch_default_for_uri(file.get_uri(), null);
            } catch (e) {
                log(`Error opening file: ${e}`);
            }
        }

        _showContextMenu(event) {
            // Close any existing menu
            this._closeContextMenu();

            // Get mouse position FIRST
            const [mouseX, mouseY] = event.get_coords();

            // Create a dummy actor at mouse position to anchor the menu
            this._menuAnchor = new St.Widget({
                x: mouseX,
                y: mouseY,
                width: 1,
                height: 1,
                reactive: false,
            });
            Main.uiGroup.add_child(this._menuAnchor);

            // Create popup menu anchored to dummy widget
            this._contextMenu = new PopupMenu.PopupMenu(this._menuAnchor, 0, St.Side.TOP);

            // Open item
            const openItem = new PopupMenu.PopupMenuItem('Open');
            openItem.connect('activate', () => {
                this._open();
            });
            this._contextMenu.addMenuItem(openItem);

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Icon Size - Submenu with Visual Grid Selector (4x4)
            const sizeSubMenu = new PopupMenu.PopupSubMenuMenuItem('Icon Size');

            const sizeItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });

            // Grid container (4x4) - centered
            const gridSize = 4;
            const cellSize = 24;
            const currentSize = this._cellSize || { cols: 1, rows: 1 };

            const gridWrapper = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });

            const gridRow = new St.BoxLayout({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });

            const gridContainer = new St.Widget({
                style: `width: ${gridSize * cellSize}px; height: ${gridSize * cellSize}px;`,
                reactive: true,
            });

            // Create grid cells
            const gridCells = [];
            for (let row = 0; row < gridSize; row++) {
                gridCells[row] = [];
                for (let col = 0; col < gridSize; col++) {
                    const cell = new St.Widget({
                        style: 'background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 2px;',
                        width: cellSize - 2,
                        height: cellSize - 2,
                        x: col * cellSize,
                        y: row * cellSize,
                    });
                    gridCells[row][col] = cell;
                    gridContainer.add_child(cell);
                }
            }

            // Highlight cells function
            const highlightCells = (cols, rows, style) => {
                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        if (c < cols && r < rows) {
                            gridCells[r][c].style = style;
                        } else {
                            gridCells[r][c].style = 'background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 2px;';
                        }
                    }
                }
            };

            // Show current size
            highlightCells(currentSize.cols, currentSize.rows, 'background-color: rgba(53,132,228,0.5); border: 1px solid rgba(53,132,228,0.8); border-radius: 2px;');

            // Tooltip label for size (below grid)
            const sizeTooltip = new St.Label({
                text: '',
                style: 'font-size: 0.9em; color: rgba(255,255,255,0.7); margin-top: 6px; min-height: 16px;',
                x_align: Clutter.ActorAlign.CENTER,
            });

            // Track hover
            gridContainer.connect('motion-event', (actor, event) => {
                const [x, y] = event.get_coords();
                const [actorX, actorY] = actor.get_transformed_position();
                const relX = x - actorX;
                const relY = y - actorY;

                const hoverCol = Math.floor(relX / cellSize) + 1;
                const hoverRow = Math.floor(relY / cellSize) + 1;

                if (hoverCol >= 1 && hoverCol <= gridSize && hoverRow >= 1 && hoverRow <= gridSize) {
                    highlightCells(hoverCol, hoverRow, 'background-color: rgba(53,132,228,0.7); border: 1px solid rgba(53,132,228,1); border-radius: 2px;');
                    sizeTooltip.text = `${hoverCol}x${hoverRow}`;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Reset on leave
            gridContainer.connect('leave-event', () => {
                highlightCells(currentSize.cols, currentSize.rows, 'background-color: rgba(53,132,228,0.5); border: 1px solid rgba(53,132,228,0.8); border-radius: 2px;');
                sizeTooltip.text = '';
                return Clutter.EVENT_PROPAGATE;
            });

            // Click to select
            gridContainer.connect('button-press-event', (actor, event) => {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

                const [x, y] = event.get_coords();
                const [actorX, actorY] = actor.get_transformed_position();
                const relX = x - actorX;
                const relY = y - actorY;

                const selCol = Math.floor(relX / cellSize) + 1;
                const selRow = Math.floor(relY / cellSize) + 1;

                if (selCol >= 1 && selCol <= gridSize && selRow >= 1 && selRow <= gridSize) {
                    const sizeKey = `${selCol}x${selRow}`;
                    this._extension._setCustomIconCellSize(this._fileName, sizeKey);
                    const newCellSize = { cols: selCol, rows: selRow };
                    this.updateSize(newCellSize);
                    this._closeContextMenu();
                }
                return Clutter.EVENT_STOP;
            });

            gridRow.add_child(gridContainer);
            gridWrapper.add_child(gridRow);
            gridWrapper.add_child(sizeTooltip);
            sizeItem.add_child(gridWrapper);
            sizeSubMenu.menu.addMenuItem(sizeItem);
            this._contextMenu.addMenuItem(sizeSubMenu);

            // Elevation submenu with visual selector
            const elevationSubMenu = new PopupMenu.PopupSubMenuMenuItem('Elevation');
            const elevationItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });

            const elevationWrapper = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });

            const elevationRow = new St.BoxLayout({
                style: 'spacing: 8px;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });

            const currentElevation = this._elevation || 0;
            const elevations = [
                { level: 0, shadow: 'none', tooltip: 'Flat' },
                { level: 1, shadow: '0 1px 3px rgba(0,0,0,0.3)', tooltip: 'Low' },
                { level: 2, shadow: '0 3px 8px rgba(0,0,0,0.4)', tooltip: 'Medium' },
                { level: 3, shadow: '0 6px 16px rgba(0,0,0,0.5)', tooltip: 'High' },
            ];

            const elevBoxSize = 36;
            for (const elev of elevations) {
                const isSelected = currentElevation === elev.level;
                const box = new St.Button({
                    style: `
                        width: ${elevBoxSize}px;
                        height: ${elevBoxSize}px;
                        background-color: rgba(255,255,255,0.15);
                        border-radius: 6px;
                        border: 2px solid ${isSelected ? 'rgba(53,132,228,1)' : 'rgba(255,255,255,0.2)'};
                        box-shadow: ${elev.shadow};
                    `,
                    x_expand: true,
                });
                box.connect('clicked', () => {
                    this._extension._setIconElevation(this._fileName, elev.level);
                    this.setElevation(elev.level);
                    this._closeContextMenu();
                });
                box.connect('enter-event', () => {
                    elevationTooltip.text = elev.tooltip;
                    if (currentElevation !== elev.level) {
                        box.style = `
                            width: ${elevBoxSize}px;
                            height: ${elevBoxSize}px;
                            background-color: rgba(255,255,255,0.25);
                            border-radius: 6px;
                            border: 2px solid rgba(53,132,228,0.7);
                            box-shadow: ${elev.shadow};
                        `;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
                box.connect('leave-event', () => {
                    elevationTooltip.text = '';
                    const sel = currentElevation === elev.level;
                    box.style = `
                        width: ${elevBoxSize}px;
                        height: ${elevBoxSize}px;
                        background-color: rgba(255,255,255,0.15);
                        border-radius: 6px;
                        border: 2px solid ${sel ? 'rgba(53,132,228,1)' : 'rgba(255,255,255,0.2)'};
                        box-shadow: ${elev.shadow};
                    `;
                    return Clutter.EVENT_PROPAGATE;
                });
                elevationRow.add_child(box);
            }

            // Tooltip label for elevation (below boxes)
            const elevationTooltip = new St.Label({
                text: '',
                style: 'font-size: 0.9em; color: rgba(255,255,255,0.7); margin-top: 6px; min-height: 16px;',
                x_align: Clutter.ActorAlign.CENTER,
            });

            elevationWrapper.add_child(elevationRow);
            elevationWrapper.add_child(elevationTooltip);
            elevationItem.add_child(elevationWrapper);
            elevationSubMenu.menu.addMenuItem(elevationItem);
            this._contextMenu.addMenuItem(elevationSubMenu);

            // Background submenu with visual selector
            const bgSubMenu = new PopupMenu.PopupSubMenuMenuItem('Background');
            const bgItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });

            const bgWrapper = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });

            const bgRow = new St.BoxLayout({
                style: 'spacing: 8px;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });

            const currentBg = this._background || 'none';
            const backgrounds = [
                { key: 'none', bg: 'transparent', border: 'rgba(255,255,255,0.3)', tooltip: 'None' },
                { key: 'light', bg: 'rgba(255,255,255,0.2)', border: 'rgba(255,255,255,0.4)', tooltip: 'Light' },
                { key: 'dark', bg: 'rgba(0,0,0,0.4)', border: 'rgba(0,0,0,0.6)', tooltip: 'Dark' },
                { key: 'accent', bg: 'rgba(53,132,228,0.4)', border: 'rgba(53,132,228,0.7)', tooltip: 'Accent' },
            ];

            const bgBoxSize = 36;
            for (const bg of backgrounds) {
                const isSelected = currentBg === bg.key;
                const box = new St.Button({
                    style: `
                        width: ${bgBoxSize}px;
                        height: ${bgBoxSize}px;
                        background-color: ${bg.bg};
                        border-radius: 6px;
                        border: 2px solid ${isSelected ? 'rgba(53,132,228,1)' : bg.border};
                    `,
                    x_expand: true,
                });
                box.connect('clicked', () => {
                    this._extension._setIconBackground(this._fileName, bg.key);
                    this.setBackground(bg.key);
                    this._closeContextMenu();
                });
                box.connect('enter-event', () => {
                    bgTooltip.text = bg.tooltip;
                    if (currentBg !== bg.key) {
                        box.style = `
                            width: ${bgBoxSize}px;
                            height: ${bgBoxSize}px;
                            background-color: ${bg.bg};
                            border-radius: 6px;
                            border: 2px solid rgba(53,132,228,0.7);
                        `;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
                box.connect('leave-event', () => {
                    bgTooltip.text = '';
                    const sel = currentBg === bg.key;
                    box.style = `
                        width: ${bgBoxSize}px;
                        height: ${bgBoxSize}px;
                        background-color: ${bg.bg};
                        border-radius: 6px;
                        border: 2px solid ${sel ? 'rgba(53,132,228,1)' : bg.border};
                    `;
                    return Clutter.EVENT_PROPAGATE;
                });
                bgRow.add_child(box);
            }

            // Tooltip label for background (below boxes)
            const bgTooltip = new St.Label({
                text: '',
                style: 'font-size: 0.9em; color: rgba(255,255,255,0.7); margin-top: 6px; min-height: 16px;',
                x_align: Clutter.ActorAlign.CENTER,
            });

            bgWrapper.add_child(bgRow);
            bgWrapper.add_child(bgTooltip);
            bgItem.add_child(bgWrapper);
            bgSubMenu.menu.addMenuItem(bgItem);
            this._contextMenu.addMenuItem(bgSubMenu);

            this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Remove item with confirmation dialog
            const deleteItem = new PopupMenu.PopupMenuItem('Remove...');
            deleteItem.connect('activate', () => {
                this._showRemoveConfirmDialog();
            });
            this._contextMenu.addMenuItem(deleteItem);

            // Add menu to UI group (above windows)
            Main.uiGroup.add_child(this._contextMenu.actor);

            // Get screen bounds
            const monitor = Main.layoutManager.primaryMonitor;
            const margin = 5;
            const screenRight = monitor.x + monitor.width - margin;
            const screenBottom = monitor.y + monitor.height - margin;
            const screenTop = monitor.y + margin;
            const screenLeft = monitor.x + margin;

            // Open menu to get its size
            this._contextMenu.open();

            const menuWidth = this._contextMenu.actor.width;
            const menuHeight = this._contextMenu.actor.height;

            // Position: top-left corner at mouse position
            let menuPosX = mouseX;
            let menuPosY = mouseY;

            // If menu goes off right edge, flip to left of cursor
            if (menuPosX + menuWidth > screenRight) {
                menuPosX = mouseX - menuWidth;
            }
            // Clamp horizontal
            menuPosX = Math.max(screenLeft, Math.min(menuPosX, screenRight - menuWidth));

            // Vertical: down by default, up if doesn't fit
            if (menuPosY + menuHeight > screenBottom) {
                // Doesn't fit below, show above (bottom-left at mouse)
                menuPosY = mouseY - menuHeight;
            }
            // Clamp vertical
            menuPosY = Math.max(screenTop, Math.min(menuPosY, screenBottom - menuHeight));

            this._contextMenu.actor.set_position(menuPosX, menuPosY);

            // Store for submenu positioning
            const contextMenu = this._contextMenu;

            // Monitor submenu opening to reposition if needed
            this._setupSubmenuPositioning(contextMenu, monitor);

            // Close menu when clicking outside
            this._menuCaptureId = global.stage.connect('captured-event', (actor, capturedEvent) => {
                if (capturedEvent.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [clickX, clickY] = capturedEvent.get_coords();

                    // Check if click is inside main menu or any submenu
                    if (!this._isClickInsideMenu(contextMenu, clickX, clickY)) {
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

        _setupSubmenuPositioning(contextMenu, monitor) {
            // Find all submenu items and monitor their opening
            const checkSubmenus = (menuItems) => {
                for (const item of menuItems) {
                    if (item instanceof PopupMenu.PopupSubMenuMenuItem) {
                        // Connect to submenu open signal
                        const submenu = item.menu;
                        const openId = submenu.connect('open-state-changed', (menu, isOpen) => {
                            if (isOpen) {
                                // Reposition submenu after it opens
                                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                    this._repositionSubmenu(submenu, monitor);
                                    return GLib.SOURCE_REMOVE;
                                });
                            }
                        });

                        // Store for cleanup
                        if (!this._submenuSignals) this._submenuSignals = [];
                        this._submenuSignals.push({ menu: submenu, id: openId });

                        // Check nested submenus
                        checkSubmenus(submenu._getMenuItems());
                    }
                }
            };

            checkSubmenus(contextMenu._getMenuItems());
        }

        _repositionSubmenu(submenu, monitor) {
            if (!submenu.actor) return;

            const [subX, subY] = submenu.actor.get_transformed_position();
            const subWidth = submenu.actor.width;
            const subHeight = submenu.actor.height;

            const margin = 5;
            const screenRight = monitor.x + monitor.width - margin;
            const screenBottom = monitor.y + monitor.height - margin;
            const screenTop = monitor.y + margin;

            let newX = subX;
            let newY = subY;

            // Check horizontal overflow
            if (subX + subWidth > screenRight) {
                // Move submenu to left side of parent
                const parentActor = submenu.sourceActor;
                if (parentActor) {
                    const [parentX] = parentActor.get_transformed_position();
                    newX = parentX - subWidth;
                }
            }

            // Check vertical overflow
            if (subY + subHeight > screenBottom) {
                // Move up so bottom aligns with screen bottom
                newY = screenBottom - subHeight;
            }
            if (newY < screenTop) {
                newY = screenTop;
            }

            // Apply position adjustment via translation
            const deltaX = newX - subX;
            const deltaY = newY - subY;

            if (deltaX !== 0 || deltaY !== 0) {
                submenu.actor.set_position(
                    submenu.actor.x + deltaX,
                    submenu.actor.y + deltaY
                );
            }
        }

        _isClickInsideMenu(contextMenu, clickX, clickY) {
            // Check main menu
            const [menuActorX, menuActorY] = contextMenu.actor.get_transformed_position();
            const menuW = contextMenu.actor.width;
            const menuH = contextMenu.actor.height;

            if (clickX >= menuActorX && clickX <= menuActorX + menuW &&
                clickY >= menuActorY && clickY <= menuActorY + menuH) {
                return true;
            }

            // Check all open submenus recursively
            const checkSubmenus = (menuItems) => {
                for (const item of menuItems) {
                    if (item instanceof PopupMenu.PopupSubMenuMenuItem && item.menu.isOpen) {
                        const subActor = item.menu.actor;
                        const [subX, subY] = subActor.get_transformed_position();
                        const subW = subActor.width;
                        const subH = subActor.height;

                        if (clickX >= subX && clickX <= subX + subW &&
                            clickY >= subY && clickY <= subY + subH) {
                            return true;
                        }

                        // Check nested submenus
                        if (checkSubmenus(item.menu._getMenuItems())) {
                            return true;
                        }
                    }
                }
                return false;
            };

            return checkSubmenus(contextMenu._getMenuItems());
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
            // Cleanup submenu signals
            if (this._submenuSignals) {
                for (const { menu, id } of this._submenuSignals) {
                    try {
                        menu.disconnect(id);
                    } catch (e) {
                        // Menu may already be destroyed
                    }
                }
                this._submenuSignals = null;
            }
            if (this._contextMenu) {
                // Close all submenus first
                try {
                    for (const item of this._contextMenu._getMenuItems()) {
                        if (item instanceof PopupMenu.PopupSubMenuMenuItem) {
                            item.menu.close();
                        }
                    }
                } catch (e) {
                    // Ignore errors
                }
                this._contextMenu.close();
                this._contextMenu.destroy();
                this._contextMenu = null;
            }
            // Remove the anchor widget
            if (this._menuAnchor) {
                this._menuAnchor.destroy();
                this._menuAnchor = null;
            }
        }

        _showRemoveConfirmDialog() {
            log(`[Obision] Opening remove dialog for: ${this._fileName}`);

            // Close context menu first
            this._closeContextMenu();

            // Create confirmation dialog
            const dialog = new ModalDialog.ModalDialog({
                styleClass: 'modal-dialog',
                destroyOnClose: true,
            });

            // Dialog content
            const contentBox = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 12px; padding: 12px;',
            });

            const title = new St.Label({
                text: 'Remove Item?',
                style: 'font-weight: bold; font-size: 1.2em;',
            });
            contentBox.add_child(title);

            const message = new St.Label({
                text: `"${this._fileName}" will be moved to the Trash.`,
                style: 'color: rgba(255,255,255,0.7);',
            });
            contentBox.add_child(message);

            dialog.contentLayout.add_child(contentBox);

            // Add buttons
            dialog.addButton({
                label: 'Cancel',
                action: () => {
                    dialog.close();
                },
                key: Clutter.KEY_Escape,
            });

            dialog.addButton({
                label: 'Remove',
                action: () => {
                    this._moveToTrash();
                    dialog.close();
                },
                default: true,
            });

            dialog.open();
        }

        _moveToTrash() {
            try {
                log(`[Obision] Attempting to trash: ${this._fileName}`);
                const file = this.getFile();
                if (file) {
                    log(`[Obision] File path: ${file.get_path()}`);
                    file.trash(null);
                    log(`[Obision] Successfully trashed: ${this._fileName}`);
                } else {
                    log(`[Obision] Could not get file object for: ${this._fileName}`);
                }
            } catch (e) {
                log(`[Obision] Error moving to trash: ${e}`);
            }
        }

        updateSize(newCellSize) {
            // Update cell size
            if (newCellSize) {
                this._cellSize = newCellSize;
            }

            // Recalculate widget dimensions
            const cellWidth = this._extension._getCellWidth();
            const cellHeight = this._extension._getCellHeight();
            const widgetWidth = cellWidth * this._cellSize.cols;
            const widgetHeight = cellHeight * this._cellSize.rows;

            // Calculate icon size based on available space
            const padding = 16;
            const labelHeight = LABEL_HEIGHT;
            const availableWidth = widgetWidth - padding;
            const availableHeight = widgetHeight - labelHeight - padding;
            const iconSize = Math.max(MIN_ICON_SIZE, Math.min(availableWidth, availableHeight));

            this._iconSize = iconSize;
            if (this._icon) {
                this._icon.set_icon_size(iconSize);
            }

            // Update font size proportionally to cell size
            const baseFontSize = 12;
            const cellSizeMultiplier = Math.max(this._cellSize.cols, this._cellSize.rows);
            // Progressive scaling: 1x1=12px, 2x2=17px, 3x3=23px, 4x4=30px
            const fontSize = Math.round(baseFontSize + (cellSizeMultiplier - 1) * 5 + (cellSizeMultiplier > 2 ? 3 : 0));
            if (this._label) {
                const lineHeight = Math.ceil(fontSize * 1.2);
                this._label.style = `font-size: ${fontSize}px; max-height: ${lineHeight * 2 + 4}px;`;
                this._label.width = widgetWidth - 8;
            }

            this.set_size(widgetWidth, widgetHeight);
        }

        getFile() {
            try {
                // First try to get from fileInfo
                const file = this._fileInfo.get_attribute_object('standard::file');
                if (file) {
                    return file;
                }

                // Fallback: construct file from desktop path and fileName
                const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
                const filePath = GLib.build_filenamev([desktopPath, this._fileName]);
                return Gio.File.new_for_path(filePath);
            } catch (e) {
                log(`[Obision] Error getting file for ${this._fileName}: ${e}`);
                return null;
            }
        }

        getFileName() {
            return this._fileName;
        }

        destroy() {
            // Clean up context menu
            this._closeContextMenu();
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
            this._desktopMenu = null;

            // Click on empty area
            this.connect('button-press-event', (actor, event) => {
                const button = event.get_button();

                if (button === 1) {
                    // Left click - deselect all
                    this._extension._deselectAll();
                    return Clutter.EVENT_STOP;
                } else if (button === 3) {
                    // Right click - show desktop menu
                    const [x, y] = event.get_coords();
                    this._showDesktopMenu(x, y);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _showDesktopMenu(x, y) {
            this._closeDesktopMenu();

            // Create a dummy actor at mouse position to anchor the menu
            this._menuAnchor = new St.Widget({
                x: x,
                y: y,
                width: 1,
                height: 1,
                reactive: false,
            });
            Main.uiGroup.add_child(this._menuAnchor);

            // Create popup menu anchored to dummy widget
            this._desktopMenu = new PopupMenu.PopupMenu(this._menuAnchor, 0, St.Side.TOP);

            // Create Folder item with accelerator
            const createFolderItem = new PopupMenu.PopupMenuItem('Create Folder...');
            createFolderItem.connect('activate', () => {
                this._showNewFolderDialog();
            });
            // Add accelerator hint text
            const accelLabel = new St.Label({
                text: 'Shift+Ctrl+N',
                style: 'font-size: 0.9em; color: rgba(255,255,255,0.5);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            createFolderItem.add_child(accelLabel);
            this._desktopMenu.addMenuItem(createFolderItem);

            this._desktopMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Check if obision-extension-one-win is installed
            try {
                const oneWinExtension = Main.extensionManager.lookup('obision-extension-one-win@obision.com');

                log(`[Obision] One Win extension lookup result: ${oneWinExtension ? 'found' : 'not found'}`);

                if (oneWinExtension) {
                    log(`[Obision] One Win extension state: ${oneWinExtension.state}`);

                    // Check current state when menu opens (state 1 = ENABLED)
                    const isCurrentlyEnabled = oneWinExtension.state === 1;
                    const oneWinItem = new PopupMenu.PopupSwitchMenuItem('One Win Mode', isCurrentlyEnabled);

                    oneWinItem.connect('toggled', (item, state) => {
                        if (state) {
                            // Enable the extension
                            try {
                                Gio.Subprocess.new(
                                    ['gnome-extensions', 'enable', 'obision-extension-one-win@obision.com'],
                                    Gio.SubprocessFlags.NONE
                                );
                            } catch (e) {
                                log(`[Obision] Error enabling One Win extension: ${e}`);
                            }
                        } else {
                            // Disable the extension
                            try {
                                Gio.Subprocess.new(
                                    ['gnome-extensions', 'disable', 'obision-extension-one-win@obision.com'],
                                    Gio.SubprocessFlags.NONE
                                );
                            } catch (e) {
                                log(`[Obision] Error disabling One Win extension: ${e}`);
                            }
                        }
                    });

                    this._desktopMenu.addMenuItem(oneWinItem);
                    log(`[Obision] One Win menu item added`);
                } else {
                    // Add placeholder to show extension is not installed
                    const notInstalledItem = new PopupMenu.PopupMenuItem('One Win (no instalado)');
                    notInstalledItem.setSensitive(false);
                    this._desktopMenu.addMenuItem(notInstalledItem);
                    log(`[Obision] One Win extension not installed, added placeholder`);
                }
            } catch (e) {
                log(`[Obision] Error checking One Win extension: ${e}\n${e.stack}`);
            }

            this._desktopMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Preferences item
            const prefsItem = new PopupMenu.PopupMenuItem('Preferences...');
            prefsItem.connect('activate', () => {
                try {
                    Gio.Subprocess.new(
                        ['gnome-extensions', 'prefs', 'obision-extension-desk-grid@obision.com'],
                        Gio.SubprocessFlags.NONE
                    );
                } catch (e) {
                    log(`[Obision] Error opening prefs: ${e}`);
                }
            });
            this._desktopMenu.addMenuItem(prefsItem)

            // Add menu to UI group (above windows)
            Main.uiGroup.add_child(this._desktopMenu.actor);

            // Force layout calculation before opening
            this._desktopMenu.actor.show();
            this._desktopMenu.actor.get_allocation_box();

            // Position menu before opening
            const monitor = Main.layoutManager.primaryMonitor;
            const margin = 5;
            const screenRight = monitor.x + monitor.width - margin;
            const screenBottom = monitor.y + monitor.height - margin;

            // Get menu dimensions (use preferred size)
            const [minWidth, natWidth] = this._desktopMenu.actor.get_preferred_width(-1);
            const [minHeight, natHeight] = this._desktopMenu.actor.get_preferred_height(-1);
            const menuWidth = natWidth;
            const menuHeight = natHeight;

            let menuPosX = x;
            let menuPosY = y;

            // Adjust horizontal position if menu goes off right edge
            if (menuPosX + menuWidth > screenRight) {
                menuPosX = x - menuWidth;
            }

            // Adjust vertical position if menu goes off bottom edge
            if (menuPosY + menuHeight > screenBottom) {
                menuPosY = y - menuHeight;
            }

            // Set position before opening
            this._desktopMenu.actor.set_position(menuPosX, menuPosY);

            // Now open the menu
            this._desktopMenu.open();

            // Close menu when clicking outside
            this._menuCaptureId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [clickX, clickY] = event.get_coords();
                    const [menuX, menuY] = this._desktopMenu.actor.get_transformed_position();
                    const menuW = this._desktopMenu.actor.width;
                    const menuH = this._desktopMenu.actor.height;

                    if (clickX < menuX || clickX > menuX + menuW ||
                        clickY < menuY || clickY > menuY + menuH) {
                        this._closeDesktopMenu();
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _closeDesktopMenu() {
            if (this._menuCaptureId) {
                global.stage.disconnect(this._menuCaptureId);
                this._menuCaptureId = null;
            }
            if (this._desktopMenu) {
                this._desktopMenu.close();
                this._desktopMenu.destroy();
                this._desktopMenu = null;
            }
            if (this._menuAnchor) {
                this._menuAnchor.destroy();
                this._menuAnchor = null;
            }
        }

        _showCreateDialog(title, message, placeholder, callback) {
            // Close menu first
            this._closeDesktopMenu();

            // Create modal dialog
            const dialog = new ModalDialog.ModalDialog({
                styleClass: 'modal-dialog',
                destroyOnClose: true,
            });

            // Dialog content
            const contentBox = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 12px; padding: 12px;',
            });

            const titleLabel = new St.Label({
                text: title,
                style_class: 'dialog-header',
                style: 'font-weight: bold; font-size: 1.2em; margin-bottom: 8px;',
            });
            contentBox.add_child(titleLabel);

            const messageLabel = new St.Label({
                text: message,
                style: 'color: rgba(255,255,255,0.7);',
            });
            contentBox.add_child(messageLabel);

            // Text entry
            const entry = new St.Entry({
                style: 'margin-top: 8px; min-width: 300px;',
                text: '',
                hint_text: placeholder,
                can_focus: true,
            });
            contentBox.add_child(entry);

            dialog.contentLayout.add_child(contentBox);

            // Add buttons
            dialog.addButton({
                label: 'Cancel',
                action: () => {
                    dialog.close();
                },
                key: Clutter.KEY_Escape,
            });

            const createButton = dialog.addButton({
                label: 'Create',
                action: () => {
                    const name = entry.get_text().trim();
                    if (name) {
                        callback(name);
                    }
                    dialog.close();
                },
                default: true,
            });

            // Style Create button with accent color
            const buttonColor = this._extension._getAccentColor('rgb');
            createButton.set_style(`background-color: ${buttonColor}; color: white; font-weight: bold;`);

            // Disable button by default (empty field)
            createButton.reactive = false;
            createButton.can_focus = false;
            createButton.set_opacity(128);

            // Enable/disable Create button based on text input
            entry.clutter_text.connect('text-changed', () => {
                const text = entry.get_text().trim();
                const hasText = text.length > 0;
                createButton.reactive = hasText;
                createButton.can_focus = hasText;
                createButton.set_opacity(hasText ? 255 : 128);
            });

            // Handle Enter key in text entry
            entry.clutter_text.connect('activate', () => {
                const name = entry.get_text().trim();
                if (name) {
                    callback(name);
                    dialog.close();
                }
            });

            dialog.open();

            // Focus entry
            global.stage.set_key_focus(entry);
        }

        _showAlertDialog(title, message) {
            // Create alert dialog using MessageDialogContent
            const dialog = new ModalDialog.ModalDialog({
                styleClass: 'modal-dialog',
                destroyOnClose: true,
            });

            // Use MessageDialogContent for proper dialog structure
            const content = new Dialog.MessageDialogContent({ title, description: message });
            dialog.contentLayout.add_child(content);

            // Add OK button
            dialog.addButton({
                label: 'OK',
                action: () => {
                    dialog.close();
                },
                default: true,
                key: Clutter.KEY_Return,
            });

            dialog.open();
        }

        _showNewFolderDialog() {
            this._showCreateDialog(
                'Create Folder',
                'Enter folder name:',
                'New Folder',
                (folderName) => this._createFolder(folderName)
            );
        }

        _createFolder(folderName) {
            try {
                const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
                const folderPath = GLib.build_filenamev([desktopPath, folderName]);
                const folder = Gio.File.new_for_path(folderPath);

                // Check if folder already exists
                if (folder.query_exists(null)) {
                    log(`[Obision] Folder already exists: ${folderName}`);
                    this._showAlertDialog('Folder Exists', `A folder named "${folderName}" already exists.`);
                    return;
                }

                // Mark that we're creating a folder to avoid full reload
                this._extension._creatingFolder = true;

                // Create the folder
                folder.make_directory(null);
                log(`[Obision] Created folder: ${folderName}`);

                // Clear flag after a short delay
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    this._extension._creatingFolder = false;
                    return GLib.SOURCE_REMOVE;
                });
            } catch (e) {
                log(`[Obision] Error creating folder: ${e}`);
                this._extension._creatingFolder = false;
            }
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
            this._closeDesktopMenu();
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

        // Wait for work area to be properly calculated (especially if dash is active)
        // This prevents the grid from being positioned incorrectly on startup
        this._initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            // Position grid and overlay
            this._updateGridPosition();

            // Build cell grid structure
            this._buildCellGrid();

            // Load desktop files
            this._loadDesktopFiles();

            this._initTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });

        // Monitor desktop directory for changes
        this._setupFileMonitor();

        // Connect to settings changes
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'grid-columns' || key === 'grid-rows') {
                // Grid dimensions changed - rebuild cell grid
                this._buildCellGrid();
                this._reloadIcons();
                this._gridOverlay.refresh();
            } else if (key === 'show-trash' || key === 'show-home') {
                // Special icons visibility changed - reload all icons
                this._reloadIcons();
            } else if (key.startsWith('grid-')) {
                this._gridOverlay.refresh();
            }
        });

        // Monitor for monitor changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._updateGridPosition();
            this._buildCellGrid();
            this._reloadIcons();
        });

        // Monitor for work area changes (when panels/docks change size)
        this._workareasChangedId = global.display.connect('workareas-changed', () => {
            this._onWorkAreaChanged();
        });

        // Try to connect to obision-dash settings for immediate updates
        this._setupObisionDashIntegration();

        // Add keyboard shortcut for Create Folder (Shift+Ctrl+N)
        Main.wm.addKeybinding(
            'obision-desk-new-folder',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => {
                // Show create folder dialog
                if (this._grid) {
                    this._grid._showNewFolderDialog();
                }
            }
        );

        log('Obision Desk enabled');
    }

    disable() {
        log('Obision Desk disabling...');

        // Cleanup initialization timeout
        if (this._initTimeoutId) {
            GLib.source_remove(this._initTimeoutId);
            this._initTimeoutId = null;
        }

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

        if (this._workareasChangedId) {
            global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = null;
        }

        // Cleanup obision-dash integration
        this._cleanupObisionDashIntegration();

        // Remove keyboard shortcut
        Main.wm.removeKeybinding('obision-desk-new-folder');

        // Cleanup work area debounce timeout
        if (this._workAreaDebounceId) {
            GLib.source_remove(this._workAreaDebounceId);
            this._workAreaDebounceId = null;
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
        const columns = this._settings.get_int('grid-columns');
        const rows = this._settings.get_int('grid-rows');

        // Calculate cell size (integer division)
        const cellWidth = Math.floor(workArea.width / columns);
        const cellHeight = Math.floor(workArea.height / rows);

        // Calculate actual grid size (may be slightly smaller than workArea)
        const gridWidth = cellWidth * columns;
        const gridHeight = cellHeight * rows;

        // Center the grid in the work area to distribute leftover pixels evenly
        const offsetX = Math.floor((workArea.width - gridWidth) / 2);
        const offsetY = Math.floor((workArea.height - gridHeight) / 2);

        const gridX = workArea.x + offsetX;
        const gridY = workArea.y + offsetY;

        // Position grid overlay
        if (this._gridOverlay) {
            this._gridOverlay.set_position(gridX, gridY);
            this._gridOverlay.set_size(gridWidth, gridHeight);
            this._gridOverlay.refresh();
        }

        // Position icon container - use exact grid size
        this._grid.set_position(gridX, gridY);
        this._grid.set_size(gridWidth, gridHeight);

        // Store grid bounds for cell calculations
        this._gridBounds = {
            x: gridX,
            y: gridY,
            width: gridWidth,
            height: gridHeight,
            cellWidth: cellWidth,
            cellHeight: cellHeight,
        };

        // Rebuild cell grid when position changes
        this._buildCellGrid();
    }

    /**
     * Handle work area changes (triggered by panels/docks resizing)
     */
    _onWorkAreaChanged() {
        // Debounce to avoid multiple rapid updates
        if (this._workAreaDebounceId) {
            GLib.source_remove(this._workAreaDebounceId);
        }

        this._workAreaDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._updateGridPosition();
            this._reloadIcons();
            this._workAreaDebounceId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Setup integration with obision-extension-dash
     * Listen to its settings for immediate grid updates when dash changes
     */
    _setupObisionDashIntegration() {
        const DASH_SCHEMA = 'com.obision.extensions.dash';

        try {
            // Try to get obision-dash settings
            const schemaSource = Gio.SettingsSchemaSource.get_default();
            const schema = schemaSource.lookup(DASH_SCHEMA, true);

            if (schema) {
                this._dashSettings = new Gio.Settings({ settings_schema: schema });

                // Keys that affect the work area
                const relevantKeys = ['dash-size', 'dash-position', 'auto-hide', 'panel-padding'];

                this._dashSettingsId = this._dashSettings.connect('changed', (settings, key) => {
                    if (relevantKeys.includes(key)) {
                        // Give the dash time to update its chrome and GNOME to recalculate workArea
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                            this._onWorkAreaChanged();
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                });

                log('[Obision Desk] Connected to obision-extension-dash settings');
            }
        } catch (e) {
            // obision-dash not installed or schema not available - that's fine
            log(`[Obision Desk] obision-dash integration not available: ${e.message}`);
        }
    }

    /**
     * Cleanup obision-dash integration
     */
    _cleanupObisionDashIntegration() {
        if (this._dashSettingsId && this._dashSettings) {
            this._dashSettings.disconnect(this._dashSettingsId);
            this._dashSettingsId = null;
        }
        this._dashSettings = null;

        if (this._workAreaDebounceId) {
            GLib.source_remove(this._workAreaDebounceId);
            this._workAreaDebounceId = null;
        }
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
                const cell = this.getCell(col, row);
                if (cell && cell.icon === icon) {
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
        // Use cached value if available
        if (this._gridBounds?.cellWidth) {
            return this._gridBounds.cellWidth;
        }
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return 80;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const columns = this._settings.get_int('grid-columns');
        return Math.floor(workArea.width / columns);
    }

    _getCellHeight() {
        // Use cached value if available
        if (this._gridBounds?.cellHeight) {
            return this._gridBounds.cellHeight;
        }
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

    /**
     * Get GNOME accent color RGB values
     * @returns {Object} RGB values for each accent color name
     */
    _getAccentColorMap() {
        return {
            'blue': { r: 53, g: 132, b: 228 },
            'teal': { r: 53, g: 185, b: 171 },
            'green': { r: 87, g: 227, b: 137 },
            'yellow': { r: 246, g: 211, b: 45 },
            'orange': { r: 255, g: 163, b: 72 },
            'red': { r: 237, g: 51, b: 59 },
            'pink': { r: 245, g: 121, b: 179 },
            'purple': { r: 192, g: 97, b: 203 },
            'slate': { r: 119, g: 127, b: 151 },
        };
    }

    /**
     * Get system accent color in specified format
     * @param {string} format - 'rgb', 'rgba', or 'object' (default: 'rgba')
     * @param {number} alpha - Alpha value for rgba format (default: 0.45)
     * @returns {string|Object} Color in requested format
     */
    _getAccentColor(format = 'rgba', alpha = 0.45) {
        try {
            const schemaSource = Gio.SettingsSchemaSource.get_default();
            const schema = schemaSource.lookup('org.gnome.desktop.interface', true);

            if (schema) {
                const interfaceSettings = new Gio.Settings({ settings_schema: schema });
                const accentColorName = interfaceSettings.get_string('accent-color');
                const colorMap = this._getAccentColorMap();
                const color = colorMap[accentColorName] || colorMap['blue'];

                if (format === 'rgb') {
                    return `rgb(${color.r}, ${color.g}, ${color.b})`;
                } else if (format === 'rgba') {
                    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
                } else if (format === 'object') {
                    return color;
                }
            }
        } catch (e) {
            log(`[Obision] Could not get accent color: ${e.message}`);
        }

        // Fallback to blue
        const defaultColor = { r: 53, g: 132, b: 228 };
        if (format === 'rgb') {
            return `rgb(${defaultColor.r}, ${defaultColor.g}, ${defaultColor.b})`;
        } else if (format === 'object') {
            return defaultColor;
        }
        return `rgba(${defaultColor.r}, ${defaultColor.g}, ${defaultColor.b}, ${alpha})`;
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
        return { cols: 1, rows: 1 };
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

        this._dragIcon = icon;
        this._dragStartX = stageX;
        this._dragStartY = stageY;
        this._iconStartX = icon.x;
        this._iconStartY = icon.y;
        this._isDragging = false;

        // Calculate offset from click point to icon's top-left corner
        // This ensures the icon follows the mouse from where it was clicked
        const [gridX, gridY] = this._grid?.get_transformed_position() || [0, 0];
        this._dragOffsetX = stageX - gridX - icon.x;
        this._dragOffsetY = stageY - gridY - icon.y;
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
                this._endDrag();
                return Clutter.EVENT_PROPAGATE;
            }

            const [stageX, stageY] = event.get_coords();
            const dx = stageX - this._dragStartX;
            const dy = stageY - this._dragStartY;

            // Start actual drag if moved more than 3 pixels
            if (!this._isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                this._isDragging = true;
                this._dragIcon._dragging = true;
                this._dragIcon.add_style_class_name('dragging');

                // Save original position for rollback
                this._dragOriginalX = this._dragIcon.x;
                this._dragOriginalY = this._dragIcon.y;

                // Create drop indicator
                this._createDropIndicator();

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

                // Update drop indicator position instead of moving the icon
                this._updateDropIndicator(stageX, stageY);
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.BUTTON_RELEASE) {
            if (this._dragIcon) {
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

        // Destroy drop indicator
        this._destroyDropIndicator();

        if (wasDragging) {
            icon._dragging = false;
            icon.remove_style_class_name('dragging');
        }
    }

    _endDrag() {
        if (!this._dragIcon) return;

        const icon = this._dragIcon;
        const wasDragging = this._isDragging;

        // Get target cell from drop indicator before destroying it
        const targetCol = this._dropTargetCol;
        const targetRow = this._dropTargetRow;
        const canDrop = this._canDrop;

        // Reset state first
        this._dragIcon = null;
        this._isDragging = false;

        // Destroy drop indicator
        this._destroyDropIndicator();

        if (wasDragging) {
            icon._dragging = false;
            icon.remove_style_class_name('dragging');

            if (!this._cells) return;

            // If we have a valid drop target, use it
            if (canDrop && targetCol !== undefined && targetRow !== undefined) {
                // Remove icon from old cells
                this.removeIconFromCells(icon);

                const cell = this.getCell(targetCol, targetRow);
                if (cell) {
                    // Animate to cell position
                    icon.ease({
                        x: cell.x,
                        y: cell.y,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            // Mark cells as occupied
                            this.placeIconInCell(icon, targetCol, targetRow);
                            // Save using col/row
                            this._saveIconPosition(icon._fileName, targetCol, targetRow);
                        }
                    });
                    return;
                }
            }

            // No valid drop, icon stays in place (original position)
            // Re-place in original cell
            const origCell = this.getCellAtPixel(this._dragOriginalX, this._dragOriginalY);
            if (origCell) {
                this.placeIconInCell(icon, origCell.col, origCell.row);
            }
        } else {
            // Was not a drag, just a click - select the icon
            icon._select();
        }
    }

    _createDropIndicator() {
        if (this._dropIndicator) {
            this._dropIndicator.destroy();
        }

        this._dropIndicator = new St.Widget({
            style_class: 'drop-indicator',
            reactive: false,
        });

        this._grid.add_child(this._dropIndicator);
        this._dropIndicator.hide();
        this._canDrop = false;
    }

    _updateDropIndicator(stageX, stageY) {
        if (!this._dropIndicator || !this._dragIcon) return;

        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        const iconCols = this._dragIcon._cellSize?.cols || 1;
        const iconRows = this._dragIcon._cellSize?.rows || 1;

        // Convert stage coordinates to grid coordinates
        // Account for the offset where the user clicked within the icon
        const [gridX, gridY] = this._grid.get_transformed_position();
        const relX = stageX - gridX - (this._dragOffsetX || 0);
        const relY = stageY - gridY - (this._dragOffsetY || 0);

        // Calculate target cell (top-left of where icon would go)
        const targetCol = Math.floor(relX / cellWidth);
        const targetRow = Math.floor(relY / cellHeight);

        // Check if the icon fits in this position
        const canFit = this._canIconFitAt(targetCol, targetRow, iconCols, iconRows, this._dragIcon);

        if (canFit) {
            // Show indicator at target cells
            const x = targetCol * cellWidth;
            const y = targetRow * cellHeight;
            const width = cellWidth * iconCols;
            const height = cellHeight * iconRows;

            this._dropIndicator.set_position(x, y);
            this._dropIndicator.set_size(width, height);
            this._dropIndicator.show();

            this._dropTargetCol = targetCol;
            this._dropTargetRow = targetRow;
            this._canDrop = true;
        } else {
            // Hide indicator - can't drop here
            this._dropIndicator.hide();
            this._canDrop = false;
        }
    }

    _canIconFitAt(col, row, cols, rows, draggedIcon) {
        // Check bounds
        const gridCols = this._settings.get_int('grid-columns');
        const gridRows = this._settings.get_int('grid-rows');

        if (col < 0 || row < 0 || col + cols > gridCols || row + rows > gridRows) {
            return false;
        }

        // Check if all cells are free (ignoring the dragged icon's current cells)
        for (let c = col; c < col + cols; c++) {
            for (let r = row; r < row + rows; r++) {
                const cell = this.getCell(c, r);
                if (!cell) return false;
                if (cell.icon && cell.icon !== draggedIcon) {
                    return false;
                }
            }
        }

        return true;
    }

    _destroyDropIndicator() {
        if (this._dropIndicator) {
            this._dropIndicator.destroy();
            this._dropIndicator = null;
        }
        this._dropTargetCol = undefined;
        this._dropTargetRow = undefined;
        this._canDrop = false;
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

    _saveIconPosition(fileName, col, row) {
        // Save column and row directly (not pixels)
        this._iconPositions[fileName] = { col: col, row: row };
        try {
            this._settings.set_string('icon-positions', JSON.stringify(this._iconPositions));
        } catch (e) {
            log(`Error saving icon position: ${e}`);
        }
    }

    _getIconPosition(fileName, defaultX, defaultY) {
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        const bounds = this._getValidBounds();

        if (this._iconPositions[fileName]) {
            const saved = this._iconPositions[fileName];

            // Handle both old format (x,y pixels) and new format (col,row)
            let col, row;
            if (saved.col !== undefined && saved.row !== undefined) {
                // New format: col/row
                col = saved.col;
                row = saved.row;
            } else {
                // Old format: x/y pixels - convert to col/row
                col = Math.round(saved.x / cellWidth);
                row = Math.round(saved.y / cellHeight);
            }

            // Clamp to valid range
            const x = Math.max(0, Math.min(col * cellWidth, bounds.maxX));
            const y = Math.max(0, Math.min(row * cellHeight, bounds.maxY));
            return { x, y };
        }

        // Snap default position to grid
        const col = Math.round(defaultX / cellWidth);
        const row = Math.round(defaultY / cellHeight);
        return { x: col * cellWidth, y: row * cellHeight };
    }

    /**
     * Reload all icons (clear and re-add)
     */
    _reloadIcons() {
        // Save current icon positions before clearing
        const cellWidth = this._getCellWidth();
        const cellHeight = this._getCellHeight();
        for (const icon of this._grid.getIcons()) {
            // Convert pixel position to col/row
            const col = Math.round(icon.x / cellWidth);
            const row = Math.round(icon.y / cellHeight);
            this._saveIconPosition(icon._fileName, col, row);
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
            // Add special icons first (Trash, Home)
            this._addSpecialIcons();

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
                    // Handle both old format (x,y pixels) and new format (col,row)
                    if (saved.col !== undefined && saved.row !== undefined) {
                        // New format: col/row
                        targetCol = saved.col;
                        targetRow = saved.row;
                    } else if (saved.x !== undefined && saved.y !== undefined) {
                        // Old format: x/y pixels - convert to col/row
                        const cellWidth = this._getCellWidth();
                        const cellHeight = this._getCellHeight();
                        targetCol = Math.floor(saved.x / cellWidth);
                        targetRow = Math.floor(saved.y / cellHeight);
                    }
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
                // Log the event for debugging
                const eventNames = {
                    [Gio.FileMonitorEvent.CREATED]: 'CREATED',
                    [Gio.FileMonitorEvent.DELETED]: 'DELETED',
                    [Gio.FileMonitorEvent.MOVED_IN]: 'MOVED_IN',
                    [Gio.FileMonitorEvent.MOVED_OUT]: 'MOVED_OUT',
                };
                log(`[Obision] FileMonitor event: ${eventNames[eventType] || eventType} for ${file.get_basename()}`);

                // Reload icons when directory changes
                if (
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.DELETED ||
                    eventType === Gio.FileMonitorEvent.MOVED_IN ||
                    eventType === Gio.FileMonitorEvent.MOVED_OUT
                ) {
                    // If we're creating a folder and this is a CREATED event, handle it specially
                    if (this._creatingFolder && eventType === Gio.FileMonitorEvent.CREATED) {
                        // Just add the new icon without clearing everything
                        if (this._reloadTimeout) {
                            GLib.source_remove(this._reloadTimeout);
                        }
                        this._reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                            try {
                                // Query with content type attribute to ensure proper icon association
                                const fileInfo = file.query_info(
                                    'standard::*,standard::content-type',
                                    Gio.FileQueryInfoFlags.NONE,
                                    null
                                );
                                const fileName = fileInfo.get_name();

                                // Check if icon already exists
                                const existingIcons = this._grid.getIcons();
                                const exists = existingIcons.some(icon => icon.getFileName() === fileName);

                                if (!exists) {
                                    const icon = new DesktopIcon(fileInfo, this, fileName);
                                    const iconCellSize = this._getIconCellSize(fileName);
                                    const freeCell = this.findFreeCell(iconCellSize);

                                    if (freeCell) {
                                        const cellWidth = this._getCellWidth();
                                        const cellHeight = this._getCellHeight();
                                        const x = freeCell.col * cellWidth;
                                        const y = freeCell.row * cellHeight;

                                        this._grid.addIcon(icon, x, y);
                                        this.placeIconInCell(icon, freeCell.col, freeCell.row);
                                        // Save position for newly created file/folder
                                        this._saveIconPosition(fileName, freeCell.col, freeCell.row);
                                        log(`[Obision] Added new icon ${fileName} at (${freeCell.col}, ${freeCell.row}) and saved position`);
                                    }
                                }
                            } catch (e) {
                                log(`[Obision] Error adding new icon: ${e}`);
                            }
                            this._reloadTimeout = null;
                            return GLib.SOURCE_REMOVE;
                        });
                        return;
                    }

                    // If this is a DELETED or MOVED_OUT event, just remove the specific icon without reloading
                    if (eventType === Gio.FileMonitorEvent.DELETED || eventType === Gio.FileMonitorEvent.MOVED_OUT) {
                        if (this._reloadTimeout) {
                            GLib.source_remove(this._reloadTimeout);
                        }
                        this._reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                            try {
                                const fileName = file.get_basename();
                                log(`[Obision] File removed/moved out: ${fileName}`);
                                const existingIcons = this._grid.getIcons();
                                const iconToRemove = existingIcons.find(icon => icon.getFileName() === fileName);

                                if (iconToRemove) {
                                    log(`[Obision] Found icon to remove: ${fileName}`);
                                    // Free the cells occupied by this icon
                                    const cellSize = iconToRemove._cellSize;
                                    const [iconX, iconY] = iconToRemove.get_position();
                                    const cellWidth = this._getCellWidth();
                                    const cellHeight = this._getCellHeight();
                                    const col = Math.round(iconX / cellWidth);
                                    const row = Math.round(iconY / cellHeight);

                                    // Free cells
                                    for (let c = col; c < col + cellSize.cols && c < this._cells.length; c++) {
                                        for (let r = row; r < row + cellSize.rows && r < this._cells[c].length; r++) {
                                            this._cells[c][r].occupied = false;
                                            this._cells[c][r].icon = null;
                                        }
                                    }

                                    // Remove the icon from grid
                                    this._grid.removeIcon(iconToRemove);
                                    log(`[Obision] Removed icon ${fileName} without moving others`);
                                } else {
                                    log(`[Obision] Icon not found in grid: ${fileName}`);
                                }
                            } catch (e) {
                                log(`[Obision] Error removing icon: ${e}`);
                            }
                            this._reloadTimeout = null;
                            return GLib.SOURCE_REMOVE;
                        });
                        return;
                    }

                    // Normal reload for other cases
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

    _addSpecialIcons() {
        // Add Trash icon if enabled
        if (this._settings.get_boolean('show-trash')) {
            this._addTrashIcon();
        }

        // Add Home icon if enabled
        if (this._settings.get_boolean('show-home')) {
            this._addHomeIcon();
        }
    }

    _addTrashIcon() {
        try {
            const trashFile = Gio.File.new_for_uri('trash:///');
            const fileInfo = trashFile.query_info(
                'standard::*',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            // Set special properties for Trash - use system translation
            const trashName = fileInfo.get_display_name() || 'Trash';
            fileInfo.set_display_name(trashName);
            fileInfo.set_attribute_object('standard::file', trashFile);
            fileInfo.set_attribute_boolean('special::is-trash', true);

            const iconName = 'user-trash';
            const name = '___TRASH___'; // Internal name

            // Create icon with trash icon
            const icon = new DesktopIcon(fileInfo, this, name);
            const iconCellSize = icon._cellSize || { cols: 1, rows: 1 };

            // Try to get saved position
            let targetCol = 0;
            let targetRow = 0;

            if (this._iconPositions[name]) {
                const saved = this._iconPositions[name];
                if (saved.col !== undefined && saved.row !== undefined) {
                    targetCol = saved.col;
                    targetRow = saved.row;
                } else if (saved.x !== undefined && saved.y !== undefined) {
                    const cellWidth = this._getCellWidth();
                    const cellHeight = this._getCellHeight();
                    targetCol = Math.floor(saved.x / cellWidth);
                    targetRow = Math.floor(saved.y / cellHeight);
                }
            }

            // Find a free cell
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
                }
            } else {
                this._grid.addIcon(icon, 0, 0);
            }
        } catch (e) {
            log(`Error adding trash icon: ${e}`);
        }
    }

    _addHomeIcon() {
        try {
            const homeFile = Gio.File.new_for_path(GLib.get_home_dir());
            const fileInfo = homeFile.query_info(
                'standard::*',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            // Set localized name for Home folder
            // Use 'Carpeta personal' as it's the standard translation in Spanish
            fileInfo.set_display_name('Carpeta personal');
            fileInfo.set_attribute_object('standard::file', homeFile);
            fileInfo.set_attribute_boolean('special::is-home', true);

            const name = '___HOME___'; // Internal name

            // Create icon
            const icon = new DesktopIcon(fileInfo, this, name);
            const iconCellSize = icon._cellSize || { cols: 1, rows: 1 };

            // Try to get saved position
            let targetCol = 0;
            let targetRow = 0;

            if (this._iconPositions[name]) {
                const saved = this._iconPositions[name];
                if (saved.col !== undefined && saved.row !== undefined) {
                    targetCol = saved.col;
                    targetRow = saved.row;
                } else if (saved.x !== undefined && saved.y !== undefined) {
                    const cellWidth = this._getCellWidth();
                    const cellHeight = this._getCellHeight();
                    targetCol = Math.floor(saved.x / cellWidth);
                    targetRow = Math.floor(saved.y / cellHeight);
                }
            }

            // Find a free cell
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
                }
            } else {
                this._grid.addIcon(icon, 0, 0);
            }
        } catch (e) {
            log(`Error adding home icon: ${e}`);
        }
    }
}
