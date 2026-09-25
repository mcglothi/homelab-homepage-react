import { useState } from 'react'

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function CalendarWidget({ accent, events: eventsData }) {
  const now = new Date()
  const [offset, setOffset] = useState(0)
  const viewing = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const firstDay = viewing.getDay()
  const daysInMonth = new Date(viewing.getFullYear(), viewing.getMonth() + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const isCurrentMonth = offset === 0
  const td = now.getDate()

  // Live events from sonarr/radarr or fallback to placeholder
  const events = isCurrentMonth
    ? (eventsData ?? {
        [td + 3]: [{ color: '#35c5f4', label: 'Sonarr release' }],
        [td + 5]: [{ color: '#ffc230', label: 'Radarr release' }],
      })
    : {}

  const monthName = viewing.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid #ffffff10',
      borderRadius: 12, padding: '18px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: accent, letterSpacing: 3, textTransform: 'uppercase' }}>Calendar</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setOffset(o => o - 1)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px' }}
          >‹</button>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#555', minWidth: 110, textAlign: 'center' }}>
            {monthName}
          </div>
          <button
            onClick={() => setOffset(o => o + 1)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px' }}
          >›</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', paddingBottom: 6 }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
        {cells.map((d, i) => {
          const isToday = isCurrentMonth && d === td
          const evs = d ? events[d] : null
          return (
            <div key={i} style={{
              textAlign: 'center', borderRadius: 6, padding: '5px 2px 4px',
              background: isToday ? accent + '28' : 'transparent',
              border: isToday ? `1px solid ${accent}60` : '1px solid transparent',
              cursor: d ? 'pointer' : 'default',
              minHeight: 32,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
            }}>
              {d && (
                <span style={{
                  fontSize: 11, color: isToday ? '#fff' : '#666',
                  fontWeight: isToday ? 700 : 400,
                  fontFamily: "'JetBrains Mono',monospace", lineHeight: 1,
                }}>{d}</span>
              )}
              {evs && evs.map((e, ei) => (
                <div key={ei} style={{ width: 4, height: 4, borderRadius: '50%', background: e.color, boxShadow: `0 0 4px ${e.color}` }} />
              ))}
            </div>
          )
        })}
      </div>

      {Object.keys(events).length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #ffffff08', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {Object.entries(events).map(([day, evs]) =>
            evs.map((e, i) => (
              <div key={`${day}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 2, height: 14, background: e.color, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#888' }}>{e.label}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', marginLeft: 'auto' }}>
                  +{parseInt(day) - td}d
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
