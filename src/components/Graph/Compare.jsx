import { useState } from 'react'
import { C, MONO, alpha } from '../../ui/theme'
import { Button, Pill } from '../../ui/primitives'

// The compare tray. Pick nodes with "+ Compare" in the details, a shift- or ctrl-click on a node, or "Compare with…" here.
// Picked nodes get a numbered badge in the graph. With two or more picked, the tray lists what they share (grouped by
// relation type, with counts), where they split and the odd one out; clicking a shared item lights up the paths to it.
const link = { color: C.accent, cursor: 'pointer' }
const sub = { fontSize: 10.5, color: C.dim, margin: '8px 0 2px', textTransform: 'uppercase', letterSpacing: 1 }
const trunc = (s, n = 30) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s))

export default function CompareTray({ ids, result, ix, shared, onShared, onSelect, onRemove, onClear, compareMode, setCompareMode, presets, onAdd, search, onPullIn }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const name = id => ix.byId.get(id)?.label ?? id
  const hits = q.trim().length >= 2 ? search(q.trim()) : []
  const pull = async () => { setBusy(true); await onPullIn(q.trim()); setBusy(false); setQ('') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 0 4px', flexWrap: 'wrap' }}>
        <Button size="sm" variant={compareMode ? 'primary' : 'default'} onClick={() => setCompareMode(!compareMode)} title="While on, every click on a node adds it here (shift- or ctrl-click always does)">Click adds</Button>
        {ids.length > 0 && <Button size="sm" variant="ghost" onClick={onClear}>Reset</Button>}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '0 0 6px' }}>
        {ids.map((id, i) => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, border: `1px solid ${alpha(C.accent, '55')}`, borderRadius: 14, padding: '1px 4px 1px 3px', background: alpha(C.accent, '12') }}>
            <span style={{ background: C.accent, color: C.bg, borderRadius: '50%', width: 15, height: 15, display: 'inline-grid', placeItems: 'center', fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
            <a style={{ ...link, color: C.text }} onClick={() => onSelect(id)}>{trunc(name(id), 22)}</a>
            <a style={{ color: C.dim, cursor: 'pointer', padding: '0 3px' }} onClick={() => onRemove(id)} title="Remove from the comparison">×</a>
          </span>
        ))}
        {ids.length === 0 && <span style={{ fontSize: 12, color: C.muted }}>Pick 2 or more nodes: “+ Compare” in the details, Shift-click a node, or search below.</span>}
        {ids.length === 1 && <span style={{ fontSize: 12, color: C.muted }}>Add one more to compare.</span>}
      </div>
      <div style={{ padding: 0, fontSize: 12, lineHeight: 1.5 }}>
        {result && ids.length >= 2 && (
          <>
            {result.shared.filter(s => !s.facet.flag).length > 0 && <div style={{ ...sub, marginTop: 0 }}>Shared</div>}
            {result.shared.filter(s => !s.facet.flag).map(s => {
              const on = shared && shared.key === s.facet.key + '|' + s.value
              return (
                <div key={s.facet.key + s.value} style={{ padding: '3px 6px', margin: '1px -6px', borderRadius: 6, background: on ? alpha(C.accent, '1a') : 'transparent' }}>
                  <b style={{ fontWeight: 600 }}>{s.facet.label}</b>:{' '}
                  <a style={link} onClick={() => onShared({ key: s.facet.key + '|' + s.value, id: s.id, ids: s.ids })}
                     title={s.id ? 'Select it and light up the paths from the picked nodes' : 'Highlight these nodes'}>
                    {s.of === s.ids.length ? `all ${s.of} share ` : `${s.ids.length} of ${s.of} share `}{trunc(s.value, 40)}
                  </a>{s.via ? <span style={{ color: C.dim }}> (via {s.via})</span> : null}
                  {s.odd && <div style={{ color: C.amber }}>odd one out: <a style={{ ...link, color: C.amber }} onClick={() => onSelect(s.odd.ids[0])}>{name(s.odd.ids[0])}</a> has {trunc(s.odd.v, 40)} (others {trunc(s.value, 40)})</div>}
                  {!s.odd && s.others.length > 0 && <div style={{ color: C.muted }}>differs: {s.others.map(g => `${trunc(g.v, 28)} (${g.ids.map(name).slice(0, 2).join(', ')}${g.ids.length > 2 ? ' …' : ''})`).join('; ')}</div>}
                </div>
              )
            })}
            {result.shared.some(s => s.facet.flag) && (
              <div style={{ margin: '4px 0', color: C.muted }}>
                <b style={{ fontWeight: 600, color: C.body }}>Sources</b>:{' '}
                {['yes', 'no'].map(v => { const f = result.shared.filter(x => x.facet.flag && x.value === v); return f.length ? `${v === 'yes' ? 'in' : 'not in'} ${f.map(x => x.facet.label.replace(/^In /, '')).join(', ')}` : null }).filter(Boolean).join(' · ')}
              </div>
            )}
            {result.differs.length > 0 && <div style={sub}>Where they split</div>}
            {result.differs.map(d => (
              <div key={d.facet.key} style={{ margin: '2px 0' }}>
                <b style={{ fontWeight: 600 }}>{d.facet.label}</b>: {d.groups.slice(0, 4).map((g, i) => (
                  <span key={i}>{i > 0 && ' · '}<a style={link} onClick={() => onShared({ key: d.facet.key + '|' + g.v, ids: g.ids })}>{trunc(g.v, 26)} ×{g.ids.length}</a></span>
                ))}{d.groups.length > 4 && ' …'}
              </div>
            ))}
            {result.neighbors.length > 0 && <div style={sub}>Other links in common</div>}
            {result.neighbors.map(nb => (
              <div key={nb.node.id} style={{ margin: '2px 0' }}>
                {nb.n} of {nb.of} connect to <a style={link} onClick={() => onShared({ key: nb.node.id, id: nb.node.id, ids })}>{trunc(nb.node.label, 36)}</a> <span style={{ color: C.dim }}>({nb.node.kind})</span>
              </div>
            ))}
            {!result.shared.length && !result.differs.length && !result.neighbors.length && <div style={{ color: C.muted }}>Nothing in common among these in the data we have.</div>}
          </>
        )}
      </div>
      <div style={{ padding: '6px 0 2px', borderTop: `1px solid ${C.line}`, marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Compare with… (any host, person, team, job)" aria-label="Compare with"
            onKeyDown={e => { if (e.key === 'Enter' && q.trim().length >= 2) (hits[0] ? (onAdd(hits[0].id), setQ('')) : pull()) }}
            style={{ flex: '1 1 170px', minWidth: 0, fontFamily: MONO, fontSize: 11, background: C.field, border: `1px solid ${C.line2}`, borderRadius: 6, color: C.text, padding: '4px 8px', outline: 'none' }} />
          {presets.sameKind && <Button size="sm" onClick={presets.sameKind.run} title={presets.sameKind.title}>{presets.sameKind.label}</Button>}
          {presets.sameTeam && <Button size="sm" onClick={presets.sameTeam.run} title={presets.sameTeam.title}>{presets.sameTeam.label}</Button>}
        </div>
        {q.trim().length >= 2 && (
          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {hits.map(h => <a key={h.id} style={{ ...link, fontSize: 12 }} onClick={() => { onAdd(h.id); setQ('') }}>+ {trunc(h.label, 40)} <span style={{ color: C.dim }}>({h.kind})</span></a>)}
            <a style={{ ...link, fontSize: 12, opacity: busy ? 0.5 : 1 }} onClick={busy ? undefined : pull}>{busy ? 'searching…' : `+ search everything for “${trunc(q.trim(), 30)}” and pull it in`}</a>
          </div>
        )}
      </div>
    </div>
  )
}
