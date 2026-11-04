"""Nginx Proxy Manager: every proxy host (public name -> upstream host:port) and its cert."""

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
        names = p.get("domain_names") or []
        for name in names:
            rows.append(("proxy", name, name, {
                "upstream": p.get("forward_host"), "port": p.get("forward_port"), "scheme": p.get("forward_scheme"),
                "enabled": bool(p.get("enabled")), "aliases": [n for n in names if n != name],
                "cert_expires": (p.get("certificate") or {}).get("expires_on"), "npm_id": p.get("id")}))
    return rows
