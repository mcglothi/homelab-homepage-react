import { useFeed } from '../../api/feeds'
import { link } from '../../router'
import { C, MONO, alpha } from '../../ui/theme'
import { SectionHeader, useCollapsed } from './Section'

// The latest idea shortlist from AIKB (ideas/shortlist/<date>.md): the top ideas that do not look built yet.
// Read-only: "Worth acting on" is ticked in the AIKB file; here the ticked ones show a check.
export function IdeasCard({ accent }) {
  const collapsed = useCollapsed('Ideas')
  const { data, error, loading } = useFeed('/api/ideas', 600000)
  const items = (data?.items || []).filter(i => !i.built).slice(0, 3)
  const open = href => e => link(href)(e)
  return (
    <div>
      <SectionHeader id="Ideas" accent={accent} title="Ideas" />
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(i => (
            <a key={i.id || i.rank} href={data.href} onClick={open(data.href)} title={i.from ? `From: ${i.from}` : undefined}
              style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 10px', borderRadius: 6, textDecoration: 'none',
                       border: `1px solid ${alpha(C.text, '10')}`, background: alpha(C.text, 0.02) }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: i.ticked ? C.green : accent, minWidth: 34 }}>
                {i.ticked ? '✓ ' : ''}{i.score != null ? i.score : '—'}
              </span>
              <span style={{ fontSize: 12.5, color: C.body, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{i.title}</span>
            </a>
          ))}
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.dim, paddingLeft: 2 }}>
            {loading ? 'loading…' : error ? 'AIKB unreachable' : !data?.count ? 'no shortlist in the last 2 weeks'
              : <a href={data.href} onClick={open(data.href)} style={{ color: C.muted, textDecoration: 'none' }}>
                  {data.date} · {data.count} ideas{data.ticked ? ` · ${data.ticked} picked` : ''} · score /30 →
                </a>}
          </div>
        </div>
      )}
    </div>
  )
}
