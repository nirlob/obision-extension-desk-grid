# Obision Desk Extension - AI Coding Instructions

## Project Overview

GNOME Shell extension for desktop icons with grid-based layout. Icons can span multiple cells (1x1 to 4x4) and have elevation/background styles for "widget mode". Built using GJS (GNOME JavaScript) for GNOME Shell 48+.

**Key Differentiator**: Unlike DING (Desktop Icons NG), this extension runs entirely in the shell process using St.* widgets, not as a separate GTK subprocess.

## Architecture

### Core Components (all in `extension.js`)

1. **`ObisionExtensionDesk`** (Extension class)
   - Manages lifecycle (`enable()`/`disable()`)
   - Maintains `_cells` array: bidimensional grid tracking which cells are occupied by which icons
   - Handles file monitoring via `Gio.FileMonitor` on Desktop directory
   - Stores per-icon metadata in GSettings: `icon-sizes`, `icon-elevations`, `icon-backgrounds`, `icon-positions`

2. **`DesktopGrid`** (St.Widget subclass)
   - Container positioned at `Main.layoutManager._backgroundGroup` (desktop layer)
   - Uses fixed layout manager - icons positioned by absolute pixel coordinates
   - Handles rubber band selection and drag-drop target
   - Position calculated from work area using `Main.layoutManager.getWorkAreaForMonitor()`

3. **`GridOverlay`** (St.DrawingArea subclass)
   - Draws grid lines/dots using Cairo when `grid-visible` setting enabled
   - Positioned identically to DesktopGrid for perfect alignment

4. **`DesktopIcon`** (St.BoxLayout subclass)
   - Width/height fixed to span N×M cells (e.g., 2x2 icon = 2 cells wide × 2 cells tall)
   - Icon image size calculated from available space minus padding and label height
   - Context menu via `PopupMenu.PopupMenu` for size/style changes
   - CSS classes: `elevation-0` to `elevation-3`, `bg-none`/`bg-frost`/`bg-glass`, `widget-mode`

### Grid System Architecture

**How icons know their size and position:**
```javascript
// 1. Cell grid built at startup
_buildCellGrid() {
    this._cells = []; // 2D array: _cells[col][row]
    for (col in columns) {
        for (row in rows) {
            this._cells[col][row] = { occupied: false, icon: null };
        }
    }
}

// 2. Icon requests cell space when created
const cellSize = extension._getIconCellSize(fileName); // e.g., {cols: 2, rows: 1}
const position = extension.findFreeSpace(cellSize); // Searches _cells array

// 3. Icon reserves cells
extension.occupyCells(col, row, cellSize, iconInstance);

// 4. Icon size calculated from cells
const cellWidth = extension._getCellWidth(); // workArea.width / gridColumns
const iconPixelWidth = cellWidth * cellSize.cols;
```

**Cell size mapping** (stored in GSettings `icon-sizes` as JSON):
```javascript
{
    "document.pdf": "2x2",    // 2 cells wide, 2 tall
    "Projects": "3x1",        // 3 cells wide, 1 tall
    "image.png": "1x1"        // default
}
```

### Import Conventions

```javascript
// GI modules use gi:// protocol
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';        // Shell Toolkit (NOT Gtk!)
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';  // For grid drawing
import Pango from 'gi://Pango';  // For text layout

// GNOME Shell modules use resource:// protocol
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
```

## Development Workflow

### Essential Commands

```bash
# Development cycle
npm run deploy     # Build (compile schemas + pack) → install → show restart instructions
npm run update     # deploy + auto-reload (X11 only, uses scripts/reload.sh)
npm run logs       # journalctl -f -o cat /usr/bin/gnome-shell

# Schema changes require
npm run compile-schemas   # glib-compile-schemas schemas/
npm run deploy           # then restart shell

# Release process
npm run release    # Automated: bump version → commit → tag → push (triggers GitHub Actions)
npm run deb-build  # Build .deb package with dpkg-buildpackage
```

### Testing Changes

1. Edit `extension.js`, `prefs.js`, or `stylesheet.css`
2. `npm run deploy` (if you changed GSettings schema, this recompiles it)
3. Restart GNOME Shell:
   - **X11**: `Alt+F2` → type `r` → Enter (or use `npm run update` to auto-reload)
   - **Wayland**: Log out/in (no hot reload available)
4. Watch logs: `npm run logs` or `journalctl -f -o cat /usr/bin/gnome-shell`
5. Use Looking Glass for debugging: `Alt+F2` → type `lg` → Enter (X11 only)

**Debugging tip**: Use `log('message')` in extension code (NOT `console.log`). Output appears in journalctl.

## Critical Constraints

### Extension Lifecycle

- `disable()` MUST clean up ALL resources:
  - Disconnect ALL signal handlers
  - Remove ALL added chrome/UI elements
  - Clear ALL timeouts/intervals
  - Null ALL references

```javascript
disable() {
    if (this._signalId) {
        someObject.disconnect(this._signalId);
        this._signalId = null;
    }
    if (this._widget) {
        Main.layoutManager.removeChrome(this._widget);
        this._widget.destroy();
        this._widget = null;
    }
}
```

### GSettings

- Schema ID must match `metadata.json` `settings-schema`
- Run `glib-compile-schemas schemas/` after schema changes
- Access via `this.getSettings()` in extension class

### UI Elements

- Use `Main.layoutManager.addChrome()` to add persistent UI
- Use `St.*` widgets (not Gtk) in shell extensions
- Use `Clutter.ActorAlign` for alignment

## Icon Size & Widget Mode

**Icon sizes are GRID-BASED, not pixel-based:**

```javascript
// extension.js defines cell sizes (NOT pixel sizes)
const ICON_CELL_SIZES = {
    '1x1': { cols: 1, rows: 1 },  // Default
    '2x2': { cols: 2, rows: 2 },  // Large widget
    '3x1': { cols: 3, rows: 1 },  // Wide icon
    '4x4': { cols: 4, rows: 4 },  // Maximum
    // ...etc
};

// Per-icon sizes stored in GSettings as JSON string
{
    "document.pdf": "2x2",    // Spans 2×2 cells
    "Projects": "3x1",        // Wide folder
    "image.png": "1x1"        // Default
}
```

**Widget mode** (elevation + backgrounds):
- Icons can have `elevation` (0-3) for shadow depth
- Backgrounds: `none`, `frost` (frosted glass), `glass` (translucent)
- Stored separately in GSettings: `icon-elevations`, `icon-backgrounds`
- Applied via CSS classes in `stylesheet.css`

## File Structure

```
├── extension.js          # Extension entry + DesktopGrid + DesktopIcon
├── prefs.js              # Preferences using Adw widgets
├── stylesheet.css        # St CSS (subset of CSS3)
├── metadata.json         # UUID, shell-version, schema
├── schemas/              # GSettings XML schema
│   └── *.gschema.xml
├── package.json          # npm scripts for build/deploy
└── reload.sh             # Shell restart helper
```

## Common Tasks

### Add New Setting

1. Add key to `schemas/*.gschema.xml`
2. Add UI in `prefs.js` with `settings.bind()`
3. Read in `extension.js` via `this._settings.get_*()`
4. Rebuild: `npm run compile-schemas && npm run deploy`

### Add New Icon Feature

1. Extend `DesktopIcon` class in `extension.js`
2. Add styles to `stylesheet.css`
3. Connect to GSettings if configurable

### Debug

```bash
# Live logs
journalctl -f -o cat /usr/bin/gnome-shell

# Looking Glass (X11)
Alt+F2 → lg → Enter

# Extension logs
log('message');  # global log function
```

## Style Guide

- Use ES modules (`import`/`export`)
- Single quotes, 4-space indent, trailing commas
- Prefix private members with `_`
- GObject classes use PascalCase
- Clean up in `disable()` - no exceptions

## Obision Extension Ecosystem

This extension is part of the **Obision** project family. Related extensions share common patterns and may interact.

### Related Extensions

| Extension | Purpose | UUID |
|-----------|---------|------|
| `obision-extension-dash` | Bottom dock/panel with app launchers | `obision-extension-dash@obision.com` |
| `obision-extension-grid` | Stage Manager-style window management | `obision-extension-grid@obision.com` |
| `obision-extension-desk` | Desktop icons (this extension) | `obision-extension-desk@obision.com` |

### Integration Patterns

**Detecting Other Obision Extensions:**
```javascript
// Check if another Obision extension is enabled
const ExtensionUtils = imports.misc.extensionUtils;
const dashExtension = ExtensionUtils.extensions['obision-extension-dash@obision.com'];
if (dashExtension?.state === ExtensionUtils.ExtensionState.ENABLED) {
    // Adjust layout to account for dash panel
}
```

**Coordinating Work Areas:**
- `obision-extension-dash` reserves space at screen edges (top/bottom)
- `obision-extension-desk` should use `Main.layoutManager.getWorkAreaForMonitor()` to respect panel space
- Both use `Main.layoutManager._trackedActors` to detect chrome elements

**Shared Design Language:**
- GNOME accent colors: read from `org.gnome.desktop.interface` → `accent-color`
- Theme variants: check `color-scheme` for light/dark mode
- Border radius: 8-14px for containers, 4-6px for small elements
- Animation duration: 150-250ms with `EASE_OUT_QUAD`

### Cross-Extension Communication

Currently no direct communication - each extension operates independently but respects:
1. Work area boundaries (panels, docks)
2. Fullscreen state (hide elements)
3. Overview state (hide desktop icons during Activities)

**Future Integration Points:**
- Drag files from desktop to dash favorites
- Unified settings panel for Obision extensions
- Shared theming preferences

## Reference: DING Extension Architecture

DING (Desktop Icons New Generation) is the reference implementation. Key architectural differences to understand:

**DING uses a separate GTK process:**
```
extension.js          → Spawns subprocess
    ↓
app/ding.js          → GTK Application (separate process)
    ↓
app/desktopManager.js → Manages multiple monitors
    ↓
app/desktopGrid.js    → Grid per monitor (Gtk.ApplicationWindow)
    ↓
app/fileItem.js       → Individual icon widget
```

**Why DING uses subprocess:**
- GTK widgets can't run in GNOME Shell process (only St.* widgets)
- Subprocess creates transparent GTK windows over desktop
- D-Bus communication between extension and subprocess
- X11: window type hint `DESKTOP`, Wayland: `maximize()`

**Our approach (simpler, single-process):**
- Use `St.*` widgets directly in shell process
- `Main.layoutManager.addChrome()` for desktop layer
- No subprocess, no D-Bus complexity
- Limitation: less GTK widget flexibility

**Key DING files for reference (cloned to `/tmp/ding-example/`):**
- `extension.js` - subprocess spawning, X11 window emulation
- `app/desktopGrid.js` - grid layout, rubber band selection
- `app/fileItem.js` - icon widget, drag & drop, context menu
- `app/desktopManager.js` - multi-monitor, file enumeration
- `visibleArea.js` - work area calculation respecting panels
