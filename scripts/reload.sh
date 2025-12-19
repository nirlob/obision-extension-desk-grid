#!/bin/bash

# Script to reload the GNOME Shell extension

EXTENSION_UUID="obision-ext-desk-grid@obision.com"

echo "🔄 Reloading extension..."

# Disable extension
gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null

# Wait a moment
sleep 0.5

# Enable extension
gnome-extensions enable "$EXTENSION_UUID"

if [ $? -eq 0 ]; then
    echo "✓ Extension reloaded successfully"
else
    echo "✗ Failed to reload extension"
    echo "Note: If this doesn't work, you may need to restart GNOME Shell:"
    echo "  - X11: Press Alt+F2, type 'r', press Enter"
    echo "  - Wayland: Log out and log back in"
    exit 1
fi
