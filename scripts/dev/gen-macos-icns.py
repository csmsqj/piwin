#!/usr/bin/env python3
"""Build the macOS and cross-platform desktop icons with HIG-compliant padding.

Usage: python3 scripts/dev/gen-macos-icns.py [--check-only]
Requires Pillow and macOS iconutil.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
ICONS_DIR = REPO_ROOT / "apps" / "desktop" / "src-tauri" / "icons"
HIG_SOURCE = ICONS_DIR / "icon-source-hig-1024.png"
ICNS_PATH = ICONS_DIR / "icon.icns"
ICON_PNG_PATH = ICONS_DIR / "icon.png"

ICNS_SIZES = (
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
)

PLATFORM_PNG_SIZES = (
    ("32x32.png", 32),
    ("64x64.png", 64),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
)


def build_icns(source: Image.Image, output_icns: Path, temp_dir: Path) -> None:
    iconset_dir = temp_dir / "piwin.iconset"
    iconset_dir.mkdir(parents=True, exist_ok=True)
    for filename, size in ICNS_SIZES:
        resized = source.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(iconset_dir / filename)

    iconutil = shutil.which("iconutil")
    if iconutil is None:
        raise SystemExit("iconutil not found (macOS required to build .icns)")
    subprocess.run(
        [iconutil, "-c", "icns", str(iconset_dir), "-o", str(output_icns)],
        check=True,
    )


def verify_icns(path: Path) -> None:
    if not path.exists() or path.stat().st_size == 0:
        raise ValueError(f"empty or missing icns: {path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    if not HIG_SOURCE.exists():
        raise SystemExit(f"missing HIG source: {HIG_SOURCE}")

    source = Image.open(HIG_SOURCE).convert("RGBA")
    if source.size != (1024, 1024):
        raise ValueError(f"expected 1024x1024 HIG source, got {source.size}")

    with tempfile.TemporaryDirectory(prefix="piwin-icns-") as directory:
        temp_dir = Path(directory)
        temp_icns = temp_dir / "generated.icns"
        build_icns(source, temp_icns, temp_dir)

        if args.check_only:
            verify_icns(ICNS_PATH)
            verify_icns(ICON_PNG_PATH)
            print(f"OK: {ICNS_PATH} and platform PNGs are valid")
            return 0

        shutil.copy2(temp_icns, ICNS_PATH)
        source.save(ICON_PNG_PATH)
        for filename, size in PLATFORM_PNG_SIZES:
            target_path = ICONS_DIR / filename
            resized = source.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(target_path)

    verify_icns(ICNS_PATH)
    print(f"OK: generated {ICNS_PATH} and matching platform PNGs with HIG safe insets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
