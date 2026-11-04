"""The local mirror: what the collectors last saw, in one SQLite file (DATA_DIR/mirror.db).

Search's fast pass and the graph read only this, so they never wait on a live system.
One table of items keyed by (kind, id); each source replaces its own kinds wholesale on
every run, so something deleted upstream disappears here too.

    python3 backend/collect.py              # all sources
    python3 backend/collect.py truenas npm  # some
"""

import json
import sqlite3
import threading
import time

from .common import DATA_DIR, parallel

DB = DATA_DIR / "mirror.db"
_lock = threading.Lock()


def _con():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    con.executescript("""
        CREATE TABLE IF NOT EXISTS items (kind TEXT, id TEXT, name TEXT, source TEXT, data TEXT,
                                          PRIMARY KEY (kind, id));
        CREATE INDEX IF NOT EXISTS items_name ON items (name);
        CREATE TABLE IF NOT EXISTS runs (source TEXT PRIMARY KEY, at REAL, count INTEGER, seconds REAL, error TEXT);
    """)
    return con


def save(source, kinds, rows, seconds):
    """Replace every row of `kinds` from `source` with rows [(kind, id, name, data)]."""
    with _lock, _con() as con:
        con.executemany("DELETE FROM items WHERE source = ? AND kind = ?", [(source, k) for k in kinds])
        con.executemany("INSERT OR REPLACE INTO items VALUES (?, ?, ?, ?, ?)",
                        [(k, str(i), n, source, json.dumps(d)) for k, i, n, d in rows])
        con.execute("INSERT OR REPLACE INTO runs VALUES (?, ?, ?, ?, NULL)", (source, time.time(), len(rows), seconds))


def failed(source, error):
    with _lock, _con() as con:
        con.execute("INSERT INTO runs (source, at, count, seconds, error) VALUES (?, ?, 0, 0, ?) "
                    "ON CONFLICT(source) DO UPDATE SET error = excluded.error", (source, time.time(), error))


def items(kind=None):
    """[{kind, id, name, source, **data}] — every item, or every item of one kind."""
    if not DB.exists():
        return []
    with _con() as con:
        rows = con.execute("SELECT * FROM items" + (" WHERE kind = ?" if kind else ""), (kind,) if kind else ())
        return [dict(json.loads(r["data"]), kind=r["kind"], id=r["id"], name=r["name"], source=r["source"]) for r in rows]


def runs():
    if not DB.exists():
        return {}
    with _con() as con:
        return {r["source"]: dict(r) for r in con.execute("SELECT * FROM runs")}


def collect(names=None):
    """Run the collectors (all, or those named), each on its own: one failing never stops the rest."""
    from .sources import SOURCES
    todo = [(n, s) for n, s in SOURCES.items() if not names or n in names]

    def one(name, src):
        t0 = time.time()
        try:
            rows = src.collect()
        except Exception as e:  # noqa: BLE001
            failed(name, str(e) or type(e).__name__)
            return name, "failed: %s" % (str(e) or type(e).__name__)
        if rows is None:
            failed(name, "not configured")
            return name, "skipped: not configured"
        save(name, src.KINDS, rows, round(time.time() - t0, 1))
        return name, "%d items in %.1fs" % (len(rows), time.time() - t0)
    return dict(parallel(*[(lambda n=n, s=s: one(n, s)) for n, s in todo]))
