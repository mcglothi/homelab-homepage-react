import { useCountUp } from '../../hooks/useCountUp'
import { C, alpha } from '../../ui/theme'

export function AdGuardDonut({ data }) {
  const blocked = data?.percentage ?? 89.2
  const queries = data?.queries ?? 12441

  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (blocked / 100) * circ
  const counted = useCountUp(blocked, 1200)

  return (
    <div style={{ background: alpha(C.text, 0.03), border: `1px solid ${alpha(C.text, '10')}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#f60d1a', letterSpacing: 3, marginBottom: 12, textTransform: 'uppercase' }}>
        AdGuard
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
          <svg width="70" height="70" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="35" cy="35" r={r} fill="none" strokeWidth="7" style={{ stroke: alpha(C.text, '08') }} />
            <circle cx="35" cy="35" r={r} fill="none" strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              style={{ stroke: C.green, filter: `drop-shadow(0 0 4px ${C.green})`, transition: 'stroke-dasharray 1.2s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: C.bright, lineHeight: 1 }}>
              {counted}%
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Blocked', val: `${blocked}%`, color: C.green },
            { label: 'Queries', val: queries.toLocaleString(), color: C.muted },
          ].map(item => (
            <div key={item.label}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: C.faint, letterSpacing: 1 }}>{item.label} </span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: item.color, fontWeight: 600 }}>{item.val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
