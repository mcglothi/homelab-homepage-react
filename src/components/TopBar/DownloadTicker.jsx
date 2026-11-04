import { TopBarPill } from '../shared/TopBarPill'

export function DownloadTicker({ data }) {
  // Only while something is downloading; idle SABnzbd takes no room in the bar
  const speed = data?.speed || 0
  if (speed <= 0) return null

  return (
    <TopBarPill color="#f5c51840" textColor="#f5c518" glow>
      <span style={{ fontSize: 10 }}>↓</span>
      {`${speed} MB/s`}
    </TopBarPill>
  )
}
