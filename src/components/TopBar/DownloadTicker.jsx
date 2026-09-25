import { TopBarPill } from '../shared/TopBarPill'

export function DownloadTicker({ data }) {
  const speed = data?.speed || 0
  const active = speed > 0

  return (
    <TopBarPill
      color={active ? '#f5c51840' : '#ffffff10'}
      textColor={active ? '#f5c518' : '#444'}
      glow={active}
    >
      <span style={{ fontSize: 10 }}>↓</span>
      {active ? `${speed} MB/s` : 'SABnzbd idle'}
    </TopBarPill>
  )
}
