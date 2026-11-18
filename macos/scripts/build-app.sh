#!/usr/bin/env bash
# Собирает Piranhas.app из Swift-пакета и web/dist. Запускать на macOS (Xcode или Command Line Tools).
#   ./macos/scripts/build-app.sh            → dist/Piranhas.app и dist/Piranhas-macos.tar.gz
# Требует готовый web/dist (cd web && npm run build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
BUILD="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-0}}"
APP="$ROOT/dist/Piranhas.app"

[[ -f "$ROOT/web/dist/index.html" ]] || { echo "Нет web/dist — сначала: cd web && npm run build" >&2; exit 1; }

cd "$ROOT/macos"
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$BIN_DIR/PiranhasDashboard" "$APP/Contents/MacOS/PiranhasDashboard"
cp -R "$ROOT/web/dist/." "$APP/Contents/Resources/web/"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" "$ROOT/macos/Resources/Info.plist" > "$APP/Contents/Info.plist"
# Иконка: AppIcon.png (1024×1024) → AppIcon.icns штатными sips и iconutil.
ICON_SRC="$ROOT/macos/Resources/AppIcon.png"
if [[ -f "$ICON_SRC" ]]; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z "$((size * 2))" "$((size * 2))" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
fi
plutil -lint "$APP/Contents/Info.plist"

# Подпись ad-hoc: приложение для одного Mac, без Apple Developer ID (см. docs/adr/0003).
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --verbose "$APP"

tar -C "$ROOT/dist" -czf "$ROOT/dist/Piranhas-macos.tar.gz" Piranhas.app
echo "Готово: $APP (версия $VERSION, сборка $BUILD)"
