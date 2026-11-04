import { useCallback, useEffect, useRef, useState } from 'react'
import { C, alpha, glow, MONO } from '../../ui/theme'

// Credential health for every integration (/api/auth), ported from work Docket. The pill
// is green / yellow / red; clicking it opens a panel listing what isn't connected and
// where its key comes from. Home has no SSO flows, so there's nothing to run, only a
// location to copy.
const COLOR = { ok: C.green, warn: C.amber, error: C.red }
// Below this width the pill drops its label so the nav tabs keep their room
const NARROW = '(max-width: 1279px)'

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

export function AuthPill() {
  const [auth, setAuth] = useState(null)
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)

  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const load = useCallback(async fresh => {
    try {
      const res = await fetch('/api/auth' + (fresh ? '?fresh=1' : ''))
      const data = await res.json()
      setAuth(res.ok ? data : { error: data.error ?? `HTTP ${res.status}` })
    } catch (e) {
      setAuth({ error: e.message })
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const providers = auth?.providers ?? []
  const bad = providers.filter(p => p.state !== 'ok')
  const overall = auth?.error ? 'warn' : auth?.overall ?? null
  const c = COLOR[overall] ?? C.dim

  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen(o => !o)} title="Connections and keys" style={{
        fontFamily: MONO, fontSize: 11, color: overall === 'ok' ? C.muted : c, cursor: 'pointer',
        padding: narrow ? '3px 7px' : '3px 10px', borderRadius: 20, border: `1px solid ${alpha(c, '40')}`,
        background: overall && overall !== 'ok' ? alpha(c, '10') : 'transparent',
        boxShadow: overall && overall !== 'ok' ? `0 0 8px ${glow(c, '40')}` : 'none',
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: c,
                       boxShadow: overall && overall !== 'ok' ? `0 0 6px ${glow(c)}` : 'none' }} />
        {narrow ? (bad.length > 0 ? bad.length : null) : <>auth{bad.length > 0 && ` · ${bad.length}`}</>}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: 460, maxWidth: 'calc(100vw - 32px)', maxHeight: '75vh',
          overflowY: 'auto', zIndex: 50, background: C.panel, border: `1px solid ${alpha(C.text, '18')}`,
          borderRadius: 12, boxShadow: '0 16px 48px var(--shade)', padding: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 3, color: C.muted, textTransform: 'uppercase' }}>
              Connections
            </span>
            <SmallButton onClick={() => load(true)}>recheck all</SmallButton>
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>
            {auth?.error ? `Couldn't read connection status: ${auth.error}`
              : !auth ? 'checking…'
              : bad.length ? `${bad.length} of ${providers.length} need attention`
              : `All ${providers.length} connected`}
          </div>
          {[...bad, ...providers.filter(p => p.state === 'ok')].map(p => <ProviderRow key={p.id} p={p} />)}
        </div>
      )}
    </span>
  )
}

function ProviderRow({ p }) {
  // Problem rows open by default (also when they turn bad later); a click overrides
  const [toggled, setToggled] = useState(null)
  const expanded = toggled ?? p.state !== 'ok'
  const [copied, setCopied] = useState(false)
  const c = COLOR[p.state] ?? C.dim

  const copy = async () => {
    await copyText(p.fix.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ borderTop: `1px solid ${alpha(C.text, '0d')}`, padding: '10px 0' }}>
      <div onClick={() => setToggled(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0,
                       boxShadow: p.state !== 'ok' ? `0 0 6px ${glow(c)}` : 'none' }} />
        <span style={{ fontSize: 13, color: p.state === 'ok' ? C.body : C.text, flexShrink: 0 }}>{p.name}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: p.state === 'ok' ? C.dim : c, flex: 1, minWidth: 0,
                       textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={p.detail}>
          {p.detail}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ margin: '10px 0 2px 18px' }}>
          {p.detail.length > 48 && (  // the header line clips long details
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, overflowWrap: 'anywhere' }}>{p.detail}</div>
          )}
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 8, lineHeight: 1.45 }}>{p.fix.help}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <code style={{
              fontFamily: MONO, fontSize: 11, color: C.muted, background: alpha(C.text, '08'), border: `1px solid ${alpha(C.text, '12')}`,
              borderRadius: 6, padding: '4px 8px', flex: 1, minWidth: 0, overflowWrap: 'anywhere',
            }}>{p.fix.command}</code>
            <SmallButton onClick={copy}>{copied ? 'copied' : 'copy'}</SmallButton>
          </div>
        </div>
      )}
    </div>
  )
}

function SmallButton({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: MONO, fontSize: 10, color: C.muted, background: 'transparent', cursor: 'pointer',
      border: `1px solid ${alpha(C.text, '18')}`, borderRadius: 5, padding: '3px 8px',
    }}>{children}</button>
  )
}
