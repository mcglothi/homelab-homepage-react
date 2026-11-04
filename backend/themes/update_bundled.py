#!/usr/bin/env python3
"""Rebuild themes/bundled.json: Docket's own themes plus a curated set of base16
schemes from tinted-theming/schemes (MIT).

base16 gives every scheme the same 16 slots: base00 is the background, base05 the
text, base02 the selection background, and base08-0F the accents (red, orange,
yellow, green, cyan, blue, magenta, brown). The page turns those into its color
tokens (work-homepage src/ui/themes.js); this file just carries the palettes.

  python3 themes/update_bundled.py         # fetch and write bundled.json
"""

import json
import ssl
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from homeapi.appearance import SLOTS, parse_scheme  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "bundled.json"
RAW = "https://raw.githubusercontent.com/tinted-theming/schemes/HEAD/base16/%s.yaml"

# Each family has a dark and a light where the scheme has one, so Light mode has
# somewhere to go from every dark theme.
CURATED = [
    "catppuccin-mocha", "catppuccin-macchiato", "catppuccin-frappe", "catppuccin-latte",
    "dracula",
    "nord", "nord-light",
    "gruvbox-dark-medium", "gruvbox-light-medium",
    "solarized-dark", "solarized-light",
    "rose-pine", "rose-pine-moon", "rose-pine-dawn",
    "tokyo-night-dark", "tokyo-night-storm", "tokyo-night-light",
    "github-dark", "github",
    "onedark", "one-light",
    "everforest-dark-medium", "everforest-light-medium",
    "kanagawa",
    "ayu-dark", "ayu-mirage", "ayu-light",
    "material-palenight", "monokai",
    "tomorrow-night", "tomorrow",
    "oxocarbon-dark", "oxocarbon-light",
]

# The original console look, written as base16. base02 is chosen so the page's
# surface mixes land on the old panel colors (#0b0b0e / #111115 / #17171c).
DOCKET = [
    {"id": "docket", "name": "Docket", "author": "Docket", "variant": "dark", "accent": "base0F",
     "palette": dict(zip(SLOTS, [
         "#080808", "#111115", "#1c1c25", "#333333", "#8a8a8a", "#e8e8e8", "#f2f2f2", "#ffffff",
         "#ff4d4f", "#f97316", "#ffab00", "#39ff5a", "#00fff7", "#2979ff", "#bf5fff", "#ff2d6b"]))},
    {"id": "docket-light", "name": "Docket Light", "author": "Docket", "variant": "light", "accent": "base0F",
     "palette": dict(zip(SLOTS, [
         "#f7f7f5", "#efefec", "#e2e2e6", "#c4c4c8", "#6b6b72", "#1a1a1f", "#111114", "#000000",
         "#d92d3a", "#d9600b", "#b37400", "#16903a", "#008a85", "#1f5fd6", "#8a3fd1", "#e0245e"]))},
]


def main():
    ctx = ssl.create_default_context()
    themes, failed = list(DOCKET), []
    for slug in CURATED:
        try:
            with urllib.request.urlopen(RAW % slug, timeout=20, context=ctx) as r:
                themes.append({"id": slug, **parse_scheme(r.read().decode())})
        except Exception as exc:  # noqa: BLE001 - report and keep going
            failed.append("%s: %s" % (slug, exc))
    OUT.write_text(json.dumps({"source": "https://github.com/tinted-theming/schemes (MIT)",
                               "themes": themes}, indent=1) + "\n")
    print("wrote %d themes to %s" % (len(themes), OUT))
    for f in failed:
        print("  failed", f, file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
