import { useState, useEffect } from 'react'

export function NetworkStats({ accent, data }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  const down = data?.down ?? (Math.sin(tick * 0.7) * 15 + 38).toFixed(1)
  const up = data?.up ?? (Math.sin(tick * 1.1 + 1) * 5 + 12).toFixed(1)
  const ping = data?.ping ?? Math.floor(Math.sin(tick * 0.5 + 2) * 4 + 14)

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #ffffff10', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#00bfff', letterSpacing: 3, marginBottom: 12, textTransform: 'uppercase' }}>
        Network
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: '↓ DOWN', val: down, unit: 'MB/s', color: '#39ff5a' },
          { label: '↑ UP', val: up, unit: 'MB/s', color: accent },
          { label: 'PING', val: ping, unit: 'ms', color: '#00bfff' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '8px 4px' }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: s.color, transition: 'color 0.5s' }}>{s.val}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#555' }}>{s.unit}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
