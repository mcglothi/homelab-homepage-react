import { C, MONO } from '../../ui/theme'
import { ago, useFeed } from '../../api/feeds'
import { Bar, Card, Columns, DataTable, Muted, Row, Tile, Tiles, ViewShell } from '../bits'

const nfmt = n => n == null ? '—' : new Intl.NumberFormat('en-US').format(n)
const tokenFmt = n => {
  if (n == null) return '—'
  if (Math.abs(n) < 1000) return nfmt(n)
  return `${(n / 1000).toFixed(1)}k`
}
const moneyFmt = n => n == null ? '—' : `$${Number(n).toFixed(2)}`
const pctColor = n => n > 90 ? C.red : n >= 70 ? C.amber : C.green

const metricColumns = [
  { key: 'key', label: 'Name' },
  { key: 'jobs', label: 'Jobs', render: nfmt },
  { key: 'fail', label: 'Fail', render: nfmt },
  { key: 'in_tok', label: 'In', render: tokenFmt },
  { key: 'out_tok', label: 'Out', render: tokenFmt },
  { key: 'cost_usd', label: 'Cost', render: moneyFmt },
]

export default function UsageView() {
  const feed = useFeed('/api/usage/summary', 60000)
  const data = feed.data

  return (
    <ViewShell title="AI Usage"
      subtitle={data ? `generated ${ago(data.generated_at)} · ${data.since || '7d'} window` : 'AI job usage and quota windows · 7d'}
      right={<span style={{ fontFamily: MONO, fontSize: 10, color: feed.error ? C.red : feed.loading ? C.dim : C.green }}>{feed.error ? `feed error · ${feed.error}` : feed.loading ? 'loading usage' : 'usage live'}</span>}>
      {!data ? (
        <div style={{ fontFamily: MONO, fontSize: 12, color: feed.error ? C.red : C.dim }}>
          {feed.error ? `Can't load AI usage (${feed.error}).` : 'Loading…'}
        </div>
      ) : <UsageBody data={data} />}
    </ViewShell>
  )
}

function UsageBody({ data }) {
  const totals = data.totals || {}
  const providers = data.by_provider || []
  const providerDays = data.by_provider_day || {}

  return (
    <>
      {data.quota_source === 'unavailable' && <div style={{ fontFamily: MONO, fontSize: 11, color: C.amber, marginBottom: 14 }}>Quota data unavailable</div>}
      {!!data.errors?.length && <div style={{ fontFamily: MONO, fontSize: 9, color: C.dim, marginBottom: 14 }}>{data.errors.map((e, i) => <div key={i}>{e}</div>)}</div>}

      <Card title="Current windows" style={{ marginBottom: 18 }}>
        {!data.windows?.length ? <Muted>no quota windows</Muted> : <Columns min={250}>
          {data.windows.map((w, i) => {
            const color = w.used_pct == null ? C.dim : pctColor(w.used_pct)
            return <div key={w.quota || i} style={{ padding: '6px 0' }}>
              <Row style={{ borderBottom: 0, padding: '0 0 7px' }}>
                <span style={{ color: C.text, flex: 1 }}>{w.quota || '—'}</span>
                <span style={{ color }}>{w.used_pct == null ? '—' : `${w.used_pct.toFixed(1)}%`}</span>
              </Row>
              <Bar value={w.used_pct ?? 0} max={100} color={color} />
              <Muted style={{ display: 'block', marginTop: 7 }}>{nfmt(w.jobs)} jobs · {tokenFmt(w.job_tok)} tokens{w.since ? ` · since ${ago(w.since)}` : ''}</Muted>
            </div>
          })}
        </Columns>}
      </Card>

      <Tiles>
        <Tile label="Jobs" value={nfmt(totals.jobs)} />
        <Tile label="Fail" value={nfmt(totals.fail)} color={totals.fail > 0 ? C.red : C.text} />
        <Tile label="Input tokens" value={tokenFmt(totals.in_tok)} />
        <Tile label="Output tokens" value={tokenFmt(totals.out_tok)} />
        <Tile label="Cost" value={moneyFmt(totals.cost_usd)} />
      </Tiles>

      <Columns min={440}>
        <Breakdown title="By provider" rows={providers} />
        <Breakdown title="By bot" rows={data.by_bot} />
        <Breakdown title="By caller" rows={data.by_caller} />
        <Breakdown title="By lane" rows={data.by_lane} />
        <Card title="Provider activity · daily jobs">
          {!providers.length ? <Muted>no provider data</Muted> : providers.map(p => <ProviderSpark key={p.key} name={p.key} days={providerDays[p.key] || []} />)}
        </Card>
      </Columns>
    </>
  )
}

function Breakdown({ title, rows = [] }) {
  return <Card title={title}><DataTable columns={metricColumns} rows={rows} /></Card>
}

function ProviderSpark({ name, days }) {
  const vals = days.map(d => Number(d.jobs) || 0)
  const max = Math.max(1, ...vals)
  const points = vals.map((v, i) => `${days.length < 2 ? 4 : 4 + i * (112 / (days.length - 1))},${28 - (v / max) * 24}`).join(' ')
  return (
    <Row style={{ alignItems: 'center' }}>
      <span style={{ width: 88, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {days.length ? <svg viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label={`${name} daily jobs`} style={{ width: 120, height: 32, flex: 1, overflow: 'visible' }}>
        {vals.length === 1 ? <circle cx="4" cy={28 - (vals[0] / max) * 24} r="2" fill={C.blue} /> : <polyline points={points} fill="none" stroke={C.blue} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      </svg> : <Muted style={{ flex: 1 }}>no daily data</Muted>}
      <Muted style={{ width: 56, textAlign: 'right' }}>{nfmt(vals.reduce((a, b) => a + b, 0))} jobs</Muted>
    </Row>
  )
}
