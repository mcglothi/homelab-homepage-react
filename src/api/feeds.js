import { useCallback, useEffect, useRef, useState } from 'react'

// Feeds from Turing (watch :8790, aikb-health :8791), reached through the proxy's
// /api/watch and /api/aikb passthroughs. Each tab polls only while it is mounted.

export async function getJSON(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

export async function postJSON(url) {
  const r = await fetch(url, { method: 'POST' })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `${r.status}`)
  return body
}

// { data, error, loading, reload } — keeps the last good data when a poll fails,
// so a blip on Turing shows as a stale badge instead of blanking the tab.
export function useFeed(url, intervalMs = 30000) {
  const [state, setState] = useState({ data: null, error: null, loading: true, at: null })
  const alive = useRef(true)
  const load = useCallback(async () => {
    if (!url) return
    try {
      const data = await getJSON(url)
      if (alive.current) setState({ data, error: null, loading: false, at: Date.now() })
    } catch (e) {
      if (alive.current) setState(s => ({ ...s, error: e.message, loading: false }))
    }
  }, [url])
  useEffect(() => {
    alive.current = true
    load()
    const t = intervalMs ? setInterval(load, intervalMs) : null
    return () => { alive.current = false; if (t) clearInterval(t) }
  }, [load, intervalMs])
  return { ...state, reload: load }
}

export function ago(iso) {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 0) return 'now'
  if (s < 90) return `${Math.round(s)}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function hoursLabel(h) {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

export function duration(sec) {
  if (!sec) return ''
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
