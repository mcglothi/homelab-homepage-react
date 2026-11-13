import { useEffect, useRef, useState } from 'react'
import { C, MONO, alpha } from '../../ui/theme'
import { Button } from '../../ui/primitives'
import { askPayload } from './askPayload'

// Ask the graph: a question about what is on screen, answered by the model loaded on Hopper; the nodes the answer
// relies on light up (onHighlight). Explicit only: nothing is sent until Ask is pressed.
export default function Ask({ model, onHighlight }) {
  const [q, setQ] = useState('')
  const [st, setSt] = useState({ busy: false, text: null, error: null })
  const ctl = useRef(null)
  useEffect(() => { ctl.current?.abort(); setSt({ busy: false, text: null, error: null }) }, [model])
  useEffect(() => () => ctl.current?.abort(), [])
  const run = async () => {
    if (!q.trim() || !model) return
    ctl.current?.abort()
    const c = new AbortController(); ctl.current = c
    const { body, back } = askPayload(model, q.trim())
    setSt({ busy: true, text: null, error: null })
    try {
      const r = await fetch('/api/graph/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: c.signal, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      const ids = (j.ids || []).map(k => back.get(String(k))).filter(Boolean)
      if (ctl.current === c) { setSt({ busy: false, text: j.text, model: j.model, n: ids.length, error: null }); if (ids.length) onHighlight(ids) }
    } catch (e) {
      if (ctl.current === c && e.name !== 'AbortError') setSt({ busy: false, text: null, error: e.message })
    }
  }
  return <div>
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.dim, margin: '14px 0 6px' }}>Ask the graph</div>
    <div style={{ display: 'flex', gap: 6 }}>
      <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run() }} placeholder="e.g. what depends on babbage?"
        aria-label="Question about the graph" style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.body }} />
      <Button size="sm" variant="primary" disabled={st.busy || !q.trim()} onClick={run}>{st.busy ? 'Asking…' : 'Ask'}</Button>
    </div>
    {st.error && <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>{st.error}</div>}
    {st.text && <div style={{ marginTop: 8, padding: '8px 10px', border: `1px solid ${alpha(C.accent, '30')}`, borderRadius: 8, background: alpha(C.accent, '08'), fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: C.body }}>
      {st.text}<div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10, color: C.dim }}>{st.model || 'model'} on Hopper · {st.n ? `${st.n} node${st.n === 1 ? '' : 's'} lit` : 'no nodes cited'}</div>
    </div>}
  </div>
}
