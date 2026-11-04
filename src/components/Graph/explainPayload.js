import { KIND, facetOf, FACETS } from './analysis'
import { rowsOf, outliers, DEFAULT_COLS } from './facts'
import { relation } from './relations'

// What "Explain this graph" sends: the relationships, not the page. A short list of who/what owns, hosts, runs and
// targets what (by name, never by id), grouped by hub and pruned to what matters (the search, the selection, the
// compare picks, hubs, flagged links), plus what needs attention and the tickets and runs tied to these items.
// Ticket and run summaries only: no bodies, no secrets. Capped at about 12,000 characters (3-4k tokens).

const LIMIT = 12000
const cut = (t, n = 90) => String(t ?? '').replace(/\s+/g, ' ').slice(0, n)
const attr = (n, k) => (n.attrs || []).find(a => a[0] === k)?.[1]
const WEAK = new Set(['about', 'reported', 'found', 'describes', 'inferred'])

export function buildExplain({ raw, model, ix, seeds, sel, multi, cmp, focus, search }) {
  const nodes = new Map(raw.nodes.map(n => [n.id, n]))
  const bc = new Map((model?.nodes ?? []).map(n => [n.id, n.bc || 0]))
  const label = id => nodes.get(id)?.label ?? String(id).replace(/^[a-z]+:/, '')
  const nm = id => { const n = nodes.get(id); return n ? `${n.label} (${(KIND[n.kind] ?? n.kind).replace(/ \/ VMs$/, '').toLowerCase()})` : label(id) }
  const flagged = new Set()
  raw.edges.forEach(e => { if (e.flag === 'conflict' || e.flag === 'missing') { flagged.add(e.a); flagged.add(e.b) } })
  const focusIds = new Set([...(seeds || []), sel, ...multi].filter(Boolean))
  const imp = id => (focusIds.has(id) ? 6 : 0) + 3 * (bc.get(id) || 0) + (nodes.get(id)?.result ? 1.5 : 0) + (flagged.has(id) ? 2 : 0)

  // relationships grouped by (parent, verb): "Team Automation --manages--> a, b, c (+4 more)"
  const groups = new Map()
  raw.edges.forEach(e => {
    if (WEAK.has(e.kind) || e.kind === 'monitor' || !nodes.has(e.a) || !nodes.has(e.b)) return
    const verb = relation(e, false).sentence   // the forward reading: "manages", "contains", "runs on"-style verbs from the table
    if (!verb) return
    const k = e.a + '|' + verb
    if (!groups.has(k)) groups.set(k, { a: e.a, verb, kids: [], score: imp(e.a) })
    const g = groups.get(k)
    g.kids.push(e.b)
    g.score += imp(e.b) * 0.5 + (e.flag ? 1 : 0)
  })
  const rel = [...groups.values()].sort((x, y) => y.score - x.score).slice(0, 45).map(g => {
    const kids = g.kids.slice().sort((p, q) => imp(q) - imp(p))
    const shown = kids.slice(0, 7).map(label).join(', ')
    return `${nm(g.a)} --${g.verb}--> ${shown}${kids.length > 7 ? ` (+${kids.length - 7} more)` : ''}`
  })
  // monitoring and coverage tools, as one line each
  const tools = new Map()
  raw.edges.forEach(e => { if (e.kind === 'monitor' && nodes.has(e.a) && nodes.has(e.b)) { const t = label(e.b); tools.set(t, (tools.get(t) || 0) + 1) } })
  if (tools.size) rel.push('Tools covering these hosts: ' + [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, c]) => `${t} (${c})`).join(', '))

  // what needs attention
  const att = []
  raw.edges.forEach(e => {
    if (e.flag === 'conflict') att.push(`Sources disagree: ${label(e.a)} / ${label(e.b)}: ${cut(e.detail, 140)}`)
    if (e.flag === 'missing') att.push(`Expected link missing: ${label(e.a)} to ${label(e.b)}`)
  })
  const owned = new Set(raw.edges.filter(e => e.kind === 'owner').map(e => e.b))
  const hosts = raw.nodes.filter(n => n.kind === 'host' && n.result)
  const noOwner = hosts.filter(n => !owned.has(n.id)).map(n => n.label)
  if (noOwner.length) att.push(`No owner on record: ${noOwner.slice(0, 8).join(', ')}${noOwner.length > 8 ? ` (+${noOwner.length - 8})` : ''}`)
  const noCmdb = hosts.filter(n => attr(n, 'In CMDB') && attr(n, 'In CMDB') !== 'yes').map(n => n.label)
  if (noCmdb.length) att.push(`Not in the CMDB: ${noCmdb.slice(0, 8).join(', ')}${noCmdb.length > 8 ? ` (+${noCmdb.length - 8})` : ''}`)
  const dups = hosts.filter(n => attr(n, 'CMDB duplicates')).map(n => n.label)
  if (dups.length) att.push(`Duplicated in the CMDB: ${dups.slice(0, 6).join(', ')}`)
  try {
    outliers(rowsOf(raw, ix), ix, DEFAULT_COLS, 'team').slice(0, 4).forEach(o =>
      {
      const none = v => (v === '(missing)' ? 'no value' : v)
      att.push(`Out of pattern${o.group ? ' in team ' + o.group : ''}: ${o.names.slice(0, 4).join(', ')} ${o.facet.label.toLowerCase()} is ${none(o.value)}, while ${o.share}% of the group have ${none(o.majority)}`)
    })
  } catch (e) { /* the pattern check is a bonus */ }

  // runs and jobs
  const runs = raw.nodes.filter(n => n.kind === 'run')
  const failed = runs.filter(n => /fail|error|cancel/i.test(attr(n, 'Status') || '')).slice(0, 5)
  failed.forEach(n => att.push(`Failed run: ${n.label}: ${cut(n.sub, 110)}`))
  raw.nodes.filter(n => n.kind === 'job' && attr(n, 'Note')).slice(0, 3).forEach(n => att.push(`Control-M job ${n.label}: ${attr(n, 'Note')} (${cut(attr(n, 'Detail'), 90)})`))

  // tickets tied to these items: open first
  const tickets = raw.nodes.filter(n => n.kind === 'ticket').map(n => {
    const about = []
    raw.edges.forEach(e => { if ((e.a === n.id || e.b === n.id) && (e.kind === 'about' || e.kind === 'reported')) { const o = e.a === n.id ? e.b : e.a; if (nodes.get(o)?.kind !== 'ticket') about.push(label(o)) } })
    const open = !/done|closed|resolved/i.test(attr(n, 'Status') || '')
    return { n, open, about: [...new Set(about)].slice(0, 3) }
  }).sort((x, y) => (y.open - x.open) || (y.about.some(a => focusIds.has(a)) - x.about.some(a => focusIds.has(a))))
  const tk = tickets.slice(0, 10).map(t => `${t.n.label} · ${attr(t.n, 'Status') || '?'} · ${cut(attr(t.n, 'Detail'), 70)} · "${cut(t.n.sub, 100)}"${t.about.length ? ' · about ' + t.about.join(', ') : ''}`)

  // the selection and the comparison come first
  const selected = sel && nodes.get(sel)
  const selection = selected ? {
    name: nm(sel), about: cut(selected.sub, 100),
    attributes: (selected.attrs || []).filter(a => !/^(Link|Source|Found in)$/.test(a[0]) && a[1] && a[1] !== '—').slice(0, 8).map(a => `${a[0]}: ${cut(a[1], 60)}`),
    links: raw.edges.filter(e => (e.a === sel || e.b === sel) && !WEAK.has(e.kind)).slice(0, 14).map(e => `${e.a === sel ? label(sel) : nm(e.a)} ${relation(e, false).sentence} ${e.b === sel ? label(sel) : nm(e.b)}` + (e.flag ? ` [${e.flag}]` : '')),
  } : null
  let compare = null
  if (cmp && multi.length >= 2) {
    compare = {
      picks: multi.map(nm),
      shared: cmp.shared.filter(s => !s.facet.flag).slice(0, 10).map(s => `${s.facet.label}: ${s.of === s.ids.length ? 'all ' + s.of : s.ids.length + ' of ' + s.of} share ${cut(s.value, 50)}${s.odd ? `; odd one out: ${label(s.odd.ids[0])} has ${cut(s.odd.v, 40)}` : ''}`),
      differ: cmp.differs.slice(0, 8).map(d => `${d.facet.label}: ${d.groups.slice(0, 4).map(g => `${cut(g.v, 30)} x${g.ids.length}`).join(' | ')}`),
      other_common_links: cmp.neighbors.slice(0, 6).map(x => `${x.n} of ${x.of} connect to ${nm(x.node.id)}`),
    }
  }
  const out = {
    question: compare ? 'What do the compared items share, and how do they differ?' : selection ? `How does ${selection.name} fit in, and what matters about it?` : 'How do these items relate, and what matters?',
    searched_for: cut(search, 80), seeds: [...(seeds || [])].map(label),
    focus: focus.size ? [...focus].map(f => FACETS[f] ?? f) : null,
    compare, selection, relationships: rel, needs_attention: att.slice(0, 16), tickets: tk,
  }
  // fit the budget: drop the least important relationship lines first
  const size = () => JSON.stringify(out).length
  while (size() > LIMIT && out.relationships.length > 12) out.relationships.pop()
  while (size() > LIMIT && out.tickets.length > 4) out.tickets.pop()
  while (size() > LIMIT && out.needs_attention.length > 6) out.needs_attention.pop()
  out.counts = { relationships: out.relationships.length, tickets: out.tickets.length, flags: out.needs_attention.length }
  return out
}
