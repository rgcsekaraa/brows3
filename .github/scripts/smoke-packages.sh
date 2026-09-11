#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?Run this script in CI}"
: "${RELEASE_VERSION:?Release version is required}"

if [[ "$OSTYPE" == darwin* ]]; then
  while IFS= read -r -d '' app; do
    codesign --verify --deep --strict "$app"
  done < <(find src-tauri/target -type d -path '*/bundle/macos/Brows3.app' -print0)
  while IFS= read -r -d '' dmg; do
    hdiutil verify "$dmg"
  done < <(find src-tauri/target -type f -path '*/bundle/dmg/*.dmg' -print0)
  exit 0
fi

while IFS= read -r -d '' deb; do
  test "$(dpkg-deb -f "$deb" Version)" = "$RELEASE_VERSION"
  dpkg-deb --contents "$deb" >/dev/null
done < <(find src-tauri/target -type f -path '*/bundle/deb/*.deb' -print0)

BROWS3_APPIMAGE=$(find src-tauri/target -type f -name '*.AppImage' -print -quit)
BROWS3_APPIMAGE=$(realpath "$BROWS3_APPIMAGE")
BROWS3_SMOKE_DIR=$(mktemp -d "$RUNNER_TEMP/brows3-smoke.XXXXXX")
cd "$BROWS3_SMOKE_DIR"
"$BROWS3_APPIMAGE" --appimage-extract >/dev/null
set +e
BROWS3_PORTABLE=1 GDK_BACKEND=x11 timeout 15s xvfb-run -a ./squashfs-root/AppRun > startup.log 2>&1
BROWS3_SMOKE_STATUS=$?
set -e
cat startup.log
if [ "$BROWS3_SMOKE_STATUS" -ne 124 ]; then
  echo "Packaged application exited during startup with status $BROWS3_SMOKE_STATUS"
  exit 1
fi
if grep -Ei 'panicked at|Panic at|symbol lookup error|error while loading shared libraries' startup.log; then
  exit 1
fi
