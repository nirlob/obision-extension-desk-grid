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

### From Release (Debian/Ubuntu)

Download the latest `.deb` package from [Releases](https://github.com/nirlob/obision-ext-desk-grid/releases) and install:

```bash
sudo dpkg -i obision-ext-desk-grid.deb
sudo apt-get install -f
gnome-extensions enable obision-ext-desk-grid@obision.com
```

Then restart GNOME Shell:
- **X11**: Press `Alt+F2`, type `r`, press `Enter`
- **Wayland**: Log out and log back in

### Development Installation

```bash
# Clone the repository
git clone https://github.com/nirlob/obision-ext-desk-grid.git
cd obision-ext-desk-grid

# Install dependencies
npm install

# Build and install the extension
npm run deploy

# Enable the extension
npm run enable
```

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile schemas and pack extension into builddir/ |
| `npm run deploy` | Build, install, and show restart instructions |
| `npm run update` | Build, install, and reload (X11 only) |
| `npm run deb-build` | Build Debian package (.deb) |
| `npm run deb-install` | Install the .deb package locally |
| `npm run deb-uninstall` | Uninstall the .deb package |
| `npm run release` | Create new release (bump version, tag, push) |
| `npm run logs` | View GNOME Shell logs in real-time |
| `npm run clean` | Remove build artifacts |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |

### Project Structure

```
obision-ext-desk-grid/
├── extension.js      # Main extension code
├── prefs.js          # Preferences dialog
├── stylesheet.css    # CSS styles
├── metadata.json     # Extension metadata
├── schemas/          # GSettings schemas
│   └── com.obision.ext.desk-grid.gschema.xml
├── scripts/          # Build and release scripts
│   └── release.sh    # Automated release script
└── package.json      # npm scripts and dependencies
```

### Making a Release

To create a new release:

```bash
npm run release
```

This will:
1. Bump the version number (increments minor version)
2. Update `package.json`, `metadata.json`, and `debian/changelog`
3. Commit the changes
4. Create a git tag
5. Push to GitHub
6. GitHub Actions will build the .deb package and attach it to the release

## Configuration

Access settings through GNOME Extensions app or run:
```bash
gnome-extensions prefs obision-ext-desk-grid@obision.com
```

### Available Settings

- **Icon Size**: small, medium, large, xlarge
- **Show Hidden Files**: Display dot files
- **Grid Spacing**: Space between icons (4-48px)
- **Sort By**: name, modified, size, type
- **Single Click**: Open with single click
- **Show Trash**: Display trash icon
- **Show Home**: Display home folder icon

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Run tests: `npm run lint`
5. Commit: `git commit -am 'Add feature'`
6. Push: `git push origin feature-name`
7. Create a Pull Request

## License

GPL-3.0

## Links

- [Repository](https://github.com/nirlob/obision-ext-desk-grid)
- [Issues](https://github.com/nirlob/obision-ext-desk-grid/issues)
- [Releases](https://github.com/nirlob/obision-ext-desk-grid/releases)
