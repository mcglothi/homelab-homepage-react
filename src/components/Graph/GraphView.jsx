import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C, MONO, alpha } from '../../ui/theme'
import { Button, Pill } from '../../ui/primitives'
import { KIND, FACETS, facetOf, initialOrder, weightOf, capGroups, localSubset, metrics, gapNodes, diversity, WINDOWS, DEFAULT_WINDOW, DEFAULT_HALF_LIFE, windowLabel } from './analysis'
import { createEngine } from './engine'
import { useGraphTheme } from './theme'
import Explain from './Explain'
import CompareTray from './Compare'
import { PANELS, Rail, Flyout, HelpOverlay, useUi, useGraphKeys, layoutPanels, RAIL_GAP } from './Panels'
import { useHoverIntent } from '../../ui/useHoverIntent'
import { EASE, motion, panelMotion } from '../../ui/motion'
import { indexGraph, compare, pathsTo } from './facts'
import { buildExplain } from './explainPayload'
import DetailsCard from './DetailsCard'

// Relationship graph for a search. The query resolves to seed nodes of any kind (host, person, team,
// cluster, subnet, software…), drawn with their parents (datacenter > cluster > host > VM, manager >
// person, …). Clicking a node pulls its neighbors in from the backend; the trail of clicks is a
// breadcrumb with back and forward, and "Search for this" runs a new search for a node.
// Colors come from Docket's theme tokens and follow theme changes live.

const glass = { background: alpha(C.panel, 0.9), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(C.accent, '30')}`, borderRadius: 10, color: C.body }
const Seg = ({ value, opts, onChange, title }) => (
  <span title={title} style={{ display: 'inline-flex', gap: 3 }}>
    {opts.map(([v, l, t]) => <Button key={v} size="sm" variant={value === v ? 'primary' : 'default'} title={t} onClick={() => onChange(v)}>{l}</Button>)}
  </span>
)
const Slider = ({ label, value, min, max, step = 1, fmt = v => v, onChange }) => (
  <label style={{ display: 'block', margin: '7px 0', fontSize: 11, color: C.muted, fontFamily: MONO }}>
    <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><span style={{ color: C.text }}>{fmt(value)}</span></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
  </label>
)
const H3 = ({ children }) => <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.dim, margin: '14px 0 6px' }}>{children}</div>
const trunc = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// What kind of thing the search is about: a Control-M job search starts from the job, not from the CMDB hits it also finds
// View settings that are remembered like the other graph controls (looks only; never what data is shown)
// The lens part of a graph URL; YouTube notes join the concept lens only when asked for
const lensQuery = e => (e.lens === 'concepts' ? '&lens=concepts' + (e.videos ? '&videos=1' : '') : '')
const VIEW_KEYS = ['arrows', 'labels', 'backdrop', 'flow', 'panelMotion', 'color', 'size', 'curves', 'links', 'window', 'halfLife', 'lens', 'videos']
const loadView = () => { try { const j = JSON.parse(localStorage.getItem('docket.graph.view.v1')); return j && typeof j === 'object' ? Object.fromEntries(VIEW_KEYS.filter(k => j[k] !== undefined).map(k => [k, j[k]])) : {} } catch (e) { return {} } }
// Backdrop tuning, remembered per Docket theme (and light/dark): star opacity, saturation, density, and the grid/rings intensity
const BD_KEY = 'docket.graph.backdrop.v1'
const bdDefaults = light => (light ? { starOp: 5, starSat: 15, starDen: 20, intensity: 25 } : { starOp: 12, starSat: 25, starDen: 30, intensity: 40 })
const loadBd = () => { try { const j = JSON.parse(localStorage.getItem(BD_KEY)); return j && typeof j === 'object' ? j : {} } catch (e) { return {} } }
const seedOf = d => (d?.coverage?.kind === 'ctm' ? 'j:x' : d?.seeds?.[0])

// Union of a root's data and the expansions after it
function merge(root, exps) {
  const nodes = new Map()
  const edges = new Map()
  const add = (d, exp) => {
    d.nodes.forEach(n => { if (!nodes.has(n.id)) nodes.set(n.id, exp ? { ...n, exp: true } : n) })
    d.edges.forEach(e => { const k = `${e.a}|${e.b}|${e.kind}`; if (!edges.has(k)) edges.set(k, e) })
  }
  add(root, false)
  exps.forEach(x => add(x, true))
  return { ...root, nodes: [...nodes.values()], edges: [...edges.values()] }
}

export default function GraphView({ q, full, setFull, pickIds, onSearch }) {
  const theme = useGraphTheme()
  const [pageScale, setPageScale] = useState(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1)
  useEffect(() => {
    const on = () => setPageScale(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1)
    window.addEventListener('docket:scale', on)
    return () => window.removeEventListener('docket:scale', on)
  }, [])
  const [S, setS] = useState(() => ({ mode: '2d', lens: 'fleet', videos: false, cap: 14, kinds: {}, depth: 1, size: 'links', color: 'kind', gaps: false, topics: false, labels: 'smart', arrows: 'smart', backdrop: 'subtle', links: 'ends', curves: true, minLinks: 0, hideHubs: false, find: '', window: DEFAULT_WINDOW, halfLife: DEFAULT_HALF_LIFE,
    f: { center: 30, repel: 520, link: 55, dist: 95, layer: 35 }, panelMotion: 'calm', flow: { on: true, speed: 40, opacity: 55, sat: 60, density: 40 }, ...loadView() }))
  const set = useCallback(p => setS(s => ({ ...s, ...p })), [])
  useEffect(() => { try { localStorage.setItem('docket.graph.view.v1', JSON.stringify(Object.fromEntries(VIEW_KEYS.map(k => [k, S[k]])))) } catch (e) { /* storage blocked */ } }, [S.arrows, S.labels, S.backdrop, S.flow, S.panelMotion, S.color, S.size, S.curves, S.links, S.window, S.halfLife, S.lens, S.videos]) // eslint-disable-line react-hooks/exhaustive-deps
  const pm = panelMotion(S.panelMotion)
  const [bdAll, setBdAll] = useState(loadBd)
  const bdVals = { ...bdDefaults(theme.light), ...(bdAll[theme.id] || {}) }
  const bdv = useMemo(() => ({ starOp: bdVals.starOp / 100, starSat: bdVals.starSat / 100, starDen: bdVals.starDen / 100, intensity: bdVals.intensity / 100 }), [bdVals.starOp, bdVals.starSat, bdVals.starDen, bdVals.intensity]) // eslint-disable-line react-hooks/exhaustive-deps
  const setBd = useCallback(p => setBdAll(a => { const n = { ...a, [theme.id]: { ...bdDefaults(theme.light), ...(a[theme.id] || {}), ...p } }; try { localStorage.setItem(BD_KEY, JSON.stringify(n)) } catch (e) { /* storage blocked */ } return n }), [theme.id, theme.light])
  const resetBd = useCallback(() => setBdAll(a => { const n = { ...a }; delete n[theme.id]; try { localStorage.setItem(BD_KEY, JSON.stringify(n)) } catch (e) { /* storage blocked */ } return n }), [theme.id])
  const [sel, setSel] = useState(null)
  const { ui, pin, setBar } = useUi()
  const [focusMode, setFocusMode] = useState(false)   // hide all chrome but a tiny HUD
  const [peek, setPeek] = useState(false)               // pointer at an edge in focus mode: chrome is back
  const [help, setHelp] = useState(false)
  const [barH, setBarH] = useState(84)
  const [boxW, setBoxW] = useState(900)
  const rootRef = useRef(null)
  const [pins, setPins] = useState([])
  const [multi, setMulti] = useState([])          // nodes picked for "What do these share?"
  const [compareMode, setCompareMode] = useState(false)
  const [shared, setShared] = useState(null)      // a shared item the user clicked: light up the paths to it
  const [fitH, setFitH] = useState(560)
  // What the search is after: facets in priority order, some muted. Starts from the kind of thing searched for,
  // moves when the user clicks a node of another kind, and can be changed with the chips. One per trail.
  const [intent, setIntent] = useState({ key: null, order: initialOrder('') })
  const [focus, setFocus] = useState(() => new Set())    // facets the user focused; empty = All (nothing dimmed)
  const [suggest, setSuggest] = useState(null)             // the kind of the last clicked node: shown on its chip, never applied
  const [revealed, setRevealed] = useState(() => new Set())
  const [ready, setReady] = useState({ '2d': false, '3d': false })

  // ── the trail: roots (searches) and expansions (clicks), a cursor into it, and the data of each ──
  const [trail, setTrail] = useState([{ kind: 'root', q, lens: S.lens, videos: S.videos, label: q }])
  const [cursor, setCursor] = useState(0)
  const [data, setData] = useState({})       // key -> response
  const [busy, setBusy] = useState(null)
  const [liveFor, setLiveFor] = useState(null)   // root whose live sources are still being added
  const started = useRef(new Set())
  const [error, setError] = useState(null)
  const grow = useRef(false)
  const info = useRef({})                    // node id -> {total, shown} from its expansion
  const none = useRef(new Set())             // nodes whose expansion added nothing

  // The page's search changed. If it came from "Search for this" (or back to a search already in the trail), the trail keeps
  // going: a search step is added, or the cursor goes back to that search and its camera and selection are restored.
  // A search typed in the search bar starts a new trail.
  const trailRef = useRef(trail)
  trailRef.current = trail
  const cursorRef = useRef(0)
  cursorRef.current = cursor
  const pendingSearch = useRef(null)      // the text "Search for this" sent; the effect below adds the crumb when the page has it
  const pendingCursor = useRef(null)      // a crumb the user clicked in another search: go there once that search is showing
  const restoreSnap = useRef(null)
  const first = useRef(true)
  useEffect(() => {
    const clear = () => { setMulti([]); setShared(null); setRevealed(new Set()); setSel(null); info.current = {}; none.current = new Set() }
    if (first.current) { first.current = false; return }
    const t = trailRef.current
    if (pendingCursor.current !== null) {
      const i = pendingCursor.current
      pendingCursor.current = null
      if (t[i]) { clear(); grow.current = false; setCursor(i); restoreSnap.current = t[i].snap || null; return }
    }
    const back = (() => { for (let i = t.length - 1; i >= 0; i--) if (t[i].kind === 'root' && t[i].q === q) return i; return -1 })()
    if (back >= 0 && pendingSearch.current !== q) {   // browser back/forward, or a crumb: a search the trail already has
      clear(); grow.current = false; setCursor(back); restoreSnap.current = t[back].snap || null; return
    }
    if (pendingSearch.current === q) {
      pendingSearch.current = null
      clear()
      setTrail(tt => [...tt.slice(0, cursorRef.current + 1), { kind: 'root', q, lens: S.lens, videos: S.videos, label: 'search: ' + q, via: 'search' }])
      setCursor(c => c + 1)
      return
    }
    clear(); setTrail([{ kind: 'root', q, lens: S.lens, videos: S.videos, label: q }]); setCursor(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const keyOf = e => (e.kind === 'root' ? `q:${e.lens || 'fleet'}${e.videos ? '+v' : ''}:${e.q}` : e.kind === 'expand' ? 'x:' + e.id : 'none:' + e.kind)   // isolate steps carry no data
  const get = useCallback(async (url, key) => {
    setBusy(key); setError(null)
    try {
      const r = await fetch(url)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || r.statusText)
      setData(d => ({ ...d, [key]: j }))
      return j
    } catch (e) { setError(e.message); return null } finally { setBusy(b => (b === key ? null : b)) }
  }, [])
  const changeLens = useCallback((lens, videos = S.videos) => {
    if (lens === S.lens && videos === S.videos) return
    set({ lens, videos })
    setMulti([]); setShared(null); setRevealed(new Set()); setSel(null)
    info.current = {}; none.current = new Set(); started.current.clear()
    setData({}); setTrail([{ kind: 'root', q, lens, videos, label: q }]); setCursor(0)
  }, [S.lens, S.videos, q, set])
  const active = trail[cursor]
  const rootIdx = useMemo(() => { for (let i = cursor; i >= 0; i--) if (trail[i].kind === 'root') return i; return 0 }, [trail, cursor])
  const rootEntry = trail[rootIdx]
  // Two passes, like the list: the fast hierarchy and local results at once, then every live source (Control-M, AAP, Jira,
  // Splunk, ...) merged in when they have answered. Nodes already on screen stay where they are.
  useEffect(() => {
    const key = keyOf(rootEntry)
    if (data[key] || started.current.has(key)) return undefined
    const lens = lensQuery(rootEntry)
    const url = `/api/graph?q=${encodeURIComponent(rootEntry.q)}${lens}`
    const t = setTimeout(async () => {
      started.current.add(key)
      const j = await get(url, key)
      if (!j) { started.current.delete(key); return }
      if (rootEntry.lens !== 'concepts') {
        setLiveFor(key)
        grow.current = true
        await get(url + '&live=1', key)
        setLiveFor(f => (f === key ? null : f))
      }
    }, rootIdx === 0 ? 300 : 0)
    return () => clearTimeout(t)
  }, [rootEntry, data, get, rootIdx])

  const rootKey = keyOf(rootEntry)
  useEffect(() => {
    if (!data[rootKey] || intent.key === rootKey) return
    setIntent({ key: rootKey, order: initialOrder(seedOf(data[rootKey])) })
    setFocus(new Set()); setSuggest(null)
    setRevealed(new Set())
  }, [data, rootKey, intent.key])
  // The seed's priority order decides what is folded into "+N more" when there is too much. It is set once per search:
  // clicking a node or a chip never reshuffles it, because that would rebuild the graph and make the nodes twitch.
  const rootData = data[rootKey]
  const seeds = useMemo(() => new Set((rootData?.seeds ?? []).slice(0, 12)), [rootData])   // the thing searched for: the HUD reticle goes here
  const wOf = useMemo(() => weightOf(intent.order, new Set()), [intent])
  const toggleFocus = facet => { setFocus(f => { const n = new Set(f); n.has(facet) ? n.delete(facet) : n.add(facet); return n }); setSuggest(x => (x === facet ? null : x)) }
  const focusKinds = useMemo(() => (focus.size ? new Set(Object.keys(KIND).filter(k => focus.has(facetOf(k)))) : null), [focus])

  const raw = useMemo(() => {
    const root = data[keyOf(rootEntry)]
    if (!root) return null
    const exps = trail.slice(rootIdx + 1, cursor + 1).map(e => data[keyOf(e)]).filter(Boolean)
    return merge(root, exps)
  }, [data, trail, cursor, rootEntry, rootIdx])

  const ix = useMemo(() => (raw ? indexGraph(raw) : null), [raw])
  const cmp = useMemo(() => (raw && ix && multi.length >= 2 ? compare(raw, ix, multi) : null), [raw, ix, multi])
  // Picked in the grid: show those nodes as a comparison here
  useEffect(() => {
    if (!pickIds || !pickIds.ids?.length) return
    setMulti(pickIds.ids.slice(0, 60)); setShared(null)
    if (pickIds.ids.length === 1) setSel(pickIds.ids[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickIds && pickIds.n])

  const expand = useCallback(async id => {
    if (!raw || id.startsWith('more:')) return
    const key = 'x:' + id
    if (none.current.has(id) || trail.slice(rootIdx + 1, cursor + 1).some(e => e.kind === 'expand' && e.id === id)) return
    const lens = lensQuery(rootEntry)
    const j = data[key] || await get(`/api/graph?expand=${encodeURIComponent(id)}${lens}`, key)
    if (!j) return
    info.current[id] = { total: j.total, shown: j.shown }
    const have = new Set(raw.nodes.map(n => n.id))
    if (!j.nodes.some(n => !have.has(n.id))) { none.current.add(id); setData(d => ({ ...d })); return }
    const label = raw.nodes.find(n => n.id === id)?.label ?? id
    grow.current = true
    stamp()
    setTrail(t => [...t.slice(0, cursor + 1), { kind: 'expand', id, label }])
    setCursor(c => c + 1)
  }, [raw, data, trail, cursor, rootIdx, get, rootEntry])

  // what the view looks like now, kept on the crumb we leave so that coming back restores it
  const snapshot = useCallback(() => ({ sel: live.current.sel, mode: live.current.S.mode, view: (() => { try { return engines.current[live.current.S.mode]?.viewState() } catch (e) { return null } })() }), [])
  const stamp = useCallback(() => setTrail(t => t.map((e, i) => (i === cursorRef.current ? { ...e, snap: snapshot() } : e))), [snapshot])
  const rootOf = (t, i) => { for (let k = i; k >= 0; k--) if (t[k].kind === 'root') return t[k]; return t[0] }
  // go to a crumb. A crumb in another search first brings that search back (the page's query follows).
  const go = useCallback(i => {
    const t = trailRef.current
    i = clamp(i, 0, t.length - 1)
    if (i === cursorRef.current) return
    grow.current = false
    stamp()
    const target = rootOf(t, i)
    if (onSearch && target.q !== rootOf(t, cursorRef.current).q) { pendingCursor.current = i; onSearch(target.q, { restore: true }); return }
    setCursor(i)
    restoreSnap.current = t[i].snap || null
  }, [onSearch, stamp])
  // "Search for this": a real search for the node, exactly as if typed; Graph view stays
  const searchText = useCallback(n => {
    const id = n.id
    if (id.startsWith('p:') && !id.startsWith('p:name:')) return id.slice(2)    // a login
    return n.label
  }, [])
  const searchFor = useCallback(id => {
    const n = raw?.nodes.find(x => x.id === id)
    if (!n || !onSearch) return
    const text = searchText(n)
    stamp()
    pendingSearch.current = text
    onSearch(text)
  }, [raw, onSearch, searchText, stamp])
  // "Isolate": a view filter on what is loaded. It adds a crumb; the rest of the graph is dimmed in place, so nothing moves.
  const isolate = useCallback(id => {
    const n = raw?.nodes.find(x => x.id === id)
    stamp()
    setTrail(t => [...t.slice(0, cursorRef.current + 1), id ? { kind: 'isolate', id, label: 'isolate: ' + (n?.label ?? id) } : { kind: 'isolate', id: null, label: 'isolate off' }])
    setCursor(c => c + 1)
  }, [raw, stamp])
  // restoring a crumb: its selection now, its camera once the engine has the data
  useEffect(() => {
    const s = restoreSnap.current
    if (!s) return undefined
    restoreSnap.current = null
    setSel(s.sel || null)
    const tm = setTimeout(() => { try { const e = engines.current[live.current.S.mode]; if (e && s.view && s.mode === live.current.S.mode) { e.autoFit = false; e.applyView(s.view, 700) } } catch (err) { /* view not ready */ } }, 500)
    return () => clearTimeout(tm)
  }, [cursor])

  // ── model ────────────────────────────────────────────────────────────────
  const present = useMemo(() => new Set((raw?.nodes ?? []).map(n => n.kind)), [raw])
  // Tools and coverage triple the edges of a big result: off by default above 60 hosts, until the box is ticked
  const on = useCallback(k => S.kinds[k] ?? (k === 'tool' ? (raw?.matched ?? 0) <= 60 : true), [S.kinds, raw])
  // Owners are never folded away where it matters: whoever owns the node you picked, whoever owns anything in a small
  // result.
  const boost = useMemo(() => {
    if (!raw) return new Set()
    const small = raw.nodes.filter(n => n.kind === 'host' && n.result).length <= 15
    const mine = new Set([sel, ...(seeds || [])].filter(Boolean))
    const ids = new Set()
    // the people who define a node's own place in the organization never fold away: its manager and the one above, its teams
    let frontier = [...mine]
    for (let hop = 0; hop < 2; hop++) {
      const next = []
      raw.edges.forEach(e => { if (e.kind === 'mgr' && frontier.includes(e.b) && !ids.has(e.a)) { ids.add(e.a); next.push(e.a) } })
      frontier = next
    }
    raw.edges.forEach(e => { if (mine.has(e.b) && (e.kind === 'owner' || e.kind === 'support') && e.a.startsWith('t:')) ids.add(e.a); if (mine.has(e.a) && e.kind === 'group') ids.add(e.b) })
    raw.edges.forEach(e => {
      const own = e.kind === 'owner' || e.kind === 'candidate' || e.kind === 'support'
      if (own && (mine.has(e.b) || (small && e.kind === 'owner' && /Dossier/.test(e.via || '')))) ids.add(e.a)
    })
    return ids
  }, [raw, sel, seeds])
  const model = useMemo(() => {
    if (!raw) return null
    // Concepts are one kind, so the per-kind cap would fold nearly all of them; the facade already sends the top 60
    const base = capGroups(raw, raw?.lens === 'concepts' ? Math.max(S.cap, 80) : S.cap, wOf, revealed, boost, { windowDays: S.window, halfLife: S.halfLife })
    let nodes = base.nodes.filter(n => n.result || on(n.kind))
    const ids = new Set(nodes.map(n => n.id))
    let edges = base.edges.filter(e => ids.has(e.a) && ids.has(e.b))
    if (S.minLinks > 0) {   // "show nodes with at least N links": hides the loosely attached
      const d = {}
      edges.forEach(e => { d[e.a] = (d[e.a] || 0) + 1; d[e.b] = (d[e.b] || 0) + 1 })
      nodes = nodes.filter(n => n.result || (d[n.id] || 0) >= S.minLinks)
      const ok = new Set(nodes.map(n => n.id))
      edges = edges.filter(e => ok.has(e.a) && ok.has(e.b))
    }
    let ms = metrics(nodes, edges, S.size)
    if (S.hideHubs) {   // "reveal the underlying ideas": take the three most influential nodes away to see what they were holding together
      const hubs = new Set(ms.filter(n => !n.result).sort((a, b) => b.bc - a.bc).slice(0, 3).map(n => n.id))
      nodes = nodes.filter(n => !hubs.has(n.id))
      edges = edges.filter(e => !hubs.has(e.a) && !hubs.has(e.b))
      ms = metrics(nodes, edges, S.size)
    }
    return { nodes: ms, edges, gap: gapNodes(ms, edges), stats: base.stats }
  }, [raw, S.cap, on, S.size, S.minLinks, S.hideHubs, sel, wOf, revealed, boost, S.window, S.halfLife])
  const byId = useMemo(() => new Map((model?.nodes ?? []).map(n => [n.id, n])), [model])
  // Isolate: the node and its neighborhood (depth from the Controls slider) stay lit; everything else is dimmed in place
  const rawById = useMemo(() => new Map((raw?.nodes ?? []).map(n => [n.id, n])), [raw])
  // a node that sits in a "+N more" group: show that group (so the node exists on screen), then select it
  const revealNode = useCallback(id => { grow.current = true; setRevealed(r => new Set(r).add('more:' + id.split(':')[0])); setTimeout(() => { setSel(id); engines.current[live.current.S.mode]?.focus(id, false, true) }, 900) }, [])
  const isoId = useMemo(() => { let id = null; for (let i = rootIdx + 1; i <= cursor; i++) if (trail[i]?.kind === 'isolate') id = trail[i].id; return id }, [trail, cursor, rootIdx])
  const isoSet = useMemo(() => (isoId && model && model.nodes.some(n => n.id === isoId) ? new Set(localSubset(model.nodes, model.edges, isoId, S.depth).nodes.map(n => n.id)) : null), [isoId, model, S.depth])
  const isoLabel = isoId ? (byId.get(isoId)?.label ?? raw?.nodes.find(n => n.id === isoId)?.label ?? isoId) : null
  const findSet = useMemo(() => {
    const t = S.find.trim().toLowerCase()
    if (!t || !model) return null
    return new Set(model.nodes.filter(n => n.label.toLowerCase().includes(t) || (n.sub || '').toLowerCase().includes(t)).map(n => n.id))
  }, [S.find, model])

  // The paths from the picked nodes to a shared item the user clicked in the comparison
  const sharedHl = useMemo(() => {
    if (!model) return null
    if (!shared) {   // two or more picked and no shared item chosen: light up the paths to everything they share
      if (!cmp || multi.length < 2) return null
      const here = new Set(model.nodes.map(n => n.id))
      const from = multi.filter(i => here.has(i))
      const nodes = new Set(from), edges = new Set()
      for (const row of cmp.shared.filter(r => r.id && !r.facet.flag).slice(0, 6)) {
        if (!here.has(row.id)) continue
        const p = pathsTo(model, row.id, row.ids.filter(i => here.has(i)))
        p.nodes.forEach(x => nodes.add(x)); p.edges.forEach(x => edges.add(x))
      }
      return edges.size ? { nodes, edges } : null
    }
    const here = new Set(model.nodes.map(n => n.id))
    const from = multi.filter(i => here.has(i))
    if (shared.id && here.has(shared.id)) { const p = pathsTo(model, shared.id, from); from.forEach(i => p.nodes.add(i)); return p }
    return { nodes: new Set([...(shared.ids || []).filter(i => here.has(i)), ...from]), edges: new Set() }
  }, [shared, model, multi, cmp])
  const pickShared = useCallback(sh => { setShared(sh); if (sh.id) engines.current[live.current.S.mode]?.focus(sh.id) }, [])

  // ── engines: one per mode, created on first use, then only updated ───────
  const sideTop = barH + 12
  const stage = useRef(null)
  const els = { '2d': useRef(null), '3d': useRef(null) }
  const engines = useRef({})
  const creating = useRef({})
  const gone = useRef(false)
  const live = useRef({})
  live.current = { isoSet, bdv, sideTop, seeds, model, sel, S, findSet, theme, compareMode, multi, sharedHl, focusKinds }

  const onPick = useCallback((id, mod) => {
    if (id && !id.startsWith('more:') && (mod?.shift || live.current.compareMode)) {   // build a comparison instead of moving on
      setMulti(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setShared(null); return   // the selection stays: no re-layout while picking
    }
    if (!mod) { setMulti([]); setShared(null) }   // a plain click or an empty-space click ends the comparison; a shift-click on empty space does not
    if (id && id.startsWith('more:')) { grow.current = true; setRevealed(r => new Set(r).add(id)); return }   // "+N more": show them, keep the selection
    setSel(id)
    if (!id) return
    engines.current[live.current.S.mode]?.focus(id, false, true)
    const nd = live.current.model?.nodes.find(n => n.id === id)
    if (nd) setSuggest(facetOf(nd.kind))                                                               // a click suggests a focus (shown on its chip), nothing more
    expandRef.current(id)
  }, [])
  const expandRef = useRef(expand)
  expandRef.current = expand
  const select = useCallback(id => { setSel(id); if (id) engines.current[live.current.S.mode]?.focus(id, false, true) }, [])

  useEffect(() => {
    if (!model) return undefined
    let dead = false
    const m = S.mode
    const run = async () => {
      creating.current[m] ??= (async () => {
        const other = engines.current[m === '2d' ? '3d' : '2d']
        const eng = await createEngine(m, els[m].current, { onSelect: (id, mod) => onPick(id, mod), onPins: setPins, onReady: () => setReady(r => ({ ...r, [m]: true })) }, live.current.theme, other?.positions())
        if (gone.current) { eng.destroy(); return eng }
        eng.setForces(live.current.S.f)
        engines.current[m] = eng
        return eng
      })()
      const e = await creating.current[m]
      if (dead) return
      const cur = live.current
      e.setVis({ sel: cur.sel, color: cur.S.color, gaps: cur.S.gaps ? cur.model.gap : null, find: cur.findSet, topics: cur.S.topics, links: cur.S.links, curves: cur.S.curves, labels: cur.S.labels, arrows: cur.S.arrows, focus: cur.focusKinds, seeds: cur.seeds, backdrop: cur.S.backdrop, isolate: cur.isoSet, bdv: cur.bdv, flow: cur.S.flow, backdropTop: cur.sideTop - 4, multiOrder: cur.multi, multi: new Set(cur.multi), pathSet: cur.sharedHl && cur.sharedHl.nodes, pathEdges: cur.sharedHl && cur.sharedHl.edges })
      e.setModel(cur.model, grow.current)
      grow.current = false
      Object.entries(engines.current).forEach(([k, x]) => (k === m ? x.resume() : x.pause()))
    }
    run()
    return () => { dead = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, S.mode])

  useEffect(() => {
    const e = engines.current[S.mode]
    if (e && model) e.setVis({ sel, color: S.color, gaps: S.gaps ? model.gap : null, find: findSet, topics: S.topics, links: S.links, curves: S.curves, labels: S.labels, arrows: S.arrows, focus: focusKinds, seeds, backdrop: S.backdrop, isolate: isoSet, bdv, flow: S.flow, backdropTop: sideTop - 4, multiOrder: multi, multi: new Set(multi), pathSet: sharedHl && sharedHl.nodes, pathEdges: sharedHl && sharedHl.edges })
  }, [sel, multi, sharedHl, focusKinds, seeds, S.arrows, S.backdrop, isoSet, bdv, S.flow, sideTop, S.color, S.gaps, S.topics, S.links, S.curves, S.labels, findSet, model, S.mode])
  useEffect(() => { Object.values(engines.current).forEach(e => e.setTheme(theme)) }, [theme])
  useEffect(() => { engines.current[S.mode]?.setForces(S.f) }, [S.f, S.mode])
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const w = stage.current.clientWidth, h = stage.current.clientHeight
      Object.values(engines.current).forEach(e => e.resize(w, h))
    })
    ro.observe(stage.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { gone.current = false; return () => { gone.current = true; Object.values(engines.current).forEach(e => e.destroy()); engines.current = {}; creating.current = {} } }, [])
  // The canvas resizes when the panel or full window toggles: glide to a fresh fit
  useEffect(() => { const t = setTimeout(() => engines.current[live.current.S.mode]?.fit(800), 140); return () => clearTimeout(t) }, [full])
  useEffect(() => {
    if (!full) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [full])

  // ── panels: hover to peek, click to pin; Details and Compare also follow the context ──
  // The same hover-intent timings as the rest of Docket (ui/motion): rest on a rail icon to open, leave and wait the grace
  // delay to hide. A panel never hides while something in it is in use: a drag on a slider, a text box or a select.
  const flyEls = useRef({})
  const dragging = useRef(false)
  const canHide = id => {
    if (dragging.current) return false
    const el = flyEls.current[id]
    const a = document.activeElement
    return !(el && a && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))
  }
  const hp = useHoverIntent({ canHide })
  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])
  const [ctx, setCtx] = useState({ details: false, compare: false })    // the context is active: the panel stays while it lasts
  const uiRef = useRef(ui)
  uiRef.current = ui
  useEffect(() => { setCtx(c => (c.details === !!sel ? c : { ...c, details: !!sel })) }, [sel])
  const prevPicks = useRef(0)
  useEffect(() => {
    if (multi.length >= 2 && prevPicks.current < 2) setCtx(c => ({ ...c, compare: true }))
    if (multi.length === 0) setCtx(c => (c.compare ? { ...c, compare: false } : c))
    prevPicks.current = multi.length
  }, [multi.length])
  const shown = useMemo(() => Object.fromEntries(PANELS.map(p => [p.id, !!(ui.pinned[p.id] || hp.on[p.id] || ctx[p.id])])), [ui.pinned, hp.on, ctx])
  const dismiss = useCallback(id => { hp.hide(id); setCtx(c => (c[id] ? { ...c, [id]: false } : c)) }, [hp.hide])
  // Only as many panels as fit side by side: showing one more hides the oldest that is not pinned
  const openedAt = useRef({})
  useEffect(() => {
    const now = Date.now()
    const open = PANELS.filter(p => p.side !== 'bottom' && shown[p.id])
    PANELS.forEach(p => { if (shown[p.id]) openedAt.current[p.id] ??= now + PANELS.indexOf(p) * 0.001; else delete openedAt.current[p.id] })
    const cap = Math.max(2, Math.floor((boxW * 0.66 - 2 * (RAIL_GAP * 2 + 40)) / 236))
    if (open.length <= cap) return
    const victim = open.filter(p => !ui.pinned[p.id]).sort((x, y) => openedAt.current[x.id] - openedAt.current[y.id])[0]
    if (victim) dismiss(victim.id)
  }, [shown, ui.pinned, boxW, dismiss])
  const selRef = useRef(null)
  selRef.current = sel
  const onEsc = useCallback(() => {
    if (help) { setHelp(false); return true }
    if (focusMode) { setFocusMode(false); return true }
    const open = PANELS.filter(p => shown[p.id] && !uiRef.current.pinned[p.id])
    if (open.length) { open.forEach(p => dismiss(p.id)); return true }
    if (selRef.current) { setSel(null); return true }
    if (full) { setFull(false); return true }
    return false
  }, [help, focusMode, full, setFull, shown, dismiss])
  // click on a rail icon or the pin button: pin it open, or let it go back to hover-to-peek
  const clickRail = useCallback(id => { setFocusMode(false); pin(id); hp.show(id) }, [pin, hp.show])
  const keyPanel = useCallback(id => {
    setFocusMode(false)
    if (shown[id]) { pin(id, false); dismiss(id) } else hp.show(id)
  }, [shown, pin, dismiss, hp.show])
  useGraphKeys({ enabled: true, onPanel: keyPanel, onFocus: () => setFocusMode(f => !f), onHelp: () => setHelp(h => !h), onEsc })
  // Focus mode: the chrome stays away until the pointer RESTS in an edge zone for 250 ms, or a key is pressed, or the pointer
  // is over the exit pill. Once shown it stays while the pointer is over it, and for at least 1.5 s after the pointer
  // leaves, so it can be crossed to reach a control. The exit pill never moves or hides.
  const reveal = useRef({ dwell: null, hide: null, over: false })
  const startHide = useCallback(() => {
    const r = reveal.current
    clearTimeout(r.hide)
    r.hide = setTimeout(function tick() { if (reveal.current.over) reveal.current.hide = setTimeout(tick, 300); else setPeek(false) }, 1500)
  }, [])
  const showChrome = useCallback(() => { clearTimeout(reveal.current.hide); setPeek(true) }, [])
  const onMove = e => {
    if (!focusMode) return
    const r = reveal.current
    const over = !!(e.target.closest && e.target.closest('[data-chrome],[data-flyout],[role=toolbar],[data-bar]'))
    r.over = over
    if (over) { clearTimeout(r.dwell); r.dwell = null; if (e.target.closest('[data-pill]')) showChrome(); else if (peek) clearTimeout(r.hide); return }
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left, y = e.clientY - box.top
    const edge = x < 28 || x > box.width - 28 || y < 28
    if (edge && !peek) { if (!r.dwell) r.dwell = setTimeout(() => { r.dwell = null; showChrome(); startHide() }, 250) }
    else { clearTimeout(r.dwell); r.dwell = null; if (peek) startHide() }
  }
  useEffect(() => {
    if (!focusMode) { clearTimeout(reveal.current.dwell); clearTimeout(reveal.current.hide); reveal.current.dwell = null; setPeek(false); return undefined }
    const onKey = e => { if (e.key !== 'Escape' && e.key.toUpperCase() !== 'F' && !e.metaKey && !e.ctrlKey) { showChrome(); startHide() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusMode, showChrome, startHide])
  // the first time: a short hint on how to leave
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!focusMode) return undefined
    let seen = false
    try { seen = localStorage.getItem('docket.graph.focushint') === '1'; localStorage.setItem('docket.graph.focushint', '1') } catch (e) { /* storage blocked */ }
    if (seen) return undefined
    setHint(true)
    const t = setTimeout(() => setHint(false), 3200)
    return () => clearTimeout(t)
  }, [focusMode])
  const chrome = !focusMode || peek
  const barRef = useRef(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setBoxW(Math.round(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = barRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setBarH(h => { const n = Math.round(el.getBoundingClientRect().height / (full ? 1 : pageScale)); return Math.abs(n - h) > 1 ? n : h }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [full, pageScale, ui.bar])

  const shownListed = useMemo(() => { const L = new Set(raw?.listed ?? []); return (model?.nodes ?? []).filter(n => L.has(n.id)).length }, [raw, model])
  const flags = useMemo(() => {
    const c = { conflict: 0, missing: 0, inferred: 0 }
    raw?.edges.forEach(e => { if (c[e.flag] !== undefined) c[e.flag]++ })
    return c
  }, [raw])
  const node = byId.get(sel) ?? raw?.nodes.find(n => n.id === sel)
  const empty = raw && !raw.nodes.length
  const flagCount = (flags.conflict || 0) + (flags.missing || 0) + (model ? model.gap.size : 0)

  // The graph lives in one DOM element that moves: in the page, under the results, or on <body> for the
  // full-window mode (a fixed element inside the page would stay below the top bar's stacking layer).
  // React keeps one portal into it, so the canvases are never rebuilt when the mode flips.
  const place = useRef(null)
  // Fill the visible height of the results pane exactly, so the page has nothing to scroll in graph view
  // (the pane's own padding and Docket's text scale, which is CSS zoom, are both counted).
  useLayoutEffect(() => {
    if (full) return undefined
    const el = place.current
    let sp = el.parentElement
    while (sp && !/(auto|scroll)/.test(getComputedStyle(sp).overflowY)) sp = sp.parentElement
    if (!sp) return undefined
    sp.scrollTop = 0
    const calc = () => {
      const sc = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1
      const padB = (parseFloat(getComputedStyle(sp).paddingBottom) || 0) * sc
      const avail = sp.getBoundingClientRect().bottom - el.getBoundingClientRect().top - padB
      setFitH(Math.max(360, Math.floor(avail / sc)))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(sp)
    ro.observe(el.parentElement)
    window.addEventListener('resize', calc)
    window.addEventListener('docket:scale', calc)
    const t = setTimeout(calc, 300)
    return () => { ro.disconnect(); clearTimeout(t); window.removeEventListener('resize', calc); window.removeEventListener('docket:scale', calc) }
  }, [full])
  // whatever overflow is left (rounding, borders) comes off the height
  useEffect(() => {
    if (full) return undefined
    const id = requestAnimationFrame(() => {
      let sp = place.current?.parentElement
      while (sp && !/(auto|scroll)/.test(getComputedStyle(sp).overflowY)) sp = sp.parentElement
      const over = sp ? sp.scrollHeight - sp.clientHeight : 0
      if (over > 1 && fitH > 360) setFitH(h => Math.max(360, h - over))
    })
    return () => cancelAnimationFrame(id)
  }, [fitH, full])
  const host = useMemo(() => document.createElement('div'), [])
  useLayoutEffect(() => {
    const target = full ? document.body : place.current
    target.appendChild(host)
    Object.assign(host.style, full
      ? { position: 'fixed', inset: '0', zIndex: '80', width: '', height: '' }
      : { position: 'absolute', inset: '0', zIndex: '' })
    host.style.background = C.bg
    host.style.borderRadius = full ? '0' : '12px'
    host.style.overflow = 'hidden'
    host.style.border = full ? '0' : `1px solid ${alpha(C.accent, '30')}`
  }, [full, host])
  useEffect(() => () => host.remove(), [host])
  const rootStyle = { position: 'absolute', inset: 0 }

  const trailBar = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '1 1 260px', overflow: 'hidden' }}>
      <Button size="sm" variant="ghost" disabled={cursor === 0} title="Back" onClick={() => go(cursor - 1)}>←</Button>
      <Button size="sm" variant="ghost" disabled={cursor >= trail.length - 1} title="Forward" onClick={() => go(cursor + 1)}>→</Button>
      <span style={{ display: 'inline-flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', alignItems: 'center' }}>
        {trail.map((e, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {i > 0 && <span style={{ color: C.dim, fontSize: 10 }}>›</span>}
            <Pill color={i === cursor ? C.accent : C.muted} solid={i === cursor} onClick={() => go(i)} title={e.kind === 'root' ? `search: ${e.q}` : e.kind === 'isolate' ? (e.id ? 'view filter: only this node and its neighbors' : 'isolate cleared') : `expanded ${e.label}`}
              style={{ opacity: i > cursor ? 0.5 : 1 }}>{trunc(e.label)}</Pill>
          </span>
        ))}
      </span>
      {(busy || false) && <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>…</span>}
      {isoId && <Pill color={C.accent} solid onClick={() => isolate(null)} title="Clear the isolate filter (Back does the same)" style={{ flexShrink: 0 }}>Isolated: {trunc(isoLabel ?? '', 20)} ×</Pill>}
    </span>
  )

  const chips = (
    <span title="Focus dims everything outside it; nothing is hidden. Pick one or several kinds. All lights everything." style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: 'uppercase' }}>Focus</span>
      <Pill color={focus.size === 0 ? C.accent : C.muted} solid={focus.size === 0} onClick={() => { setFocus(new Set()); setSuggest(null) }}>All</Pill>
      {intent.order.filter(f => raw?.nodes.some(n => facetOf(n.kind) === f)).map(f => {
        const on = focus.has(f)
        const hint = suggest === f && !on
        return <Pill key={f} color={on ? C.accent : C.muted} solid={on} onClick={() => toggleFocus(f)}
          title={hint ? 'You just clicked one of these. Click to focus them.' : undefined}
          style={hint ? { borderStyle: 'dashed', boxShadow: `0 0 0 1px ${alpha(C.accent, '70')}`, color: C.accent } : undefined}>{FACETS[f]}{hint ? ' ◂' : ''}</Pill>
      })}
    </span>
  )
  const modeSeg = <Seg value={S.mode} onChange={v => set({ mode: v })} opts={[['2d', '2D'], ['3d', '3D']]} />
  const lensSeg = <>
    <Seg value={S.lens} onChange={l => changeLens(l)} opts={[['fleet', 'Fleet'], ['concepts', 'Concepts']]} />
    {S.lens === 'concepts' && <Button size="sm" variant={S.videos ? 'primary' : 'default'} onClick={() => changeLens('concepts', !S.videos)}
      title="Include the YouTube video notes (media/youtube/); off, the graph is your own notes">Videos</Button>}
  </>
  const quick = (
    <>
      <Seg value={S.color} onChange={v => set({ color: v })} opts={[['kind', 'Color: kind'], ['comm', 'Color: community', 'Clusters found by modularity']]} />
      <Seg value={S.size} onChange={v => set({ size: v })} title="Size nodes by" opts={[['links', 'Size: links', 'Bigger node = more links'], ['infl', 'Size: influence', 'Bigger node = more shortest paths run through it']]} />
      <Seg value={S.labels} onChange={v => set({ labels: v })} title="How many labels: Off shows only the node you point at or pick, Smart fits as many as have room (more as you zoom in), More packs them tighter" opts={[['off', 'Labels: off'], ['smart', 'Smart'], ['more', 'More']]} />
      <Seg value={S.arrows} onChange={v => set({ arrows: v })} title="Static arrowheads, only on links without a moving pulse: Smart near the focus and when zoomed in, All always, Off never" opts={[['off', 'Arrows: off'], ['smart', 'Smart'], ['all', 'All']]} />
      <Seg value={S.flow.on ? 'on' : 'off'} onChange={v => set({ flow: { ...S.flow, on: v === 'on' } })} title="Moving pulses along the links that matter (selected, compared, hierarchy near the focus, conflicts)" opts={[['on', 'Pulses: on'], ['off', 'off']]} />
    </>
  )
  const row = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0' }
  const controls = (
    <>
      <H3>Look</H3>
      <div style={row}>{quick}</div>
      <div style={row}>
        <Seg value={S.backdrop} onChange={v => set({ backdrop: v })} title="The faint holo-table behind the graph: grid, dust, range rings, corner marks. Never over the data." opts={[['off', 'Backdrop: off'], ['subtle', 'Subtle'], ['full', 'Full']]} />
      </div>
      <div style={row}>
        <Seg value={S.curves ? 'curves' : 'lines'} onChange={v => set({ curves: v === 'curves' })} opts={[['curves', 'Curves'], ['lines', 'Lines']]} />
        <Seg value={S.links} onChange={v => set({ links: v })} title="Color links by the nodes at their ends, or by relation type" opts={[['ends', 'Links: ends'], ['type', 'Links: type']]} />
      </div>
      <div style={row}>
        <Button size="sm" variant={S.topics ? 'primary' : 'default'} title="2D: soft halos for each community and dashed lines where they are only thinly connected" onClick={() => set({ topics: !S.topics, color: !S.topics ? 'comm' : S.color })}>Topics</Button>
        <Button size="sm" variant={S.gaps ? 'primary' : 'default'} title="Highlight hosts with missing records, duplicates, no owner, or sources that disagree" onClick={() => set({ gaps: !S.gaps })}>Data gaps</Button>
        <Button size="sm" variant={S.hideHubs ? 'primary' : 'default'} onClick={() => set({ hideHubs: !S.hideHubs })} title="Take the three most influential nodes away to see what they were holding together">Hide top hubs</Button>
      </div>
      <Slider label="Isolate depth (hops around the node)" value={S.depth} min={1} max={3} onChange={v => set({ depth: v })} />
      <H3>Backdrop (saved for this theme)</H3>
      <Slider label="Star opacity" value={bdVals.starOp} min={0} max={60} onChange={v => setBd({ starOp: v })} />
      <Slider label="Star saturation" value={bdVals.starSat} min={0} max={100} onChange={v => setBd({ starSat: v })} />
      <Slider label="Star density and size" value={bdVals.starDen} min={0} max={100} onChange={v => setBd({ starDen: v })} />
      <Slider label="Grid, rings and scan intensity" value={bdVals.intensity} min={0} max={100} onChange={v => setBd({ intensity: v })} />
      <div style={row}><Button size="sm" onClick={resetBd} title="Back to the defaults for this theme">Reset to default</Button><span style={{ fontSize: 11, color: C.dim }}>{theme.id.replace('|', ' · ')}. Stars thin out and dim as you zoom out.</span></div>
      <H3>Link pulses</H3>
      <Slider label="Speed" value={S.flow.speed} min={5} max={100} onChange={v => set({ flow: { ...S.flow, speed: v } })} />
      <Slider label="Opacity" value={S.flow.opacity} min={10} max={100} onChange={v => set({ flow: { ...S.flow, opacity: v } })} />
      <Slider label="Saturation" value={S.flow.sat} min={0} max={100} onChange={v => set({ flow: { ...S.flow, sat: v } })} />
      <Slider label="Density (max pulses)" value={S.flow.density} min={0} max={100} fmt={v => Math.round(20 + 1.3 * v)} onChange={v => set({ flow: { ...S.flow, density: v } })} />
      <div style={{ fontSize: 11, color: C.dim }}>The more links in view, the fewer, slower and softer the pulses get. Selected, compared and conflicting paths stay strongest.</div>
      <H3>Panels</H3>
      <div style={row}><Seg value={S.panelMotion} onChange={v => set({ panelMotion: v })} title="How the side panels slide in and out" opts={[['calm', 'Panel motion: calm'], ['normal', 'normal'], ['snappy', 'snappy']]} /></div>
      <H3>Size of the graph</H3>
      <Slider label="Show nodes with at least N links" value={S.minLinks} min={0} max={6} onChange={v => set({ minLinks: v })} />
      <Slider label="Max nodes per group" value={S.cap} min={2} max={60} onChange={v => set({ cap: v })} />
      <H3>Activity window</H3>
      <div style={row}><Seg value={S.window} onChange={v => set({ window: v })} title="Nodes whose latest activity is older than this fold into the +N more bubble. Nodes with no date are never hidden by it, they just rank last; a group always keeps its newest two."
        opts={WINDOWS.map(([d, l]) => [d, l])} /></div>
      <div style={{ fontSize: 11, color: C.dim }}>Recent ties first: the nodes shown are the ones most recently tied to what you searched for (tickets, jobs, logins). Older ones fold into "+N more", which says how old they are.</div>
      {model?.stats && <div style={{ fontSize: 11, color: C.muted }} title="Counted on the graph in view">Now: {S.window > 0 ? `${model.stats.window} folded because they are older than ${windowLabel(S.window)}, ` : 'window off (All), '}{model.stats.cap} folded by the per-group limit, in {model.stats.bubbles} bubble{model.stats.bubbles === 1 ? '' : 's'}. {model.stats.undated} undated node{model.stats.undated === 1 ? ' is' : 's are'} folded by the limit only.</div>}
      <H3>Advanced</H3>
      <Slider label="Recency half-life (days)" value={S.halfLife} min={3} max={180} onChange={v => set({ halfLife: v })} />
      <div style={{ fontSize: 11, color: C.dim }}>How fast activity fades: a tie's score halves every this many days (default 30). Strength: owner > ticket you worked > job you launched > logged in > sudo.</div>
      <H3>Forces and hierarchy</H3>
      <Slider label="Center force" value={S.f.center} min={0} max={100} fmt={v => (v / 100).toFixed(2)} onChange={v => set({ f: { ...S.f, center: v } })} />
      <Slider label="Repel force" value={S.f.repel} min={10} max={1200} onChange={v => set({ f: { ...S.f, repel: v } })} />
      <Slider label="Link force" value={S.f.link} min={0} max={100} fmt={v => (v / 100).toFixed(2)} onChange={v => set({ f: { ...S.f, link: v } })} />
      <Slider label="Link distance" value={S.f.dist} min={20} max={240} onChange={v => set({ f: { ...S.f, dist: v } })} />
      <Slider label="Hierarchy (parents above)" value={S.f.layer} min={0} max={100} fmt={v => (v / 100).toFixed(2)} onChange={v => set({ f: { ...S.f, layer: v } })} />
    </>
  )
  const find = (w = 120) => (
    <input value={S.find} onChange={e => set({ find: e.target.value })} placeholder="find node…" aria-label="Find a node"
      onKeyDown={e => { if (e.key === 'Enter' && findSet?.size) select([...findSet][0]) }}
      style={{ fontFamily: MONO, fontSize: 11, width: w, background: C.field, border: `1px solid ${C.line2}`, borderRadius: 6, color: C.text, padding: '4px 8px', outline: 'none' }} />
  )
  const filters = (
    <>
      <H3>Focus</H3>
      <div style={{ ...row, gap: 4 }}>{chips}</div>
      <H3>Find</H3>
      {find('100%')}
      <H3>Kinds shown</H3>
      {Object.entries(KIND).filter(([k]) => present.has(k)).map(([k, label]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 12.5 }}>
          <input type="checkbox" checked={on(k)} onChange={e => set({ kinds: { ...S.kinds, [k]: e.target.checked } })} style={{ accentColor: 'var(--accent)' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: theme.kind[k] }} />{label}
          {k === 'tool' && <span style={{ color: C.dim, fontSize: 11 }}>(off above 60 hosts)</span>}
        </label>
      ))}
    </>
  )
  const legend = (
    <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.65 }}>
      <H3>{S.color === 'comm' ? 'Color: community' : 'Color: kind'}</H3>
      {S.color === 'comm'
        ? <div>Nodes of one color are more connected to each other than to the rest. {[...new Set((model?.nodes ?? []).map(n => n.comm))].length} communities here.</div>
        : Object.entries(KIND).filter(([k]) => present.has(k)).map(([k, label]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: theme.kind[k], flexShrink: 0 }} />{label}</div>
        ))}
      <H3>Size</H3>
      <div>{S.size === 'infl' ? 'Bigger = more shortest paths run through it (a bridge).' : 'Bigger = more links.'} Search results are drawn larger.</div>
      <H3>Lines {S.links === 'type' ? '(colored by relation)' : '(colored by the nodes at their ends)'}</H3>
      {S.links === 'type' && Object.entries(theme.rel).filter(([k]) => (raw?.edges ?? []).some(e => e.kind === k)).map(([k, c]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 22, height: 0, borderTop: `2px solid ${c}` }} />{k}</div>
      ))}
      <div><b style={{ color: C.text }}>━▶ owns / owned by</b>, <b style={{ color: C.text }}>manages / reports to</b> (the parent above the child; each end reads its own side)</div>
      <div>╌╌ possible owner (Dossier evidence)</div><div>··· also routed to / supports · joined by name or IP</div>
      <div>── other typed link</div>
      <div style={{ color: theme.flag.conflict }}>── sources disagree (moving dots)</div>
      <div style={{ color: theme.flag.missing }}>- - expected link missing</div>
      <div style={{ color: theme.flag.inferred }}>- - inferred pair</div>
      <H3>Arrows</H3>
      <div>{S.flow.on ? 'Moving pulses show the direction (parent to child, owner to asset) on the selected, compared, nearby and conflicting links; red = sources disagree. Those links get no static arrowhead.' : 'Pulses are off.'} {S.arrows === 'off' ? 'Static arrowheads: off.' : S.arrows === 'all' ? 'Static arrowheads are on every link without a pulse.' : 'Static arrowheads (smart): on links without a pulse, near the focus and when zoomed in.'}</div>
      <H3>Recency</H3>
      <div>Newer ties are brighter and a little larger; older ones fade. Nodes with no date stay at a middle brightness and rank after every dated one. The "+N more" bubble says how old the nodes it holds are. Window: {WINDOWS.find(([d]) => d === S.window)?.[1] ?? 'All'}; half-life {S.halfLife} days (Controls).</div>
      <H3>Marks</H3>
      <div>Dimmed = outside the focus (nothing is hidden). ● = pinned where you dropped it. Numbered badge = picked for Compare.</div>
      <div>Parents sit above children. Click a node to pull in its neighbors.</div>
    </div>
  )
  const sliders = null

  // What "Explain this graph" sends: the relationships (names, never ids), the selection and comparison first
  const summary = useCallback(() => buildExplain({ raw, model, ix, seeds, sel, multi, cmp, focus, search: rootEntry.q }), [model, raw, ix, seeds, sel, multi, cmp, focus, rootEntry])

  const toggleMulti = useCallback(id => { setMulti(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id])); setShared(null) }, [])
  const kindOf = id => ix?.byId.get(id)?.kind
  const presets = {
    sameKind: (() => {
      const last = multi[multi.length - 1]
      const k = last && kindOf(last)
      if (!k) return null
      const all = (raw?.nodes ?? []).filter(n => n.kind === k).map(n => n.id)
      return all.length > 1 ? { label: `All ${all.length} ${KIND[k] ?? k}`, title: 'Compare every node of this kind in the result (the first 60)', run: () => { setMulti(all.slice(0, 60)); setShared(null) } } : null
    })(),
    sameTeam: (() => {
      const last = multi[multi.length - 1]
      if (!last || !ix || !['host', 'hv'].includes(kindOf(last))) return null
      const team = (ix.direct.get(last) || []).find(d => d.kind === 'owner' && d.id.startsWith('t:'))
      if (!team) return null
      const mates = (raw?.nodes ?? []).filter(n => (n.kind === 'host' || n.kind === 'hv') && (ix.direct.get(n.id) || []).some(d => d.id === team.id && d.kind === 'owner')).map(n => n.id)
      return mates.length > 1 ? { label: `Same team (${mates.length})`, title: `Compare the hosts owned by ${ix.byId.get(team.id)?.label ?? 'the same team'}`, run: () => { setMulti(mates.slice(0, 60)); setShared(null) } } : null
    })(),
  }
  const searchLocal = text => {
    const t = text.toLowerCase()
    return (raw?.nodes ?? []).filter(n => !multi.includes(n.id) && !n.more && (n.label.toLowerCase().includes(t) || (n.sub || '').toLowerCase().includes(t))).slice(0, 6)
  }
  // a node that is not in this graph: search everything for it and merge the result in, like a click that expands
  const pullIn = useCallback(async text => {
    const key = 'x:pull:' + text
    const lens = lensQuery(rootEntry)
    const j = data[key] || await get(`/api/graph?q=${encodeURIComponent(text)}${lens}`, key)
    if (!j || !j.nodes.length) return
    grow.current = true
    setTrail(t => [...t.slice(0, cursor + 1), { kind: 'expand', id: 'pull:' + text, label: text }])
    setCursor(c => c + 1)
    if (j.seeds?.[0]) { setMulti(m => (m.includes(j.seeds[0]) ? m : [...m, j.seeds[0]])); setShared(null) }
  }, [data, get, cursor, rootEntry])

  const vis = chrome && !!model
  const badges = { compare: multi.length ? { n: multi.length } : null, insights: flagCount ? { n: flagCount > 99 ? '99+' : flagCount, warn: true } : null, details: null }
  const body = {
    controls: controls,
    filters: filters,
    details: (
      <DetailsCard node={node} model={model} raw={raw} rawById={rawById} byId={byId} select={select} theme={theme} info={info.current[sel]} picked={multi.includes(sel)} onCompare={() => sel && toggleMulti(sel)}
        pinned={pins.includes(sel)} onUnpin={() => engines.current[S.mode]?.unpinId(sel)} onReveal={revealNode} isoId={isoId} onIsolate={isolate} onSearch={onSearch ? searchFor : null}
        onCenter={() => sel && select(sel)} focus={focus} search={rootEntry.q} onHoverNode={id => engines.current[S.mode]?.setExtHover(id)} />
    ),
    compare: (
      <CompareTray ids={multi} result={cmp} ix={ix || { byId: new Map() }} shared={shared} onShared={pickShared} onSelect={id => select(id)}
        onRemove={id => toggleMulti(id)} onClear={() => { setMulti([]); setShared(null) }} compareMode={compareMode} setCompareMode={setCompareMode}
        presets={presets} onAdd={id => { setMulti(m => (m.includes(id) ? m : [...m, id])); setShared(null) }} search={searchLocal} onPullIn={pullIn} />
    ),
    insights: model && (
      <>
        <div style={{ fontSize: 12, margin: '10px 0 0', lineHeight: 1.7 }}>
          <span style={{ color: flags.conflict ? theme.flag.conflict : C.dim }}>● {flags.conflict} conflict{flags.conflict === 1 ? '' : 's'}</span> ·{' '}
          <span style={{ color: flags.missing ? C.amber : C.dim }}>● {flags.missing} missing link{flags.missing === 1 ? '' : 's'}</span> ·{' '}
          <span style={{ color: flags.inferred ? theme.flag.inferred : C.dim }}>● {flags.inferred} inferred</span> · <span style={{ color: model.gap.size ? C.amber : C.dim }}>{model.gap.size} gap node{model.gap.size === 1 ? '' : 's'}</span>
        </div>
        <Explain summary={summary} />
        <Insights model={model} select={select} color={S.color} theme={theme} />
      </>
    ),
    legend: legend,
  }

  return (
    <div ref={place} style={{ position: 'relative', height: fitH }}>
    {createPortal(
    <div ref={rootRef} style={rootStyle} onPointerMove={onMove} onPointerLeave={() => { reveal.current.over = false; clearTimeout(reveal.current.dwell); reveal.current.dwell = null; if (focusMode && peek) startHide() }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 40%, ${alpha(C.accent, '0d')} 0%, transparent 70%)` }}>
        {/* Docket's text scale is CSS zoom on #root, which skews canvas pointer coordinates (clicks and hovers land
            beside the node). The canvases sit in a box zoomed back to 1:1; the full-window host is on <body>, outside it.
            The canvas is always the whole box: panels and bars float over it, so showing or hiding them never resizes it. */}
        <div ref={stage} style={{ position: 'absolute', inset: 0, zoom: full ? 1 : 1 / pageScale }}>
          {['2d', '3d'].map(m => (
            <div key={m} ref={els[m]} style={{ position: 'absolute', inset: 0, opacity: S.mode === m && ready[m] ? 1 : 0, pointerEvents: S.mode === m ? 'auto' : 'none', transition: 'opacity .55s ease' }} />
          ))}
        </div>
      </div>

      {/* top bar: full width, collapsible. Quick controls here; the long tail is in the Controls panel. */}
      {(() => { const m = motion(); return (
      <div ref={barRef} data-bar style={{ ...glass, position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, borderRadius: '0 0 10px 10px', borderWidth: '0 0 1px 0', padding: '4px 10px 0', paddingRight: 10 + (focusMode ? 158 : 0) + (full ? 186 : 0),
        display: 'flex', flexDirection: 'column', opacity: chrome ? 1 : 0, pointerEvents: chrome ? 'auto' : 'none', transition: `opacity ${m.ms}ms ${EASE}` }}>
        <style>{`@keyframes gfade{from{opacity:0}to{opacity:1}}`}</style>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', padding: ui.bar ? '3px 0 0' : '0 0 4px' }}>
          <button onClick={() => setBar(b => !b)} aria-label={ui.bar ? 'Collapse the toolbar' : 'Expand the toolbar'} aria-expanded={ui.bar} title={ui.bar ? 'Collapse the toolbar' : 'Expand the toolbar'}
            style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 11 }}>{ui.bar ? '▴' : '▾'}</button>
          {trailBar}
          {!ui.bar && <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', animation: `gfade ${m.ms}ms ${EASE}` }}>{find(150)}{lensSeg}{modeSeg}</span>}
          {pins.length > 0 && <Button size="sm" onClick={() => engines.current[S.mode]?.unpinAll()} title="Pinned nodes stay where you dropped them. Double-click one to release it, or release all.">Unpin all ({pins.length})</Button>}
          <Button size="sm" onClick={() => engines.current[S.mode]?.fit(900)} title="Frame the whole graph">Fit</Button>
          <Button size="sm" onClick={() => setFocusMode(true)} title="Focus mode (F): hide everything but the graph">Focus mode</Button>
          {!full && <Button size="sm" onClick={() => setFull(true)} title="Use the whole browser window (Esc leaves)">Full window</Button>}
        </div>
        {/* the second row folds away: its height animates inside the bar, which floats over the canvas, so nothing under it resizes */}
        <div aria-hidden={!ui.bar} style={{ display: 'grid', gridTemplateRows: ui.bar ? '1fr' : '0fr', opacity: ui.bar ? 1 : 0, visibility: ui.bar ? 'visible' : 'hidden',
          transition: `grid-template-rows ${ui.bar ? pm.inMs : pm.outMs}ms ${ui.bar ? pm.easeIn : pm.easeOut}, opacity ${ui.bar ? pm.inMs : pm.outMs}ms ${ui.bar ? pm.easeIn : pm.easeOut}, visibility 0s linear ${ui.bar ? 0 : pm.outMs}ms` }}>
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', padding: '6px 0 7px', transform: ui.bar ? 'none' : `translateY(${-Math.max(8, pm.travel / 2)}px)`, transition: `transform ${ui.bar ? pm.inMs : pm.outMs}ms ${ui.bar ? pm.easeIn : pm.easeOut}` }}>
              {chips}
              <span style={{ flex: 1 }} />
              {find(150)}
              {lensSeg}{modeSeg}
              <Seg value={S.labels} onChange={v => set({ labels: v })} title="How many labels: Off shows only the node you point at or pick, Smart fits as many as have room (more as you zoom in), More packs them tighter" opts={[['off', 'Labels: off'], ['smart', 'Smart'], ['more', 'More']]} />
            </div>
          </div>
        </div>
      </div>
      ) })()}

      {/* rails and flyouts: over the canvas, never resizing it */}
      <div style={{ opacity: vis ? 1 : 0, pointerEvents: 'none', transition: `opacity ${motion().ms}ms ${EASE}` }}>
        <div style={{ pointerEvents: vis ? 'auto' : 'none' }}>
          {['left', 'right'].map(side => (
            <Rail key={side} side={side} top={sideTop} items={PANELS.filter(p => (p.rail ?? p.side) === side)} shown={shown} pinned={ui.pinned} badges={badges}
              onEnter={id => (shown[id] ? hp.hold(id) : hp.enter(id))} onLeave={hp.leave} onClick={clickRail} />
          ))}
        </div>
      </div>
      {model && (() => { const lay = layoutPanels(shown, boxW); return PANELS.map(p => (
        <Flyout key={p.id} pm={pm} panel={p} shown={shown[p.id]} pinned={!!ui.pinned[p.id]} top={sideTop} bottom={40} visible={chrome} {...lay[p.id]}
          panelRef={el => { flyEls.current[p.id] = el }}
          onEnter={id => { hp.hold(id) }} onLeave={hp.leave}
          onClose={id => { pin(id, false); dismiss(id) }} onPin={id => pin(id)}>
          <div onPointerDown={() => { dragging.current = true }}>{body[p.id]}</div>
        </Flyout>
      )) })()}

      {/* exit controls: fixed in the corner, over everything, never moved, resized or hidden by the chrome around them */}
      {(focusMode || full) && (
        <div data-chrome data-pill style={{ position: 'absolute', top: 10, right: 10, zIndex: 30, display: 'flex', gap: 8 }}>
          <style>{'[data-pill] button:hover,[data-pill] button:focus-visible{opacity:1!important}'}</style>
          {focusMode && <button onClick={() => setFocusMode(false)} title="Leave focus mode (F or Esc)" style={pillStyle(152)}>⤡ Exit focus (F)</button>}
          {full && <button onClick={() => setFull(false)} title="Leave full window (Esc)" style={pillStyle(178)}>✕ Exit full window</button>}
        </div>
      )}
      {focusMode && (
        <div role="status" style={{ position: 'absolute', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 30, ...glass, padding: '6px 14px', fontFamily: MONO, fontSize: 11, color: C.bright, pointerEvents: 'none',
          opacity: hint ? 1 : 0, transition: `opacity ${hint ? 300 : 900}ms ease` }}>Press F or Esc to exit focus mode</div>
      )}

      {/* legend chip: always there, never moves or fades when its panel opens, so the pointer stays on it; it is also the panel's hover trigger */}
      {model && (
        <button onClick={() => clickRail('legend')} onMouseEnter={() => (shown.legend ? hp.hold('legend') : hp.enter('legend'))} onMouseLeave={() => hp.leave('legend')} title="Legend: what the colors, sizes, lines and pulses mean now. Hover to peek, click to pin."
          aria-expanded={!!shown.legend} style={{ ...glass, position: 'absolute', right: RAIL_GAP * 2 + 40, bottom: 8, zIndex: 9, padding: '3px 9px', fontFamily: MONO, fontSize: 10, color: shown.legend ? C.bright : C.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            borderColor: shown.legend ? alpha(C.accent, '80') : undefined, opacity: chrome ? 1 : 0, pointerEvents: chrome ? 'auto' : 'none', transition: `opacity ${pm.inMs}ms ${EASE}, border-color .2s` }}>
          {(S.color === 'comm' ? theme.comm.slice(0, 4) : ['host', 'app', 'dataset', 'proxy'].map(k => theme.kind[k])).map((c, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />)}
          Legend
        </button>
      )}

      <div style={{ position: 'absolute', left: 14, bottom: 10, right: 150, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontFamily: MONO, fontSize: 11, color: C.muted, pointerEvents: 'none', opacity: chrome ? 1 : 0, transition: 'opacity .18s ease' }}>
        {!raw && !error && <span>building graph…</span>}
        {error && <span style={{ color: C.red }}>graph failed: {error}</span>}
        {raw && !empty && <>
          <span>{raw.resolved ? `${raw.resolved}: ` : ''}{raw.matched ?? 0} start node{raw.matched === 1 ? '' : 's'} · {model?.nodes.length ?? 0} nodes · {model?.edges.length ?? 0} links shown</span>
          {raw.coverage && !raw.coverage.error && (
            <span title={(raw.coverage.groups || []).map(g => `${g.title}: ${g.items} → ${g.covered} (${g.typed ?? '?'} with a real relationship)`).join('\n') + (raw.coverage.more ? `\n(+${raw.coverage.more} more the list holds back)` : '')}
              style={{ color: raw.coverage.covered < raw.coverage.list ? C.amber : C.muted, pointerEvents: 'auto' }}>
              list: {raw.coverage.list} result{raw.coverage.list === 1 ? '' : 's'} · graph: {raw.coverage.nodes} node{raw.coverage.nodes === 1 ? '' : 's'}{raw.coverage.covered < raw.coverage.list ? ' (gap!)' : ''}{raw.coverage.typed != null ? ` · ${raw.coverage.typed} tied in by a relationship` : ''}{shownListed < raw.coverage.nodes ? ` · ${shownListed} of these drawn, ${raw.coverage.nodes - shownListed} folded into +N more` : ''}{model?.stats && (model.stats.window || model.stats.cap) ? (S.window > 0 ? ` · folded: ${model.stats.window} older than ${windowLabel(S.window)}, ${model.stats.cap} over the group limit (${model.stats.undated} undated, never hidden by the window)` : ` · folded: ${model.stats.cap} over the group limit (window: All, ${model.stats.undated} of them undated)`) : ''}
            </span>
          )}
          {raw.coverage?.error && <span style={{ color: C.amber }}>list not added: {raw.coverage.error}</span>}
          {liveFor === rootKey && <span style={{ color: C.dim }}>adding live sources…</span>}
          {raw.truncated && <span style={{ color: C.amber }}>capped at {raw.matched}; narrow the search to see the rest</span>}
          {flags.conflict > 0 && <span style={{ color: theme.flag.conflict }}>● {flags.conflict} source conflict{flags.conflict === 1 ? '' : 's'}</span>}
          {flags.missing > 0 && <span style={{ color: theme.flag.missing }}>● {flags.missing} missing link{flags.missing === 1 ? '' : 's'}</span>}
          {flags.inferred > 0 && <span style={{ color: theme.flag.inferred }}>● {flags.inferred} inferred pair{flags.inferred === 1 ? '' : 's'}</span>}
          <span style={{ color: C.dim }}>drag · scroll to zoom{S.mode === '3d' ? ' · shift-drag or right-drag: pan' : ''} · click a node to inspect and expand it · ? for keys</span>
        </>}
      </div>

      {empty && (
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, display: 'grid', placeItems: 'center', color: C.muted, fontFamily: MONO, fontSize: 12, textAlign: 'center', padding: 24, pointerEvents: 'none' }}>
          Nothing in the CMDB, AD or network mirrors matches “{rootEntry.q}”. Try a host, person, team, cluster, pool, subnet or software name.
        </div>
      )}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>, host)}
    </div>
  )
}

const pillStyle = w => ({ ...glass, width: w, height: 28, padding: 0, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', fontFamily: MONO, fontSize: 11, letterSpacing: 0.5, color: C.bright, cursor: 'pointer', opacity: 0.6, transition: 'opacity .15s' })
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function Insights({ model, select, color, theme }) {
  const ns = model.nodes
  const info = useMemo(() => {
    if (!ns.length) return null
    const byId = new Map(ns.map(n => [n.id, n]))
    const top = ns.slice().sort((a, b) => b.bc - a.bc).filter(n => n.bc > 0.05).slice(0, 4)
    const cs = {}
    ns.forEach(n => { (cs[n.comm] ??= []).push(n) })
    const cl = Object.entries(cs).sort((a, b) => b[1].length - a[1].length).filter(c => c[1].length > 1).slice(0, 5)
    const inter = {}
    model.edges.forEach(e => {
      const a = byId.get(e.a), b = byId.get(e.b)
      if (a && b && a.comm !== b.comm) { const k = Math.min(a.comm, b.comm) + '-' + Math.max(a.comm, b.comm); inter[k] = (inter[k] || 0) + 1 }
    })
    const pairs = []
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) pairs.push([cl[i], cl[j], inter[Math.min(+cl[i][0], +cl[j][0]) + '-' + Math.max(+cl[i][0], +cl[j][0])] || 0])
    pairs.sort((a, b) => a[2] - b[2])
    const owned = new Set(model.edges.filter(e => e.kind === 'owner').map(e => e.b))
    const hosts = ns.filter(n => n.kind === 'host')
    const orphans = hosts.filter(n => n.result && !owned.has(n.id))
    const nocmdb = hosts.filter(n => (n.attrs || []).some(a => a[0] === 'In CMDB' && a[1] !== 'yes'))
    const dups = hosts.filter(n => (n.attrs || []).some(a => a[0] === 'CMDB duplicates'))
    return { top, cl, pairs, orphans, nocmdb, dups, gaps: hosts.filter(n => model.gap.has(n.id)).length, diversity: diversity(ns, model.edges) }
  }, [ns, model])
  if (!info) return null
  const col = n => (color === 'comm' ? theme.comm[n.comm % theme.comm.length] : theme.kind[n.kind])
  const name = c => (c[1].filter(n => n.result).slice(0, 2).map(n => n.label).join(', ') || c[1][0].label) + (c[1].length > 2 ? ` +${c[1].length - 2}` : '')
  const row = { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12, cursor: 'pointer' }
  const sub = { fontSize: 10.5, color: C.dim, margin: '8px 0 2px', textTransform: 'uppercase', letterSpacing: 1 }
  const list = (label, arr) => arr.length > 0 && (
    <div style={{ ...row, cursor: 'default' }}>
      <span style={{ flex: 1, minWidth: 0 }}>{arr.length} {label}</span>
      <a onClick={() => select(arr[0].id)} style={{ color: C.accent, cursor: 'pointer', fontFamily: MONO, fontSize: 10.5 }}>{trunc(arr[0].label, 16)}{arr.length > 1 ? ' …' : ''}</a>
    </div>
  )
  return (
    <div>
      <H3>Network insights</H3>
      <div style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>Diversity: <span style={{ color: C.accent }}>{info.diversity.label}</span> (Q {info.diversity.q.toFixed(2)}, top topic {Math.round(info.diversity.topShare * 100)}%)<div style={{ color: C.muted }}>{info.diversity.label === 'biased' ? 'One topic holds most of the graph.' : info.diversity.label === 'focused' ? 'Topics are lightly separated.' : info.diversity.label === 'diversified' ? 'Several distinct topics are represented.' : 'Topics are strongly separated.'}</div></div>
      <div style={{ ...sub, marginTop: 2 }}>Bridges (most influence)</div>
      {info.top.map(n => (
        <div key={n.id} style={row} onClick={() => select(n.id)}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: col(n), flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
          <span style={{ height: 5, borderRadius: 3, background: C.accent, opacity: 0.7, width: Math.round(n.bc * 60) }} />
        </div>
      ))}
      <div style={sub}>Communities ({info.cl.length})</div>
      {info.cl.map(c => (
        <div key={c[0]} style={row} onClick={() => select(c[1].slice().sort((a, b) => b.val - a.val)[0].id)}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.comm[+c[0] % theme.comm.length], flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(c)}</span>
          <span style={{ color: C.dim, fontSize: 11 }}>{c[1].length}</span>
        </div>
      ))}
      {info.pairs.length > 0 && <>
        <div style={sub}>Weakest ties between communities</div>
        {info.pairs.slice(0, 2).map((p, i) => (
          <div key={i} style={{ ...row, cursor: 'default', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(p[0])} ↔ {name(p[1])}</span>
            <span style={{ color: C.dim, fontSize: 11 }}>{p[2]} link{p[2] === 1 ? '' : 's'}</span>
            <Explain compact mode="bridge" gap={{ a: p[0][1].slice().sort((a, b) => b.bc - a.bc).slice(0, 6).map(n => n.label), b: p[1][1].slice().sort((a, b) => b.bc - a.bc).slice(0, 6).map(n => n.label) }} summary={() => ({ question: 'Find a bridge between these AIKB topics.' })} />
          </div>
        ))}
      </>}
      {info.gaps + info.orphans.length + info.nocmdb.length + info.dups.length > 0 && <>
        <div style={sub}>Diagnostics</div>
        <div style={{ fontSize: 12 }}>{info.gaps} host{info.gaps === 1 ? '' : 's'} with a gap or conflict</div>
        {list('with no owner', info.orphans)}
        {list('not in the CMDB', info.nocmdb)}
        {list('duplicated in the CMDB', info.dups)}
      </>}
    </div>
  )
}
