"""Nginx Proxy Manager: every proxy host (public name -> upstream host:port) and its cert."""

import json

from ..common import get_json, request, secret, setting

KINDS = ("proxy",)


def collect():
    user, pw = secret("NPM_USER"), secret("NPM_PASSWORD")
    if not (user and pw):
        return None
    base = setting("NPM_URL", "http://10.10.10.10:30020").rstrip("/")
    tok = request(base + "/api/tokens", method="POST", body={"identity": user, "secret": pw}).json
    if not tok or "token" not in tok:
        raise RuntimeError("NPM login refused")
    hosts = get_json(base + "/api/nginx/proxy-hosts?expand=certificate", headers={"Authorization": "Bearer " + tok["token"]})
    rows = []
    for p in hosts:
        names = _names(p.get("domain_names"))
        cert = p.get("certificate") or {}
        for name in names:
            rows.append(("proxy", name, name, {
                "upstream": p.get("forward_host"), "port": p.get("forward_port"), "scheme": p.get("forward_scheme"),
                "enabled": bool(p.get("enabled")), "aliases": [n for n in names if n != name],
                "cert_expires": cert.get("expires_on"), "npm_id": p.get("id"),
                "cert_id": p.get("certificate_id") or None, "cert_name": cert.get("nice_name") or ", ".join(_names(cert.get("domain_names")))[:80] or None}))
    return rows


def _names(v):
    """Some NPM hosts return domain_names as a JSON string, which iterated char by char."""
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            pass
    if isinstance(v, str):
        v = [v]
    return [n for n in (v if isinstance(v, list) else []) if isinstance(n, str) and n]
