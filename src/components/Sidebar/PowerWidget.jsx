export function PowerWidget({ accent, data }) {
  // Real data only: /api/power (Senseless live draw + Prometheus history). No placeholder values.
  const powerHistory = data?.history ?? []
  const currentW = data?.current ?? null
  const peakW = data?.peak ?? null
  const avgW = data?.avg ?? null
  const dailyKwh = data?.kwh ?? null
  const legs = data?.legs ?? null
  const live = data?.live ?? false
  const fmtW = (v) => (v == null ? '—' : `${v.toLocaleString()}W`)

  const barMax = Math.max(1, ...powerHistory)
  const gaugeMax = 4000
  const gaugeProgress = currentW == null ? 0 : Math.min(currentW / gaugeMax, 1)
  const r = 30
  const circ = Math.PI * r
  const dash = gaugeProgress * circ

  const wColor = currentW == null ? '#555' : currentW > 3000 ? '#ff2d6b' : currentW > 2500 ? '#ff6b35' : accent

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #ffffff10', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#ffab00', letterSpacing: 3, textTransform: 'uppercase' }}>Power</div>
        <a href="https://sense.home.timmcg.net" target="_blank" rel="noreferrer"
          style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: live ? '#39ff5a90' : '#ff2d6b', textDecoration: 'none' }}>
          {live ? 'Sense · live' : 'Sense · stale'}
        </a>
      </div>

      {/* Gauge + reading */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 14 }}>
        <div style={{ position: 'relative', width: 80, height: 44, flexShrink: 0 }}>
          <svg width="80" height="44" viewBox="0 0 80 44">
            <path d="M 4 40 A 36 36 0 0 1 76 40" fill="none" stroke="#ffffff08" strokeWidth="6" strokeLinecap="round" />
            <path d="M 4 40 A 36 36 0 0 1 76 40" fill="none" stroke={wColor} strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${gaugeProgress * 113} 113`}
              style={{ filter: `drop-shadow(0 0 5px ${wColor})`, transition: 'stroke-dasharray 1s ease, stroke 0.5s' }}
            />
          </svg>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center' }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#555' }}>0</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#555', marginLeft: 42 }}>4kW</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: wColor, lineHeight: 1, transition: 'color 0.5s' }}>
              {currentW == null ? '—' : currentW.toLocaleString()}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#555' }}>W</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', marginTop: 2 }}>
            {legs ? `L1 ${legs[0].toLocaleString()} · L2 ${legs[1].toLocaleString()}` : 'current draw'}
          </div>
        </div>
      </div>

      {/* 24h bar chart */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1, marginBottom: 6 }}>TODAY (HOURLY AVG)</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
          {powerHistory.map((v, i) => {
            const h = Math.max(3, (v / barMax) * 38)
            const isRecent = i >= powerHistory.length - 3
            const barColor = v > 2800 ? '#ff6b35' : v > 2400 ? '#ffab00' : '#39ff5a'
            return (
              <div key={i} style={{
                flex: 1, height: h, borderRadius: '2px 2px 0 0',
                background: isRecent ? barColor : barColor + '70',
                boxShadow: isRecent ? `0 0 4px ${barColor}` : 'none',
                transition: 'height 0.4s ease',
              }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: '#333' }}>12am</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: '#333' }}>now</span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {[
          { label: 'PEAK', val: fmtW(peakW), color: '#ff6b35' },
          { label: 'AVG', val: fmtW(avgW), color: '#ffab00' },
          { label: 'TODAY', val: dailyKwh == null ? '—' : `${dailyKwh} kWh`, color: '#39ff5a' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '6px 4px' }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: '#444', letterSpacing: 1, marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
