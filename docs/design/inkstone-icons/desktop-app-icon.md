# Desktop app icon

The production master for full-bleed platform surfaces is `apps/desktop/src-tauri/icons/icon-source-1024.png`.
It is a 1024 × 1024 RGBA image where the dark tile reaches all four canvas edges at
their midpoints; only the rounded corners are transparent. This full-bleed master is used by
macOS 26 Icon Composer (`PiwinNative.icon`), the Windows 1024 px vector master, and the NSIS installer art.

Platform assets that are rendered directly without Icon Composer—specifically `icon.icns` (used by
Tauri in development mode and by legacy macOS as fallback) and the platform PNGs (`icon.png`,
`128x128.png`, etc.)—are built with Apple HIG standard 824 px squircle safe insets and ambient shadow
via `python3 scripts/dev/gen-macos-icns.py` (sourced from `icon-source-hig-1024.png`). This ensures the
development mode Dock icon matches standard macOS dock icon dimensions rather than overflowing the tile.

The desktop bundle uses the PNG, ICNS, and ICO files in
`apps/desktop/src-tauri/icons/`. Windows uses a simplified, optically larger
vector master (`icon-windows-small.svg`) for 16–48 px frames. The larger frames
use the 1024 px artwork. Run `python3 scripts/dev/gen-windows-icon.py` to build
the 15-frame ICO for Windows 11 display scales; `--check-only` validates it.
The small frames are uncompressed; the 256 px frame is PNG-compressed. The
frame sizes cover the [Windows 11 icon scale table](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction).
The matching browser icons are in `apps/desktop/public/` and
`apps/docs/public/`. The NSIS sidebar art uses the same large master and is
regenerated with
`python3 scripts/dev/gen-nsis-art.py`.

macOS 26 uses `icons/Piwin.car`, compiled from `icons/PiwinNative.icon`. The
Icon Composer source uses the same full-size artwork on a dark native icon
background. `icon.icns` remains the fallback for older macOS.
Check the packaged `.app` for both `Contents/Resources/Assets.car` and
`Contents/Resources/icon.icns`, with `CFBundleIconName` in `Contents/Info.plist`.
Regenerate `Piwin.car` from the Icon Composer source with Xcode 26 or later
when changing the artwork. Tauri uses the precompiled catalog because its
current Icon Composer path renames the document before compilation, which fails
with this version of Apple's asset compiler. Check the regenerated catalog
with `assetutil --info` and inspect a packaged `.app` in Finder. The native
icon should fill the system icon shape without a separate gray plate.

