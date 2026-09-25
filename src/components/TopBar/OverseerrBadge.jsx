import { TopBarPill } from '../shared/TopBarPill'

export function OverseerrBadge({ data }) {
  const count = data?.pending ?? 3
  return (
    <TopBarPill color="#e5700d40" textColor="#e5700d">
      <span style={{
        background: '#e5700d', color: '#000', fontSize: 9, fontWeight: 700,
        borderRadius: 10, padding: '1px 5px', lineHeight: 1.4,
      }}>{count}</span>
      requests
    </TopBarPill>
  )
}
