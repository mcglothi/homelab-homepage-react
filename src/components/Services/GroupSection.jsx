import { useState } from 'react'
import { ServiceCard } from './ServiceCard'

export function GroupSection({ group, services, accent, cardRadius, groupIndex = 0, minCardW = 230, liveData }) {
  const [collapsed, setCollapsed] = useState(false)
  const baseDelay = groupIndex * 80

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: collapsed ? 0 : 16, cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{
          fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 600,
          color: accent, letterSpacing: 3, textTransform: 'uppercase',
        }}>{group}</span>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${accent}40, transparent)` }} />
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#444' }}>
          {services.length}
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#444',
          transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          transition: 'transform 0.2s ease', display: 'inline-block',
        }}>›</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${minCardW}px, 1fr))`,
        gap: 10,
        overflow: 'hidden',
        maxHeight: collapsed ? 0 : '2000px',
        transition: 'max-height 0.35s ease',
      }}>
        {services.map((svc, i) => (
          <ServiceCard
            key={svc.name}
            svc={svc}
            accent={accent}
            cardRadius={cardRadius}
            entranceDelay={baseDelay + i * 40}
            liveData={liveData?.[svc.name]}
          />
        ))}
      </div>
    </div>
  )
}
