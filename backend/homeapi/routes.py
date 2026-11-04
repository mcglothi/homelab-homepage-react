"""The dashboard's existing /api/* routes, ported one for one from server/proxy.cjs.

Each GET handler returns the payload the Node proxy returned. The server turns None
into {"error": "no data"} (HTTP 200) and an exception into {"error": msg} (HTTP 502),
exactly as proxy.cjs's apiRoute() did.
"""

import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .common import REPO, Cached, basic, fetch_local, iso_now, js_quote, parallel, request, settle, setting


def cfg(name, default):
    return setting(name, default)


PLEX_URL = lambda: cfg("PLEX_URL", "http://10.10.10.10:32400")                # noqa: E731
TAUTULLI_URL = lambda: cfg("TAUTULLI_URL", "http://10.10.10.10:30047")        # noqa: E731
OVERSEERR_URL = lambda: cfg("OVERSEERR_URL", "http://10.10.10.10:30042")      # noqa: E731
SONARR_URL = lambda: cfg("SONARR_URL", "http://10.10.10.10:8989")             # noqa: E731
RADARR_URL = lambda: cfg("RADARR_URL", "http://10.10.10.10:7878")             # noqa: E731
PROWLARR_URL = lambda: cfg("PROWLARR_URL", "http://10.10.10.10:9696")         # noqa: E731
SABNZBD_URL = lambda: cfg("SABNZBD_URL", "http://10.10.10.10:30055")          # noqa: E731
TRANSMISSION_URL = lambda: cfg("TRANSMISSION_URL", "http://10.10.10.10:30096")  # noqa: E731
ADGUARD_URL = lambda: cfg("ADGUARD_URL", "http://10.10.10.10:3000")           # noqa: E731
PROMETHEUS_URL = lambda: cfg("PROMETHEUS_URL", "http://10.10.10.10:9090")     # noqa: E731
SENSELESS_URL = lambda: cfg("SENSELESS_URL", "http://10.10.10.10:8780")       # noqa: E731
OPENSOAK_URL = lambda: cfg("OPENSOAK_URL", "https://opensoak.home.timmcg.net")  # noqa: E731
WATCH_URL = lambda: cfg("WATCH_URL", "http://10.10.10.50:8790")               # noqa: E731
AIKB_HEALTH_URL = lambda: cfg("AIKB_HEALTH_URL", "http://10.10.10.50:8791")   # noqa: E731
USAGE_URL = lambda: cfg("USAGE_URL", "")                                      # noqa: E731


def _month_window():
    """First day of last month .. last day of next month (UTC dates), as proxy.cjs."""
    now = datetime.now()
    y, m = now.year, now.month
    sy, sm = (y, m - 1) if m > 1 else (y - 1, 12)
    ey, em = (y, m + 2) if m <= 10 else (y + 1, m + 2 - 12)
    end = date(ey, em, 1).toordinal() - 1      # day 0 of month+2 = last day of month+1
    return date(sy, sm, 1).isoformat(), date.fromordinal(end).isoformat()


# ── Media ────────────────────────────────────────────────────────────────────

def plex_sessions():
    return fetch_local("%s/status/sessions?X-Plex-Token=%s" % (PLEX_URL(), cfg("PLEX_TOKEN", "")))


def tautulli(cmd_query):
    return lambda: fetch_local("%s/api/v2?apikey=%s&cmd=%s" % (TAUTULLI_URL(), cfg("TAUTULLI_KEY", ""), cmd_query))


def overseerr_requests():
    return fetch_local("%s/api/v1/request?filter=pending&take=100" % OVERSEERR_URL(),
                       {"Authorization": "Bearer %s" % cfg("OVERSEERR_KEY", "")})


def arr(base, key, path):
    return lambda: fetch_local("%s%s%sapikey=%s" % (base(), path, "&" if "?" in path else "?", cfg(key, "")))


def sonarr_calendar():
    s, e = _month_window()
    return fetch_local("%s/api/v3/calendar?apikey=%s&start=%s&end=%s&includeSeries=true" % (SONARR_URL(), cfg("SONARR_KEY", ""), s, e))


def radarr_calendar():
    s, e = _month_window()
    return fetch_local("%s/api/v3/calendar?apikey=%s&start=%s&end=%s" % (RADARR_URL(), cfg("RADARR_KEY", ""), s, e))


def transmission_torrents():
    # proxy.cjs never stored the session id, so this always answered with Transmission's
    # 409 body (not JSON) -> null -> {"error": "no data"}. Kept as is; the card copes.
    body = {"method": "torrent-get", "arguments": {"fields": ["status", "rateDownload"]}}
    return settle(lambda: fetch_local("%s/transmission/rpc" % TRANSMISSION_URL(), method="POST", body=body))


def adguard_stats():
    return fetch_local("%s/control/stats" % ADGUARD_URL(),
                       {"Authorization": basic(cfg("ADGUARD_USER", "admin"), cfg("ADGUARD_PASSWORD", ""))})


# ── Metrics ──────────────────────────────────────────────────────────────────

def prom(path):
    return lambda: fetch_local(PROMETHEUS_URL() + path)


def _prom_q(expr):
    return fetch_local("%s/api/v1/query?query=%s" % (PROMETHEUS_URL(), js_quote(expr)))


def grafana_metrics():
    now = int(time.time())
    rng = "&start=%d&end=%d&step=60" % (now - 900, now)
    cpu_q = '100-avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))*100'
    ram_q = "100*(1-node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes)"
    try:
        # proxy.cjs put these expressions in the URL unencoded; http.client needs them encoded
        cpu, ram = parallel(lambda: fetch_local("%s/api/v1/query_range?query=%s%s" % (PROMETHEUS_URL(), js_quote(cpu_q), rng)),
                            lambda: fetch_local("%s/api/v1/query_range?query=%s%s" % (PROMETHEUS_URL(), js_quote(ram_q), rng)))
    except Exception:  # noqa: BLE001
        return None

    def history(res):
        out = []
        for v in (((res or {}).get("data") or {}).get("result") or [{}])[0].get("values") or []:
            try:
                out.append(float(v[1]))
            except (TypeError, ValueError, IndexError):
                pass
        return out
    c, r = history(cpu), history(ram)
    return {"cpu": {"history": c or None, "current": c[-1] if c else None},
            "ram": {"history": r or None, "current": r[-1] if r else None},
            "net": None}


POWER_EXPR = "(max(senseless_power_watts) or max(sense_active_power_watts))"


def _since_local_midnight():
    n = datetime.now(ZoneInfo(cfg("DASHBOARD_TZ", "America/New_York")))
    return n.hour * 3600 + n.minute * 60 + n.second


def _scalar(res):
    try:
        return float(res["data"]["result"][0]["value"][1])
    except (TypeError, KeyError, IndexError, ValueError):
        return None


def _jround(x):
    """Math.round: halves go up (Python's round() goes to even)."""
    import math
    return int(math.floor(x + 0.5))


def power():
    now = int(time.time())
    since = max(60, _since_local_midnight())
    status, peak, avg, hist = parallel(
        lambda: settle(lambda: fetch_local("%s/api/status" % SENSELESS_URL())),
        lambda: settle(lambda: _prom_q("max_over_time(%s[%ds:1m])" % (POWER_EXPR, since))),
        lambda: settle(lambda: _prom_q("avg_over_time(%s[%ds:1m])" % (POWER_EXPR, since))),
        lambda: settle(lambda: fetch_local("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=3600" % (
            PROMETHEUS_URL(), js_quote("avg_over_time(%s[1h:1m])" % POWER_EXPR), now - since + 3600, now))),
    )
    history = []
    for v in (((hist or {}).get("data") or {}).get("result") or [{}])[0].get("values") or []:
        try:
            history.append(_jround(float(v[1])))
        except (TypeError, ValueError):
            pass
    latest = (status or {}).get("latest") or {}
    a, p = _scalar(avg), _scalar(peak)
    return {
        "live": bool((status or {}).get("healthy", False)),
        "current": _jround(latest["w"]) if latest.get("w") is not None else None,
        "legs": [_jround(w) for w in latest["channels"]] if isinstance(latest.get("channels"), list) else None,
        "peak": _jround(p) if p is not None else None,
        "avg": _jround(a) if a is not None else None,
        "kwh": _jround(a * since / 3600 / 100) / 10 if a is not None else None,
        "history": history or None,
    }


def opensoak_status():
    return fetch_local("%s/api/status" % OPENSOAK_URL())


# ── Media sweep flag (bind-mounted _scripts dir) ─────────────────────────────

def _scripts():
    return Path(cfg("MEDIA_SCRIPTS_DIR", "/data/media-scripts"))


def media_sweep():
    d = _scripts()
    last_run, last_lines = None, []
    try:
        last_run = (d / "last_sweep").read_text().strip()
    except OSError:
        pass
    try:
        last_lines = (d / "nightly_sweep.log").read_text().strip().split("\n")[-8:]
    except OSError:
        pass
    return {"enabled": not (d / "AUTOMATION_OFF").exists(), "lastRun": last_run,
            "lastLines": last_lines, "available": d.exists()}


def media_sweep_toggle():
    flag = _scripts() / "AUTOMATION_OFF"
    if flag.exists():
        flag.unlink()
    else:
        flag.write_text("disabled via dashboard %s\n" % iso_now())
    return {"enabled": not flag.exists()}


# ── Health: reachability for every service card ──────────────────────────────
# The catalog is src/services.js (ESM, shared with the front end). Python can't import
# it, so read the literal: every card has name: '...' and href: '...'.

SERVICES_JS = REPO / "src" / "services.js"
_GROUP_RE = re.compile(r"^\s{2}(\w[\w ]*|'[^']+'):\s*\[", re.M)
_CARD_RE = re.compile(r"name:\s*'((?:[^'\\]|\\.)*)'.*?href:\s*'([^']*)'", re.S)
_DESC_RE = re.compile(r"desc:\s*'((?:[^'\\]|\\.)*)'")


def catalog():
    """[{name, href, desc, group}] in file order."""
    text = SERVICES_JS.read_text()
    groups = [(m.start(), m.group(1).strip("'")) for m in _GROUP_RE.finditer(text)]
    out = []
    for m in _CARD_RE.finditer(text):
        group = next((g for pos, g in reversed(groups) if pos < m.start()), None)
        d = _DESC_RE.search(text, m.start(), m.end())
        out.append({"name": m.group(1).replace("\\'", "'"), "href": m.group(2),
                    "desc": d.group(1).replace("\\'", "'") if d else "", "group": group})
    return out


def _probe(s):
    start = time.time()
    try:
        res = request(s["href"], headers={"Accept": "*/*"})
        days = None
        if res.cert_expires:
            days = int((res.cert_expires - datetime.now(timezone.utc)).total_seconds() // 86400)
        return s["name"], {"online": res.status < 500, "status": res.status,
                           "ms": int((time.time() - start) * 1000), "certDays": days}
    except Exception as e:  # noqa: BLE001
        return s["name"], {"online": False, "error": str(e) or "unreachable"}


def _health():
    services = catalog()
    results = parallel(*[(lambda s=s: _probe(s)) for s in services], workers=16)
    return {"checkedAt": iso_now(), "services": dict(results)}


health = Cached(60, _health)


def _weather():
    d = fetch_local("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
                    "&current=temperature_2m&temperature_unit=fahrenheit" % (cfg("WEATHER_LAT", "43.93"), cfg("WEATHER_LON", "-69.97")))
    t = ((d or {}).get("current") or {}).get("temperature_2m")
    if t is None:
        raise RuntimeError("open-meteo: no temperature")
    return {"temp": _jround(t), "at": d["current"]["time"]}


weather = Cached(600, _weather)


GET = {
    "/api/plex/sessions": plex_sessions,
    "/api/tautulli/activity": tautulli("get_activity"),
    "/api/tautulli/stats": tautulli("get_home_stats&time_range=1&stats_count=1&stats_type=plays"),
    "/api/overseerr/requests": overseerr_requests,
    "/api/sonarr/missing": arr(SONARR_URL, "SONARR_KEY", "/api/v3/wanted/missing?pageSize=1"),
    "/api/sonarr/queue": arr(SONARR_URL, "SONARR_KEY", "/api/v3/queue?pageSize=1"),
    "/api/sonarr/calendar": sonarr_calendar,
    "/api/radarr/queue": arr(RADARR_URL, "RADARR_KEY", "/api/v3/queue?pageSize=1"),
    "/api/radarr/movies": arr(RADARR_URL, "RADARR_KEY", "/api/v3/movie"),
    "/api/radarr/calendar": radarr_calendar,
    "/api/prowlarr/indexers": arr(PROWLARR_URL, "PROWLARR_KEY", "/api/v1/indexer"),
    "/api/prowlarr/stats": arr(PROWLARR_URL, "PROWLARR_KEY", "/api/v1/indexerstats"),
    "/api/sabnzbd/queue": lambda: fetch_local("%s/api?apikey=%s&output=json&mode=queue" % (SABNZBD_URL(), cfg("SABNZBD_KEY", ""))),
    "/api/transmission/torrents": transmission_torrents,
    "/api/adguard/stats": adguard_stats,
    "/api/prometheus/targets": prom("/api/v1/targets"),
    "/api/prometheus/series": prom("/api/v1/query?query=count(up)"),
    "/api/grafana/metrics": grafana_metrics,
    "/api/power": power,
    "/api/opensoak/status": opensoak_status,
    "/api/media-sweep": media_sweep,
    "/api/health": health,
    "/api/weather": weather,
}
POST = {
    "/api/media-sweep/toggle": media_sweep_toggle,
}
# Prefix -> (base url fn, timeout seconds, methods). Bodies and status codes relayed as is.
PASSTHROUGH = {
    "/api/watch/": (WATCH_URL, 20, ("GET", "POST")),
    "/api/aikb/": (AIKB_HEALTH_URL, 30, ("GET",)),
    "/api/usage/": (USAGE_URL, 30, ("GET",)),
}
