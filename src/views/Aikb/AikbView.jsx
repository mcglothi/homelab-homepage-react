import { useState } from 'react'
import { C, MONO } from '../../ui/theme'
import { Button, Pill } from '../../ui/primitives'
import { ago, hoursLabel, useFeed } from '../../api/feeds'
import { AlertList, Bar, Card, Columns, FeedBadge, Muted, Row, Tile, Tiles, ViewShell } from '../bits'

// AIKB health, from aikb_health.py on Turing (read-only snapshot of the AIKB mirror,
// cached 60s server-side). Everything here is derived; nothing on this tab writes.

const GH = 'https://github.com/mcglothi/AIKB/blob/main/'
const WRITER_LABEL = {
  'session-stop': 'Session stops (agents)',
  'hopper-nightly': 'Hopper nightly',
  watch: 'watch (YouTube notes)',
  'agent-update': 'Agent doc updates',
  other: 'Other / manual',
}
const PRIORITY = { high: C.red, medium: C.amber, low: C.dim }

export default function AikbView() {
  const feed = useFeed('/api/aikb/health', 60000)
  const h = feed.data

  return (
    <ViewShell title="AIKB" subtitle={h ? `snapshot ${ago(h.generated)} · ${h.root} on Turing · ${h.took_ms} ms` : 'AI knowledge base health'}
      right={<FeedBadge feed={feed} name="aikb-health" />}>
      {!h ? (
        <div style={{ fontFamily: MONO, fontSize: 12, color: feed.error ? C.red : C.dim }}>
          {feed.error ? `Can't reach aikb-health on Turing (${feed.error}).` : 'Loading…'}
        </div>
      ) : <Body h={h} />}
    </ViewShell>
  )
}

function Body({ h }) {
  const g = h.git || {}
  const st = h.state || {}
  const unacked = Object.values(h.inbox || {}).reduce((n, b) => n + b.unacked, 0)
  const crit = (h.alerts || []).filter(a => a.level !== 'info').length

  return (
    <>
      <Tiles>
        <Tile label="Needs attention" value={crit} color={crit ? C.amber : C.green} sub={`${(h.alerts || []).length - crit} informational`} />
        <Tile label="Commits 24h" value={g.commits_24h} sub={`head ${ago(g.head_time)}`} />
        <Tile label="Markdown files" value={h.content?.md_files} sub={`${h.content?.tree_mib} MiB tree · ${(g.pack_kib / 1024).toFixed(1)} MiB packed`} />
        <Tile label="Search index" value={hoursLabel(h.index?.hours_ago)} sub={`old · ${h.index?.mib} MiB`}
          color={h.index?.hours_ago > 3 ? C.amber : undefined} />
        <Tile label="Pending items" value={st.pending?.length} sub={`${st.incidents?.length || 0} open incidents`}
          color={st.incidents?.length ? C.red : undefined} />
        <Tile label="Unacked IMs" value={unacked} sub={`${Object.keys(h.inbox || {}).length} inboxes`} />
        <Tile label="Memory candidates" value={h.promotion?.queued} sub="queued for review" color={h.promotion?.queued > 100 ? C.amber : undefined} />
        <Tile label="YouTube notes" value={h.content?.youtube_notes} sub="media/youtube" />
      </Tiles>

      <Columns>
        <Card title="Needs attention" color={crit ? C.amber : C.green}>
          <AlertList alerts={h.alerts} />
        </Card>

        <Card title="Writers · last 7 days" right={<Muted>mirror fetched {hoursLabel(g.mirror_fetch_hours_ago)} ago</Muted>}>
          {Object.entries(g.writers || {}).sort((a, b) => (a[1].hours_ago ?? 1e9) - (b[1].hours_ago ?? 1e9)).map(([w, d]) => (
            <Row key={w}>
              <span style={{ flex: 1, color: C.text }} title={d.last_subject}>{WRITER_LABEL[w] || w}</span>
              <span style={{ color: w === 'hopper-nightly' && g.hopper_nightly_stale ? C.amber : C.body }}>{hoursLabel(d.hours_ago)} ago</span>
              <Muted style={{ width: 54, textAlign: 'right' }}>{d.count_7d} commits</Muted>
            </Row>
          ))}
          <CommitSpark perDay={g.commits_per_day} />
        </Card>

        <Card title="Certificates">
          {(st.certs || []).map(c => (
            <Row key={c.name}>
              <span style={{ flex: 1, color: C.text }}>{c.name}</span>
              <span style={{ color: c.days_left < 7 ? C.red : c.warning || c.days_left < 21 ? C.amber : C.green }}>{c.days_left}d</span>
              <Muted>{c.expires}</Muted>
            </Row>
          ))}
          {!st.certs?.length && <Muted>none tracked in _state.yaml</Muted>}
        </Card>

        <Card title={`Open incidents · ${st.incidents?.length || 0}`} color={st.incidents?.length ? C.red : undefined}>
          {(st.incidents || []).map((i, n) => (
            <Row key={n}>
              <span style={{ flex: 1, color: C.text, lineHeight: 1.45 }}>{i.item}</span>
              {i.file && <a href={GH + i.file} target="_blank" rel="noreferrer" style={{ color: C.muted, fontSize: 10 }}>doc ↗</a>}
            </Row>
          ))}
          {!st.incidents?.length && <Muted>none</Muted>}
        </Card>

        <Pending items={st.pending || []} />
        <Inbox inbox={h.inbox || {}} />

        <Card title="Content by folder">
          {Object.entries(h.content?.by_top_dir || {}).slice(0, 12).map(([dir, d], i, arr) => (
            <Row key={dir} style={{ gap: 12 }}>
              <span style={{ width: 130, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir}</span>
              <Bar value={d.kib} max={arr[0][1].kib} />
              <Muted style={{ width: 120, textAlign: 'right' }}>{d.kib >= 1024 ? `${(d.kib / 1024).toFixed(1)} MiB` : `${d.kib} KiB`} · {d.md} md</Muted>
            </Row>
          ))}
        </Card>

        <Card title="Index · doctor · cron">
          <Row><span style={{ flex: 1 }}>Search index updated</span><span>{ago(h.index?.updated)}</span></Row>
          {(h.index?.log_tail || []).slice(-2).map((l, i) => <Row key={i}><Muted>{l}</Muted></Row>)}
          <Row>
            <span style={{ flex: 1 }}>doctor.py <Muted>(as seen from Turing's mirror)</Muted></span>
            {h.doctor?.summary && <span>{h.doctor.summary.ok}/{h.doctor.summary.total} ok</span>}
          </Row>
          {(h.doctor?.problems || []).map(p => (
            <Row key={p.name}>
              <Pill color={p.status === 'FAIL' ? C.red : C.amber}>{p.status}</Pill>
              <span style={{ flex: 1 }}>{p.name} <Muted>{p.detail}</Muted></span>
            </Row>
          ))}
          {(h.cron || []).map((c, i) => (
            <Row key={i}><Pill color={C.amber}>DEAD CRON</Pill><Muted style={{ flex: 1, wordBreak: 'break-all' }}>{c.entry}</Muted></Row>
          ))}
        </Card>
      </Columns>
    </>
  )
}

function CommitSpark({ perDay }) {
  const days = Object.entries(perDay || {}).slice(-7)
  if (!days.length) return null
  const max = Math.max(...days.map(d => d[1]))
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 46, marginTop: 12 }}>
      {days.map(([d, n]) => (
        <div key={d} title={`${d}: ${n} commits`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <div style={{ width: '100%', height: Math.max(2, (n / max) * 32), background: '#ffffff30', borderRadius: 2 }} />
          <Muted style={{ fontSize: 8 }}>{d.slice(8)}</Muted>
        </div>
      ))}
    </div>
  )
}

function Pending({ items }) {
  const [all, setAll] = useState(false)
  const rank = { high: 0, medium: 1, low: 2 }
  const sorted = [...items].sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3))
  const shown = all ? sorted : sorted.slice(0, 8)
  return (
    <Card title={`Pending · ${items.length}`} right={items.length > 8 &&
      <Button size="sm" variant="ghost" onClick={() => setAll(v => !v)}>{all ? 'less' : 'all'}</Button>}>
      {shown.map((p, i) => (
        <Row key={i}>
          <Pill color={PRIORITY[p.priority] || C.dim}>{p.priority || '—'}</Pill>
          <span style={{ flex: 1, color: C.text, lineHeight: 1.45 }}>
            {p.item}
            {p.blocked_by && <Muted> · blocked by {p.blocked_by}</Muted>}
          </span>
          {p.file && <a href={GH + p.file} target="_blank" rel="noreferrer" style={{ color: C.muted, fontSize: 10 }}>↗</a>}
        </Row>
      ))}
    </Card>
  )
}

function Inbox({ inbox }) {
  const sev = { blocker: C.red, warn: C.amber, review: C.violet, request: C.blue, info: C.dim }
  const agents = Object.entries(inbox).sort((a, b) => b[1].unacked - a[1].unacked)
  return (
    <Card title="Agent inboxes · unacked">
      {agents.map(([agent, box]) => (
        <div key={agent} style={{ marginBottom: 10 }}>
          <Row style={{ borderBottom: 'none', paddingBottom: 2 }}>
            <span style={{ flex: 1, color: C.text }}>{agent}</span>
            <span>{box.unacked}</span>
          </Row>
          {box.latest.slice(0, 3).map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, padding: '2px 0 2px 10px', fontFamily: MONO, fontSize: 10, color: C.muted }}>
              <span style={{ color: sev[m.severity] || C.dim, width: 52, flexShrink: 0 }}>{m.severity}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.summary}>{m.summary}</span>
              <span style={{ flexShrink: 0 }}>{ago(m.ts_utc)}</span>
            </div>
          ))}
        </div>
      ))}
    </Card>
  )
}
