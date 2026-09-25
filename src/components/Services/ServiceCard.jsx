import { useState } from 'react'
import { useEntrance } from '../../hooks/useEntrance'
import { ServiceIcon } from '../shared/ServiceIcon'
import { StatusDot } from '../shared/StatusDot'
import { AnimatedValue } from './AnimatedValue'
import { OpenSoakCard } from './OpenSoakCard'
import { MediaSweepCard } from './MediaSweepCard'

export function ServiceCard({ svc, accent, cardRadius = 12, entranceDelay = 0, liveData }) {
  const [hovered, setHovered] = useState(false)
  const visible = useEntrance(entranceDelay)

  if (svc.name === 'OpenSoak') {
    return <OpenSoakCard data={liveData} cardRadius={cardRadius} />
  }

  if (svc.name === 'Unmanic') {
    return <MediaSweepCard svc={svc} cardRadius={cardRadius} entranceDelay={entranceDelay} />
  }

  // Merge static details with any live data overrides
  const details = liveData?.details ?? svc.details

  return (
    <a
      href={svc.href}
      target="_blank"
      rel="noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        background: hovered ? `${svc.color}14` : `${svc.color}06`,
        border: `1px solid ${hovered ? svc.color + '70' : svc.color + '25'}`,
        borderRadius: cardRadius,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        backdropFilter: 'blur(8px)',
        boxShadow: hovered ? `0 4px 28px ${svc.color}22` : `0 1px 8px ${svc.color}08`,
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ServiceIcon name={svc.name} color={svc.color} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{
              fontSize: 14, fontWeight: 600,
              color: hovered ? '#fff' : '#ccc',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{svc.name}</span>
            <StatusDot online={liveData?.online ?? true} />
          </div>
          <div style={{
            fontSize: 11, color: '#555', fontFamily: "'JetBrains Mono',monospace",
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{svc.desc}</div>
        </div>
      </div>
      {details && details.length > 0 && (
        <div style={{
          marginTop: 12, paddingTop: 10, borderTop: `1px solid ${svc.color}20`,
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(details.length, 3)}, 1fr)`,
          gap: 6,
        }}>
          {details.map(d => (
            <div key={d.k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: 9,
                color: '#444', letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}>{d.k}</span>
              {visible
                ? <AnimatedValue raw={d.v} color={hovered ? svc.color : svc.color + 'cc'} size={12} />
                : <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: svc.color + 'cc', fontWeight: 600 }}>—</span>
              }
            </div>
          ))}
        </div>
      )}
    </a>
  )
}
