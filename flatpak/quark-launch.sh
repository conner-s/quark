#!/bin/sh
# Restore XDG_CONFIG_HOME to the real user config directory so that
# ProjectDirs (and any other XDG-aware code) reads ~/.config/quark
# instead of the Flatpak sandbox redirect at ~/.var/app/.../config.
export XDG_CONFIG_HOME="$HOME/.config"
exec /app/bin/quark "$@"
