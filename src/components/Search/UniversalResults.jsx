import { HOVER_INTENT_MS, ANIM_MS, EASE } from '../../ui/motion'
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { link } from '../../router'
import SplunkInline from './SplunkInline'
import { C, alpha } from '../../ui/theme'
import { DossierBanner } from './DossierBanner'

const GraphView = lazy(() => import('../Graph/GraphView'))
const PivotGrid = lazy(() => import('../Graph/PivotGrid'))   // three.js stays out of the list view's bundle

// Universal search under the search bar. Two passes per query: a fast local-index
// pass while typing (/api/search), then the live lookups (OmniCenter, CMDB, Jira, AAP,
// Control-M, Satellite…) streamed source by source once typing pauses. Items with
// `search` pivot the box to that term.
const MONO = "'JetBrains Mono',monospace"
const SOURCE = {
  path: { label: 'Path', color: C.cyan },
  host: { label: 'Hosts', color: C.cyan },
  app: { label: 'Apps', color: C.blue },
  service: { label: 'Cards', color: C.muted },
  proxy: { label: 'NPM', color: C.orange },
  dns: { label: 'DNS', color: C.green },
  dataset: { label: 'Datasets', color: C.violet },
  pool: { label: 'Pools', color: C.violet },
  health: { label: 'Prometheus', color: C.orange },
  media: { label: 'Media', color: C.amber },
  watch: { label: 'Watch', color: C.red },
  aikb: { label: 'AIKB', color: C.violet },
  ops: { label: 'Ops', color: C.red },
  error: { label: 'Error', color: C.amber },
}
// Result sections, in page order. Each card lands in the first section listing its
// source; cards keep that order inside a section. Unknown sources go to Records.
const SECTIONS = [
  { key: 'path', label: 'Path', color: C.cyan, sources: ['path'] },
  { key: 'servers', label: 'Hosts', color: C.cyan, sources: ['host'] },
  { key: 'notes', label: 'Notes (AIKB)', color: C.violet, sources: ['aikb'] },
  { key: 'ops', label: 'Ops', color: C.red, sources: ['ops'] },
  { key: 'apps', label: 'Apps & services', color: C.blue, sources: ['app', 'service', 'proxy'] },
  { key: 'health', label: 'Health & monitoring', color: C.orange, sources: ['health'] },
  { key: 'storage', label: 'Storage', color: C.violet, sources: ['pool', 'dataset'] },
  { key: 'media', label: 'Media', color: C.amber, sources: ['media', 'watch'] },
  { key: 'records', label: 'Records', color: C.muted, sources: ['dns', 'error'] },
]
function sectioned(groups) {
  const out = SECTIONS.map(sec => ({ ...sec, groups: [] }))
  for (const g of groups) {
    const sec = out.find(x => x.sources.includes(g.source)) ?? out[out.length - 1]
    sec.groups.push(g)
  }
  for (const sec of out) {
    sec.groups = sec.groups.map((g, i) => [g, i])
      .sort(([a, i], [b, j]) => (sec.sources.indexOf(a.source) - sec.sources.indexOf(b.source)) || i - j)
      .map(([g]) => g)
  }
  return out.filter(sec => sec.groups.length)
}
const failedIn = g => (g.items ?? []).filter(it => ['failed', 'error'].includes(it.status)).length + (g.error ? 1 : 0)

function useCollapsed() {
  const [set, setSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('docket.search.collapsed') ?? '[]')) } catch { return new Set() }
  })
  const toggle = key => setSet(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    try { localStorage.setItem('docket.search.collapsed', JSON.stringify([...next])) } catch { /* private mode */ }
    return next
  })
  return [set, toggle]
}

const STATUS = {
  failed: C.red, error: C.red, successful: C.green, ok: C.green,
  running: C.blue, open: C.amber, done: C.dim, canceled: C.dim,
}
// "looks like …": each with its own article, and plain text for free text
const KIND_LABEL = { host: 'a host', ip: 'an IP address', app: 'an app', text: 'plain text' }

// The full pass streams (/api/search/stream): one event per live source as it answers,
// so the page can say which sources are still running instead of looking finished.
export function useUniversalSearch(query, scope = 'all') {
  const [state, setState] = useState({ q: '', fast: null, live: null })
  const seq = useRef(0)
  useEffect(() => {
    const q = query.trim()
    const sc = scope && scope !== 'all' ? `&scope=${scope}` : ''
    const n = ++seq.current
    if (q.length < 2) { setState({ q: '', fast: null, live: null }); return }
    const abort = new AbortController()
    const current = () => n === seq.current
    const t1 = setTimeout(async () => {
      const fast = await fetch(`/api/search?mode=fast&q=${encodeURIComponent(q)}${sc}`)
        .then(r => r.json()).catch(e => ({ error: e.message, groups: [] }))
      if (current()) setState(s => ({ ...s, q, fast, live: s.q === q ? s.live : null }))
    }, 120)
    const t2 = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/stream?q=${encodeURIComponent(q)}${sc}`, { signal: abort.signal })
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1)
            if (!line.trim() || !current()) continue
            const ev = JSON.parse(line)
            setState(s => ({ ...s, q, live: applyEvent(s.q === q ? s.live : null, ev) }))
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError' && current()) {
          setState(s => ({ ...s, q, live: { ...(s.live ?? { sources: [] }), extras: [], done: true, error: e.message } }))
        }
      }
    }, 550)
    return () => { clearTimeout(t1); clearTimeout(t2); abort.abort() }
  }, [query, scope])
  return state
}

function applyEvent(live, ev) {
  if (ev.type === 'start') {
    return { kind: ev.kind, resolved: ev.resolved, cached: !!ev.cached, done: false, extras: [],
             sources: ev.sources.map(name => ({ name, state: 'pending', groups: [] })) }
  }
  if (!live) return live
  if (ev.type === 'source') {
    return { ...live, sources: live.sources.map(s => s.name !== ev.name ? s : {
      ...s, state: ev.error ? 'error' : 'done', error: ev.error, seconds: ev.seconds, groups: ev.groups ?? [],
    }) }
  }
  if (ev.type === 'done') return { ...live, done: true, extras: ev.groups ?? [], error: ev.error }
  return live
}

// Local groups the live sources haven't covered (the same rule the server uses)
const ALWAYS_LOCAL = new Set(['project', 'service', 'inventory'])
function withLocal(live, local) {
  const covered = new Set(live.map(g => g.source))
  return [...live, ...(local ?? []).filter(g => !covered.has(g.source) || ALWAYS_LOCAL.has(g.source))]
}

// The groups on screen: live sources as they answer, local (fast) groups until then
function resultGroups({ fast, live }) {
  const liveGroups = (live?.sources ?? []).flatMap(s => s.groups)
  return (live?.done ? [...liveGroups, ...(live.extras ?? [])] : withLocal(liveGroups, fast?.groups))
    .filter(g => g.items?.length || g.error)
}

// The search bar's total: top-level result rows (indented rows are details of the row
// above) plus what is behind each group's "more". Service cards are counted by the
// caller, so the Services group is left out here to avoid counting them twice.
export function matchCount(search) {
  if (!search.q || (!search.fast && !search.live)) return { count: 0, running: false }
  const count = resultGroups(search).filter(g => g.source !== 'service')
    .reduce((n, g) => n + (g.items ?? []).filter(it => !it.indent).length + (g.more ?? 0), 0)
  return { count, running: !search.live?.done }
}

// The results list is the default view; the graph shows only when picked after a search, and a new search goes
// back to the list. One value decides that, so a user setting can later make the choice stick.
export const preferredResultView = 'list'
// `chain` holds the searches made from the graph ("Search for this" and going back through them): moving along it keeps Graph view
export function useView(q, chain) {
  const [view, setView] = useState(preferredResultView)
  useEffect(() => {
    if (chain && chain.current.has(q)) return
    if (chain) chain.current.clear()
    setView(preferredResultView)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  return [view, setView]
}

export function UniversalResults({ search, setQuery, accent, view, pickView, graphSearch }) {
  const [collapsed, toggle] = useCollapsed()
  const [graphFull, setGraphFull] = useState(false)
  const [pickIds, setPickIds] = useState(null)   // nodes chosen in the grid, shown in the graph as a comparison
  const openGraph = ids => { setPickIds({ ids, n: Date.now() }); pickView('graph') }
  // Esc, when no text box has the focus, closes every expanded result
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) window.dispatchEvent(new Event(COLLAPSE_ALL))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const { fast, live } = search
  if (!search.q || (!fast && !live)) return null
  const all = resultGroups(search)
  // A host's dossier spans the pane above the cards; its plain group is the fallback
  const dossier = all.find(g => g.source === 'dossier' && g.banner)?.banner
  const groups = dossier ? all.filter(g => g.source !== 'dossier') : all
  const pending = live ? live.sources.filter(s => s.state === 'pending') : null
  const running = !live || !live.done
  const kind = live?.kind ?? fast?.kind
  const resolved = live ? live.resolved : fast?.resolved   // a partial name ("tim01") matched to one host
  return (
    <div style={{ marginBottom: view === 'graph' ? 0 : 28, paddingBottom: view === 'graph' ? 0 : '45vh' }}>
      <style>{'@keyframes srch-pulse{0%,100%{opacity:.35}50%{opacity:1}}@keyframes tabgrow{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.07)}100%{opacity:1;transform:scale(1)}}@keyframes tabfill{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes rowsweep{from{stroke-dashoffset:0}to{stroke-dashoffset:100}}@keyframes srch-bar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: running ? 6 : 12, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 3, color: accent, textTransform: 'uppercase' }}>
          Everything
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>
          {kind && `looks like ${KIND_LABEL[kind] ?? kind}`}
          {resolved && <> · searching <span style={{ color: C.text }}>{resolved}</span></>}
          {fast?.error && ` · ${fast.error}`}
        </span>
        <SourceChips live={live} accent={accent} />
        {live?.done && !live.cached && pending?.length === 0 && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: alpha(C.green, '99') }}>✓ all sources answered</span>
        )}
      </div>
      {running && (
        <div title="Searching live sources" style={{ height: 2, borderRadius: 1, overflow: 'hidden', background: alpha(C.text, '0a'), marginBottom: 12 }}>
          <div style={{ width: '40%', height: '100%', background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
                        animation: 'srch-bar 1.1s ease-in-out infinite' }} />
        </div>
      )}
      {view === 'graph' ? (
        <Suspense fallback={<div style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>loading graph…</div>}>
          <GraphView q={search.q} full={graphFull} setFull={setGraphFull} pickIds={pickIds} onSearch={graphSearch} />
        </Suspense>
      ) : view === 'grid' ? (
        <Suspense fallback={<div style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>loading grid…</div>}>
          <PivotGrid q={search.q} onOpenGraph={openGraph} />
        </Suspense>
      ) : <>
      {dossier && <DossierBanner banner={dossier} accent={accent} />}
      {groups.length === 0 && !running && !dossier ? (
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>nothing linked to "{search.q}"</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {sectioned(groups).map(sec => (
            <Section key={sec.key} sec={sec} open={!collapsed.has(sec.key)} onToggle={() => toggle(sec.key)} setQuery={setQuery} />
          ))}
        </div>
      )}
      </>}
    </div>
  )
}

// ── Copy to clipboard: a result, a card, or a whole section, as plain text ──────────────────────
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}
const itemText = it => [it.title, it.subtitle, it.detail, ...(it.children || []).map(c => [c.title, c.subtitle, c.href].filter(Boolean).join(' · '))].filter(Boolean).join('\n')
const groupText = g => [`# ${g.title}${g.more > 0 ? ` (+${g.more} more not shown)` : ''}`,
  ...(g.items ?? []).map(it => it.indent ? itemText(it).replace(/^/gm, '  ') : itemText(it))].join('\n')
const sectionText = sec => [`## ${sec.label}`, ...sec.groups.map(groupText)].join('\n\n')

function CopyBtn({ get, title = 'Copy', style }) {
  const [done, setDone] = useState(false)
  return (
    <span role="button" tabIndex={0} title={done ? 'Copied' : title}
          onClick={e => { e.preventDefault(); e.stopPropagation(); copyText(get()); setDone(true); setTimeout(() => setDone(false), 1200) }}
          style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: done ? C.green : C.dim, cursor: 'pointer', flexShrink: 0, padding: '0 4px',
                   border: `1px solid ${done ? alpha(C.green, '60') : alpha(C.text, '1a')}`, borderRadius: 4, userSelect: 'none', ...style }}>
      {done ? '✓' : '⧉'}
    </span>
  )
}

function Section({ sec, open, onToggle, setQuery }) {
  const attention = sec.groups.reduce((n, g) => n + failedIn(g), 0)
  const rows = sec.groups.reduce((n, g) => n + (g.items ?? []).filter(it => !it.indent).length, 0)
  return (
    <section>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
                                       padding: '6px 0', marginBottom: open ? 10 : 0, borderBottom: `1px solid ${alpha(sec.color, '30')}` }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: sec.color }} />
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase', color: sec.color }}>{sec.label}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>
          {sec.groups.length} card{sec.groups.length === 1 ? '' : 's'} · {rows} row{rows === 1 ? '' : 's'}
        </span>
        {attention > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.red, border: `1px solid ${alpha(C.red, '60')}`, borderRadius: 10, padding: '0 7px' }}>
            {attention} need{attention === 1 ? 's' : ''} attention
          </span>
        )}
        <span style={{ flex: 1 }} />
        <CopyBtn get={() => sectionText(sec)} title={`Copy the whole ${sec.label} section`} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(420px, 100%), 1fr))', gap: 12 }}>
          {sec.groups.map((g, i) => <Group key={g.title + i} g={g} setQuery={setQuery} edge={sec.color} />)}
        </div>
      )}
    </section>
  )
}

// One chip per live source: pulsing while it runs, then its hit count (or the error)
function SourceChips({ live, accent }) {
  if (!live) {
    return <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, animation: 'srch-pulse 1.2s ease-in-out infinite' }}>starting live search…</span>
  }
  if (live.cached) return <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>· from the last minute</span>
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {live.sources.map((s, si) => {
        const hits = s.groups.reduce((n, g) => n + (g.items?.length ?? 0), 0)
        const color = s.state === 'pending' ? accent : s.state === 'error' ? C.amber : hits ? C.green : C.dim
        return (
          <span key={s.name + si} title={s.state === 'pending' ? 'still searching' : s.error ? `failed: ${s.error}` : `${hits} result${hits === 1 ? '' : 's'} in ${s.seconds}s`}
            style={{ fontFamily: MONO, fontSize: 10, color, padding: '1px 8px', borderRadius: 10,
                     border: `1px solid ${alpha(color, '40')}`, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: color,
                           animation: s.state === 'pending' ? 'srch-pulse 1s ease-in-out infinite' : 'none' }} />
            {s.name}{s.state === 'done' ? ` ${hits}` : s.state === 'error' ? ' !' : ''}
          </span>
        )
      })}
    </span>
  )
}

const SCROLL_AFTER = 10   // rows shown before a group scrolls
const ROW_PX = 46         // ~ one title + subtitle row

function Group({ g, setQuery, edge }) {
  const src = SOURCE[g.source] ?? { label: g.source ?? 'Other', color: C.muted }
  const [signal, setSignal] = useState(0)
  const [expandSig, setExpandSig] = useState(0)
  const [full, setFull] = useState(false)    // after expand-all the card grows to show everything: no inner scroll panes
  useEffect(() => {
    const off = () => setFull(false)
    window.addEventListener(COLLAPSE_ALL, off)
    return () => window.removeEventListener(COLLAPSE_ALL, off)
  }, [])
  const [inside, setInside] = useState(false)
  return (
    <div onMouseEnter={() => setInside(true)} onMouseLeave={() => setInside(false)} style={{ background: C.panel, border: `1px solid ${alpha(C.text, '10')}`, borderLeft: `2px solid ${alpha(edge ?? src.color, '80')}`,
                  borderRadius: 10, padding: '12px 14px', gridColumn: g.splunk ? '1 / -1' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: src.color, whiteSpace: 'nowrap', flexShrink: 0,
                       border: `1px solid ${alpha(src.color, '50')}`, borderRadius: 4, padding: '1px 6px' }}>{src.label}</span>
        <span style={{ fontSize: 12, color: C.muted }}>{g.title}</span>
        {g.items.length > SCROLL_AFTER && <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{g.items.length}</span>}
        {g.more > 0 && <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>+{g.more} more · narrow the search</span>}
        <span style={{ flex: 1 }} />
        <span role="button" tabIndex={0} title="Expand every result in this card that has more to show (they stay pinned open)" onClick={() => { setFull(true); setExpandSig(n => n + 1) }}
              style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: C.dim, cursor: 'pointer', padding: '0 4px', userSelect: 'none',
                       border: `1px solid ${alpha(C.text, '1a')}`, borderRadius: 4 }}>⇣</span>
        <span role="button" tabIndex={0} title="Collapse every open result in this card" onClick={() => { setFull(false); setSignal(n => n + 1) }}
              style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: C.dim, cursor: 'pointer', padding: '0 4px', userSelect: 'none',
                       border: `1px solid ${alpha(C.text, '1a')}`, borderRadius: 4 }}>⇡</span>
        <CopyBtn get={() => groupText(g)} title="Copy this card" />
      </div>
      {g.error && <div style={{ fontFamily: MONO, fontSize: 11, color: C.amber }}>{g.error}</div>}
      {/* Every match is listed; a long group scrolls inside its card instead of stretching the page */}
      {g.splunk && <SplunkInline desc={g.splunk} accent={C.accent} setQuery={setQuery} />}
      {!g.splunk && <div style={g.items.length > SCROLL_AFTER && !full ? { maxHeight: ROW_PX * SCROLL_AFTER, overflowY: 'auto', marginRight: -6, paddingRight: 6 } : undefined}>
        {g.items.map((it, i) => <Item key={i} it={it} setQuery={setQuery} collapseSignal={signal} expandSignal={expandSig} uncapped={full} paused={inside} />)}
      </div>}
      {g.actions?.length > 0 && (
        // Card-level buttons, kept at the bottom edge of the card (sticky, so they stay in reach on a tall card)
        <div style={{ position: 'sticky', bottom: 0, zIndex: 2, display: 'flex', gap: 8, justifyContent: 'flex-end', margin: '10px -14px -12px',
                      padding: '9px 14px', background: C.panel, borderTop: `1px solid ${alpha(C.text, '12')}`, borderRadius: '0 0 10px 10px' }}>
          {g.actions.map((a, i) => (
            <a key={a.label} href={a.href} title={a.title} onClick={a.internal ? link(a.href) : undefined}
               style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.5, textDecoration: 'none', padding: '6px 14px', borderRadius: 6,
                        color: i === 0 ? C.bright : C.accent, background: i === 0 ? alpha(C.accent, '40') : alpha(C.accent, '10'),
                        border: `1px solid ${alpha(C.accent, i === 0 ? 'c0' : '70')}`, boxShadow: i === 0 ? `0 0 12px ${alpha(C.accent, '30')}` : 'none' }}>
              {a.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// A row expands in place and STAYS expanded: hovering it for a moment opens it, and only ▾ (or Esc, or a card's
// "collapse all") closes it. Nothing collapses when the pointer moves away, so the list never shifts under the
// pointer and several results can be open side by side for comparison. Opening a row near the bottom scrolls just
// far enough to show all of it.
const EDGE = 48            // stay clear of Chrome's link-preview bar at the bottom edge
const COLLAPSE_ALL = 'docket-search-collapse-all'

function scrollParent(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p
  }
  return document.scrollingElement
}

// Where the pointer is, so a row that closes by itself can keep the page still under it
const pointer = { x: 0, y: 0 }
if (typeof document !== 'undefined' && !window.__docketPointer) {
  window.__docketPointer = true
  document.addEventListener('mousemove', e => { pointer.x = e.clientX; pointer.y = e.clientY }, { passive: true })
}
const AUTO_CLOSE_S = 10
const PEEK_S = 2.5           // the warning before a hovered row fully expands
const PEEK_DWELL_MS = HOVER_INTENT_MS    // how long the pointer rests before the warning starts (shared with the graph panels)
const PEEK_PX = 46
// ANIM_MS (expand / collapse of a row's detail) comes from ui/motion with the other shared timings

// Height-animated container with three states: closed, peek (a few lines, for the "about to expand" warning), open
function Collapse({ mode, overlay, children }) {
  const ref = useRef(null)
  const [h, setH] = useState(0)                 // px, or 'auto' once fully open
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (mode === 'open') setH(el.scrollHeight)
    else if (mode === 'peek') setH(Math.min(PEEK_PX, el.scrollHeight))
    else if (h === 'auto') { setH(el.offsetHeight); requestAnimationFrame(() => requestAnimationFrame(() => setH(0))) }
    else setH(0)
  }, [mode])
  return (
    <div ref={ref} style={{ position: 'relative', height: h, overflow: 'hidden', transition: `height ${ANIM_MS}ms ${EASE}`, ...(h === 'auto' ? { height: 'auto' } : null) }}
         onTransitionEnd={e => { if (e.target === ref.current && e.propertyName === 'height' && mode === 'open') setH('auto') }}>
      {children}
      {overlay}
    </div>
  )
}

// One row behind a count (a ticket, an AAP job): it opens its own page in a new tab. A span, not an anchor, because
// the row it sits in is already a link (the person search); clicks here never reach that link.
function ChildRow({ c, setQuery }) {
  // A row with `search` runs that search (a host a note names); one with `href` opens it
  const act = c.search && setQuery ? 'search' : c.href ? 'open' : null
  const go = e => { e.preventDefault(); e.stopPropagation(); if (act === 'search') setQuery(c.search); else if (act) window.open(c.href, '_blank', 'noopener,noreferrer') }
  return (
    <div style={{ padding: '3px 0 3px 12px', borderLeft: `2px solid ${alpha(C.text, '1a')}`, marginBottom: 2 }}>
      <span role={act ? 'link' : undefined} tabIndex={act ? 0 : undefined} onClick={act ? go : e => e.stopPropagation()}
            onKeyDown={act ? e => { if (e.key === 'Enter') go(e) } : undefined}
            title={act === 'search' ? `Search ${c.search}` : act ? `Open ${c.href}` : undefined}
            style={{ fontSize: 12, color: c.muted ? C.dim : act ? C.accent : C.muted, cursor: act ? 'pointer' : 'default',
                     textDecoration: act ? 'underline' : 'none', textDecorationColor: alpha(C.accent, '55'), overflowWrap: 'anywhere' }}>
        {c.title}{act === 'search' ? ' ⌕' : act ? ' ↗' : ''}
      </span>
      {c.subtitle && <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>{c.subtitle}</div>}
    </div>
  )
}

function Item({ it, setQuery, collapseSignal, expandSignal, uncapped, paused }) {
  // Hovering a row opens it for AUTO_CLOSE_S seconds (a radial countdown on its arrow); the arrow pins it open.
  // Pinned rows stay until closed (arrow, Esc, or the card's collapse-all). The countdown waits while the pointer
  // is inside the card, so a row never closes under a pointer that is reading around it.
  const hasMore = !!it.detail || !!it.children?.length     // a detail block, or child rows (the tickets or jobs behind a count)
  const [auto, setAuto] = useState(0)          // 0 = not auto-open; else a counter that restarts the countdown
  const [pinned, setPinned] = useState(false)
  const [peek, setPeek] = useState(false)       // the warning stage: a few lines, fading, a sweep filling toward full expansion
  const open = auto > 0 || pinned
  const [everOpen, setEverOpen] = useState(false)   // detail stays mounted after the first open so it can animate shut
  useEffect(() => { if (open || peek) setEverOpen(true) }, [open, peek])
  const ref = useRef(null)
  const titleRef = useRef(null)
  const subRef = useRef(null)
  const timer = useRef(null)
  const anchor = useRef(null)
  // Closing may move the rows below it. Measure what is under the pointer before, and put it back after.
  const closeAll = () => {
    const under = document.elementFromPoint(pointer.x, pointer.y)?.closest('a')
    anchor.current = under && !ref.current?.contains(under) ? { el: under, top: under.getBoundingClientRect().top } : null
    setAuto(0)
    setPinned(false)
    setPeek(false)
  }
  // The collapse animates (ANIM_MS), so follow the anchor frame by frame while it plays
  useEffect(() => {
    const k = anchor.current
    if (!k || open) return undefined
    anchor.current = null
    const t0 = performance.now()
    let raf
    const tick = () => {
      if (k.el.isConnected) {
        const drift = k.el.getBoundingClientRect().top - k.top
        const sp = scrollParent(k.el)
        if (sp && Math.abs(drift) > 0.5) sp.scrollTop += drift
      }
      if (performance.now() - t0 < ANIM_MS + 80) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])
  // Hover intent: a row opens after a short dwell, so sweeping down the list does not open every row on the way
  // Only a row with more to show reacts: it has a detail block, or its title or subtitle is cut off (measured now,
  // so a resized window is handled). A row that already fits on one line does nothing on hover.
  const needsMore = () => {
    const cut = el => !!el && el.scrollWidth > el.clientWidth + 1
    return hasMore || cut(titleRef.current) || cut(subRef.current)
  }
  // A row with a detail block warns first: after a short rest it peeks open (PEEK_S), and only then opens fully and
  // starts its countdown. Moving off during the warning cancels it. A row with nothing but cut-off text just opens.
  const enter = () => {
    clearTimeout(timer.current)
    if (open || peek || !needsMore()) return
    if (hasMore) setEverOpen(true)      // mount the (closed) detail now so the peek can animate from zero
    timer.current = setTimeout(() => (hasMore ? setPeek(true) : setAuto(n => n + 1)), PEEK_DWELL_MS)
  }
  const leave = () => { clearTimeout(timer.current); if (peek) setPeek(false) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    window.addEventListener(COLLAPSE_ALL, closeAll)
    return () => window.removeEventListener(COLLAPSE_ALL, closeAll)
  })
  useEffect(() => { if (collapseSignal) closeAll() }, [collapseSignal])
  // The card's "expand all": rows with more to show open and stay pinned (a countdown would close them all again),
  // and they do not each scroll themselves into view.
  const bulk = useRef(false)
  useEffect(() => {
    if (expandSignal && needsMore()) { bulk.current = true; setPinned(true); setAuto(0); setPeek(false) }
  }, [expandSignal])
  useEffect(() => {
    if (!open) return undefined
    if (bulk.current) { bulk.current = false; return undefined }
    const t = setTimeout(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 160)
    return () => clearTimeout(t)
  }, [open])
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const cut = el => !!el && el.scrollWidth > el.clientWidth + 1
    if (!open) setClipped(cut(titleRef.current) || cut(subRef.current))
  })
  const expandable = hasMore || open || clipped
  const dot = STATUS[it.status]
  const pivot = it.search && !it.href
  const onClick = e => {
    if (!it.href && !it.search) { e.preventDefault(); return }      // nothing to open: a bare '#' used to open a new, empty Docket tab
    if (pivot) { e.preventDefault(); setQuery(it.search) }
    else if (it.internal) link(it.href)(e)
  }
  return (
    <a ref={ref} href={it.href ?? '#'} onClick={onClick} target={it.internal || pivot || (!it.href && !it.search) ? undefined : '_blank'} rel="noreferrer"
       onMouseEnter={enter} onMouseLeave={leave}
       style={{
         display: 'block', padding: '6px 8px', marginLeft: it.indent ? 16 : 0, borderRadius: 6,
         scrollMarginBottom: EDGE, background: open ? alpha(C.text, 0.04) : 'transparent', textDecoration: 'none',
       }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
        <span ref={titleRef} style={{ fontSize: it.indent ? 12 : 13, color: open ? C.bright : it.indent ? C.muted : C.text, flex: 1, minWidth: 0,
                       ...(open ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
          {it.title}
        </span>
        <CopyBtn get={() => itemText(it)} title="Copy this result" style={{ opacity: open ? 1 : 0.35 }} />
        {auto > 0 && !pinned && (
          <span role="button" tabIndex={0} title="Close this result now"
                onClick={e => { e.preventDefault(); e.stopPropagation(); closeAll() }}
                style={{ width: 18, height: 18, flexShrink: 0, cursor: 'pointer', display: 'inline-flex' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: 'block' }}>
              <circle cx="9" cy="9" r="8.5" fill="none" stroke={alpha(C.text, '1a')} />
              <path d="M6.5 6.5 L11.5 11.5 M11.5 6.5 L6.5 11.5" stroke={C.dim} strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
        )}
        {expandable && (
          <span role="button" tabIndex={0}
                title={pinned ? 'Pinned open: click to close' : auto ? `Closes by itself in ${AUTO_CLOSE_S} s: click to pin it open` : 'Click to open and pin (hovering opens it for a few seconds)'}
                onClick={e => { e.preventDefault(); e.stopPropagation(); if (pinned) closeAll(); else { setPinned(true); setAuto(0); setPeek(false) } }}
                style={{ width: 18, height: 18, flexShrink: 0, cursor: 'pointer', display: 'inline-flex' }}>
            {/* one 18x18 drawing: outline or countdown ring, and the triangle centred on its own middle */}
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: 'block' }}>
              {pinned && <rect x="0.5" y="0.5" width="17" height="17" rx="4" fill={alpha(C.accent, '30')} stroke={alpha(C.accent, '90')} />}
              {!pinned && auto === 0 && <circle cx="9" cy="9" r="8.5" fill="none" stroke={alpha(C.text, '1a')} />}
              {!pinned && auto > 0 && (
                <g key={auto} transform="rotate(-90 9 9)">
                  <circle cx="9" cy="9" r="7.5" fill="none" stroke={alpha(C.text, '1a')} strokeWidth="1.5" />
                  <circle cx="9" cy="9" r="7.5" fill="none" stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray="100"
                          onAnimationEnd={closeAll}
                          style={{ animation: `rowsweep ${AUTO_CLOSE_S}s linear forwards`, animationPlayState: paused ? 'paused' : 'running' }} />
                </g>
              )}
              <polygon fill={pinned ? C.bright : open ? C.accent : C.dim}
                       points={open ? '5.5,7.2 12.5,7.2 9,11.7' : '7.2,5.5 7.2,12.5 11.7,9'} />
            </svg>
          </span>
        )}
        {it.badge && (
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.red, border: `1px solid ${alpha(C.red, '60')}`,
                         borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>{it.badge}</span>
        )}
        {it.search && it.href && (
          <span onClick={e => { e.preventDefault(); e.stopPropagation(); setQuery(it.search) }} title={`search ${it.search}`}
                style={{ fontFamily: MONO, fontSize: 10, color: C.dim, border: `1px solid ${alpha(C.text, '1a')}`, borderRadius: 4,
                         padding: '0 5px', cursor: 'pointer', flexShrink: 0 }}>⌕</span>
        )}
      </div>
      {it.subtitle && (
        <div ref={subRef} style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 2, marginLeft: dot ? 15 : 0,
                      ...(open ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
          {it.subtitle}
        </div>
      )}
      {hasMore && (everOpen || open || peek) && (
        <Collapse mode={open ? 'open' : peek ? 'peek' : 'closed'} overlay={peek && !open && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {/* the text fades down toward the part that is about to open */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 34, background: `linear-gradient(to bottom, transparent, ${C.panel} 80%)` }} />
            {/* a small tab at the bottom centre: it grows in with a slight bounce, fills slowly as the warning runs,
                and clicking it pins the row open like the arrow does */}
            <span role="button" tabIndex={0} title="Keep hovering to expand, or click to pin it open"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setPinned(true); setAuto(0); setPeek(false) }}
                  style={{ position: 'absolute', left: '50%', bottom: 3, marginLeft: -42, width: 84, height: 18, borderRadius: 9, overflow: 'hidden',
                           display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', cursor: 'pointer',
                           fontFamily: MONO, fontSize: 10, color: C.accent, background: alpha(C.accent, '14'), border: `1px solid ${alpha(C.accent, '55')}`,
                           animation: 'tabgrow 380ms cubic-bezier(.3,1.4,.5,1) both' }}>
              <span onAnimationEnd={() => { setPeek(false); setAuto(n => n + 1) }}
                    style={{ position: 'absolute', inset: 0, background: alpha(C.accent, '30'), transformOrigin: 'left',
                             animation: `tabfill ${PEEK_S}s linear forwards` }} />
              <span style={{ position: 'relative' }}>expand ▾</span>
            </span>
          </div>
        )}>
          <div style={{ position: 'relative', opacity: open || peek ? 1 : 0, transition: `opacity ${ANIM_MS}ms ease` }}>
            {it.detail && (
              <pre style={{ fontFamily: MONO, fontSize: 11, color: C.muted, margin: '6px 0 0', whiteSpace: 'pre-wrap',
                            maxHeight: uncapped ? 'none' : '50vh', overflowY: uncapped ? 'visible' : 'auto' }}>{it.detail}</pre>
            )}
            {it.children?.length > 0 && (
              <div style={{ margin: '6px 0 0', maxHeight: uncapped ? 'none' : '50vh', overflowY: uncapped ? 'visible' : 'auto' }}>
                {it.children.map((c, i) => <ChildRow key={i} c={c} setQuery={setQuery} />)}
              </div>
            )}
          </div>
        </Collapse>
      )}
    </a>
  )
}
