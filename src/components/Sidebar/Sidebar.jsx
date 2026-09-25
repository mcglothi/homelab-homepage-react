import { StatTiles } from './StatTiles'
import { CalendarWidget } from './CalendarWidget'
import { GrafanaWidget } from './GrafanaWidget'
import { PowerWidget } from './PowerWidget'
import { AdGuardDonut } from './PiHoleDonut'
import { NetworkStats } from './NetworkStats'
import { QuickLinks } from './QuickLinks'

export function Sidebar({ accent, apiData }) {
  return (
    <div style={{
      width: 320, borderLeft: '1px solid #ffffff10',
      padding: '24px 20px', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 16,
      background: 'rgba(255,255,255,0.01)', flexShrink: 0,
    }}>
      <StatTiles adguard={apiData?.adguard} weather={apiData?.weather} />
      <CalendarWidget accent={accent} events={apiData?.calendarEvents} />
      <GrafanaWidget accent={accent} data={apiData?.grafana} />
      <PowerWidget accent={accent} data={apiData?.power} />
      <AdGuardDonut data={apiData?.adguard} />
      <NetworkStats accent={accent} data={apiData?.network} />
      <QuickLinks accent={accent} />
    </div>
  )
}
