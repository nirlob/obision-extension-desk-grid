#!/bin/bash
# Reload GNOME Shell extension
# On X11: Uses D-Bus to restart GNOME Shell
# On Wayland: Logs out the user (only way to restart shell)

if [ "$XDG_SESSION_TYPE" = "x11" ]; then
    echo "Reloading GNOME Shell on X11..."
    dbus-send --type=method_call --dest=org.gnome.Shell /org/gnome/Shell org.gnome.Shell.Eval string:'Meta.restart("Reloading extensions...")'
else
    echo "On Wayland, you need to log out and back in to reload the extension."
    echo "Do you want to log out now? (y/n)"
    read -r answer
    if [ "$answer" = "y" ]; then
        gnome-session-quit --logout --no-prompt
    fi
fi
