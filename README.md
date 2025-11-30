# Obision Desk - Desktop Icons Extension

A GNOME Shell extension that provides desktop icons functionality with support for multiple icon sizes.

## Features

- 📁 **Desktop Icons**: Display files and folders from your Desktop directory
- 📏 **Multi-size Icons**: Support for small (48px), medium (64px), large (96px), and extra-large (128px) icons
- 🔄 **Auto-refresh**: Automatically updates when files are added/removed from Desktop
- 🎨 **Theme Integration**: Respects GNOME accent colors and light/dark themes
- 🖱️ **Drag & Drop**: Move icons around (coming soon: custom positions)
- 🗑️ **Special Icons**: Trash and Home folder support

## Installation

### Development Installation

```bash
# Clone the repository
git clone https://github.com/nirlob/obision-extension-desk.git
cd obision-extension-desk

# Install dependencies
npm install

# Build and install the extension
npm run deploy

# Enable the extension
npm run enable
```

### Restart GNOME Shell

- **X11**: Press `Alt+F2`, type `r`, press `Enter`
- **Wayland**: Log out and log back in

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile schemas and pack extension |
| `npm run deploy` | Build, install, and show restart instructions |
| `npm run update` | Build, install, and reload (X11 only) |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |

### Project Structure

```
obision-extension-desk/
├── extension.js      # Main extension code
├── prefs.js          # Preferences dialog
├── stylesheet.css    # CSS styles
├── metadata.json     # Extension metadata
├── schemas/          # GSettings schemas
│   └── org.gnome.shell.extensions.obision-extension-desk.gschema.xml
└── package.json      # npm scripts and dependencies
```

## Configuration

Access settings through GNOME Extensions app or run:
```bash
gnome-extensions prefs obision-extension-desk@obision.com
```

### Available Settings

- **Icon Size**: small, medium, large, xlarge
- **Show Hidden Files**: Display dot files
- **Grid Spacing**: Space between icons (4-48px)
- **Sort By**: name, modified, size, type
- **Single Click**: Open with single click
- **Show Trash**: Display trash icon
- **Show Home**: Display home folder icon

## License

GPL-3.0
