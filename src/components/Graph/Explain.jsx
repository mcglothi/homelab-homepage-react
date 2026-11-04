import { useEffect, useRef, useState } from 'react'
import { C, MONO, alpha } from '../../ui/theme'
import { Button } from '../../ui/primitives'

// Explain is explicit: only the already-built names and short summary leave the page.
export default function Explain({ summary, mode = 'graph', gap, compact = false }) {
  const [st, setSt] = useState({ busy: false, text: null, error: null })
  const ctl = useRef(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const run = async () => {
    ctl.current?.abort()
    const c = new AbortController(); ctl.current = c
    const timer = setTimeout(() => c.abort(), 170000)
    setSt({ busy: true, text: null, error: null })
    try {
      const r = await fetch('/api/graph/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: c.signal,
        body: JSON.stringify({ summary: summary(), mode, gap }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setSt({ busy: false, text: j.text, error: null, basis: j.basis })
    } catch (e) { setSt({ busy: false, text: null, error: e.name === 'AbortError' ? 'no answer within 170 s' : e.message }) } finally { clearTimeout(timer) }
  }
  return <div style={compact ? { marginTop: 4 } : undefined}>
    {!compact && <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.dim, margin: '14px 0 6px' }}>Explain</div>}
    <Button size="sm" variant="primary" disabled={st.busy} onClick={run}>{st.busy ? 'Explaining…' : mode === 'bridge' ? 'Bridge' : 'Explain this graph'}</Button>
    {st.error && <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>{st.error}</div>}
    {st.text && <div style={{ marginTop: 8, padding: '8px 10px', border: `1px solid ${alpha(C.accent, '30')}`, borderRadius: 8, background: alpha(C.accent, '08'), fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: C.body }}>
      {st.text}<div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10, color: C.dim }}>Nemotron on Hopper · names and summaries only{st.basis ? ` · ${st.basis}` : ''}</div>
    </div>}
  </div>
}
