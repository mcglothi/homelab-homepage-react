import { useState } from 'react'
import { C, MONO, SANS } from '../../ui/theme'
import { Button, Pill, TextArea, TextInput, toast } from '../../ui/primitives'
import { patchJSON, postJSON, useFeed } from '../../api/feeds'
import { AlertList, Card, Columns, FeedBadge, Muted, Tile, Tiles, ViewShell } from '../bits'

// Growth community-replies queue (service on Turing :3055, proxied at /api/growth).
// Phase 1 is review-only: Approve and Skip write a decision to SQLite and never post.

const itemsOf = data => (Array.isArray(data) ? data : data?.items) || []
const countsOf = data => data?.counts || {}

export default function GrowthView() {
  const queue = useFeed('/api/growth/queue?status=pending', 30000)
  const health = useFeed('/api/growth/health', 30000)
  const items = itemsOf(queue.data)
  const counts = countsOf(queue.data)
  const alerts = []
  if (queue.error) alerts.push({ level: 'warn', text: `Growth API unreachable (${queue.error}). The tab stays empty until the service is running on Turing :3055.` })
  if (health.data?.posting) alerts.push({ level: 'crit', text: 'API reported posting enabled — phase 1 should record decisions only.' })

  return (
    <ViewShell title="Growth" subtitle="Community replies · review queue · phase 1 records decisions, it does not post"
      right={<FeedBadge feed={queue} name="growth" />}>
      {alerts.length > 0 && <div style={{ marginBottom: 18 }}><AlertList alerts={alerts} /></div>}
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.amber, marginBottom: 16, lineHeight: 1.45 }}>
        Approve does not publish. It only stores your decision. Hacker News stays copy-and-open.
      </div>
      <Tiles>
        <Tile label="Pending" value={items.length} sub="awaiting review" color={items.length ? C.violet : undefined} />
        <Tile label="Approved" value={counts.approved ?? counts.approved_today ?? '—'} sub="decision only, not posted" />
        <Tile label="Skipped" value={counts.skipped ?? counts.skipped_today ?? '—'} />
        <Tile label="Draft failed" value={counts.draft_failed ?? '—'} color={counts.draft_failed ? C.amber : undefined} />
      </Tiles>
      <Columns>
        <Queue feed={queue} items={items} onChange={() => queue.reload()} />
      </Columns>
    </ViewShell>
  )
}

function Queue({ feed, items, onChange }) {
  const [gone, setGone] = useState(new Set())
  const visible = items.filter(d => !gone.has(d.id))
  return (
    <Card title={`Review queue · ${visible.length}`} color={C.violet}
      right={<Muted>phase 1 · no posting</Muted>}>
      {!visible.length && <Muted>{feed.loading ? 'loading…' : 'queue is empty ✓'}</Muted>}
      {visible.map(d => (
        <DraftCard key={d.id} draft={d}
          onDone={() => { setGone(g => new Set(g).add(d.id)); onChange() }} />
      ))}
    </Card>
  )
}

function DraftCard({ draft, onDone }) {
  const [text, setText] = useState(draft.body || draft.draft_text || draft.text || '')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState('')
  const platform = (draft.platform || '').toLowerCase()
  const isHn = platform === 'hn' || platform === 'hackernews' || platform === 'hacker_news'
  const title = draft.thread_title || draft.title || 'Untitled thread'
  const url = draft.thread_url || draft.url
  const scores = draft.scores || {}
  const scoreLine = [
    scores.relevance != null ? `rel ${scores.relevance}` : null,
    scores.helpfulness != null ? `help ${scores.helpfulness}` : null,
    scores.freshness != null ? `fresh ${scores.freshness}` : null,
    draft.score != null && !scores.relevance ? `score ${draft.score}` : null,
  ].filter(Boolean).join(' · ')

  const run = async (label, fn, okMsg) => {
    setBusy(label)
    try {
      await fn()
      toast(okMsg)
      onDone()
    } catch (e) {
      toast(`${label} failed: ${e.message}`)
    } finally {
      setBusy('')
    }
  }

  const save = () => run('save', () => patchJSON(`/api/growth/queue/${draft.id}`, { body: text }), 'Draft saved')
  const approve = () => run('approve', () => postJSON(`/api/growth/queue/${draft.id}/approve`, pin ? { pin } : {}), 'Decision recorded — not posted')
  const skip = () => run('skip', () => postJSON(`/api/growth/queue/${draft.id}/skip`, {}), 'Skipped')
  const manualDone = () => run('mark-done', () => postJSON(`/api/growth/queue/${draft.id}/manual-done`, {}), 'Marked as posted by hand')

  const copyOpen = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* still open the thread */ }
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    toast('Draft copied' + (url ? ', thread opened' : ''))
  }

  return (
    <div style={{ padding: '14px 0', borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer"
              style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: C.text, textDecoration: 'none', lineHeight: 1.35 }}>{title}</a>
          ) : (
            <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: C.text, lineHeight: 1.35 }}>{title}</div>
          )}
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill color={C.blue}>{draft.platform || 'unknown'}</Pill>
            {draft.product && <span>{draft.product}</span>}
            {scoreLine && <span>{scoreLine}</span>}
            {draft.created_at && <span>{ago(draft.created_at)}</span>}
            {draft.link_included || draft.has_link ? <span style={{ color: C.amber }}>contains a link</span> : null}
          </div>
        </div>
      </div>
      {(draft.snippet || draft.thread_snippet) && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>{draft.snippet || draft.thread_snippet}</div>
      )}
      <TextArea value={text} onChange={e => setText(e.target.value)} rows={5} style={{ marginTop: 10 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        <Button size="sm" onClick={save} disabled={!!busy}>{busy === 'save' ? '…' : 'Save'}</Button>
        {isHn ? (
          <>
            <Button size="sm" variant="primary" onClick={copyOpen} disabled={!!busy}>Copy and open thread</Button>
            <Button size="sm" onClick={manualDone} disabled={!!busy}>{busy === 'mark-done' ? '…' : 'I posted this'}</Button>
          </>
        ) : (
          <Button size="sm" variant="primary" color={C.green} onClick={approve} disabled={!!busy}>
            {busy === 'approve' ? '…' : 'Approve'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={skip} disabled={!!busy}>{busy === 'skip' ? '…' : 'Skip'}</Button>
        {!isHn && (
          <TextInput type="password" autoComplete="off" placeholder="PIN if set" value={pin} onChange={e => setPin(e.target.value)}
            style={{ width: 110, padding: '4px 8px', flex: '0 0 110px' }} />
        )}
      </div>
    </div>
  )
}
