"""Headscale: tailnet nodes. Needs HEADSCALE_API_KEY (Bitwarden: PAT/Headscale/api-docket, expires 2027-11-03); skipped without it."""

from ..common import get_json, secret, setting

KINDS = ("node",)


def collect():
    key = secret("HEADSCALE_API_KEY")
    if not key:
        return None
    base = setting("HEADSCALE_URL", "https://hs.timmcg.net").rstrip("/")
    nodes = (get_json(base + "/api/v1/node", headers={"Authorization": "Bearer " + key}) or {}).get("nodes") or []
    return [("node", n["id"], n.get("givenName") or n.get("name"), {
        "hostname": n.get("name"), "ips": n.get("ipAddresses") or [], "online": n.get("online"),
        "last_seen": n.get("lastSeen"), "user": (n.get("user") or {}).get("name")}) for n in nodes]
