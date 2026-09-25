import { useCountUp } from '../../hooks/useCountUp'

export function AdGuardDonut({ data }) {
  const blocked = data?.percentage ?? 89.2
  const queries = data?.queries ?? 12441

  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (blocked / 100) * circ
  const counted = useCountUp(blocked, 1200)

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #ffffff10', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#f60d1a', letterSpacing: 3, marginBottom: 12, textTransform: 'uppercase' }}>
        AdGuard
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
          <svg width="70" height="70" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="35" cy="35" r={r} fill="none" stroke="#ffffff08" strokeWidth="7" />
            <circle cx="35" cy="35" r={r} fill="none" stroke="#39ff5a" strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              style={{ filter: 'drop-shadow(0 0 4px #39ff5a)', transition: 'stroke-dasharray 1.2s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
              {counted}%
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Blocked', val: `${blocked}%`, color: '#39ff5a' },
            { label: 'Queries', val: queries.toLocaleString(), color: '#888' },
          ].map(item => (
            <div key={item.label}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1 }}>{item.label} </span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: item.color, fontWeight: 600 }}>{item.val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
