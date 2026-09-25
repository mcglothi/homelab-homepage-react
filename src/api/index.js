// All API calls go through /api/* — proxied to local services by the Express server
// Falls back gracefully on error so the UI always renders

async function get(path) {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

// ── Plex ──────────────────────────────────────────────────────────────────────
export async function fetchPlex() {
  const data = await get('/api/plex/sessions')
  if (!data) return null
  const sessions = data.MediaContainer?.Metadata ?? []
  const playing = sessions.find(s => s.type === 'episode' || s.type === 'movie')
  return {
    streams: sessions.length,
    title: playing
      ? playing.grandparentTitle
        ? `${playing.grandparentTitle} ${playing.parentIndex > 0 ? 'S' + String(playing.parentIndex).padStart(2,'0') : ''}E${String(playing.index).padStart(2,'0')}`
        : playing.title
      : null,
  }
}

// ── Tautulli ──────────────────────────────────────────────────────────────────
export async function fetchTautulli() {
  const [activity, stats] = await Promise.all([
    get('/api/tautulli/activity'),
    get('/api/tautulli/stats'),
  ])
  return {
    details: [
      { k: 'Today', v: `${stats?.response?.data?.[0]?.total_plays ?? 0} plays` },
      { k: 'Users', v: String(activity?.response?.data?.stream_count ?? 0) },
      { k: 'Duration', v: stats?.response?.data?.[0]?.total_duration ?? '0h' },
    ],
  }
}

// ── Overseerr ─────────────────────────────────────────────────────────────────
export async function fetchOverseerr() {
  const data = await get('/api/overseerr/requests')
  const pending = data?.pageInfo?.results ?? data?.results?.length ?? 0
  return {
    pending,
    details: [
      { k: 'Pending', v: String(pending) },
      { k: 'Approved', v: '—' },
      { k: 'Available', v: '—' },
    ],
  }
}

// ── Sonarr ────────────────────────────────────────────────────────────────────
export async function fetchSonarr() {
  const [missing, queue] = await Promise.all([
    get('/api/sonarr/missing'),
    get('/api/sonarr/queue'),
  ])
  const wanted = missing?.totalRecords ?? 0
  const queued = queue?.totalRecords ?? 0
  return {
    details: [
      { k: 'Wanted', v: String(wanted) },
      { k: 'Queued', v: String(queued) },
      { k: 'Missing', v: String(wanted) },
    ],
  }
}

// ── Radarr ────────────────────────────────────────────────────────────────────
export async function fetchRadarr() {
  const [queue, movies] = await Promise.all([
    get('/api/radarr/queue'),
    get('/api/radarr/movies'),
  ])
  const queued = queue?.totalRecords ?? 0
  const total = Array.isArray(movies) ? movies.length : 0
  const missing = Array.isArray(movies) ? movies.filter(m => m.monitored && !m.hasFile).length : 0
  return {
    details: [
      { k: 'Queued', v: String(queued) },
      { k: 'Missing', v: String(missing) },
      { k: 'Movies', v: total.toLocaleString() },
    ],
  }
}

// ── Prowlarr ──────────────────────────────────────────────────────────────────
export async function fetchProwlarr() {
  const [indexers, stats] = await Promise.all([
    get('/api/prowlarr/indexers'),
    get('/api/prowlarr/stats'),
  ])
  const count = Array.isArray(indexers) ? indexers.length : 0
  const grabs = stats?.grabCount ?? 0
  const fails = stats?.failCount ?? 0
  return {
    details: [
      { k: 'Indexers', v: String(count) },
      { k: 'Grabs today', v: String(grabs) },
      { k: 'Fails', v: String(fails) },
    ],
  }
}

// ── SABnzbd ───────────────────────────────────────────────────────────────────
export async function fetchSABnzbd() {
  const data = await get('/api/sabnzbd/queue')
  const q = data?.queue
  const speedRaw = parseFloat(q?.kbpersec ?? 0)
  const speed = speedRaw > 0 ? `${(speedRaw / 1024).toFixed(1)} MB/s` : '— MB/s'
  const diskFree = q?.diskspace1 ? `${parseFloat(q.diskspace1).toFixed(1)} GB` : '—'
  return {
    speed: speedRaw > 0 ? parseFloat((speedRaw / 1024).toFixed(1)) : 0,
    details: [
      { k: 'Speed', v: speed },
      { k: 'Queue', v: String(q?.noofslots ?? 0) },
      { k: 'Disk free', v: diskFree },
    ],
  }
}

// ── Transmission ──────────────────────────────────────────────────────────────
export async function fetchTransmission() {
  const data = await get('/api/transmission/torrents')
  const torrents = data?.arguments?.torrents ?? []
  const active = torrents.filter(t => t.status === 4).length // 4 = downloading
  const seeding = torrents.filter(t => t.status === 6).length
  const totalDown = torrents.reduce((sum, t) => sum + (t.rateDownload ?? 0), 0)
  const downSpeed = totalDown > 0 ? `${(totalDown / 1024 / 1024).toFixed(1)} MB/s` : '—'
  return {
    details: [
      { k: 'Active', v: String(active) },
      { k: 'Seeding', v: String(seeding) },
      { k: 'Speed ↓', v: downSpeed },
    ],
  }
}

// ── AdGuard Home ──────────────────────────────────────────────────────────────
export async function fetchAdguard() {
  const data = await get('/api/adguard/stats')
  if (!data) return null
  const queries = parseInt(data.num_dns_queries ?? 0)
  const blocked = parseInt(data.num_blocked_filtering ?? 0)
  const pct = queries > 0 ? ((blocked / queries) * 100).toFixed(1) : '0.0'
  return {
    blocked: parseFloat(pct),
    percentage: parseFloat(pct),
    queries,
    details: [
      { k: 'Blocked', v: `${pct}%` },
      { k: 'Queries today', v: queries.toLocaleString() },
      { k: 'Blocked today', v: blocked.toLocaleString() },
    ],
  }
}

// ── Prometheus ────────────────────────────────────────────────────────────────
export async function fetchPrometheus() {
  const [targets, series] = await Promise.all([
    get('/api/prometheus/targets'),
    get('/api/prometheus/series'),
  ])
  const active = targets?.data?.activeTargets?.length ?? 0
  const total = (targets?.data?.activeTargets?.length ?? 0) + (targets?.data?.droppedTargets?.length ?? 0)
  const seriesCount = series?.data?.result?.[0]?.value?.[1] ?? '—'
  return {
    details: [
      { k: 'Targets', v: `${active}/${total}` },
      { k: 'Series', v: typeof seriesCount === 'number' ? seriesCount.toLocaleString() : seriesCount },
      { k: 'Alerts', v: '0' },
    ],
  }
}

// ── Grafana (sparklines) ──────────────────────────────────────────────────────
export async function fetchGrafana() {
  const data = await get('/api/grafana/metrics')
  return data ?? null
}

// ── OpenSoak ──────────────────────────────────────────────────────────────────
export async function fetchOpenSoak() {
  const data = await get('/api/opensoak/status')
  if (!data) return null
  const rawTemp = data.current_temp ?? data.temperature ?? data.temp ?? data.currentTemp
  return {
    temp: (rawTemp != null && !isNaN(rawTemp)) ? Math.round(rawTemp) : null,
    setPoint: data.desired_state?.target_temp ?? data.setPoint ?? data.set_point ?? null,
    heating: data.actual_relay_state?.heater ?? data.desired_state?.heater ?? data.heating ?? false,
    locked: data.system_locked ?? false,
    safety: data.safety_status ?? null,
  }
}

// ── Calendar events from Sonarr + Radarr ─────────────────────────────────────
export async function fetchCalendarEvents() {
  const [sonarr, radarr] = await Promise.all([
    get('/api/sonarr/calendar'),
    get('/api/radarr/calendar'),
  ])
  // Build {dayOfMonth: [{color, label}]} for current month only
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const events = {}

  const addEvent = (dateStr, color, label) => {
    if (!dateStr) return
    const d = new Date(dateStr)
    if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) return
    const day = d.getDate()
    if (!events[day]) events[day] = []
    events[day].push({ color, label })
  }

  if (Array.isArray(sonarr)) {
    sonarr.forEach(ep => {
      const seriesTitle = ep.series?.title ?? ep.seriesTitle ?? 'TV'
      const epLabel = `${seriesTitle} S${String(ep.seasonNumber).padStart(2,'0')}E${String(ep.episodeNumber).padStart(2,'0')}`
      addEvent(ep.airDateUtc, '#35c5f4', epLabel)
    })
  }

  if (Array.isArray(radarr)) {
    radarr.forEach(movie => {
      const label = movie.title ?? 'Movie'
      // Use physical release date (home video) if available, otherwise theatrical
      addEvent(movie.physicalRelease ?? movie.digitalRelease ?? movie.inCinemas, '#ffc230', label)
    })
  }

  return Object.keys(events).length > 0 ? events : null
}

// ── Top-level poller ──────────────────────────────────────────────────────────
export async function fetchAllData() {
  const [plex, tautulli, overseerr, sonarr, radarr, prowlarr, sabnzbd, transmission, adguard, prometheus, grafana, opensoak, calendarEvents] =
    await Promise.allSettled([
      fetchPlex(),
      fetchTautulli(),
      fetchOverseerr(),
      fetchSonarr(),
      fetchRadarr(),
      fetchProwlarr(),
      fetchSABnzbd(),
      fetchTransmission(),
      fetchAdguard(),
      fetchPrometheus(),
      fetchGrafana(),
      fetchOpenSoak(),
      fetchCalendarEvents(),
    ])

  const ok = r => (r.status === 'fulfilled' ? r.value : null)

  return {
    plex: ok(plex),
    tautulli: ok(tautulli),
    overseerr: ok(overseerr),
    sonarr: ok(sonarr),
    radarr: ok(radarr),
    prowlarr: ok(prowlarr),
    sabnzbd: ok(sabnzbd),
    transmission: ok(transmission),
    adguard: ok(adguard),
    prometheus: ok(prometheus),
    grafana: ok(grafana),
    opensoak: ok(opensoak),
    calendarEvents: ok(calendarEvents),
  }
}
