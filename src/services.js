// Service definitions — sourced from homelab-homepage/services.yaml
export const SERVICES = {
  Media: [
    {
      name: 'Plex', desc: 'Movies & TV', color: '#e5a00d',
      href: 'https://plex.home.timmcg.net',
      details: [{ k: 'Streams', v: '0 active' }, { k: 'Transcodes', v: '0' }, { k: 'Libraries', v: '4' }],
    },
    {
      name: 'Tautulli', desc: 'Plex Analytics', color: '#e5a00d',
      href: 'https://tautulli.home.timmcg.net',
      details: [{ k: 'Today', v: '0 plays' }, { k: 'Users', v: '0' }, { k: 'Duration', v: '0h' }],
    },
    {
      name: 'Jellyfin', desc: 'Open Source Streaming', color: '#00a4dc',
      href: 'https://jellyfin.home.timmcg.net',
      details: [{ k: 'Status', v: 'online' }, { k: 'Libraries', v: '3' }],
    },
    {
      name: 'Overseerr', desc: 'Media Requests', color: '#e5700d',
      href: 'https://overseerr.home.timmcg.net',
      details: [{ k: 'Pending', v: '0' }, { k: 'Approved', v: '0' }, { k: 'Available', v: '0' }],
    },
    {
      name: 'Sonarr', desc: 'TV Series', color: '#35c5f4',
      href: 'https://sonarr.home.timmcg.net',
      details: [{ k: 'Wanted', v: '0' }, { k: 'Queued', v: '0' }, { k: 'Missing', v: '0' }],
    },
    {
      name: 'Radarr', desc: 'Movies', color: '#ffc230',
      href: 'https://radarr.home.timmcg.net',
      details: [{ k: 'Queued', v: '0' }, { k: 'Missing', v: '0' }, { k: 'Movies', v: '0' }],
    },
    {
      name: 'Prowlarr', desc: 'Indexer Manager', color: '#ff6b35',
      href: 'https://prowlarr.home.timmcg.net',
      details: [{ k: 'Indexers', v: '0' }, { k: 'Grabs today', v: '0' }, { k: 'Fails', v: '0' }],
    },
    {
      name: 'SABnzbd', desc: 'Usenet Downloader', color: '#f5c518',
      href: 'https://sab.home.timmcg.net',
      details: [{ k: 'Speed', v: '— MB/s' }, { k: 'Queue', v: '0' }, { k: 'Disk free', v: '—' }],
    },
    {
      name: 'Transmission', desc: 'Torrents', color: '#c40025',
      href: 'https://transmission.home.timmcg.net',
      details: [{ k: 'Active', v: '0' }, { k: 'Seeding', v: '0' }, { k: 'Speed ↓', v: '—' }],
    },
    {
      name: 'Unmanic', desc: 'Transcoding & Nightly Sweep', color: '#7b68ee',
      href: 'https://unmanic.home.timmcg.net',
      details: [{ k: 'Queue', v: '0' }, { k: 'Processed', v: '0' }, { k: 'Workers', v: '2' }],
    },
  ],
  Services: [
    {
      name: 'timmcg.net', desc: 'Personal Landing Page', color: '#ff2d6b',
      href: 'https://timmcg.net',
      details: [{ k: 'Status', v: 'online' }, { k: 'Latency', v: '—ms' }],
    },
    {
      name: 'AI Hub', desc: 'ai.home.timmcg.net', color: '#bf5fff',
      href: 'https://ai.home.timmcg.net',
      details: [{ k: 'Status', v: 'online' }, { k: 'Latency', v: '—ms' }],
    },
    {
      name: 'Draw', desc: 'Diagrams & Whiteboard', color: '#4ecdc4',
      href: 'https://draw.home.timmcg.net',
      details: [{ k: 'Status', v: 'online' }],
    },
    {
      name: 'PDF Tools', desc: 'Stirling PDF', color: '#ff6b6b',
      href: 'https://pdf.home.timmcg.net',
      details: [{ k: 'Status', v: 'online' }],
    },
    {
      name: 'OnWatch', desc: 'Media Watchlist', color: '#ffd93d',
      href: 'https://onwatch.home.timmcg.net',
      details: [{ k: 'Status', v: 'online' }],
    },
    {
      name: 'OpenSoak', desc: 'Hot Tub Controller', color: '#ff6b35',
      href: 'http://opensoak.home.timmcg.net',
      details: [],
    },
  ],
  Infrastructure: [
    {
      name: 'Homelab Docs', desc: 'Architecture & Runbooks', color: '#4caf50',
      href: 'https://docs.home.timmcg.net',
      details: [{ k: 'Status', v: 'online' }, { k: 'Pages', v: '—' }],
    },
    {
      name: 'TrueNAS', desc: 'Storage & Apps (babbage)', color: '#0095d5',
      href: 'https://nas.home.timmcg.net',
      details: [{ k: 'Pools', v: '—' }, { k: 'Used', v: '—' }, { k: 'Free', v: '—' }],
    },
    {
      name: 'Nginx PM', desc: 'Reverse Proxy & SSL', color: '#009639',
      href: 'https://npm.home.timmcg.net',
      details: [{ k: 'Hosts', v: '—' }, { k: 'SSL', v: 'valid' }],
    },
    {
      name: 'Dockge', desc: 'Compose Stacks', color: '#2496ed',
      href: 'https://dockge.home.timmcg.net',
      details: [{ k: 'Stacks', v: '—' }, { k: 'Running', v: '—' }, { k: 'Stopped', v: '—' }],
    },
    {
      name: 'AdGuard', desc: 'DNS Ad-block — Primary', color: '#67b346',
      href: 'https://adguard.home.timmcg.net',
      details: [{ k: 'Blocked', v: '—%' }, { k: 'Queries today', v: '—' }, { k: 'Blocked today', v: '—' }],
    },
    {
      name: 'AdGuard 2', desc: 'DNS Ad-block — Pi', color: '#67b346',
      href: 'https://adguard2.home.timmcg.net',
      details: [{ k: 'Role', v: 'secondary' }, { k: 'Blocked', v: '—%' }],
    },
    {
      name: 'Tailscale', desc: 'VPN Mesh Network', color: '#246bfd',
      href: 'https://login.tailscale.com/admin',
      details: [{ k: 'Status', v: 'connected' }, { k: 'Peers', v: '—' }, { k: 'Exit node', v: 'none' }],
    },
    {
      name: 'MinIO', desc: 'S3 Object Storage', color: '#c72e49',
      href: 'https://minio.home.timmcg.net',
      details: [{ k: 'Buckets', v: '—' }, { k: 'Objects', v: '—' }, { k: 'Used', v: '—' }],
    },
    {
      name: 'Nextcloud', desc: 'Cloud Storage & Files', color: '#0082c9',
      href: 'https://nc.home.timmcg.net',
      details: [{ k: 'Files', v: '—' }, { k: 'Used', v: '—' }, { k: 'Users', v: '—' }],
    },
    {
      name: 'Vaultwarden', desc: 'Password Manager', color: '#175ddc',
      href: 'https://vault.home.timmcg.net',
      details: [{ k: 'Status', v: 'locked' }, { k: 'Users', v: '—' }],
    },
    {
      name: 'HashiCorp Vault', desc: 'Secrets & SSH CA', color: '#ffd814',
      href: 'https://hcvault.home.timmcg.net',
      details: [{ k: 'Status', v: '—' }, { k: 'Auth', v: 'LDAP' }],
    },
    {
      name: 'Netbox', desc: 'Network Source of Truth', color: '#9b59b6',
      href: 'https://netbox.home.timmcg.net',
      details: [{ k: 'Devices', v: '—' }, { k: 'IPs', v: '—' }, { k: 'VLANs', v: '—' }],
    },
    {
      name: 'Ansible Semaphore', desc: 'Automation', color: '#ff5733',
      href: 'https://ansible.home.timmcg.net',
      details: [{ k: 'Projects', v: '—' }, { k: 'Last run', v: '—' }, { k: 'Status', v: '—' }],
    },
    {
      name: 'Grafana', desc: 'Metrics & Dashboards', color: '#f46800',
      href: 'https://grafana.home.timmcg.net',
      details: [{ k: 'Dashboards', v: '—' }, { k: 'Alerts', v: '—' }, { k: 'DS', v: '—' }],
    },
    {
      name: 'Prometheus', desc: 'Metrics Collection', color: '#e6522c',
      href: 'https://prometheus.home.timmcg.net',
      details: [{ k: 'Targets', v: '—' }, { k: 'Series', v: '—' }, { k: 'Alerts', v: '0' }],
    },
  ],
}
