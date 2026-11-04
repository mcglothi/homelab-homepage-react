import { useState, useEffect } from 'react'
import { Sparkline } from '../shared/Sparkline'
import { C, alpha } from '../../ui/theme'
import { SectionHeader, useCollapsed } from './Section'

export function GrafanaWidget({ accent, data }) {
  const collapsed = useCollapsed('Grafana')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000)
    return () => clearInterval(id)
  }, [])

  const cpuHistory = data?.cpu?.history ?? [18, 22, 19, 28, 35, 24, 20, 26, 22, 18, 24, 28, 22, 20, 24]
  const ramHistory = data?.ram?.history ?? [58, 59, 60, 61, 61, 60, 62, 63, 61, 60, 61, 62, 61, 61, 61]
  const netHistory = data?.net?.history ?? [12, 45, 28, 89, 34, 12, 67, 44, 23, 78, 34, 56, 23, 45, 38]

  const cpuLive = Math.round(data?.cpu?.current ?? Math.floor(Math.sin(tick * 0.8) * 6 + 24))
  const ramLive = Math.round(data?.ram?.current ?? 61)
  const netLive = data?.net?.current ?? Math.floor(Math.sin(tick * 1.2 + 1) * 12 + 38)

  const rows = [
    { label: 'CPU', val: `${cpuLive}%`, color: accent, data: cpuHistory },
    { label: 'RAM', val: `${ramLive}%`, color: C.violet, data: ramHistory },
    { label: 'NET ↑↓', val: `${netLive} MB/s`, color: C.blue, data: netHistory },
  ]

  return (
    <div style={{ background: alpha(C.text, 0.03), border: `1px solid ${alpha(C.text, '10')}`, borderRadius: 12, padding: '14px 16px' }}>
      <SectionHeader id="Grafana" accent={'#f46800'} title="Grafana">
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: C.faint }}>babbage</div>
      </SectionHeader>
      {!collapsed && (<>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(row => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 56, flexShrink: 0 }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: C.faint, letterSpacing: 1 }}>{row.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 600, color: row.color, transition: 'color 0.5s' }}>{row.val}</div>
            </div>
            <Sparkline data={row.data} color={row.color} width={172} height={28} />
          </div>
        ))}
      </div>
      </>)}
    </div>
  )
}
