import { useState, useEffect } from 'react'
import { TopBarPill } from '../shared/TopBarPill'

export function PlexNowPlaying({ data }) {
  const [pulse, setPulse] = useState(true)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const p = setInterval(() => setPulse(v => !v), 900)
    const r = setInterval(() => setProgress(v => (v >= 100 ? 0 : v + 0.5)), 2000)
    return () => { clearInterval(p); clearInterval(r) }
  }, [])

  // Real sessions only: nothing while loading (it used to show a made-up title)
  const title = data?.title
  if (!(data?.streams > 0) || !title) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <TopBarPill color="#e5a00d40" textColor="#e5a00d" glow>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: '#e5a00d',
          display: 'inline-block', opacity: pulse ? 1 : 0.3, transition: 'opacity 0.3s',
        }} />
        <span title={title} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Plex · {title}
        </span>
      </TopBarPill>
      <div style={{ height: 2, width: 140, background: '#e5a00d20', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${progress}%`, background: '#e5a00d',
          borderRadius: 2, transition: 'width 1.8s linear', boxShadow: '0 0 6px #e5a00d',
        }} />
      </div>
    </div>
  )
}
