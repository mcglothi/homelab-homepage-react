import { useState } from 'react'
import { dateKey, dateFromKey, weekKeys, toggleDate } from './calendarDates'
import './CalendarWidget.css'

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const shortDate = key => dateFromKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function CalendarWidget({ accent, events: eventsData }) {
  const now = new Date()
  const today = dateKey(now)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState([])
  const viewing = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const daysInMonth = new Date(viewing.getFullYear(), viewing.getMonth() + 1, 0).getDate()
  const thisWeek = weekKeys(now)
  const activeDays = selected.length ? selected : thisWeek
  const events = eventsData ?? {}
  const groups = activeDays.filter(key => events[key]?.length).map(key => ({ key, releases: events[key] }))
  const releaseCount = groups.reduce((total, group) => total + group.releases.length, 0)
  const cells = Array.from({ length: viewing.getDay() }, () => null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(dateKey(new Date(viewing.getFullYear(), viewing.getMonth(), day)))
  while (cells.length % 7) cells.push(null)

  const resetWeek = () => { setSelected([]); setOffset(0) }
  const heading = selected.length === 1 ? shortDate(selected[0]) : selected.length ? `${selected.length} selected days` : 'This week'

  return (
    <section className="release-calendar" style={{ '--calendar-accent': accent }} aria-label="Media release calendar">
      <div className="calendar-title-row">
        <h2>Releases</h2>
        <button className={`calendar-week-button ${!selected.length && offset === 0 ? 'is-active' : ''}`} onClick={resetWeek}>This week</button>
      </div>
      <div className="calendar-month-row">
        <button className="calendar-nav" aria-label="Previous month" disabled={offset === -1} onClick={() => setOffset(o => o - 1)}>‹</button>
        <h3>{viewing.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
        <button className="calendar-nav" aria-label="Next month" disabled={offset === 1} onClick={() => setOffset(o => o + 1)}>›</button>
      </div>
      <div className="calendar-grid calendar-weekdays" aria-hidden="true">
        {DAY_LABELS.map(day => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid" role="group" aria-label="Choose release dates">
        {cells.map((key, index) => {
          if (!key) return <span key={`blank-${index}`} />
          const releases = events[key] ?? []
          const colors = [...new Set(releases.map(event => event.color))]
          const isToday = key === today
          const isSelected = selected.includes(key)
          const inWeek = !selected.length && thisWeek.includes(key)
          const label = dateFromKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          return (
            <button key={key}
              className={`calendar-day ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${inWeek ? 'in-week' : ''}`}
              aria-label={`${label}, ${releases.length} ${releases.length === 1 ? 'release' : 'releases'}`}
              aria-pressed={isSelected} aria-current={isToday ? 'date' : undefined}
              title={`${label} · ${releases.length} ${releases.length === 1 ? 'release' : 'releases'}`}
              onClick={() => setSelected(days => toggleDate(days, key))}>
              <span>{dateFromKey(key).getDate()}</span>
              <span className="calendar-markers" aria-hidden="true">
                {colors.map(color => <i key={color} style={{ background: color }} />)}
              </span>
            </button>
          )
        })}
      </div>
      <div className="calendar-guide">
        <span>Click days to {selected.length ? 'add or remove' : 'select'}.</span>
        <span className="calendar-legend"><i style={{ background: '#35c5f4' }} />TV<i style={{ background: '#ffc230' }} />Film</span>
      </div>
      {selected.length > 0 && (
        <div className="calendar-selection" aria-label="Selected dates">
          {selected.map(key => <button key={key} aria-label={`Remove ${shortDate(key)} from selection`} onClick={() => setSelected(days => toggleDate(days, key))}>{shortDate(key)} <span aria-hidden="true">×</span></button>)}
        </div>
      )}
      <div className="calendar-agenda" aria-live="polite" aria-atomic="true">
        <div className="calendar-agenda-heading">
          <h3>{heading}</h3>
          <span>{releaseCount} {releaseCount === 1 ? 'release' : 'releases'}</span>
        </div>
        {!selected.length && <p className="calendar-range">{shortDate(thisWeek[0])} – {shortDate(thisWeek[6])}</p>}
        {eventsData == null ? <p className="calendar-empty">{eventsData === undefined ? 'Loading releases…' : 'Release data is unavailable right now.'}</p> : groups.length === 0 ? <p className="calendar-empty">No releases {selected.length ? 'on the selected days' : 'this week'}. Try another date.</p> : (
          <div className="calendar-release-list" tabIndex={0} aria-label="Releases for displayed dates">
            {groups.map(({ key, releases }) => (
              <div className="calendar-release-group" key={key}>
                <h4>{dateFromKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{key === today && <span>Today</span>}</h4>
                {releases.map((release, index) => (
                  <div className="calendar-release" key={`${key}-${index}`} style={{ '--release-color': release.color }}>
                    <span className="calendar-release-type">{release.type === 'movie' ? 'FILM' : 'TV'}</span>
                    <span>{release.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
