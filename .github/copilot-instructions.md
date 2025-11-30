# Obision Desk Extension - AI Coding Instructions

## Project Overview

GNOME Shell extension for desktop icons with multi-size support. Built using GJS (GNOME JavaScript) and the GNOME Shell extension framework for GNOME 48+.

## Architecture

### Core Components

- **`extension.js`**: Main entry point with `enable()`/`disable()` lifecycle
  - `ObisionExtensionDesk`: Extension class managing lifecycle and state
  - `DesktopGrid`: Container widget handling icon layout
  - `DesktopIcon`: Individual icon widget with selection/DnD support

- **`prefs.js`**: Preferences dialog using libadwaita (Adw) widgets
  - Uses `ExtensionPreferences` base class from GNOME 45+ API

- **`schemas/*.gschema.xml`**: GSettings schema for persistent configuration

### Key Patterns

```javascript
// GNOME Shell extension structure
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MyExtension extends Extension {
    enable() { /* activation */ }
    disable() { /* cleanup - MUST remove all traces */ }
}

// GObject widget registration
const MyWidget = GObject.registerClass(
class MyWidget extends St.Widget {
    _init(params) {
        super._init(params);
    }
});
```

### Import Conventions

```javascript
// GI modules use gi:// protocol
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// GNOME Shell modules use resource:// protocol
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
```

## Development Workflow

```bash
npm run deploy    # Build + install (then restart shell)
npm run update    # Build + install + reload (X11 only)
npm run lint      # Check code style
```

### Testing Changes

1. Modify code
2. Run `npm run deploy`
3. Restart GNOME Shell:
   - X11: `Alt+F2` → `r` → Enter
   - Wayland: Log out/in
4. Check logs: `journalctl -f -o cat /usr/bin/gnome-shell`

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

## Icon Size Implementation

```javascript
// Size presets in extension.js
const ICON_SIZES = {
    small: 48,
    medium: 64,
    large: 96,
    xlarge: 128,
};

// Per-icon custom sizes stored in GSettings as JSON
{
    "filename.txt": "large",
    "folder": "xlarge"
}
```

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
