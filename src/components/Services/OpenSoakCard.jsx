import { useState, useEffect } from 'react'
import { useEntrance } from '../../hooks/useEntrance'

export function OpenSoakCard({ data, cardRadius = 12 }) {
  const [hovered, setHovered] = useState(false)
  const visible = useEntrance(200)
  const [heatingPulse, setHeatingPulse] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setHeatingPulse(v => !v), 2400)
    return () => clearInterval(id)
  }, [])

  const currentTemp = (data?.temp != null && !isNaN(data?.temp)) ? data.temp : null
  const setPoint = data?.setPoint ?? null
  const heating = data?.heating ?? false
  const color = '#ff6b35'

  const circumference = 2 * Math.PI * 28
  const progress = (currentTemp != null && setPoint != null)
    ? Math.max(0, Math.min(1, (currentTemp - 95) / (setPoint + 5 - 95)))
    : 0
  const dash = circumference * progress

  return (
    <a
      href="http://opensoak.home.timmcg.net"
      target="_blank"
      rel="noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        background: hovered ? `${color}14` : `${color}06`,
        border: `1px solid ${hovered ? color + '70' : color + '25'}`,
        borderRadius: cardRadius,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        backdropFilter: 'blur(8px)',
        boxShadow: hovered ? `0 4px 28px ${color}22` : `0 1px 8px ${color}08`,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Animated temp ring */}
        <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
          <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="32" cy="32" r="28" fill="none" stroke={color + '20'} strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28" fill="none" stroke={color}
              strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dasharray 1s ease' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: hovered ? '#fff' : '#ddd', lineHeight: 1 }}>
              {currentTemp != null ? `${currentTemp}°` : '—'}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color, marginTop: 1 }}>F</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: hovered ? '#fff' : '#ccc' }}>OpenSoak</span>
            {heating && (
              <span style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color,
                background: `${color}20`, padding: '1px 6px', borderRadius: 10,
                border: `1px solid ${color}40`,
                opacity: heatingPulse ? 1 : 0.4, transition: 'opacity 0.6s',
              }}>● HEATING</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#555', fontFamily: "'JetBrains Mono',monospace" }}>
            Hot Tub Controller
          </div>
        </div>
      </div>
      <div style={{
        marginTop: 12, paddingTop: 10, borderTop: `1px solid ${color}20`,
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
      }}>
        {[
          { k: 'Temp', v: currentTemp != null ? `${currentTemp}°F` : '—' },
          { k: 'Set Point', v: setPoint != null ? `${setPoint}°F` : '—' },
          { k: 'Heating', v: heating ? 'active' : 'off' },
        ].map(d => (
          <div key={d.k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1, textTransform: 'uppercase' }}>{d.k}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: hovered ? color : color + 'cc', fontWeight: 600 }}>{d.v}</span>
          </div>
        ))}
      </div>
    </a>
  )
}
