import { useEffect, useState } from 'react'

// The graph's colors come from Docket's own theme tokens (the --bg, --text, --blue… set on :root by the
// Appearance panel), read as real colors because canvas and WebGL cannot use var(). A theme or
// light/dark switch changes those variables on :root; the observer picks that up and the
// engine eases to the new colors, so nothing needs a reload.
const TOKENS = ['bg', 'panel', 'text', 'muted', 'dim', 'faint', 'line', 'blue', 'cyan', 'green', 'amber', 'orange', 'red', 'violet', 'accent']
let ctx
function hex(css, fallback = '#888888') {
  try {
    ctx ??= document.createElement('canvas').getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillStyle = css
    const v = ctx.fillStyle
    if (v.startsWith('#')) return v
    const m = v.match(/rgba?\((\d+), (\d+), (\d+)/)
    return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : fallback
  } catch { return fallback }
}

export function readTheme() {
  const cs = getComputedStyle(document.documentElement)
  const t = {}
  for (const k of TOKENS) t[k] = hex(cs.getPropertyValue('--' + k).trim() || '#888888')
  t.light = document.documentElement.dataset.theme === 'light'
  t.id = (document.documentElement.dataset.themeId || 'home') + '|' + (t.light ? 'light' : 'dark')
  t.kind = {
    host: t.blue, pool: t.violet, dataset: t.violet, app: t.cyan, service: t.muted, proxy: t.orange, dns: t.green,
    network: t.amber, target: t.dim, query: t.accent,
  }
  t.comm = [t.blue, t.green, t.orange, t.violet, t.cyan, t.amber, t.accent, t.red]
  t.rel = { owner: t.violet, runs: t.cyan, net: t.orange, member: t.muted, mgr: t.accent, group: t.violet, monitor: t.dim, named: t.blue, inferred: t.violet, candidate: t.accent, support: t.violet, reported: t.orange, calls: t.blue, targets: t.cyan, ran: t.dim, describes: t.muted, about: t.orange, found: t.dim }
  t.flag = { conflict: t.red, missing: t.dim, inferred: t.violet }
  return t
}

export function useGraphTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    let t
    const update = () => { clearTimeout(t); t = setTimeout(() => setTheme(prev => { const n = readTheme(); return JSON.stringify(n) === JSON.stringify(prev) ? prev : n }), 60) }
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'data-theme-id', 'class'] })
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', update)
    update()
    return () => { clearTimeout(t); mo.disconnect(); mq.removeEventListener('change', update) }
  }, [])
  return theme
}
