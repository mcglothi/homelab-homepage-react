"""Shared plumbing: settings, secrets, TLS, HTTP, caching. Ported from Docket's common.py.

Stdlib only. Nothing in here ever logs or returns a secret value.
"""

import base64
import http.client
import json
import os
import shutil
import socket
import ssl
import subprocess
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
ENV_FILE = REPO / ".env"
# Mirror databases written by the collectors (backend/collect.py); git-ignored.
DATA_DIR = Path(os.environ.get("DATA_DIR") or REPO / "data")


def js_quote(s):
    """encodeURIComponent, so query strings match the Node proxy byte for byte."""
    return quote(str(s), safe="-_.!~*'()")


# ── Settings ─────────────────────────────────────────────────────────────────

def _read_env_file():
    out = {}
    try:
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def setting(name, default=""):
    """Process env first (like dotenv, which never overrides), then the .env file."""
    if os.environ.get(name):
        return os.environ[name]
    return _read_env_file().get(name) or default


# ── Secrets ──────────────────────────────────────────────────────────────────
# A secret is a setting first (.env or the container's environment). On a dev Mac with
# an unlocked Bitwarden session (~/.bw_session) a missing one falls back to the vault
# item named here. Values are held in memory only.

BW_ITEMS = {
    "TRUENAS_API_KEY": ("PAT/TrueNAS/svc_claude", "password"),
    "NPM_PASSWORD": ("PAT/NPM/svc_claude", "password"),
    "NPM_USER": ("PAT/NPM/svc_claude", "username"),
    "HEADSCALE_API_KEY": ("PAT/Headscale/api-docket", "password"),
}
MISS_RETRY = 300
_secrets = {}
_secrets_lock = threading.Lock()


def _from_bitwarden(name):
    item = BW_ITEMS.get(name)
    session_file = Path.home() / ".bw_session"
    bw = shutil.which("bw") or "/opt/homebrew/bin/bw"
    if not item or not session_file.exists() or not os.path.exists(bw):
        return None
    try:
        r = subprocess.run([bw, "get", item[1], item[0], "--session", session_file.read_text().strip()],
                           capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = r.stdout.strip()
    return value if r.returncode == 0 and value else None


def secret(name):
    value = setting(name)
    if value:
        return value
    with _secrets_lock:
        hit = _secrets.get(name)
        if hit and (hit[0] is not None or time.time() - hit[1] < MISS_RETRY):
            return hit[0]
    value = _from_bitwarden(name)
    with _secrets_lock:
        _secrets[name] = (value, time.time())
    return value


def basic(user, password):
    return "Basic " + base64.b64encode(("%s:%s" % (user, password)).encode()).decode()


# ── TLS ──────────────────────────────────────────────────────────────────────
# The Node proxy ran with rejectUnauthorized: false for every local service (self-signed
# certs); this keeps that behavior.

INSECURE = ssl.create_default_context()
INSECURE.check_hostname = False
INSECURE.verify_mode = ssl.CERT_NONE


def _der_not_after(der):
    """notAfter from a DER certificate (getpeercert() is empty under CERT_NONE)."""
    def tlv(i):
        tag, n = der[i], der[i + 1]
        i += 2
        if n & 0x80:
            k = n & 0x7F
            n = int.from_bytes(der[i:i + k], "big")
            i += k
        return tag, i, i + n
    _, i, _ = tlv(0)                       # Certificate
    _, i, _ = tlv(i)                       # tbsCertificate
    tag, s, e = tlv(i)
    if tag == 0xA0:                        # [0] version
        i = e
    for field in range(4):                 # serial, signature, issuer, validity
        tag, s, e = tlv(i)
        if field == 3:
            _, _, before_end = tlv(s)      # notBefore
            tag, s3, e3 = tlv(before_end)  # notAfter
            raw = der[s3:e3].decode()
            fmt = "%y%m%d%H%M%SZ" if tag == 0x17 else "%Y%m%d%H%M%SZ"
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        i = e
    return None


def cert_not_after(sock):
    try:
        info = sock.getpeercert()
        if info and info.get("notAfter"):
            return datetime.fromtimestamp(ssl.cert_time_to_seconds(info["notAfter"]), timezone.utc)
        der = sock.getpeercert(binary_form=True)
        return _der_not_after(der) if der else None
    except (ValueError, IndexError, AttributeError, OSError):
        return None


# ── HTTP ─────────────────────────────────────────────────────────────────────

class Response:
    def __init__(self, status, raw, cert_expires, headers=None):
        self.status = status
        self.raw = raw
        self.cert_expires = cert_expires
        self.headers = headers or {}
        try:
            self.json = json.loads(raw)
        except ValueError:
            self.json = None


def _error_text(e):
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "timeout"
    return str(getattr(e, "reason", None) or e) or type(e).__name__


class UpstreamError(Exception):
    pass


def request(url, method="GET", headers=None, body=None, timeout=5):
    """One HTTP(S) exchange, no redirect following. Raises UpstreamError on transport
    failure (message mirrors Node's: "timeout", connection refused, TLS error...)."""
    u = urlsplit(url)
    path = (u.path or "/") + ("?" + u.query if u.query else "")
    hdrs = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = body if isinstance(body, (bytes, str)) else json.dumps(body)
        data = data.encode() if isinstance(data, str) else data
        hdrs["Content-Type"] = "application/json"
        hdrs["Content-Length"] = str(len(data))
    hdrs.update(headers or {})
    if u.scheme == "https":
        conn = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout, context=INSECURE)
    else:
        conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    try:
        conn.connect()
        expires = cert_not_after(conn.sock) if u.scheme == "https" else None
        conn.request(method, path, body=data, headers=hdrs)
        r = conn.getresponse()
        raw = r.read().decode("utf-8", "replace")
        return Response(r.status, raw, expires, {k.lower(): v for k, v in r.getheaders()})
    except (OSError, http.client.HTTPException) as e:
        raise UpstreamError(_error_text(e)) from None
    finally:
        conn.close()


def fetch_local(url, headers=None, method="GET", body=None, timeout=5):
    """The Node proxy's fetchLocal: follows one redirect, returns parsed JSON or None."""
    res = request(url, method=method, headers=headers, body=body, timeout=timeout)
    if method == "GET" and res.status in (301, 302) and res.headers.get("location"):
        res = request(urljoin(url, res.headers["location"]), headers=headers, timeout=timeout)
    return res.json


class HttpStatusError(UpstreamError):
    def __init__(self, host, status):
        super().__init__("%s returned HTTP %s" % (host, status))
        self.status = status


def get_json(url, **kw):
    """Strict: an HTTP error status raises (collectors use this; routes use fetch_local)."""
    res = request(url, **kw)
    if res.status >= 400:
        raise HttpStatusError(urlsplit(url).hostname, res.status)
    return res.json


def parallel(*calls, workers=None):
    """Run zero-arg callables concurrently; return results in order, re-raising the
    first failure (Promise.all semantics)."""
    if not calls:
        return []
    with ThreadPoolExecutor(max_workers=workers or len(calls)) as pool:
        futures = [pool.submit(c) for c in calls]
        return [f.result() for f in futures]


def settle(fn):
    """fn() or None on any failure (Node's .catch(() => null))."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return None


# ── Caching ──────────────────────────────────────────────────────────────────

class Cached:
    """TTL cache with single flight: concurrent callers share one upstream fetch.

    After a failure the entry backs off (doubling, capped) and serves the last good
    value if it is no older than STALE_MAX; only then does the error reach the caller.
    """

    BACKOFF_MIN = 30
    BACKOFF_MAX = 600
    STALE_MAX = 1800

    def __init__(self, ttl_seconds, fn):
        self.ttl = ttl_seconds
        self.fn = fn
        self.lock = threading.Lock()
        self.value = None
        self.at = 0.0
        self.inflight = None
        self.error = None
        self.retry_at = 0.0
        self.backoff = 0.0

    def _stale_or_raise(self, now):
        if self.value is not None and now - self.at < self.STALE_MAX:
            return self.value
        raise self.error

    def __call__(self):
        now = time.monotonic()
        with self.lock:
            if self.value is not None and now - self.at < self.ttl:
                return self.value
            if self.error is not None and now < self.retry_at:
                return self._stale_or_raise(now)
            owner = self.inflight is None
            if owner:
                self.inflight = Future()
            fut = self.inflight
        if not owner:
            return fut.result()
        try:
            value = self.fn()
        except BaseException as e:
            with self.lock:
                self.inflight = None
                self.error = e
                self.backoff = min(self.BACKOFF_MAX, max(self.BACKOFF_MIN, self.backoff * 2))
                self.retry_at = time.monotonic() + self.backoff
                try:
                    value = self._stale_or_raise(time.monotonic())
                except BaseException as err:
                    fut.set_exception(err)
                    raise
            fut.set_result(value)
            return value
        with self.lock:
            self.value, self.at, self.inflight = value, time.monotonic(), None
            self.error, self.backoff, self.retry_at = None, 0.0, 0.0
        fut.set_result(value)
        return value


# ── Time ─────────────────────────────────────────────────────────────────────

def iso_now():
    """new Date().toISOString()"""
    n = datetime.now(timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (n.microsecond // 1000)
