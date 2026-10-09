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
const ADGUARD_URL      = process.env.ADGUARD_URL      || 'http://10.10.10.10:30053'
const ADGUARD_USER     = process.env.ADGUARD_USER     || 'admin'
const ADGUARD_PASSWORD = process.env.ADGUARD_PASSWORD || ''
const PROMETHEUS_URL  = process.env.PROMETHEUS_URL   || 'http://10.10.10.10:30028'
const GRAFANA_URL     = process.env.GRAFANA_URL      || 'http://10.10.10.10:3000'
const OPENSOAK_URL    = process.env.OPENSOAK_URL      || 'https://opensoak.home.timmcg.net'
// Docket tab feeds on Turing
const WATCH_URL       = process.env.WATCH_URL        || 'http://10.10.10.50:8790'
const AIKB_HEALTH_URL = process.env.AIKB_HEALTH_URL  || 'http://10.10.10.50:8791'

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
  const start = new Date(); start.setDate(1)
  const end = new Date(start.getFullYear(), start.getMonth() + 2, 0)
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
  const start = new Date(); start.setDate(1)
  const end = new Date(start.getFullYear(), start.getMonth() + 2, 0)
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
