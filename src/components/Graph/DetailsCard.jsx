import { useEffect, useMemo, useRef, useState } from 'react'
import { C, MONO, alpha } from '../../ui/theme'
import { Button } from '../../ui/primitives'
import { EASE } from '../../ui/motion'
import { KIND, agoText, ageDays as recAge, isDated } from './analysis'
import { relation } from './relations'
import { link } from '../../router'

// The Details card. For the selected node it puts what matters first: a compact header with a few key facts, the actions
// pinned at the top, and the relations sorted into sections (People, Servers, ...) whose order depends on the kind of node.
// Edit SECTION_ORDER to change what leads for each kind. Each section opens/closes smoothly, shows its top rows by relevance
// and "Show all N" for the rest; what you open or close is remembered per kind of node.

const SECTIONS = {
  people: { label: 'People', facet: 'people' },
  teams: { label: 'Teams & groups', facet: 'groups' },
  servers: { label: 'Servers & infrastructure', facet: 'servers' },
  network: { label: 'Network', facet: 'network' },
  automation: { label: 'Automation', facet: 'work' },
  tickets: { label: 'Tickets & changes', facet: 'work' },
  other: { label: 'Other sources', facet: 'found' },
}
// which section leads, by the kind of node selected (first = top)
export const SECTION_ORDER = {
  person: ['people', 'teams', 'tickets', 'servers', 'automation', 'network', 'other'],
  host: ['servers', 'network', 'people', 'teams', 'automation', 'tickets', 'other'],
  hv: ['servers', 'network', 'people', 'teams', 'automation', 'tickets', 'other'],
  team: ['people', 'servers', 'tickets', 'automation', 'teams', 'network', 'other'],
  group: ['people', 'servers', 'tickets', 'automation', 'teams', 'network', 'other'],
  network: ['servers', 'network', 'teams', 'people', 'automation', 'tickets', 'other'],
  job: ['automation', 'servers', 'teams', 'people', 'tickets', 'network', 'other'],
  run: ['automation', 'servers', 'teams', 'people', 'tickets', 'network', 'other'],
  playbook: ['automation', 'servers', 'teams', 'people', 'tickets', 'network', 'other'],
  inventory: ['servers', 'automation', 'teams', 'people', 'tickets', 'network', 'other'],
  project: ['automation', 'servers', 'teams', 'people', 'tickets', 'network', 'other'],
  credential: ['automation', 'servers', 'teams', 'people', 'tickets', 'network', 'other'],
  ticket: ['people', 'servers', 'teams', 'tickets', 'automation', 'network', 'other'],
  cluster: ['servers', 'people', 'teams', 'network', 'automation', 'tickets', 'other'],
  dc: ['servers', 'people', 'teams', 'network', 'automation', 'tickets', 'other'],
  pool: ['servers', 'people', 'teams', 'network', 'automation', 'tickets', 'other'],
}
const DEFAULT_ORDER = ['people', 'servers', 'teams', 'network', 'automation', 'tickets', 'other']

// the section a relation row belongs to is decided by what is on the other end
const CLASS_OF = { person: 'people', team: 'teams', group: 'teams', host: 'servers', hv: 'servers', cluster: 'servers', dc: 'servers', pool: 'servers', network: 'network',
  job: 'automation', run: 'automation', playbook: 'automation', project: 'automation', credential: 'automation', inventory: 'automation', ticket: 'tickets' }
// an AAP template keeps the hosts it targets in its Automation section, between the inventory and the credentials
const classOf = (other, e, node) => (e.kind === 'found' ? 'other' : node?.kind === 'playbook' && (other.kind === 'host' || other.kind === 'hv') ? 'automation' : CLASS_OF[other.kind] || 'other')
// the order of an AAP template's Automation rows: playbook, project, inventory, hosts, credentials, workflows and jobs that call it, then runs
const templateRank = (text, o) => text === 'Runs' ? 0 : text === 'Uses' ? ({ project: 1, inventory: 2, credential: 4 }[o.kind] ?? 3) : text === 'Targets' ? 3 : text === 'Called by' || text === 'Calls' ? 5 : text === 'Had run' ? 6 : 7

// within a section: the relations that say most about the node come first
const PRIORITY = ['Reports to', 'Managed by', 'Manages', 'Owned by', 'Owns', 'Runs on', 'Member of cluster', 'Located in', 'In subnet', 'In inventory', 'Has member', 'Member of', 'Run by',
  'Runs', 'Uses', 'Used by', 'Contains', 'Hosts', 'Targets', 'Targeted by', 'Calls', 'Called by', 'Had run', 'Run of', 'Possible owner', 'Possible owner of', 'Named on', 'Names']
const GLYPH = { person: '◍', team: '▣', group: '▣', host: '▭', hv: '▭', cluster: '⬡', dc: '⌂', network: '⌁', job: '⚙', run: '⚙', playbook: '⚙', project: '⎇', credential: '⚿', inventory: '☰', ticket: '✎', pool: '▭' }
const attr = (n, k) => (n.attrs || []).find(a => a[0] === k)?.[1]
const ageDays = n => { const m = /\((\d+)d ago\)/.exec(String(attr(n, 'Detail') || '')); return m ? +m[1] : 9999 }
const isOpenTicket = n => !/done|closed|resolved/i.test(String(attr(n, 'Status') || ''))

const KEY = 'docket.graph.details.v1'
const loadOpen = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch (e) { return {} } }
const FACTS = ['Playbook', 'Inventory', 'Project', 'Last success', 'Title', 'Login', 'Type', 'OS (CMDB)', 'Environment', 'App tier', 'Status', 'Power (Prism)', 'Hosts named for them', 'Role / team AD groups', 'Comment', 'Building']

export default function DetailsCard({ node, model, raw, rawById, byId, select, theme, info, picked, onCompare, pinned, onUnpin, onReveal, isoId, onIsolate, onSearch, onCenter, focus, search, onHoverNode }) {
  const [openMap, setOpenMap] = useState(loadOpen)
  const [attrsOpen, setAttrsOpen] = useState(false)
  const [sigOpen, setSigOpen] = useState(false)
  const [more, setMore] = useState({})        // section id -> how many rows are shown (beyond the top few)
  const [find, setFind] = useState({})
  const refs = useRef({})
  useEffect(() => { setSigOpen(false); setAttrsOpen(false); setMore({}); setFind({}) }, [node?.id])

  const edges = node && (node.more || !raw ? model.edges : raw.edges)
  const lookup = id => byId.get(id) ?? rawById?.get(id)
  const sections = useMemo(() => {
    if (!node) return []
    const rows = {}
    ;(edges || []).forEach(e => {
      if (e.a !== node.id && e.b !== node.id) return
      const up = e.b === node.id
      const o = lookup(up ? e.a : e.b)
      if (!o) return
      const r = relation(e, up)
      const cls = classOf(o, e, node)
      ;(rows[cls] ??= []).push({ e, o, up, text: r.text, weak: r.weak, folded: !byId.has(o.id) })
    })
    const pri = t => { const i = PRIORITY.indexOf(t); return i < 0 ? 50 : i }
    Object.entries(rows).forEach(([cls, list]) => list.sort((x, y) => {
      if (cls === 'tickets') return (isOpenTicket(y.o) - isOpenTicket(x.o)) || (ageDays(x.o) - ageDays(y.o))
      if (node.kind === 'playbook' && cls === 'automation') { const d = templateRank(x.text, x.o) - templateRank(y.text, y.o); if (d) return d }
      return (x.weak - y.weak) || (pri(x.text) - pri(y.text)) || ((y.o.result ? 1 : 0) - (x.o.result ? 1 : 0)) || String(x.o.label).localeCompare(String(y.o.label))
    }))
    let order = (SECTION_ORDER[node.kind] || DEFAULT_ORDER).slice()
    if (focus && focus.size) order = [...order.filter(id => focus.has(SECTIONS[id].facet)), ...order.filter(id => !focus.has(SECTIONS[id].facet))]   // the focused kinds lead
    return order.filter(id => rows[id]?.length).map(id => ({ id, ...SECTIONS[id], rows: rows[id] }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, edges, byId, rawById, focus])

  if (!node) return <div style={{ fontSize: 12, color: C.muted, margin: '14px 0 4px', lineHeight: 1.5 }}>Click a node: its neighbors join the graph and its relations show here, most relevant first, with where each link comes from and any disagreement between sources. The trail above lets you go back.</div>

  // open by default: the first two sections, and the next ones while the card stays short; the focused kinds always
  const defaultOpen = id => {
    let total = 0
    for (let i = 0; i < sections.length; i++) { total += sections[i].rows.length; if (sections[i].id === id) return i < 2 || total <= 6 }
    return false
  }
  const isOpen = id => { const m = openMap[node.kind]; return m && id in m ? m[id] : !!(defaultOpen(id) || (focus && focus.size && focus.has(SECTIONS[id].facet))) }
  const toggle = id => setOpenMap(m => { const n = { ...m, [node.kind]: { ...(m[node.kind] || {}), [id]: !isOpen(id) } }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch (e) { /* storage blocked */ } return n })
  const jump = id => { if (!isOpen(id)) toggle(id); setTimeout(() => refs.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60) }
  const kindColor = theme.kind[node.kind]
  const facts = FACTS.map(k => [k, attr(node, k)]).filter(([, v]) => v && v !== '—').slice(0, 4)
  const allAttrs = (node.attrs || []).filter(a => a[1] != null && a[1] !== '')
  const isoHere = isoId && isoId === node.id

  return (
    <div>
      {/* pinned: the actions never scroll away; the section chips jump to a section */}
      <div style={{ position: 'sticky', top: 0, zIndex: 3, margin: '0 -12px', padding: '8px 12px 6px', background: alpha(C.panel, 0.98), borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={onCenter} title="Center the camera on the selected node">Center</Button>
          <Button size="sm" variant={isoHere ? 'primary' : 'default'} onClick={() => onIsolate(isoHere ? null : node.id)} title="Isolate: show only this node and its neighbors">{isoHere ? '✓ Isolated' : 'Isolate'}</Button>
          <Button size="sm" variant="primary" disabled={!onSearch} onClick={() => onSearch(node.id)} title="Search for this: run a new search and redraw the graph">Search for this</Button>
          {node.kind === 'note' && (() => { const href = node.attrs?.find(([k]) => k === 'Open')?.[1]
            return href && <Button size="sm" onClick={link(href)} title="Open the note in the AIKB viewer">Open note</Button> })()}
          <Button size="sm" variant={picked ? 'primary' : 'default'} onClick={onCompare} title="Add this node to the compare tray (Shift-click does the same)">{picked ? '✓ In compare' : '+ Compare'}</Button>
        </div>
        {sections.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
            {sections.map(s => (
              <a key={s.id} onClick={() => jump(s.id)} title={`Jump to ${s.label}`} style={{ cursor: 'pointer', fontFamily: MONO, fontSize: 10, padding: '1px 7px', borderRadius: 10, border: `1px solid ${alpha(C.accent, isOpen(s.id) ? '70' : '30')}`, color: isOpen(s.id) ? C.bright : C.muted }}>
                {s.label.split(' ')[0]} {s.rows.length}
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: kindColor, fontFamily: MONO, marginTop: 8 }}>{KIND[node.kind] ?? node.kind}{node.more ? ' · collapsed' : ''}</div>
      <div style={{ fontSize: 15, fontWeight: 600, wordBreak: 'break-word', color: C.bright }}>{node.label}</div>
      <div style={{ fontSize: 11.5, color: C.muted }}>{node.sub}</div>
      {node.change && <div style={{ fontSize: 11.5, marginTop: 4, color: node.change === 'removed' ? C.amber : C.green }}>{node.change === 'removed' ? 'Removed' : 'Added'} since {node.change_since}</div>}
      {pinned && <div style={{ fontSize: 11.5, marginTop: 4, color: C.accent }}>● pinned where you dropped it <a onClick={onUnpin} style={{ cursor: 'pointer', textDecoration: 'underline' }}>unpin</a></div>}
      {info && info.total > info.shown && <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>Showing {info.shown} of {info.total} children. “Search for this” lists them from this node.</div>}
      {facts.length > 0 && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', margin: '6px 0 2px', fontSize: 11.5 }}>
          {facts.map(([k, v]) => [<dt key={'k' + k} style={{ color: C.dim }}>{k}</dt>, <dd key={'v' + k} style={{ margin: 0, fontFamily: MONO, wordBreak: 'break-word', color: C.text }}>{String(v)}</dd>])}
        </dl>
      )}
      {isDated(node) && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.text }} title="The newest dated activity that links this node to what you searched for (see LAYOUT.md, Recency)">
          <span style={{ color: C.dim }}>Last activity:</span> <span style={{ fontFamily: MONO }}>{node.last.slice(0, 10)}</span> <span style={{ color: C.muted }}>({agoText(recAge(node.last))}{recAge(node.last) < 1 ? '' : ' ago'})</span>
          {node.via ? <span style={{ color: C.muted }}> via {node.via}</span> : null}
          {node.sig && node.sig.length > 1 && (
            <div>
              <a onClick={() => setSigOpen(o => !o)} style={{ fontSize: 11, color: C.accent, cursor: 'pointer' }}>{sigOpen ? '▾' : '▸'} Signals ({node.sig.length})</a>
              <Collapse open={sigOpen}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 11.5, marginTop: 4 }}>
                  {node.sig.map((s, i) => [<span key={'d' + i} style={{ color: C.dim, fontFamily: MONO }}>{s.last.slice(0, 10)}</span>, <span key={'v' + i} style={{ color: C.text }}>{s.via} <span style={{ color: C.dim }}>· {s.src} · strength {s.s}</span></span>])}
                </div>
              </Collapse>
            </div>
          )}
        </div>
      )}
      {!isDated(node) && !node.more && node.kind !== 'query' && <div style={{ marginTop: 8, fontSize: 11, color: C.dim }}>No dated activity links this node to your search (it ranks after the dated ones).</div>}
      {allAttrs.length > 0 && (
        <div>
          <a onClick={() => setAttrsOpen(o => !o)} style={{ fontSize: 11, color: C.accent, cursor: 'pointer' }}>{attrsOpen ? '▾' : '▸'} Attributes ({allAttrs.length})</a>
          <Collapse open={attrsOpen}>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', margin: '6px 0', fontSize: 11.5 }}>
              {allAttrs.map(([k, v], i) => [<dt key={'k' + i} style={{ color: C.dim }}>{k}</dt>, <dd key={'v' + i} style={{ margin: 0, fontFamily: MONO, wordBreak: 'break-word', color: C.text }}>{/^https?:\/\//.test(String(v)) ? <a href={v} target="_blank" rel="noreferrer" style={{ color: C.accent }}>open ↗</a>
                : /^\/aikb\//.test(String(v)) ? <a href={v} onClick={link(v)} style={{ color: C.accent }}>open note</a> : String(v)}</dd>])}
            </dl>
          </Collapse>
        </div>
      )}

      {node.kind === 'concept' && <ConceptContext name={node.label} search={search} />}

      {sections.map(s => {
        const open = isOpen(s.id)
        const q = (find[s.id] || '').toLowerCase()
        const filtered = q ? s.rows.filter(r => r.o.label.toLowerCase().includes(q)) : s.rows
        const cap = more[s.id] || 5
        const shown = Math.min(filtered.length, cap)
        const rest = filtered.length - shown
        return (
          <div key={s.id} ref={el => { refs.current[s.id] = el }} style={{ marginTop: 10, borderTop: `1px solid ${C.line}` }}>
            <div onClick={() => toggle(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0 4px', cursor: 'pointer', userSelect: 'none' }}>
              <span aria-hidden style={{ color: C.dim, fontSize: 10, transition: `transform .2s ${EASE}`, transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: open ? C.bright : C.muted }}>{s.label}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{s.rows.length}</span>
            </div>
            <Collapse open={open}>
              {s.rows.length > 20 && <input value={find[s.id] || ''} onChange={e => setFind(f => ({ ...f, [s.id]: e.target.value }))} placeholder={`search ${s.rows.length} rows…`} aria-label={`Search ${s.label}`}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: MONO, fontSize: 11, background: C.field, border: `1px solid ${C.line2}`, borderRadius: 6, color: C.text, padding: '3px 7px', margin: '2px 0 4px', outline: 'none' }} />}
              {filtered.slice(0, shown).map((r, i) => <Row key={r.e.a + r.e.b + r.e.kind + i} r={r} select={select} onReveal={onReveal} theme={theme} onHoverNode={onHoverNode} />)}
              {rest > 0 && <a onClick={() => setMore(m => ({ ...m, [s.id]: cap <= 5 ? Math.min(60, filtered.length) : cap + 60 }))} style={{ fontSize: 11, color: C.accent, cursor: 'pointer' }}>
                {cap > 5 ? `Show ${Math.min(60, rest)} more` : filtered.length > 60 ? `${s.rows[0].text} ${filtered.length}: show` : `Show all ${filtered.length}`}</a>}
              {cap > 5 && <a onClick={() => setMore(m => ({ ...m, [s.id]: 5 }))} style={{ fontSize: 11, color: C.dim, cursor: 'pointer', marginLeft: 10 }}>show fewer</a>}
            </Collapse>
          </div>
        )
      })}
      {!sections.length && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>No links to this node in the data loaded.</div>}
    </div>
  )
}

// height animation without touching anything outside the card: the row of a grid goes between 0fr and 1fr
function Collapse({ open, children }) {
  const [ever, setEver] = useState(open)
  useEffect(() => { if (open) setEver(true) }, [open])
  return (
    <div aria-hidden={!open} style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transition: `grid-template-rows .26s ${EASE}, opacity .22s ${EASE}` }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{ever ? children : null}</div>
    </div>
  )
}

function ConceptContext({ name, search }) {
  const [state, setState] = useState({ loading: true, items: [] })
  useEffect(() => {
    let live = true
    setState({ loading: true, items: [] })
    fetch(`/api/kb/context?name=${encodeURIComponent(name)}&q=${encodeURIComponent(search || '')}`).then(async r => {
      const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || `${r.status}`); return body
    }).then(body => live && setState({ loading: false, items: body.items || [] })).catch(e => live && setState({ loading: false, items: [], error: e.message }))
    return () => { live = false }
  }, [name, search])
  return <div style={{ minHeight: 82, marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.muted }}>Where it's mentioned</div>
    {state.loading && <div style={{ fontSize: 11, color: C.dim, marginTop: 5 }}>Loading notes…</div>}
    {state.error && <div style={{ fontSize: 11, color: C.red, marginTop: 5 }}>{state.error}</div>}
    {!state.loading && !state.error && state.items.map(item => <div key={item.file + item.section} style={{ marginTop: 7, fontSize: 11.5 }}>
      <a onClick={link(`/aikb/note?path=${encodeURIComponent(item.file)}&section=${encodeURIComponent(item.section)}`)} style={{ color: C.accent, cursor: 'pointer' }}>{item.title} <span style={{ color: C.dim }}>· {item.section}</span></a>
      <div style={{ color: C.muted, marginTop: 2, lineHeight: 1.35 }}>{item.excerpt}</div>
    </div>)}
  </div>
}

function Row({ r, select, onReveal, theme, onHoverNode }) {
  const { e, o, up, folded, text } = r
  return (
    <div onMouseEnter={() => onHoverNode && onHoverNode(o.id)} onMouseLeave={() => onHoverNode && onHoverNode(null)}
      style={{ borderTop: `1px solid ${C.line}`, padding: '5px 0', fontSize: 12, display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span aria-hidden title={KIND[o.kind] ?? o.kind} style={{ color: theme.kind[o.kind], fontSize: 11, width: 12, textAlign: 'center' }}>{GLYPH[o.kind] || '●'}</span>
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.5 }} title={up ? 'the link points to this node' : 'the link points away from this node'}>{text}</span>
      {e.prov && e.prov !== 'extracted' && <span title={e.prov === 'ambiguous' ? 'Ambiguous: the source did not identify one unambiguous relation.' : 'Inferred: this relation was deduced from the available data.'} style={{ fontFamily: MONO, fontSize: 9, color: C.dim, border: `1px solid ${C.line}`, borderRadius: 4, padding: '0 3px' }}>{e.prov}</span>}
      <a onClick={() => (folded ? onReveal(o.id) : select(o.id))} title={folded ? 'Folded into a "+N more" group on screen: click to show it' : undefined} style={{ color: C.accent, cursor: 'pointer', minWidth: 0, wordBreak: 'break-word' }}>{o.label}</a>
      {folded && <span style={{ color: C.dim, fontSize: 10 }}>(folded)</span>}
      <span style={{ color: C.dim, fontSize: 11 }}>({e.flag === 'derived' ? 'joined by name or IP' : e.flag === 'inferred' ? 'inferred' : 'typed link'})</span>
      {e.flag === 'conflict' && <div style={{ flexBasis: '100%', border: `1px solid ${alpha(theme.flag.conflict, '88')}`, background: alpha(theme.flag.conflict, '22'), borderRadius: 7, padding: '4px 7px' }}>Sources disagree: {e.detail}</div>}
      {e.flag === 'missing' && <div style={{ flexBasis: '100%', border: `1px dashed ${theme.flag.missing}`, borderRadius: 7, padding: '4px 7px' }}>Expected a link here, but this source has no record.</div>}
      {e.flag === 'inferred' && <div style={{ flexBasis: '100%', border: `1px solid ${alpha(theme.flag.inferred, '88')}`, background: alpha(theme.flag.inferred, '22'), borderRadius: 7, padding: '4px 7px' }}>{e.detail}</div>}
    </div>
  )
}
