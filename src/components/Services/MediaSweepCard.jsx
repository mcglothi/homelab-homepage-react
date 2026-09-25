import { useState, useEffect, useCallback } from 'react'
import { useEntrance } from '../../hooks/useEntrance'
import { ServiceIcon } from '../shared/ServiceIcon'
import { StatusDot } from '../shared/StatusDot'

// Unmanic card with the nightly media sweep toggle.
// The toggle drives an AUTOMATION_OFF flag file that nightly_sweep.py checks;
// the card link still opens the Unmanic UI.
export function MediaSweepCard({ svc, cardRadius = 12, entranceDelay = 0 }) {
  const [hovered, setHovered] = useState(false)
  const visible = useEntrance(entranceDelay)
  const [sweep, setSweep] = useState(null)
  const [toggling, setToggling] = useState(false)

  const refresh = useCallback(() => {
    fetch('/api/media-sweep')
      .then(r => r.json())
      .then(setSweep)
      .catch(() => setSweep(null))
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 60000)
    return () => clearInterval(id)
  }, [refresh])

  const toggle = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (toggling) return
    setToggling(true)
    try {
      const r = await fetch('/api/media-sweep/toggle', { method: 'POST' })
      const data = await r.json()
      setSweep(s => ({ ...s, enabled: data.enabled }))
    } catch { /* leave state as-is */ }
    setToggling(false)
  }

  const enabled = sweep?.enabled ?? null
  const color = svc.color
  const stateColor = enabled == null ? '#555' : enabled ? '#4ade80' : '#f87171'

  return (
    <a
      href={svc.href}
      target="_blank"
      rel="noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        background: hovered ? `${color}14` : `${color}06`,
        border: `1px solid ${hovered ? color + '70' : color + '25'}`,
        borderRadius: cardRadius,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        backdropFilter: 'blur(8px)',
        boxShadow: hovered ? `0 4px 28px ${color}22` : `0 1px 8px ${color}08`,
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ServiceIcon name={svc.name} color={color} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{
              fontSize: 14, fontWeight: 600,
              color: hovered ? '#fff' : '#ccc',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{svc.name}</span>
            <StatusDot online={sweep?.available ?? true} />
          </div>
          <div style={{
            fontSize: 11, color: '#555', fontFamily: "'JetBrains Mono',monospace",
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{svc.desc}</div>
        </div>
      </div>

      {/* Nightly sweep toggle row */}
      <div
        onClick={toggle}
        title={enabled ? 'Click to disable the nightly media sweep' : 'Click to re-enable the nightly media sweep'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 12, padding: '8px 10px',
          borderRadius: 8,
          background: `${stateColor}10`,
          border: `1px solid ${stateColor}30`,
          transition: 'all 0.18s ease',
          opacity: toggling ? 0.5 : 1,
        }}
      >
        {/* Switch */}
        <div style={{
          width: 30, height: 16, borderRadius: 8, flexShrink: 0,
          background: enabled ? '#4ade8060' : '#33333390',
          border: `1px solid ${enabled ? '#4ade80' : '#555'}`,
          position: 'relative', transition: 'all 0.18s ease',
        }}>
          <div style={{
            position: 'absolute', top: 1, left: enabled ? 15 : 1,
            width: 12, height: 12, borderRadius: 6,
            background: enabled ? '#4ade80' : '#777',
            transition: 'all 0.18s ease',
          }} />
        </div>
        <span style={{
          fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
          color: stateColor, fontWeight: 600, letterSpacing: 0.5,
        }}>
          {enabled == null ? 'NIGHTLY SWEEP: —' : enabled ? 'NIGHTLY SWEEP: ON' : 'NIGHTLY SWEEP: OFF'}
        </span>
      </div>

      {sweep?.lastRun && (
        <div style={{
          marginTop: 8, fontSize: 10, color: '#555',
          fontFamily: "'JetBrains Mono',monospace",
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          last sweep: {sweep.lastRun}
        </div>
      )}
    </a>
  )
}
