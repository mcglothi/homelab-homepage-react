import { useFeed } from '../../api/feeds'
import { link } from '../../router'
import { AlertList } from '../../views/bits'

// The few things across Docket's tabs that want a human: AIKB warnings and the
// watch job's health. Informational items stay on their tabs.
export function NeedsAttention({ accent }) {
  const aikb = useFeed('/api/aikb/health', 120000)
  const watch = useFeed('/api/watch/status', 120000)
  const alerts = []
  for (const a of aikb.data?.alerts || []) {
    if (a.level !== 'info') alerts.push({ ...a, href: '/aikb' })
  }
  const w = watch.data
  if (w?.auth?.ok === false) alerts.push({ level: 'crit', text: 'watch: YouTube login expired', href: '/watch' })
  if (w?.counts?.borderline) alerts.push({ level: 'info', text: `watch: ${w.counts.borderline} videos to review`, href: '/watch' })
  if (aikb.error) alerts.push({ level: 'warn', text: 'aikb-health on Turing unreachable', href: '/aikb' })
  if (watch.error) alerts.push({ level: 'warn', text: 'watch API on Turing unreachable', href: '/watch' })
  const order = { crit: 0, warn: 1, info: 2 }
  alerts.sort((a, b) => order[a.level] - order[b.level])

  return (
    <div>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 2, color: accent, marginBottom: 10 }}>
        NEEDS ATTENTION
      </div>
      <div onClick={e => { const a = e.target.closest('a'); if (a) link(a.getAttribute('href'))(e) }}>
        <AlertList alerts={alerts.slice(0, 7)} empty={aikb.loading || watch.loading ? 'checking…' : 'all clear'} />
      </div>
    </div>
  )
}
