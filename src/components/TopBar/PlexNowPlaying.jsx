import { useState, useEffect } from 'react'
import { TopBarPill } from '../shared/TopBarPill'

// ms -> h:mm:ss or m:ss
function fmt(ms) {
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function PlexNowPlaying({ data }) {
  const [pulse, setPulse] = useState(true)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const p = setInterval(() => setPulse(v => !v), 900)
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(p); clearInterval(t) }
  }, [])

  // Real sessions only: nothing while loading (it used to show a made-up title)
  const title = data?.title
  if (!(data?.streams > 0) || !title) return null

  // Real position from the Plex session, advanced locally between the 15s polls while playing
  const playing = data.state === 'playing'
  const pos = data.offset != null ? data.offset + (playing ? now - data.at : 0) : null
  const progress = pos != null && data.duration ? Math.min(100, (pos / data.duration) * 100) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <TopBarPill color="#e5a00d40" textColor="#e5a00d" glow>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: '#e5a00d',
          display: 'inline-block', opacity: pulse || !playing ? 1 : 0.3, transition: 'opacity 0.3s',
        }} />
        <span title={title} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Plex · {title}
        </span>
      </TopBarPill>
      {progress != null && (
        <div title={`${fmt(pos)} / ${fmt(data.duration)}${playing ? '' : ' · ' + data.state}`}
          style={{ height: 2, width: 140, background: '#e5a00d20', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${progress}%`, background: '#e5a00d', opacity: playing ? 1 : 0.5,
            borderRadius: 2, transition: 'width 1s linear', boxShadow: '0 0 6px #e5a00d',
          }} />
        </div>
      )}
    </div>
  )
}
