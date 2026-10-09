import { C, LEVEL, MONO, SANS, useTheme } from '../ui/theme'
import { Dot, Panel, SectionTitle } from '../ui/primitives'

// Layout pieces shared by the AIKB / Watch / HA tabs.

export function ViewShell({ title, subtitle, right, children }) {
  const { isMobile } = useTheme()
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px' : '28px 32px', position: 'relative', zIndex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: isMobile ? 22 : 28, color: C.text, letterSpacing: '-0.02em' }}>{title}</div>
          {subtitle && <div style={{ fontFamily: MONO, fontSize: 11, color: C.dim, marginTop: 4 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Tiles({ children }) {
  const { isMobile } = useTheme()
  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 22,
      gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 130 : 160}px, 1fr))` }}>{children}</div>
  )
}

export function Tile({ label, value, sub, color, title }) {
  const { cardRadius } = useTheme()
  return (
    <div title={title} style={{ background: C.panel, border: `1px solid ${(color || '#ffffff') + '22'}`, borderRadius: cardRadius, padding: '12px 14px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, color: C.dim, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 24, color: color || C.text, marginTop: 4, lineHeight: 1.1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// Responsive two-column grid of panels.
export function Columns({ children, min = 380 }) {
  const { isMobile } = useTheme()
  return <div style={{ display: 'grid', gap: 16, gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 260 : min}px, 1fr))`, alignItems: 'start' }}>{children}</div>
}

export function Card({ title, right, children, color, style }) {
  return (
    <Panel color={color} style={{ padding: '14px 16px', ...style }}>
      <SectionTitle right={right}>{title}</SectionTitle>
      {children}
    </Panel>
  )
}

export function AlertList({ alerts, empty = 'nothing needs attention' }) {
  if (!alerts?.length) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: C.green }}>✓ {empty}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {alerts.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
          <Dot color={LEVEL[a.level] || C.muted} pulse={a.level === 'crit'} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: a.level === 'info' ? C.body : C.text, lineHeight: 1.45 }}>
            {a.href ? <a href={a.href} style={{ color: 'inherit' }}>{a.text}</a> : a.text}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Row({ children, style }) {
  return <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 11, color: C.body, ...style }}>{children}</div>
}

export function Muted({ children, style }) {
  return <span style={{ color: C.dim, fontFamily: MONO, fontSize: 10, ...style }}>{children}</span>
}

// Feed error/stale indicator for a view header.
export function FeedBadge({ feed, name }) {
  const bad = feed.error
  const color = bad ? C.red : feed.loading ? C.dim : C.green
  return (
    <span style={{ fontFamily: MONO, fontSize: 10, color, display: 'inline-flex', gap: 6, alignItems: 'center' }}
      title={bad ? `${name}: ${feed.error}` : ''}>
      <Dot color={color} pulse={!bad && !feed.loading} size={6} />
      {bad ? `${name} unreachable${feed.data ? ' — showing last data' : ''}` : feed.loading ? `loading ${name}` : `${name} live`}
    </span>
  )
}

// Horizontal bar used for size / count breakdowns.
export function Bar({ value, max, color }) {
  const { accent } = useTheme()
  return (
    <div style={{ flex: 1, height: 5, background: '#ffffff0c', borderRadius: 3, overflow: 'hidden', alignSelf: 'center' }}>
      <div style={{ width: `${Math.max(2, (value / (max || 1)) * 100)}%`, height: '100%', background: color || accent, borderRadius: 3 }} />
    </div>
  )
}
