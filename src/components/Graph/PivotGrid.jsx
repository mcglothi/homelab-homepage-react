import { useEffect, useMemo, useRef, useState } from 'react'
import { C, MONO, alpha } from '../../ui/theme'
import { Button, Pill } from '../../ui/primitives'
import { useGraphTheme } from './theme'
import { DEFAULT_COLS, FACET, FACETS, indexGraph, outliers, rowsOf, valueOf } from './facts'

// The result set as a table of attributes: rows are hosts, columns are facts you choose. Sort, group, collapse into
// counts (a pivot), spot outliers, and send a cell or group to the graph as a comparison. Same data as the graph.
const ROW_H = 27
const cache = new Map()
async function load(q) {
  const hit = cache.get(q)
  if (hit && Date.now() - hit.t < 60000) return hit.j
  const r = await fetch(`/api/graph?q=${encodeURIComponent(q)}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  cache.set(q, { t: Date.now(), j })
  return j
}
const hatch = { backgroundImage: `repeating-linear-gradient(45deg, ${alpha(C.dim, '40')} 0 3px, transparent 3px 7px)` }
const trunc = (s, n = 34) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s))

export default function PivotGrid({ q, onOpenGraph }) {
  const T = useGraphTheme()
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState(null)
  const [cols, setCols] = useState(DEFAULT_COLS)
  const [sort, setSort] = useState({ key: null, dir: 1 })
  const [groupBy, setGroupBy] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [mode, setMode] = useState('rows')
  const [pv, setPv] = useState({ r: 'cluster', c: 'os' })
  const [picker, setPicker] = useState(false)
  const [flow, setFlow] = useState(true)
  const [top, setTop] = useState(0)
  const box = useRef(null)

  useEffect(() => {
    let dead = false
    setRaw(null); setError(null)
    load(q).then(j => { if (!dead) setRaw(j) }).catch(e => { if (!dead) setError(e.message) })
    return () => { dead = true }
  }, [q])

  const ix = useMemo(() => (raw ? indexGraph(raw) : null), [raw])
  const rows = useMemo(() => (raw ? rowsOf(raw, ix) : []), [raw, ix])
  // every cell value once
  const cell = useMemo(() => {
    const m = new Map()
    for (const r of rows) m.set(r.id, Object.fromEntries(FACETS.map(f => [f.key, valueOf(ix, r.node, f)])))
    return m
  }, [rows, ix])
  const val = (r, k) => cell.get(r.id)?.[k]?.v ?? null

  // a color per distinct value of a column: the commonest values get the theme's palette, the rest stay quiet
  const palette = useMemo(() => {
    const out = {}
    for (const k of new Set([...cols, groupBy, pv.r, pv.c].filter(Boolean))) {
      const count = new Map()
      rows.forEach(r => { const v = val(r, k); if (v != null) count.set(v, (count.get(v) || 0) + 1) })
      const f = FACET[k]
      out[k] = new Map([...count.entries()].sort((a, b) => b[1] - a[1]).map(([v], i) => [v, f?.flag ? (v === 'yes' ? T.green : T.dim) : i < T.comm.length ? T.comm[i] : T.muted]))
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, groupBy, pv, T, cell])

  const sorted = useMemo(() => {
    const key = sort.key
    const list = rows.slice()
    list.sort((a, b) => {
      const av = key ? val(a, key) : a.node.label, bv = key ? val(b, key) : b.node.label
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sort.dir
    })
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, cell])

  // rows plus group headers, flattened for the windowed list
  const flat = useMemo(() => {
    if (!groupBy) return sorted.map(r => ({ row: r }))
    const g = new Map()
    sorted.forEach(r => { const v = val(r, groupBy) ?? '(missing)'; if (!g.has(v)) g.set(v, []); g.get(v).push(r) })
    const out = []
    for (const [v, list] of [...g.entries()].sort((a, b) => b[1].length - a[1].length)) {
      out.push({ head: v, list })
      if (!collapsed.has(v)) list.forEach(r => out.push({ row: r }))
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, groupBy, collapsed, cell])

  const odd = useMemo(() => (raw ? outliers(rows, ix, cols, groupBy || null) : []), [raw, rows, ix, cols, groupBy])

  // pivot counts: row facet x column facet
  const pivot = useMemo(() => {
    const rv = new Map(), cv = new Map(), cellIds = new Map()
    for (const r of rows) {
      const a = val(r, pv.r) ?? '(missing)', b = val(r, pv.c) ?? '(missing)'
      rv.set(a, (rv.get(a) || 0) + 1); cv.set(b, (cv.get(b) || 0) + 1)
      const k = a + '\u0000' + b
      if (!cellIds.has(k)) cellIds.set(k, [])
      cellIds.get(k).push(r.id)
    }
    const rl = [...rv.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
    const cl = [...cv.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 12)
    let max = 1
    cellIds.forEach(v => { max = Math.max(max, v.length) })
    return { rl, cl, cellIds, max, rv, cv }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pv, cell])

  if (error) return <div style={{ fontFamily: MONO, fontSize: 12, color: C.red }}>grid failed: {error}</div>
  if (!raw) return <div style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>building grid…</div>
  if (!rows.length) return <div style={{ fontFamily: MONO, fontSize: 12, color: C.dim }}>No hosts in this result. The grid lists hosts and VMs; try a host, team, cluster, subnet or pool.</div>

  const H = Math.min(520, flat.length * ROW_H + 30)
  const start = Math.max(0, Math.floor(top / ROW_H) - 6)
  const end = Math.min(flat.length, start + Math.ceil(H / ROW_H) + 12)
  const col = k => FACET[k]
  const colW = k => (FACET[k].flag ? 84 : k === 'os' ? 230 : k === 'seen' ? 100 : 170)
  const total = 200 + cols.reduce((a, k) => a + colW(k), 0)
  const th = { fontFamily: MONO, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.dim, padding: '0 8px', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }

  const Swatch = ({ k, v }) => <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: palette[k]?.get(v) || C.dim }} />
  const renderCell = (r, k) => {
    const c = cell.get(r.id)[k]
    const bad = (ix.conflicts.get(r.id) || []).find(x => x.col === k)
    const same = () => onOpenGraph(rows.filter(x => val(x, k) === (c?.v ?? null)).map(x => x.id))
    return (
      <div key={k} onClick={same} title={bad ? `Sources disagree: ${bad.detail}` : c ? `${c.v}: pick every row with this value in the graph` : 'no value in any source we have'}
        style={{ width: colW(k), flexShrink: 0, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, height: ROW_H - 3, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap',
          borderRadius: 4, ...(c ? {} : hatch), outline: bad ? `1px solid ${alpha(T.flag.conflict, '99')}` : 'none' }}>
        {c && <Swatch k={k} v={c.v} />}
        {c && <span style={{ fontSize: 12, color: FACET[k].flag && c.v === 'no' ? C.dim : C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</span>}
        {bad && <span style={{ color: T.flag.conflict, fontSize: 11 }}>⚠</span>}
      </div>
    )
  }
  const sel = { width: 'auto', maxWidth: 170, fontFamily: MONO, fontSize: 11, background: C.field, border: `1px solid ${C.line2}`, color: C.text, borderRadius: 6, padding: '3px 6px' }
  const facetSelect = (v, on, none) => (
    <select value={v} onChange={e => on(e.target.value)} style={sel}>
      {none && <option value="">{none}</option>}
      {FACETS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
    </select>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{rows.length} row{rows.length === 1 ? '' : 's'}{raw.truncated ? ' (capped)' : ''}</span>
        <Button size="sm" variant={mode === 'rows' ? 'primary' : 'default'} onClick={() => setMode('rows')}>Rows</Button>
        <Button size="sm" variant={mode === 'pivot' ? 'primary' : 'default'} onClick={() => setMode('pivot')}>Pivot counts</Button>
        {mode === 'rows' && <>
          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>GROUP BY</span>{facetSelect(groupBy, v => { setGroupBy(v); setCollapsed(new Set()) }, 'none')}
          <Button size="sm" variant={picker ? 'primary' : 'default'} onClick={() => setPicker(p => !p)}>Columns ({cols.length})</Button>
          {groupBy && <Button size="sm" onClick={() => setCollapsed(c => (c.size ? new Set() : new Set(flat.filter(f => f.head !== undefined).map(f => f.head))))}>{collapsed.size ? 'Expand all' : 'Collapse all'}</Button>}
        </>}
        {mode === 'pivot' && <>
          {facetSelect(pv.r, v => setPv(p => ({ ...p, r: v })))}<span style={{ color: C.dim }}>×</span>{facetSelect(pv.c, v => setPv(p => ({ ...p, c: v })))}
        </>}
        {rows.length >= 20 && <Button size="sm" variant={flow ? 'primary' : 'default'} onClick={() => setFlow(f => !f)}>Flow</Button>}
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => onOpenGraph(rows.map(r => r.id).slice(0, 60))} title="Show these in the graph as a comparison (the first 60)">All in graph</Button>
      </div>

      {picker && mode === 'rows' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {FACETS.map(f => <Pill key={f.key} color={cols.includes(f.key) ? C.accent : C.dim} solid={cols.includes(f.key)} onClick={() => setCols(c => (c.includes(f.key) ? c.filter(x => x !== f.key) : [...c, f.key]))}>{f.label}</Pill>)}
        </div>
      )}

      {odd.length > 0 && (
        <div style={{ marginBottom: 8, padding: '7px 10px', border: `1px solid ${alpha(C.amber, '55')}`, borderRadius: 8, background: alpha(C.amber, '0c'), fontSize: 12, lineHeight: 1.6, color: C.body }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.amber }}>Outliers </span>
          {odd.map((o, i) => (
            <span key={i} style={{ display: 'block' }}>
              <a style={{ color: C.accent, cursor: 'pointer' }} onClick={() => onOpenGraph(o.ids)}>{trunc(o.names.slice(0, 3).join(', '), 60)}{o.ids.length > 3 ? ` +${o.ids.length - 3}` : ''}</a>
              {' '}{o.facet.label}: {trunc(o.value, 40)}, while {o.share}% {o.group ? `of ${trunc(o.group, 24)} ` : 'of the rest '}have {trunc(o.majority, 40)}
            </span>
          ))}
        </div>
      )}

      {flow && rows.length >= 20 && (rows.filter(r => cell.get(r.id).cluster || cell.get(r.id).hv).length / rows.length >= 0.2
        ? <Flow rows={rows} cell={cell} T={T} onOpenGraph={onOpenGraph} />
        : <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 8 }}>Flow: most of these rows have no cluster or host in the data, so there is nothing to follow.</div>)}

      {mode === 'pivot' ? (
        <div style={{ overflow: 'auto', maxHeight: 520, border: `1px solid ${alpha(C.accent, '25')}`, borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left', cursor: 'default', padding: '6px 8px' }}>{FACET[pv.r].label} \ {FACET[pv.c].label}</th>
              {pivot.cl.map(c => <th key={c} style={{ ...th, textAlign: 'right', cursor: 'default' }} title={c}>{trunc(c, 18)}</th>)}
              <th style={{ ...th, textAlign: 'right', cursor: 'default' }}>Total</th>
            </tr></thead>
            <tbody>
              {pivot.rl.map(rv => (
                <tr key={rv} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6, background: palette[pv.r]?.get(rv) || C.dim }} />{trunc(rv, 40)}</td>
                  {pivot.cl.map(cv => {
                    const ids = pivot.cellIds.get(rv + '\u0000' + cv)
                    return <td key={cv} onClick={() => ids && onOpenGraph(ids.slice(0, 60))} title={ids ? `${ids.length}: pick them in the graph` : ''}
                      style={{ textAlign: 'right', padding: '4px 8px', cursor: ids ? 'pointer' : 'default', background: ids ? alpha(C.accent, Math.round(8 + 45 * ids.length / pivot.max).toString(16).padStart(2, '0')) : 'transparent', color: ids ? C.bright : C.dim }}>{ids ? ids.length : '·'}</td>
                  })}
                  <td style={{ textAlign: 'right', padding: '4px 8px', color: C.muted }}>{pivot.rv.get(rv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ border: `1px solid ${alpha(C.accent, '25')}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: total }}>
              <div style={{ display: 'flex', height: 28, alignItems: 'center', borderBottom: `1px solid ${C.line}`, background: alpha(C.panel2, 'cc') }}>
                <div onClick={() => setSort(s => ({ key: null, dir: s.key === null ? -s.dir : 1 }))} style={{ ...th, width: 200, flexShrink: 0 }}>Host{sort.key === null ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</div>
                {cols.map(k => (
                  <div key={k} onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : 1 }))} style={{ ...th, width: colW(k), flexShrink: 0 }}>{col(k).label}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</div>
                ))}
              </div>
              <div ref={box} onScroll={e => setTop(e.currentTarget.scrollTop)} style={{ height: H - 28, overflowY: 'auto', position: 'relative' }}>
                <div style={{ height: flat.length * ROW_H, position: 'relative' }}>
                  {flat.slice(start, end).map((f, i) => {
                    const y = (start + i) * ROW_H
                    if (f.head !== undefined) {
                      const open = !collapsed.has(f.head)
                      return (
                        <div key={'h' + f.head} style={{ position: 'absolute', top: y, left: 0, right: 0, height: ROW_H - 2, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', background: alpha(C.accent, '10'), cursor: 'pointer', fontSize: 12 }}
                          onClick={() => setCollapsed(c => { const n = new Set(c); open ? n.add(f.head) : n.delete(f.head); return n })}>
                          <span style={{ color: C.dim }}>{open ? '▾' : '▸'}</span><Swatch k={groupBy} v={f.head} /><b style={{ fontWeight: 600 }}>{trunc(f.head, 60)}</b>
                          <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{f.list.length}</span>
                          <a style={{ color: C.accent, marginLeft: 'auto', fontSize: 11 }} onClick={e => { e.stopPropagation(); onOpenGraph(f.list.map(r => r.id).slice(0, 60)) }}>group in graph →</a>
                        </div>
                      )
                    }
                    const r = f.row
                    return (
                      <div key={r.id} style={{ position: 'absolute', top: y, left: 0, right: 0, height: ROW_H - 3, display: 'flex', alignItems: 'center', borderBottom: `1px solid ${alpha(C.line, '80')}` }}>
                        <div onClick={() => onOpenGraph([r.id])} title="Show in the graph" style={{ width: 200, flexShrink: 0, padding: '0 8px', fontFamily: MONO, fontSize: 11.5, color: C.accent, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.node.label}</div>
                        {cols.map(k => renderCell(r, k))}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 6 }}>Click a cell to pick every row with that value in the graph. ⚠ sources disagree · hatched = no value · patch status is not in the mirrors yet.</div>
    </div>
  )
}

// Flow strip: how the rows spread over datacenter, cluster and hypervisor host, as bands whose thickness is the count.
function Flow({ rows, cell, T, onOpenGraph }) {
  const order = ['dc', 'cluster', 'hv']
  const names = ['Datacenter', 'Cluster', 'Hypervisor host']
  const lay = useMemo(() => {
    const W = 900, H = 190, pad = 6, colX = [0, 340, 680], bw = 12
    const cols = order.map(k => {
      const m = new Map()
      rows.forEach(r => { const v = cell.get(r.id)[k]?.v ?? '—'; if (!m.has(v)) m.set(v, []); m.get(v).push(r.id) })
      let list = [...m.entries()].sort((a, b) => b[1].length - a[1].length)
      if (list.length > 8) { const rest = list.slice(7).flatMap(e => e[1]); list = [...list.slice(0, 7), ['other', rest]] }
      return list
    })
    const scale = (H - pad * 8) / rows.length
    const nodes = cols.map((list, ci) => {
      let y = pad
      return list.map(([v, ids], i) => { const h = Math.max(3, ids.length * scale); const n = { v, ids, ci, i, x: colX[ci], y, h, c: T.comm[i % T.comm.length] }; y += h + pad; return n })
    })
    const find = (ci, id) => nodes[ci].find(n => n.ids.includes(id))
    const flows = []
    for (let ci = 0; ci < 2; ci++) {
      const m = new Map()
      rows.forEach(r => { const a = find(ci, r.id), b = find(ci + 1, r.id); if (!a || !b) return; const k = a.i + '|' + b.i; m.set(k, [...(m.get(k) || []), r.id]) })
      const offA = new Map(), offB = new Map()
      for (const [k, ids] of [...m.entries()].sort()) {
        const [ai, bi] = k.split('|').map(Number)
        const a = nodes[ci][ai], b = nodes[ci + 1][bi]
        const t = Math.max(1.5, ids.length * scale)
        const ya = a.y + (offA.get(a.i) || 0) + t / 2, yb = b.y + (offB.get(b.i + ':' + ci) || 0) + t / 2
        offA.set(a.i, (offA.get(a.i) || 0) + t); offB.set(b.i + ':' + ci, (offB.get(b.i + ':' + ci) || 0) + t)
        flows.push({ ids, t, d: `M${a.x + bw},${ya} C${a.x + 170},${ya} ${b.x - 160},${yb} ${b.x},${yb}`, c: a.c })
      }
    }
    return { W, H, nodes, flows, bw }
  }, [rows, cell, T])
  return (
    <div style={{ marginBottom: 10, border: `1px solid ${alpha(C.accent, '25')}`, borderRadius: 8, padding: '6px 8px 2px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: 'uppercase' }}>
        {names.map((n, i) => <span key={n} style={{ width: '33%', textAlign: i === 2 ? 'right' : 'left' }}>{n}</span>)}
      </div>
      <svg viewBox={`0 0 ${lay.W + 240} ${lay.H}`} style={{ width: '100%', height: 'auto', maxHeight: 220, display: 'block' }}>
        {lay.flows.map((f, i) => <path key={i} d={f.d} fill="none" stroke={f.c} strokeOpacity={0.32} strokeWidth={f.t} style={{ cursor: 'pointer' }} onClick={() => onOpenGraph(f.ids.slice(0, 60))}><title>{f.ids.length} rows</title></path>)}
        {lay.nodes.flat().map(n => (
          <g key={n.ci + n.v} style={{ cursor: 'pointer' }} onClick={() => onOpenGraph(n.ids.slice(0, 60))}>
            <rect x={n.x} y={n.y} width={lay.bw} height={n.h} rx={2} fill={n.c} />
            <text x={n.x + lay.bw + 6} y={n.y + Math.min(n.h, 14) / 2 + 4} fontSize="11" fill={C.text} fontFamily="Manrope, system-ui, sans-serif">{trunc(n.v, 26)} <tspan fill={C.dim}>{n.ids.length}</tspan></text>
            <title>{n.v}: {n.ids.length} rows</title>
          </g>
        ))}
      </svg>
    </div>
  )
}
