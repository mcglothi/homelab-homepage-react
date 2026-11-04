"""Appearance settings and the theme catalog, kept server-side so they follow you
to any browser pointed at this Docket. Ported from work Docket; files live in DATA_DIR.

  GET    /api/appearance          saved settings, defaults filled in, and "saved":
                                  whether anything was ever saved
  POST   /api/appearance          a partial update; the whole settings object comes back
  GET    /api/themes              the catalog: bundled themes plus installed ones
  GET    /api/themes/gallery      every scheme in tinted-theming/schemes (?refresh=1
                                  to re-download); cached for a week
  POST   /api/themes/install      {"id": ...} copies a gallery scheme into the catalog
  DELETE /api/themes/<id>         removes an installed theme (not a bundled one)

The gallery is one download of the schemes repo tarball (~110 KB), parsed here.
The page turns a theme's palette into its color tokens; this side only stores
palettes and choices.
"""

import io
import json
import re
import ssl
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

from .common import DATA_DIR

DASHBOARD = DATA_DIR                               # the container mounts it, so settings survive a redeploy
THEMES_FILE = Path(__file__).resolve().parent.parent / "themes" / "bundled.json"
INSTALLED_FILE = DASHBOARD / "themes-installed.json"
GALLERY_FILE = DASHBOARD / "theme-gallery.json"   # a cache, gitignored
SETTINGS_FILE = DASHBOARD / "appearance.json"
GALLERY_URL = "https://codeload.github.com/tinted-theming/schemes/tar.gz/HEAD"
GALLERY_TTL = 7 * 86400
SLOTS = ["base%02X" % i for i in range(16)]

DEFAULTS = {
    "mode": "dark",          # dark | light | system
    "dark": "docket",        # theme id used in dark mode
    "light": "docket-light",  # theme id used in light mode
    "accent": None,          # None = the theme's own; "base08".."base0F" = that slot of any theme; "#rrggbb"
    "radius": 12,            # card corner radius, px
    "texture": "dots",       # background pattern: none | dots | grid | crosshair | scanlines | hatch
    "textureStrength": 8,    # its opacity, percent of the text color (1-30)
    "glow": "corners",       # background glow: none | corners | vignette | aurora
    "glowStrength": 3,       # its strength (1-30)
    "density": "comfortable",  # spacing: compact | comfortable | spacious
    "textScale": 100,        # page scale, percent: 90 | 100 | 110 | 120
    "motion": "system",      # animations: system (follow macOS) | reduced | full
}
MODES = {"dark", "light", "system"}
TEXTURES = {"none", "dots", "grid", "crosshair", "scanlines", "hatch"}
GLOWS = {"none", "corners", "vignette", "aurora"}
DENSITIES = {"compact", "comfortable", "spacious"}
TEXT_SCALES = {90, 100, 110, 120}
MOTIONS = {"system", "reduced", "full"}
ACCENT_RE = re.compile(r"^(base0[89A-F]|#[0-9a-fA-F]{6})$")
_lock = threading.Lock()
_gallery_lock = threading.Lock()


# ── schemes ───────────────────────────────────────────────────────────────────

def parse_scheme(text):
    """The fields Docket uses from a base16/base24 scheme YAML, without a YAML
    dependency. base24 schemes carry base00-0F too; Docket only reads those."""
    def field(key):
        m = re.search(r'^%s:\s*"?([^"\n#]*)"?' % key, text, re.M)
        return m.group(1).strip() if m else None
    found = {k: v.lower() for k, v in re.findall(r'^\s+(base[0-9A-F]{2}):\s*"?#?([0-9a-fA-F]{6})"?', text, re.M)}
    if field("system") not in (None, "base16", "base24") or not set(SLOTS) <= set(found):
        raise ValueError("not a complete base16 scheme")
    return {"name": field("name"), "author": field("author"), "variant": field("variant") or "dark",
            "palette": {k: "#" + found[k] for k in SLOTS}}


def _read(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n")
    tmp.replace(path)


def themes():
    """Bundled themes, then installed ones (marked "installed")."""
    data = json.loads(THEMES_FILE.read_text())
    bundled = {t["id"] for t in data["themes"]}
    installed = [{**t, "installed": True} for t in _read(INSTALLED_FILE, []) if t["id"] not in bundled]
    return {**data, "themes": data["themes"] + installed}


def _theme_ids():
    return {t["id"] for t in themes()["themes"]}


# ── gallery ───────────────────────────────────────────────────────────────────

def _download_gallery():
    with urllib.request.urlopen(GALLERY_URL, timeout=30, context=ssl.create_default_context()) as r:
        blob = r.read()
    by_system = {"base16": {}, "base24": {}}
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for m in tar.getmembers():
            parts = m.name.split("/")
            if len(parts) != 3 or parts[1] not in by_system or not parts[2].endswith(".yaml"):
                continue
            try:
                scheme = parse_scheme(tar.extractfile(m).read().decode())
            except (ValueError, UnicodeDecodeError, AttributeError):
                continue
            slug = parts[2][:-5]
            by_system[parts[1]][slug] = {"id": slug, "system": parts[1], **scheme}
    # base24 only where there's no base16 scheme of the same name: Docket reads
    # the same 16 slots from both, so the base16 one is the canonical copy.
    schemes = list(by_system["base16"].values()) + [
        s for slug, s in by_system["base24"].items() if slug not in by_system["base16"]]
    schemes.sort(key=lambda s: (s["name"] or s["id"]).lower())
    return {"fetchedAt": int(time.time()), "source": "https://github.com/tinted-theming/schemes (MIT)",
            "themes": schemes}


def gallery(refresh=False):
    """(status, payload). A failed download serves the stale copy with an error."""
    with _gallery_lock:
        cached = _read(GALLERY_FILE, None)
        if cached and not refresh and time.time() - cached.get("fetchedAt", 0) < GALLERY_TTL:
            return 200, cached
        try:
            fresh = _download_gallery()
        except Exception as exc:  # noqa: BLE001 - network, TLS, bad tarball: all reported
            if cached:
                return 200, {**cached, "error": "refresh failed: %s" % exc}
            return 502, {"error": "couldn't download the theme gallery: %s" % exc}
        _write(GALLERY_FILE, fresh)
        return 200, fresh


def install(body):
    tid = (body or {}).get("id")
    status, data = gallery()
    if status != 200:
        return status, data
    scheme = next((s for s in data["themes"] if s["id"] == tid), None)
    if scheme is None:
        return 404, {"error": "no theme %r in the gallery" % tid}
    with _lock:
        installed = [t for t in _read(INSTALLED_FILE, []) if t["id"] != tid]
        installed.append({k: scheme[k] for k in ("id", "name", "author", "variant", "palette")})
        _write(INSTALLED_FILE, installed)
    return 200, themes()


def uninstall(tid):
    """Removes an installed theme; settings pointing at it fall back to the defaults."""
    if tid in {t["id"] for t in json.loads(THEMES_FILE.read_text())["themes"]}:
        return 400, {"error": "%s is bundled and can't be removed" % tid}
    with _lock:
        installed = _read(INSTALLED_FILE, [])
        kept = [t for t in installed if t["id"] != tid]
        if len(kept) == len(installed):
            return 404, {"error": "%s isn't installed" % tid}
        _write(INSTALLED_FILE, kept)
        saved = _load()
        if saved and tid in (saved.get("dark"), saved.get("light")):
            for key in ("dark", "light"):
                if saved.get(key) == tid:
                    saved[key] = DEFAULTS[key]
            _write(SETTINGS_FILE, saved)
    return 200, themes()


# ── settings ──────────────────────────────────────────────────────────────────

def _load():
    return _read(SETTINGS_FILE, None)


def get():
    saved = dict(_load() or {}) or None
    if saved and "dotGrid" in saved:   # before textures: an on/off dot grid
        dot = saved.pop("dotGrid")
        saved.setdefault("texture", "dots" if dot else "none")
    return {**DEFAULTS, **(saved or {}), "saved": saved is not None}


def _clean(body):
    """Validated subset of body; raises ValueError naming the bad field."""
    out = {}
    if "mode" in body:
        if body["mode"] not in MODES:
            raise ValueError("mode must be dark, light or system")
        out["mode"] = body["mode"]
    for key in ("dark", "light"):
        if key in body:
            if body[key] not in _theme_ids():
                raise ValueError("unknown theme: %s" % body[key])
            out[key] = body[key]
    if "accent" in body:
        a = body["accent"]
        if a is not None and not (isinstance(a, str) and ACCENT_RE.match(a)):
            raise ValueError("accent must be null, base08-base0F or #rrggbb")
        out["accent"] = a.lower() if a and a.startswith("#") else a
    if "radius" in body:
        r = body["radius"]
        if not isinstance(r, int) or isinstance(r, bool) or not 0 <= r <= 24:
            raise ValueError("radius must be an integer 0-24")
        out["radius"] = r
    if "texture" in body:
        if body["texture"] not in TEXTURES:
            raise ValueError("texture must be one of %s" % ", ".join(sorted(TEXTURES)))
        out["texture"] = body["texture"]
    if "glow" in body:
        if body["glow"] not in GLOWS:
            raise ValueError("glow must be one of %s" % ", ".join(sorted(GLOWS)))
        out["glow"] = body["glow"]
    for key, allowed in (("density", DENSITIES), ("motion", MOTIONS)):
        if key in body:
            if body[key] not in allowed:
                raise ValueError("%s must be one of %s" % (key, ", ".join(sorted(allowed))))
            out[key] = body[key]
    if "textScale" in body:
        if body["textScale"] not in TEXT_SCALES or isinstance(body["textScale"], bool):
            raise ValueError("textScale must be 90, 100, 110 or 120")
        out["textScale"] = body["textScale"]
    for key in ("textureStrength", "glowStrength"):
        if key in body:
            v = body[key]
            if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 30:
                raise ValueError("%s must be an integer 1-30" % key)
            out[key] = v
    return out


def post(body):
    """(status, payload) for POST /api/appearance."""
    if not isinstance(body, dict):
        return 400, {"error": "expected a JSON object"}
    try:
        update = _clean(body)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    with _lock:
        current = {k: v for k, v in get().items() if k in DEFAULTS}
        current.update(update)
        _write(SETTINGS_FILE, current)
    return 200, {**current, "saved": True}
