#!/usr/bin/env bash
set -euo pipefail

cache_dir="${HOME}/.cache/tauri"
plugin="${cache_dir}/linuxdeploy-plugin-gtk.sh"
plugin_url="${LINUXDEPLOY_GTK_PLUGIN_URL:-https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/b5eb8d05b4c0ed40107fe2158c5d8527f94568ef/linuxdeploy-plugin-gtk.sh}"

mkdir -p "$cache_dir"
curl -fsSL "$plugin_url" -o "$plugin"
chmod +x "$plugin"

python3 - "$plugin" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

marker = 'export APPDIR="${APPDIR:-"$(dirname "$(realpath "$0")")"}" # Workaround to run extracted AppImage\n'
block = '''# Brows3: prefer the host Wayland client library when one is available.
# Bundled Ubuntu Wayland libs can crash newer rolling-release EGL stacks.
if [ "${BROWS3_DISABLE_HOST_WAYLAND_PRELOAD:-0}" != "1" ]; then
    brows3_host_wayland_client=""

    if command -v ldconfig >/dev/null 2>&1; then
        brows3_host_wayland_client="$(ldconfig -p 2>/dev/null | awk '/libwayland-client\\.so(\\.0)? / { print $NF; exit }')"
    fi

    if [ -z "$brows3_host_wayland_client" ]; then
        for brows3_candidate in \\
            /usr/lib/libwayland-client.so.0 \\
            /usr/lib/libwayland-client.so \\
            /usr/lib/x86_64-linux-gnu/libwayland-client.so.0 \\
            /usr/lib/aarch64-linux-gnu/libwayland-client.so.0 \\
            /lib/x86_64-linux-gnu/libwayland-client.so.0 \\
            /lib/aarch64-linux-gnu/libwayland-client.so.0
        do
            if [ -f "$brows3_candidate" ]; then
                brows3_host_wayland_client="$brows3_candidate"
                break
            fi
        done
    fi

    if [ -n "$brows3_host_wayland_client" ]; then
        case ":${LD_PRELOAD:-}:" in
            *":$brows3_host_wayland_client:"*) ;;
            *) export LD_PRELOAD="$brows3_host_wayland_client${LD_PRELOAD:+:$LD_PRELOAD}" ;;
        esac
    fi

    unset brows3_candidate brows3_host_wayland_client
fi
'''

if block in text:
    sys.exit(0)

if marker not in text:
    print("Failed to find linuxdeploy GTK AppRun hook insertion point", file=sys.stderr)
    sys.exit(1)

path.write_text(text.replace(marker, marker + block, 1))
PY

grep -q "BROWS3_DISABLE_HOST_WAYLAND_PRELOAD" "$plugin"
