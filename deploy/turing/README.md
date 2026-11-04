# AIKB search HTTP API

Read-only local dashboard API over AIKB's existing search index.

Endpoints: `GET /healthz`, `/search?q=text&k=8`, `/note?path=relative.md`, and `/mentions?name=host&limit=20`.

Install on Turing:
```sh
install -D -m 755 deploy/turing/aikb_search_http.py ~/.local/share/aikb-search-http/aikb_search_http.py
install -D -m 644 deploy/turing/aikb-search-http.service ~/.config/systemd/user/aikb-search-http.service
systemctl --user daemon-reload
systemctl --user enable --now aikb-search-http
```
