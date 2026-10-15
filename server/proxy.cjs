#!/usr/bin/env node
// Production server: serves dist/ static files + proxies /api/* to local homelab services
// Run: node server/proxy.cjs
// Requires: npm install (in server/ dir) or: npm i express http-proxy-middleware dotenv

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const express = require('express')
const path = require('path')
const http = require('http')
const https = require('https')

const app = express()
const PORT = process.env.PORT || 3001

const PLEX_URL        = process.env.PLEX_URL        || 'http://10.10.10.10:32400'
const PLEX_TOKEN      = process.env.PLEX_TOKEN       || ''
const TAUTULLI_URL    = process.env.TAUTULLI_URL     || 'http://10.10.10.10:30047'
const TAUTULLI_KEY    = process.env.TAUTULLI_KEY     || ''
const OVERSEERR_URL   = process.env.OVERSEERR_URL    || 'http://10.10.10.10:30042'
const OVERSEERR_KEY   = process.env.OVERSEERR_KEY    || ''
const SONARR_URL      = process.env.SONARR_URL       || 'http://10.10.10.10:8989'
const SONARR_KEY      = process.env.SONARR_KEY       || ''
const RADARR_URL      = process.env.RADARR_URL       || 'http://10.10.10.10:7878'
const RADARR_KEY      = process.env.RADARR_KEY       || ''
const PROWLARR_URL    = process.env.PROWLARR_URL     || 'http://10.10.10.10:9696'
const PROWLARR_KEY    = process.env.PROWLARR_KEY     || ''
const SABNZBD_URL     = process.env.SABNZBD_URL      || 'http://10.10.10.10:30055'
const SABNZBD_KEY     = process.env.SABNZBD_KEY      || ''
const TRANSMISSION_URL = process.env.TRANSMISSION_URL || 'http://10.10.10.10:30096'
const ADGUARD_URL      = process.env.ADGUARD_URL      || 'http://10.10.10.10:3000'  // host networking since 2026-09-25
const ADGUARD_USER     = process.env.ADGUARD_USER     || 'admin'
const ADGUARD_PASSWORD = process.env.ADGUARD_PASSWORD || ''
const PROMETHEUS_URL  = process.env.PROMETHEUS_URL   || 'http://10.10.10.10:9090'
const SENSELESS_URL   = process.env.SENSELESS_URL    || 'http://10.10.10.10:8780'
const LOCAL_TZ        = process.env.DASHBOARD_TZ     || 'America/New_York'
const GRAFANA_URL     = process.env.GRAFANA_URL      || 'http://10.10.10.10:3000'
const OPENSOAK_URL    = process.env.OPENSOAK_URL      || 'https://opensoak.home.timmcg.net'
// Docket tab feeds on Turing
const WATCH_URL       = process.env.WATCH_URL        || 'http://10.10.10.50:8790'
const AIKB_HEALTH_URL = process.env.AIKB_HEALTH_URL  || 'http://10.10.10.50:8791'
// Weather for the top bar and sidebar tile (Open-Meteo, no key)
const WEATHER_LAT     = process.env.WEATHER_LAT      || '43.93'
const WEATHER_LON     = process.env.WEATHER_LON      || '-69.97'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchLocal(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const lib = parsedUrl.protocol === 'https:' ? https : http
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: extraHeaders,
      rejectUnauthorized: false, // allow self-signed certs on local services
    }
    const req = lib.request(options, (res) => {
      // Follow single redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchLocal(res.headers.location, extraHeaders).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

function fetchLocalPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const parsedUrl = new URL(url)
    const lib = parsedUrl.protocol === 'https:' ? https : http
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
      rejectUnauthorized: false,
    }
    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(bodyStr)
    req.end()
  })
}

// TTL cache with single-flight, so every open tab doesn't trigger its own round of probes
function cached(ttlMs, fn) {
  let value = null, at = 0, inflight = null
  return () => {
    if (value && Date.now() - at < ttlMs) return Promise.resolve(value)
    if (!inflight) {
      inflight = fn()
        .then(v => { value = v; at = Date.now(); return v })
        .finally(() => { inflight = null })
    }
    return inflight
  }
}

// Status code + TLS expiry for one URL; redirects are not followed (a 302 to a login page is "up")
function probe(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET', headers: { Accept: '*/*' }, rejectUnauthorized: false,
    }, res => {
      // Grab the cert before the socket is released back to the agent
      const certExpires = res.socket?.getPeerCertificate?.()?.valid_to ?? null
      res.resume()
      resolve({ status: res.statusCode, certExpires })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')) })
    req.end()
  })
}

function apiRoute(handler) {
  return async (req, res) => {
    try {
      const data = await handler(req)
      res.json(data ?? { error: 'no data' })
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  }
}

// ── AdGuard Home Basic Auth header ───────────────────────────────────────────
function adguardAuthHeader() {
  return 'Basic ' + Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASSWORD}`).toString('base64')
}

// ── API Routes ────────────────────────────────────────────────────────────────

// Plex
app.get('/api/plex/sessions', apiRoute(() =>
  fetchLocal(`${PLEX_URL}/status/sessions?X-Plex-Token=${PLEX_TOKEN}`)
))

// Tautulli
app.get('/api/tautulli/activity', apiRoute(() =>
  fetchLocal(`${TAUTULLI_URL}/api/v2?apikey=${TAUTULLI_KEY}&cmd=get_activity`)
))
app.get('/api/tautulli/stats', apiRoute(() =>
  fetchLocal(`${TAUTULLI_URL}/api/v2?apikey=${TAUTULLI_KEY}&cmd=get_home_stats&time_range=1&stats_count=1&stats_type=plays`)
))

// Overseerr (needs Authorization header)
app.get('/api/overseerr/requests', apiRoute(() =>
  fetchLocal(`${OVERSEERR_URL}/api/v1/request?filter=pending&take=100`, { Authorization: `Bearer ${OVERSEERR_KEY}` })
))

// Sonarr
app.get('/api/sonarr/missing', apiRoute(() =>
  fetchLocal(`${SONARR_URL}/api/v3/wanted/missing?apikey=${SONARR_KEY}&pageSize=1`)
))
app.get('/api/sonarr/queue', apiRoute(() =>
  fetchLocal(`${SONARR_URL}/api/v3/queue?apikey=${SONARR_KEY}&pageSize=1`)
))
app.get('/api/sonarr/calendar', apiRoute(() => {
  const now = new Date()
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 2, 0))
  return fetchLocal(`${SONARR_URL}/api/v3/calendar?apikey=${SONARR_KEY}&start=${start.toISOString().split('T')[0]}&end=${end.toISOString().split('T')[0]}&includeSeries=true`)
}))

// Radarr
app.get('/api/radarr/queue', apiRoute(() =>
  fetchLocal(`${RADARR_URL}/api/v3/queue?apikey=${RADARR_KEY}&pageSize=1`)
))
app.get('/api/radarr/movies', apiRoute(() =>
  fetchLocal(`${RADARR_URL}/api/v3/movie?apikey=${RADARR_KEY}`)
))
app.get('/api/radarr/calendar', apiRoute(() => {
  const now = new Date()
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 2, 0))
  return fetchLocal(`${RADARR_URL}/api/v3/calendar?apikey=${RADARR_KEY}&start=${start.toISOString().split('T')[0]}&end=${end.toISOString().split('T')[0]}`)
}))

// Prowlarr
app.get('/api/prowlarr/indexers', apiRoute(() =>
  fetchLocal(`${PROWLARR_URL}/api/v1/indexer?apikey=${PROWLARR_KEY}`)
))
app.get('/api/prowlarr/stats', apiRoute(() =>
  fetchLocal(`${PROWLARR_URL}/api/v1/indexerstats?apikey=${PROWLARR_KEY}`)
))

// SABnzbd
app.get('/api/sabnzbd/queue', apiRoute(() =>
  fetchLocal(`${SABNZBD_URL}/api?apikey=${SABNZBD_KEY}&output=json&mode=queue`)
))

// Transmission — needs session ID negotiation
let transmissionSessionId = null
app.get('/api/transmission/torrents', apiRoute(async () => {
  const body = { method: 'torrent-get', arguments: { fields: ['status', 'rateDownload'] } }
  const headers = transmissionSessionId ? { 'X-Transmission-Session-Id': transmissionSessionId } : {}
  try {
    return await fetchLocalPost(`${TRANSMISSION_URL}/transmission/rpc`, body, headers)
  } catch {
    return null
  }
}))

// AdGuard Home
app.get('/api/adguard/stats', apiRoute(() =>
  fetchLocal(`${ADGUARD_URL}/control/stats`, { Authorization: adguardAuthHeader() })
))

// Prometheus
app.get('/api/prometheus/targets', apiRoute(() =>
  fetchLocal(`${PROMETHEUS_URL}/api/v1/targets`)
))
app.get('/api/prometheus/series', apiRoute(() =>
  fetchLocal(`${PROMETHEUS_URL}/api/v1/query?query=count(up)`)
))

// Grafana — CPU/RAM sparkline data from Prometheus
app.get('/api/grafana/metrics', apiRoute(async () => {
  try {
    const [cpuRes, ramRes] = await Promise.all([
      fetchLocal(`${PROMETHEUS_URL}/api/v1/query_range?query=100-avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))*100&start=${Math.floor(Date.now()/1000)-900}&end=${Math.floor(Date.now()/1000)}&step=60`),
      fetchLocal(`${PROMETHEUS_URL}/api/v1/query_range?query=100*(1-node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes)&start=${Math.floor(Date.now()/1000)-900}&end=${Math.floor(Date.now()/1000)}&step=60`),
    ])
    const toHistory = (res) => {
      const values = res?.data?.result?.[0]?.values ?? []
      return values.map(([, v]) => parseFloat(v)).filter(n => !isNaN(n))
    }
    const cpuHistory = toHistory(cpuRes)
    const ramHistory = toHistory(ramRes)
    return {
      cpu: { history: cpuHistory.length > 0 ? cpuHistory : null, current: cpuHistory[cpuHistory.length - 1] ?? null },
      ram: { history: ramHistory.length > 0 ? ramHistory : null, current: ramHistory[ramHistory.length - 1] ?? null },
      net: null,
    }
  } catch {
    return null
  }
}))

// Power — live draw from Senseless, today's history/stats from Prometheus.
// History falls back to the legacy sense-exporter series until Senseless has a full day.
const POWER_EXPR = '(max(senseless_power_watts) or max(sense_active_power_watts))'

function secondsSinceLocalMidnight(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date()).map(p => [p.type, p.value]))
  return (parseInt(parts.hour, 10) % 24) * 3600 + parseInt(parts.minute, 10) * 60 + parseInt(parts.second, 10)
}

app.get('/api/power', apiRoute(async () => {
  const now = Math.floor(Date.now() / 1000)
  const sinceMidnight = Math.max(60, secondsSinceLocalMidnight(LOCAL_TZ))
  const q = (expr) => fetchLocal(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(expr)}`)
  const scalar = (res) => {
    const v = parseFloat(res?.data?.result?.[0]?.value?.[1])
    return isNaN(v) ? null : v
  }
  const [status, peakRes, avgRes, histRes] = await Promise.all([
    fetchLocal(`${SENSELESS_URL}/api/status`).catch(() => null),
    q(`max_over_time(${POWER_EXPR}[${sinceMidnight}s:1m])`).catch(() => null),
    q(`avg_over_time(${POWER_EXPR}[${sinceMidnight}s:1m])`).catch(() => null),
    fetchLocal(`${PROMETHEUS_URL}/api/v1/query_range?query=${encodeURIComponent(`avg_over_time(${POWER_EXPR}[1h:1m])`)}&start=${now - sinceMidnight + 3600}&end=${now}&step=3600`).catch(() => null),
  ])
  const history = (histRes?.data?.result?.[0]?.values ?? []).map(([, v]) => Math.round(parseFloat(v))).filter(n => !isNaN(n))
  const latest = status?.latest ?? {}
  const avg = scalar(avgRes)
  return {
    live: status?.healthy ?? false,
    current: latest.w != null ? Math.round(latest.w) : null,
    legs: Array.isArray(latest.channels) ? latest.channels.map(w => Math.round(w)) : null,
    peak: scalar(peakRes) != null ? Math.round(scalar(peakRes)) : null,
    avg: avg != null ? Math.round(avg) : null,
    kwh: avg != null ? Math.round(avg * sinceMidnight / 3600 / 100) / 10 : null,
    history: history.length ? history : null,
  }
}))

// OpenSoak — follows redirects (HTTP→HTTPS via NPM)
app.get('/api/opensoak/status', apiRoute(() =>
  fetchLocal(`${OPENSOAK_URL}/api/status`)
))

// Media sweep automation — flag file + logs on the bind-mounted _scripts dir
const fs = require('fs')
const MEDIA_SCRIPTS_DIR = process.env.MEDIA_SCRIPTS_DIR || '/data/media-scripts'
const SWEEP_FLAG = path.join(MEDIA_SCRIPTS_DIR, 'AUTOMATION_OFF')

app.get('/api/media-sweep', apiRoute(async () => {
  const enabled = !fs.existsSync(SWEEP_FLAG)
  let lastRun = null
  let lastLines = []
  try {
    lastRun = fs.readFileSync(path.join(MEDIA_SCRIPTS_DIR, 'last_sweep'), 'utf8').trim()
  } catch { /* no sweep yet */ }
  try {
    const log = fs.readFileSync(path.join(MEDIA_SCRIPTS_DIR, 'nightly_sweep.log'), 'utf8')
    lastLines = log.trim().split('\n').slice(-8)
  } catch { /* no log yet */ }
  return { enabled, lastRun, lastLines, available: fs.existsSync(MEDIA_SCRIPTS_DIR) }
}))

app.post('/api/media-sweep/toggle', apiRoute(async () => {
  if (fs.existsSync(SWEEP_FLAG)) {
    fs.unlinkSync(SWEEP_FLAG)
  } else {
    fs.writeFileSync(SWEEP_FLAG, `disabled via dashboard ${new Date().toISOString()}\n`)
  }
  return { enabled: !fs.existsSync(SWEEP_FLAG) }
}))

// ── Health: reachability for every service card ──────────────────────────────
// The catalog is src/services.js (ESM, shared with the front end; the Dockerfile copies it in).
// Any HTTP response below 500, including a 401/403 login wall, counts as up.
const catalog = import(require('url').pathToFileURL(path.join(__dirname, '../src/services.js')).href)
  .then(m => Object.values(m.SERVICES).flat())
catalog.catch(e => console.error(`health: cannot load service catalog: ${e.message}`)) // don't crash on start

const getHealth = cached(60_000, async () => {
  const services = await catalog
  const results = await Promise.all(services.map(async s => {
    const start = Date.now()
    try {
      const res = await probe(s.href)
      const certDays = res.certExpires ? Math.floor((new Date(res.certExpires) - Date.now()) / 864e5) : null
      return [s.name, { online: res.status < 500, status: res.status, ms: Date.now() - start, certDays }]
    } catch (e) {
      // Connection failures over several addresses arrive as an AggregateError with an empty message
      return [s.name, { online: false, error: e.message || e.code || e.errors?.[0]?.code || 'unreachable' }]
    }
  }))
  return { checkedAt: new Date().toISOString(), services: Object.fromEntries(results) }
})
app.get('/api/health', apiRoute(() => getHealth()))

const getWeather = cached(10 * 60_000, async () => {
  const d = await fetchLocal(`https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
    '&current=temperature_2m&temperature_unit=fahrenheit')
  const t = d?.current?.temperature_2m
  if (t == null) throw new Error('open-meteo: no temperature')
  return { temp: Math.round(t), at: d.current.time }
})
app.get('/api/weather', apiRoute(() => getWeather()))

// ── Docket tabs: Turing feeds, passed straight through ───────────────────────
// /api/watch/* → watch (:8790), /api/aikb/* → aikb_health (:8791). Bodies and status
// codes are relayed as-is so the views can show upstream errors.
function passthrough(base, timeoutMs) {
  return (req, res) => {
    const upstream = http.request(new URL(req.originalUrl, base), { method: req.method, headers: { accept: 'application/json' } }, up => {
      res.status(up.statusCode)
      res.set('content-type', up.headers['content-type'] || 'application/json')
      up.pipe(res)
    })
    upstream.on('error', e => { if (!res.headersSent) res.status(502).json({ error: e.message }) })
    upstream.setTimeout(timeoutMs, () => upstream.destroy(new Error('upstream timeout')))
    upstream.end()
  }
}
app.get('/api/watch/*', passthrough(WATCH_URL, 20000))
app.post('/api/watch/*', passthrough(WATCH_URL, 20000))
app.get('/api/aikb/*', passthrough(AIKB_HEALTH_URL, 30000))

// ── Static files (production) ─────────────────────────────────────────────────
const distPath = path.join(__dirname, '../dist')
app.use(express.static(distPath))
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`home.timmcg.net proxy running on http://localhost:${PORT}`)
})
