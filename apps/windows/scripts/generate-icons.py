#!/usr/bin/env python3
"""
Generate Tauri 2 desktop PNGs and multi-resolution Windows icon.ico directly
from apps/client/public/icon-512.png so Windows, Android, and Web share the
exact same Neo-Chinese Haipai app icon.
"""

from pathlib import Path
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
WINDOWS_ROOT = SCRIPT_DIR.parent
REPO_ROOT = WINDOWS_ROOT.parent.parent
SOURCE_ICON = REPO_ROOT / "apps" / "client" / "public" / "icon-512.png"
ICONS_DIR = WINDOWS_ROOT / "src-tauri" / "icons"


def main() -> None:
    if not SOURCE_ICON.exists():
        raise FileNotFoundError(f"Source icon not found: {SOURCE_ICON}")

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    master = Image.open(SOURCE_ICON).convert("RGBA")

    png_targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for filename, px_size in png_targets.items():
        resized = (
            master
            if master.size == (px_size, px_size)
            else master.resize((px_size, px_size), Image.Resampling.LANCZOS)
        )
        resized.save(ICONS_DIR / filename, format="PNG")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(ICONS_DIR / "icon.ico", format="ICO", sizes=ico_sizes)
    print(f"Generated Tauri icons from {SOURCE_ICON} into {ICONS_DIR}")


if __name__ == "__main__":
    main()
