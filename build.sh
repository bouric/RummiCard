#!/bin/bash
# Construit RummiCard.app (aucune dépendance en dehors des Command Line Tools).
set -euo pipefail
cd "$(dirname "$0")"

APP="RummiCard.app"
ARCH="$(uname -m)"
# La version est l'horodatage de compilation : date + heure.
BUILD_VERSION="$(date '+%Y.%m.%d.%H%M')"
BUILD_DATE="$(date '+%d/%m/%Y à %H:%M')"
# (&amp; : le plist est du XML)
COPYRIGHT="© $(date '+%Y') Richard Boulais &amp; Claude"
echo "▸ Nettoyage"
rm -rf "$APP" build/RummiCard.iconset build/icons
mkdir -p build/icons build/RummiCard.iconset

echo "▸ Icône"
swiftc -O Tools/makeicon.swift -o build/makeicon
./build/makeicon build/icons >/dev/null
set -- 16:16x16 32:16x16@2x 32:32x32 64:32x32@2x 128:128x128 256:128x128@2x \
       256:256x256 512:256x256@2x 512:512x512 1024:512x512@2x
for pair in "$@"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  cp "build/icons/icon_${src}.png" "build/RummiCard.iconset/icon_${dst}.png"
done
iconutil -c icns build/RummiCard.iconset -o build/AppIcon.icns

echo "▸ Compilation (${ARCH})"
swiftc -O -target "${ARCH}-apple-macos13.0" Sources/main.swift -o build/RummiCard-bin

echo "▸ Assemblage du bundle"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/RummiCard-bin "$APP/Contents/MacOS/RummiCard"
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp -R Resources/web "$APP/Contents/Resources/web"
printf 'APPL????' > "$APP/Contents/PkgInfo"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>RummiCard</string>
  <key>CFBundleDisplayName</key><string>RummiCard</string>
  <key>CFBundleExecutable</key><string>RummiCard</string>
  <key>CFBundleIdentifier</key><string>com.rboulais.rummicard</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${BUILD_VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_VERSION}</string>
  <key>RCBuildDate</key><string>${BUILD_DATE}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.card-games</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>${COPYRIGHT}</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

echo "▸ Signature locale"
codesign --force --sign - "$APP" 2>/dev/null || echo "  (signature ad-hoc ignorée)"

echo "✓ $APP prêt — version ${BUILD_VERSION} (${BUILD_DATE}) — $(du -sh "$APP" | cut -f1)"
