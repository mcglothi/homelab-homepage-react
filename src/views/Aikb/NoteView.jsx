import { useEffect, useState } from 'react'
import { ago } from '../../api/feeds'
import { link, useLocation } from '../../router'
import { C, MONO, SANS, alpha } from '../../ui/theme'
import Markdown from './markdown.jsx'

export default function NoteView() {
  const { query } = useLocation(), path = query.get('path') || '', section = query.get('section') || 'overview'
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    if (!path) { setState({ error: 'No note path was provided.' }); return }
    let alive = true
    setState({ loading: true })
    fetch(`/api/kb/note?path=${encodeURIComponent(path)}`).then(async r => {
      const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || `${r.status}`); return body
    }).then(data => alive && setState({ data, loading: false })).catch(e => alive && setState({ error: e.message, loading: false }))
    return () => { alive = false }
  }, [path])
  useEffect(() => {
    if (!state.data) return
    const want = section.toLowerCase(), timers = []
    let target, old
    timers.push(setTimeout(() => {
      // The section name from search, or a heading slug from a #fragment link
      target = want === 'overview' ? document.querySelector('[data-aikb-note]')
        : [...document.querySelectorAll('[data-aikb-section]')].find(el => el.dataset.aikbSection.toLowerCase() === want || el.id === want)
      if (!target) return
      // Instant, and once more after late layout (fonts, tables): a smooth scroll was dropped on phones
      target.scrollIntoView({ block: 'start' })
      timers.push(setTimeout(() => target.scrollIntoView({ block: 'start' }), 350))
      old = target.style.background; target.style.background = alpha(C.violet, '25')
      timers.push(setTimeout(() => { target.style.background = old }, 1100))
    }, 40))
    return () => { timers.forEach(clearTimeout); if (target && old !== undefined) target.style.background = old }
  }, [state.data, section])
  return <div data-aikb-note style={{ flex: 1, overflowY: 'auto', padding: '28px max(14px, calc((100% - 860px) / 2))', position: 'relative', zIndex: 1 }}>
    <button onClick={() => history.back()} style={{ border: 0, background: 'transparent', padding: 0, color: C.violet, fontFamily: MONO, fontSize: 12, cursor: 'pointer' }}>← back</button>
    {state.loading && <div style={{ fontFamily: MONO, fontSize: 12, color: C.dim, marginTop: 22 }}>Loading note…</div>}
    {state.error && <div style={{ fontFamily: MONO, fontSize: 12, color: C.red, marginTop: 22 }}>Could not load this note: {state.error}</div>}
    {state.data && <><h1 style={{ fontFamily: SANS, color: C.text, margin: '18px 0 4px', lineHeight: 1.15 }}>{state.data.title || path}</h1><div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginBottom: 26, overflowWrap: 'anywhere' }}>{state.data.path || path}{state.data.mtime ? ` · ${ago(state.data.mtime)}` : ''}</div><div style={{ background: alpha(C.panel, 'd9'), border: `1px solid ${C.line}`, borderRadius: 10, padding: 'clamp(14px, 3vw, 28px)', minWidth: 0 }}><Markdown content={state.data.content} file={state.data.path || path} title={state.data.title} /></div><RelatedNotes path={state.data.path || path} /></>}
  </div>
}

function RelatedNotes({ path }) {
  const [state, setState] = useState({ loading: true, items: [] })
  useEffect(() => {
    let live = true
    fetch(`/api/kb/related?path=${encodeURIComponent(path)}`).then(async r => {
      const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || `${r.status}`); return body
    }).then(body => live && setState({ loading: false, items: body.items || [] })).catch(() => live && setState({ loading: false, items: [] }))
    return () => { live = false }
  }, [path])
  if (state.loading || !state.items.length) return null
  return <div style={{ marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
    <div style={{ fontFamily: MONO, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.dim }}>Related notes</div>
    {state.items.map(item => <div key={item.file} style={{ marginTop: 8, fontSize: 12 }}>
      <a onClick={link(`/aikb/note?path=${encodeURIComponent(item.file)}`)} style={{ color: C.violet, cursor: 'pointer' }}>{item.title}</a>
      {!item.linked && <span style={{ marginLeft: 7, fontFamily: MONO, fontSize: 10, color: C.amber }}>unlinked</span>}
      <div style={{ color: C.muted, marginTop: 2 }}>{item.shared.join(' · ')}</div>
    </div>)}
  </div>
}
