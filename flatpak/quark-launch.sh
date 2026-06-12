#!/bin/sh
# Restore XDG_CONFIG_HOME to the real user config directory so that
# ProjectDirs (and any other XDG-aware code) reads ~/.config/quark
# instead of the Flatpak sandbox redirect at ~/.var/app/.../config.
export XDG_CONFIG_HOME="$HOME/.config"

# WebKitGTK's DMABuf/GBM renderer fails on NVIDIA proprietary drivers under
# Wayland ("failed to create GBM buffer"). Disable it only when an NVIDIA GPU
# is the active renderer; AMD/Intel can keep hardware acceleration.
if grep -qi nvidia /sys/class/drm/*/device/uevent 2>/dev/null; then
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
fi

exec /app/bin/quark "$@"
