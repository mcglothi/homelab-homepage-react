#!/usr/bin/env python3
"""Refresh the mirror (homeapi/mirror.py). Run by the server every COLLECT_MINUTES, or by hand:

    python3 backend/collect.py [truenas npm adguard headscale]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from homeapi import mirror  # noqa: E402

if __name__ == "__main__":
    for name, result in mirror.collect(sys.argv[1:] or None).items():
        print("%-10s %s" % (name, result))
