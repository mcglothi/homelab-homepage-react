import { useState } from 'react'
import { C, MONO, SANS } from '../../ui/theme'
import { Button, Pill, TextInput, toast } from '../../ui/primitives'
import { ago, duration, getJSON, postJSON, useFeed } from '../../api/feeds'
import { AlertList, Card, Columns, FeedBadge, Muted, Row, Tile, Tiles, ViewShell } from '../bits'

// watch: YouTube history → ledger + curated AIKB notes (service on Turing :8790).
// The review queue is the borderline pile (triage score 1): Promote writes an AIKB
// note (takes ~1 min in the background), Dismiss clears it. Nothing is ever lost —
// the ledger keeps every video and its transcript, which the search box covers.

const GH = 'https://github.com/mcglothi/AIKB/blob/main/'
const yt = (id, t) => `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`
const STATUS_COLOR = { kept: C.green, borderline: C.violet, dropped: C.dim, skipped: C.faint, no_transcript: C.dim,
  new: C.blue, error: C.red, unavailable: C.faint, dismissed: C.faint, promoting: C.amber }

export default function WatchView() {
  const status = useFeed('/api/watch/status', 30000)
  const queue = useFeed('/api/watch/queue?limit=50', 60000)
  const recent = useFeed('/api/watch/recent?status=kept&limit=25', 60000)
  const runs = useFeed('/api/watch/runs?limit=8', 60000)
  const s = status.data

  return (
    <ViewShell title="Watch" subtitle="YouTube → AIKB · history, likes and the AIKB playlist, every 2h on Turing"
      right={<FeedBadge feed={status} name="watch" />}>
      {s && <Summary s={s} />}
      <Columns>
        <Queue feed={queue} onChange={() => { queue.reload(); recent.reload(); status.reload() }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Search />
          <Recent feed={recent} />
          <Runs feed={runs} />
        </div>
      </Columns>
    </ViewShell>
  )
}

function Summary({ s }) {
  const c = s.counts || {}
  const w = s.last_7_days || {}
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  const lr = s.last_run || {}
  const lrStats = (() => { try { return JSON.parse(lr.stats || '{}') } catch { return {} } })()
  const authBad = s.auth?.ok === false
  const alerts = []
  if (authBad) alerts.push({ level: 'crit', text: `YouTube login expired (${ago(s.auth.checked)}). Re-export cookies.txt from a private Brave window → turing:~/.config/watch/cookies.txt` })
  if (lr.ok === 0) alerts.push({ level: 'warn', text: `Last sync failed: ${lr.error || 'see journalctl --user -u watch-sync'}` })
  if (lrStats.rate_limited) alerts.push({ level: 'warn', text: 'Last sync stopped early: YouTube rate limit (it resumes next run)' })
  if (s.last_success && Date.now() - new Date(s.last_success) > 6 * 3600e3) alerts.push({ level: 'warn', text: `No successful sync since ${ago(s.last_success)}` })

  return (
    <>
      <Tiles>
        <Tile label="Kept" value={c.kept || 0} sub={`${w.kept || 0} this week`} color={C.green} />
        <Tile label="Review queue" value={c.borderline || 0} sub="borderline" color={c.borderline ? C.violet : undefined} />
        <Tile label="Backlog" value={s.pending} sub="waiting to process" color={s.pending > 200 ? C.amber : undefined} />
        <Tile label="Seen" value={total} sub={`${(c.dropped || 0) + (c.skipped || 0)} dropped/skipped`} />
        <Tile label="YouTube login" value={authBad ? 'EXPIRED' : s.auth?.ok ? 'OK' : '?'} color={authBad ? C.red : s.auth?.ok ? C.green : C.dim}
          sub={s.auth?.checked ? `checked ${ago(s.auth.checked)}` : 'not checked yet'} />
        <Tile label="Last sync" value={ago(lr.finished)} color={lr.ok === 0 ? C.red : undefined}
          sub={lr.stats ? Object.entries(lrStats).filter(([k]) => !k.startsWith('seen')).map(([k, v]) => `${k} ${v}`).join(' · ') : ''} />
      </Tiles>
      {alerts.length > 0 && <div style={{ marginBottom: 18 }}><AlertList alerts={alerts} /></div>}
    </>
  )
}

function VideoTitle({ v, t }) {
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <a href={yt(v.id, t)} target="_blank" rel="noreferrer"
        style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: C.text, textDecoration: 'none', lineHeight: 1.35 }}>{v.title}</a>
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
        {v.channel}{v.duration ? ` · ${duration(v.duration)}` : ''}{(v.watched_at || v.first_seen) ? ` · ${ago(v.watched_at || v.first_seen)}` : ''}
      </div>
    </div>
  )
}

function Queue({ feed, onChange }) {
  const [busy, setBusy] = useState({})
  const [gone, setGone] = useState(new Set())
  const act = async (v, action) => {
    setBusy(b => ({ ...b, [v.id]: action }))
    try {
      await postJSON(`/api/watch/${action}/${v.id}`)
      setGone(g => new Set(g).add(v.id))
      toast(action === 'promote' ? `Writing a note for "${v.title.slice(0, 40)}"…` : 'Dismissed')
      setTimeout(onChange, action === 'promote' ? 60000 : 500)
    } catch (e) {
      toast(`${action} failed: ${e.message}`)
    } finally {
      setBusy(b => { const n = { ...b }; delete n[v.id]; return n })
    }
  }
  const items = (feed.data || []).filter(v => !gone.has(v.id))
  return (
    <Card title={`Review queue · ${items.length}`} color={C.violet}
      right={<Muted>triage said "maybe" — promote what's worth keeping</Muted>}>
      {!items.length && <Muted>{feed.loading ? 'loading…' : 'queue is empty ✓'}</Muted>}
      {items.map(v => (
        <div key={v.id} style={{ padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <VideoTitle v={v} />
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <Button size="sm" variant="primary" color={C.green} disabled={!!busy[v.id]} onClick={() => act(v, 'promote')}>
                {busy[v.id] === 'promote' ? '…' : 'Promote'}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy[v.id]} onClick={() => act(v, 'dismiss')}>Dismiss</Button>
            </div>
          </div>
          {v.reason && <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 5 }}>{v.score}/3 · {v.reason}</div>}
        </div>
      ))}
    </Card>
  )
}

function Search() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async e => {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    try { setRes(await getJSON(`/api/watch/find?q=${encodeURIComponent(q)}&limit=12`)) }
    catch (err) { toast(`search failed: ${err.message}`) }
    finally { setBusy(false) }
  }
  return (
    <Card title="Which video was it…?">
      <form onSubmit={run} style={{ display: 'flex', gap: 8 }}>
        <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="describe what you remember — searches every transcript" />
        <Button variant="primary" disabled={busy}>{busy ? '…' : 'Find'}</Button>
      </form>
      {res && (
        <div style={{ marginTop: 10 }}>
          {!res.length && <Muted>no matches</Muted>}
          {res.map(r => (
            <div key={r.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <a href={r.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontFamily: SANS, fontSize: 13, color: C.text, textDecoration: 'none' }}>{r.title}</a>
                <Pill color={STATUS_COLOR[r.status] || C.dim}>{r.status}</Pill>
                {r.note_path && <a href={GH + r.note_path} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 10, color: C.green }}>note ↗</a>}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 2 }}>{r.channel}</div>
              {r.snip && <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{r.snip}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Recent({ feed }) {
  return (
    <Card title="Recently kept">
      {(feed.data || []).map(v => (
        <div key={v.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
          <VideoTitle v={v} />
          {v.note_path && <a href={GH + v.note_path} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 10, color: C.green, flexShrink: 0 }}>note ↗</a>}
        </div>
      ))}
      {!feed.data?.length && <Muted>{feed.loading ? 'loading…' : 'nothing kept yet'}</Muted>}
    </Card>
  )
}

function Runs({ feed }) {
  return (
    <Card title="Recent syncs">
      {(feed.data || []).map(r => {
        let st = {}
        try { st = JSON.parse(r.stats || '{}') } catch { /* old row */ }
        return (
          <Row key={r.id}>
            <span style={{ color: r.ok ? C.green : C.red, width: 14 }}>{r.ok ? '✓' : '✗'}</span>
            <span style={{ width: 70 }}>{ago(r.finished)}</span>
            <Muted style={{ flex: 1 }}>
              {r.error ? r.error.slice(0, 90) : Object.entries(st).filter(([k]) => !k.startsWith('seen')).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing new'}
            </Muted>
          </Row>
        )
      })}
    </Card>
  )
}
