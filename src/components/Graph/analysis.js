// Graph analysis for the search graph view: node cap, local graph, link counts, influence
// (betweenness), communities (modularity) and data gaps. Pure functions over the plain
// {nodes, edges} the /api/graph endpoint returns; nothing here knows about the canvas.

// Kinds of node, in the order the Groups list shows them. Colors come from the theme (theme.js).
export const KIND = {
  host: 'Hosts / VMs', pool: 'ZFS pools', dataset: 'Datasets', app: 'Apps', service: 'Dashboard cards',
  proxy: 'Proxy names (NPM)', dns: 'DNS names', network: 'Addresses', target: 'Monitoring targets', query: 'The search',
}

// ── Intent ───────────────────────────────────────────────────────────────────
// What the search is after decides which kinds of node lead. Kinds fall into facets (the chips the user
// can see and change); each seed type has a priority order of facets, and a click on a node moves
// that node's facet to the front. A facet's place in the order is its weight.
export const FACETS = { servers: 'Hosts', storage: 'Storage', apps: 'Apps', network: 'Network', monitoring: 'Monitoring', found: 'Other sources' }
const FACET_OF = { host: 'servers', pool: 'storage', dataset: 'storage', app: 'apps', service: 'apps', proxy: 'network', dns: 'network',
  network: 'network', target: 'monitoring', query: 'found' }
export const facetOf = kind => FACET_OF[kind] || 'found'
const ORDER = {
  host: ['servers', 'apps', 'storage', 'network', 'monitoring', 'found'],
  app: ['apps', 'servers', 'storage', 'network', 'monitoring', 'found'],
  storage: ['storage', 'apps', 'servers', 'network', 'monitoring', 'found'],
  network: ['network', 'apps', 'servers', 'storage', 'monitoring', 'found'],
}
export const WEIGHTS = [1, 0.85, 0.65, 0.5, 0.4, 0.3, 0.22, 0.16]
export const initialOrder = seedId => {
  const p = (seedId || '').split(':')[0]
  const kind = { h: 'host', a: 'app', svc: 'app', pl: 'storage', ds: 'storage', px: 'network', d: 'network', ip: 'network', t: 'host' }[p] || 'host'
  return ORDER[kind].slice()
}
// weight of a kind: its facet's place in the order; muted facets collapse
export const weightOf = (order, muted) => kind => {
  const f = facetOf(kind)
  if (muted.has(f)) return 0.12
  const i = order.indexOf(f)
  return WEIGHTS[i < 0 ? WEIGHTS.length - 1 : i]
}

// ── Recency ──────────────────────────────────────────────────────────────────
// The backend (homeapi/recency.py) gives a node `last` (ISO), `via` (why) and `sig` (the dated signals behind it: {last, via, src, s}).
// Score = strength x 0.5 ** (age_days / half_life), the same formula as the backend, so the half-life control rescores without a refetch.
// A node with no signal is "undated": it ranks after every dated node and the activity window never hides it.
export const DEFAULT_HALF_LIFE = 30
export const WINDOWS = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'All']]
export const DEFAULT_WINDOW = 90
const DAY = 86400000

export const decay = (ageDays, halfLife = DEFAULT_HALF_LIFE) => 0.5 ** (Math.max(0, ageDays) / (halfLife || DEFAULT_HALF_LIFE))
export const ageDays = (iso, now = Date.now()) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null }
export const isDated = n => !!(n && n.last && Number.isFinite(Date.parse(n.last)))

// 0..1, or null when the node is undated
export function recScore(n, now = Date.now(), halfLife = DEFAULT_HALF_LIFE) {
  if (!isDated(n)) return null
  const sigs = n.sig && n.sig.length ? n.sig : [{ last: n.last, s: 1 }]
  let best = 0
  for (const s of sigs) { const a = ageDays(s.last, now); if (a != null) best = Math.max(best, (s.s ?? 1) * decay(a, halfLife)) }
  return best
}

// "5 days", "3 months", "1 year" for an age in days
export function agoText(days) {
  if (days == null) return ''
  if (days < 1) return 'today'
  if (days < 60) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  if (days < 730) return `${Math.round(days / 30.4)} months`
  return `${Math.round(days / 365)} years`
}

// Ranking inside a group (best first): flagged (conflict or missing) first, then newest by recency score, undated after every dated
// node, then the most links. Boosted nodes (the user picked them) are not in a group at all, they are never folded.
export function rankGroup(arr, flagged, now = Date.now(), halfLife = DEFAULT_HALF_LIFE) {
  const sc = new Map(arr.map(n => [n.id, recScore(n, now, halfLife)]))
  return arr.slice().sort((a, b) => {
    const fa = flagged.has(a.id) ? 1 : 0, fb = flagged.has(b.id) ? 1 : 0
    if (fa !== fb) return fb - fa
    const sa = sc.get(a.id), sb = sc.get(b.id)
    if ((sa == null) !== (sb == null)) return sa == null ? 1 : -1
    if (sa != null && sb != null && sa !== sb) return sb - sa
    return (b.count || 0) - (a.count || 0)
  })
}

// What a "+N more" bubble says about the nodes it holds: "12 older · 3 to 14 months ago · 4 undated"
export function foldSummary(gone, now = Date.now(), byWindow = 0, windowDays = 0) {
  const ages = gone.map(n => (isDated(n) ? ageDays(n.last, now) : null)).filter(a => a != null).sort((a, b) => a - b)
  const undated = gone.length - ages.length
  const parts = []
  if (ages.length) {
    const lo = agoText(ages[0]), hi = agoText(ages[ages.length - 1])
    parts.push(`${ages.length} dated (${lo === hi ? `${lo} ago` : `${lo.replace(/ (days?|months?|years?)$/, m => (hi.endsWith(m.trim()) ? '' : m))} to ${hi} ago`})`)
  }
  if (undated) parts.push(`${undated} undated`)
  if (byWindow) parts.push(`${byWindow} older than ${windowLabel(windowDays)}`)
  const capped = gone.length - byWindow
  if (capped > 0 && byWindow) parts.push(`${capped} over the group limit`)
  return parts.join(' · ')
}

export const windowLabel = d => (WINDOWS.find(([v]) => v === d)?.[1] ?? (d ? `${d} days` : 'All')).toLowerCase()

// Cap each kind of node (the first part of a node id) so a 300-host search does not draw 200 subnets, and a person's servers are the
// ones most recently tied to them. How many stay depends on the group's weight. A "+N more" the user has clicked (revealed) shows
// everything. opts: {windowDays (0 = all), halfLife, now}. Dated nodes older than the window fold even when the group is small, but a
// group never loses all of its dated nodes (the newest two stay), and undated nodes are never hidden by the window.
export function capGroups(raw, cap, wOf = () => 1, revealed = new Set(), boost = new Set(), opts = {}) {
  const { windowDays = 0, halfLife = DEFAULT_HALF_LIFE, now = Date.now() } = opts
  const nodes = raw.nodes
  const flagged = new Set()
  raw.edges.forEach(e => { if (e.flag === 'conflict' || e.flag === 'missing') { flagged.add(e.a); flagged.add(e.b) } })
  const groups = {}
  nodes.forEach(n => { if (!n.result && !boost.has(n.id)) (groups[n.id.split(':')[0]] ??= []).push(n) })
  const hide = {}
  const extra = []
  const stats = { window: 0, cap: 0, undated: 0, bubbles: 0, windowDays }
  for (const [k, arr] of Object.entries(groups)) {
    const open = revealed.has('more:' + k)
    const limit = open ? Infinity : Math.max(2, Math.round(cap * wOf(arr[0].kind)))
    const ranked = rankGroup(arr, flagged, now, halfLife)
    let shown = ranked
    if (!open && windowDays > 0) {
      const outside = n => isDated(n) && !flagged.has(n.id) && ageDays(n.last, now) > windowDays
      shown = ranked.filter(n => !outside(n))
      if (!shown.some(isDated) && ranked.some(isDated)) { const keep = new Set(ranked.filter(isDated).slice(0, 2).map(n => n.id)); shown = ranked.filter(n => keep.has(n.id) || shown.includes(n)) }
    }
    if (shown.length > limit) shown = shown.slice(0, Math.max(1, limit - 1))
    const keepIds = new Set(shown.map(n => n.id))
    const gone = ranked.filter(n => !keepIds.has(n.id))
    if (!gone.length) continue
    const outsideWin = n => windowDays > 0 && !open && isDated(n) && !flagged.has(n.id) && ageDays(n.last, now) > windowDays
    const byWindow = gone.filter(outsideWin).length
    stats.window += byWindow
    stats.cap += gone.length - byWindow
    stats.undated += gone.filter(n => !isDated(n)).length
    stats.bubbles += 1
    const when = foldSummary(gone, now, byWindow, windowDays)
    const newest = gone.filter(isDated).sort((a, b) => Date.parse(b.last) - Date.parse(a.last))[0]
    extra.push({ id: 'more:' + k, kind: arr[0].kind, label: `+${gone.length} more`,
      sub: (when ? when + ' · ' : '') + gone.slice(0, 3).map(n => n.label).join(', ') + (gone.length > 3 ? '…' : '') + ' · click to show',
      fold: { total: gone.length, window: byWindow, cap: gone.length - byWindow, undated: gone.filter(n => !isDated(n)).length, windowDays },
      attrs: [['Folded here', `${gone.length} nodes`], ...(windowDays > 0 ? [[`Older than ${windowLabel(windowDays)}`, String(byWindow)]] : []), ['Over the group limit', String(gone.length - byWindow)],
        ['Undated (never hidden by the window)', String(gone.filter(n => !isDated(n)).length)]].concat(gone.slice(0, 40).map(n => [n.label, isDated(n) ? `${n.sub || ''} · last ${n.last.slice(0, 10)} (${agoText(ageDays(n.last, now))} ago)`.replace(/^ · /, '') : `${n.sub || ''} · undated`.replace(/^ · /, '')])),
      more: true, count: gone.length, ...(newest ? { last: newest.last, via: `${gone.length} folded nodes; newest: ${newest.label} (${newest.via || ''})` } : {}) })
    gone.forEach(n => { hide[n.id] = 'more:' + k })
  }
  const seen = new Set()
  const edges = []
  raw.edges.forEach(e => {
    const a = hide[e.a] || e.a
    const b = hide[e.b] || e.b
    if (a === b) return
    const key = `${a}|${b}|${e.kind}|${e.flag || ''}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ ...e, a, b })
  })
  const out = nodes.filter(n => !hide[n.id]).concat(extra).map(n => ({ ...n, wt: n.result ? Math.max(0.8, wOf(n.kind)) : wOf(n.kind), rk: recScore(n, now, halfLife) }))
  return { nodes: out, edges, stats }
}

export function localSubset(nodes, edges, sel, depth) {
  const keep = new Set([sel])
  let frontier = [sel]
  const adj = adjacency(edges)
  for (let d = 0; d < depth; d++) {
    const next = []
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!keep.has(o)) { keep.add(o); next.push(o) }
    frontier = next
  }
  return { nodes: nodes.filter(n => keep.has(n.id)), edges: edges.filter(e => keep.has(e.a) && keep.has(e.b)) }
}

export function adjacency(edges) {
  const adj = new Map()
  edges.forEach(e => {
    if (!adj.has(e.a)) adj.set(e.a, [])
    if (!adj.has(e.b)) adj.set(e.b, [])
    adj.get(e.a).push(e.b)
    adj.get(e.b).push(e.a)
  })
  return adj
}

// Brandes betweenness, scaled 0..1. Queue by index, not shift(): 600 nodes is fast.
function betweenness(n, adj) {
  const C = new Float64Array(n)
  const sg = new Float64Array(n)
  const dl = new Float64Array(n)
  const d = new Int32Array(n)
  const Q = new Int32Array(n)
  for (let s = 0; s < n; s++) {
    sg.fill(0); dl.fill(0); d.fill(-1)
    const P = Array.from({ length: n }, () => [])
    let head = 0, tail = 0
    sg[s] = 1; d[s] = 0; Q[tail++] = s
    while (head < tail) {
      const v = Q[head++]
      for (const w of adj[v]) {
        if (d[w] < 0) { d[w] = d[v] + 1; Q[tail++] = w }
        if (d[w] === d[v] + 1) { sg[w] += sg[v]; P[w].push(v) }
      }
    }
    for (let i = tail - 1; i >= 0; i--) {
      const w = Q[i]
      for (const v of P[w]) dl[v] += (sg[v] / sg[w]) * (1 + dl[w])
      if (w !== s) C[w] += dl[w]
    }
  }
  let mx = 1e-9
  for (let i = 0; i < n; i++) mx = Math.max(mx, C[i])
  return Array.from(C, c => c / mx)
}

// One pass of local moving (Louvain phase 1): good enough to find the clusters.
function communities(n, adj, m) {
  const k = adj.map(a => a.length)
  const comm = Array.from({ length: n }, (_, i) => i)
  const tot = k.slice()
  let moved = true
  let it = 0
  while (moved && it++ < 30) {
    moved = false
    for (let i = 0; i < n; i++) {
      const ci = comm[i]
      const w = {}
      adj[i].forEach(j => { w[comm[j]] = (w[comm[j]] || 0) + 1 })
      tot[ci] -= k[i]
      let best = ci
      let bg = (w[ci] || 0) - (tot[ci] * k[i]) / (2 * m)
      for (const c of Object.keys(w)) {
        const g = w[c] - (tot[c] * k[i]) / (2 * m)
        if (g > bg + 1e-9) { bg = g; best = +c }
      }
      tot[best] += k[i]
      if (best !== ci) { comm[i] = best; moved = true }
    }
  }
  const size = {}
  comm.forEach(c => { size[c] = (size[c] || 0) + 1 })
  const map = {}
  Object.keys(size).sort((a, b) => size[b] - size[a]).forEach((c, i) => { map[c] = i })
  return comm.map(c => map[c])
}

// Hosts a result list should look at twice: no CMDB record, duplicated in the CMDB, no
// owner, or on either end of a conflicting / missing link.
export function gapNodes(nodes, edges) {
  const set = new Set()
  const owned = new Set()
  edges.forEach(e => {
    if (e.flag === 'conflict' || e.flag === 'missing') { set.add(e.a); set.add(e.b) }
    if (e.kind === 'owner') owned.add(e.b)
  })
  nodes.forEach(n => {
    if (!n.result || n.kind !== 'host') return
    const at = Object.fromEntries(n.attrs || [])
    if (at['In CMDB'] !== 'yes' || at['CMDB duplicates'] || !owned.has(n.id)) set.add(n.id)
  })
  return set
}

// size: 'links' | 'infl'. Returns plain node objects (new each call) and link objects.
// Layer of each node: the longest chain of parents above it (edges run parent -> child; lateral
// "inferred" pairs do not count). Used for the gentle vertical bias.
function depths(nodes, edges) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]))
  const kids = nodes.map(() => [])
  const indeg = new Array(nodes.length).fill(0)
  edges.forEach(e => {
    if (e.flag === 'inferred') return
    const a = idx.get(e.a), b = idx.get(e.b)
    if (a !== undefined && b !== undefined && a !== b) { kids[a].push(b); indeg[b]++ }
  })
  const d = new Array(nodes.length).fill(0)
  const q = []
  indeg.forEach((v, i) => { if (!v) q.push(i) })
  for (let h = 0; h < q.length; h++) {
    const i = q[h]
    for (const j of kids[i]) { d[j] = Math.max(d[j], d[i] + 1); if (--indeg[j] === 0) q.push(j) }
  }
  return d   // nodes inside a cycle keep depth 0
}

export function metrics(nodes, edges, size) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]))
  const adj = nodes.map(() => [])
  edges.forEach(e => {
    const a = idx.get(e.a), b = idx.get(e.b)
    if (a !== undefined && b !== undefined && a !== b) { adj[a].push(b); adj[b].push(a) }
  })
  const bc = betweenness(nodes.length, adj)
  const cm = communities(nodes.length, adj, edges.length || 1)
  const scale = Math.max(0.42, Math.min(1, 1.5 - Math.log10(Math.max(nodes.length, 10)) * 0.5))
  const dp = depths(nodes, edges)
  const mean = dp.reduce((a, b) => a + b, 0) / (dp.length || 1)
  const out = nodes.map((n, i) => {
    const deg = adj[i].length
    const val = size === 'infl' ? 2 + bc[i] * 20 + (n.result ? 3 : 0)
      : 2 + Math.sqrt(deg) * 2.2 + (n.result ? 5 : 0) + (n.count ? Math.min(4, Math.log10(n.count + 1)) : 0)
    return { ...n, deg, bc: bc[i], comm: cm[i], depth: dp[i] - mean, val, radius: Math.sqrt(val) * 2.6 * scale }
  })
  const order = out.map((n, i) => i).sort((a, b) => out[b].val - out[a].val)
  order.forEach((i, r) => { out[i].rank = out.length > 1 ? r / out.length : 0 })
  return out
}
