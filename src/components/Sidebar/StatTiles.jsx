export function StatTiles({ adguard, weather }) {
  const stats = [
    { label: 'DNS BLOCK', val: `${adguard?.blocked ?? '89'}%`, color: '#39ff5a' },
    { label: 'WEATHER', val: `${weather?.temp ?? '52'}°F`, color: '#00bfff' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid #ffffff10',
          borderRadius: 10, padding: '12px', textAlign: 'center',
        }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 600, color: s.color }}>
            {s.val}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', marginTop: 4, letterSpacing: 1 }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}
