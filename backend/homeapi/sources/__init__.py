"""Collectors for the mirror. Each module has KINDS (the item kinds it owns) and
collect() -> [(kind, id, name, data)], or None when its credentials are not set."""

from . import adguard, headscale, npm, truenas

SOURCES = {"truenas": truenas, "npm": npm, "adguard": adguard, "headscale": headscale}
