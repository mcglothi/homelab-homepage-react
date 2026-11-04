// Correlation helpers shared by the graph's "What do these share?" panel and the pivot grid. Everything is derived
// from the {nodes, edges} the graph already has: a host's facts come from its place in the hierarchy (team, cluster,
// hypervisor, datacenter, subnet, inventory, pool) and from the attributes the backend put on the node.

// Each facet is either a relation (the nearest ancestor whose id has this prefix) or a node attribute.
export const FACETS = [
  { key: 'owner', label: 'Owner (person)', direct: 'p', kinds: ['owner'], multi: true },
  { key: 'team', label: 'Team (owning)', direct: 't', kinds: ['owner'], multi: true },
  { key: 'cluster', label: 'Cluster', rel: 'c' },
  { key: 'hv', label: 'Hypervisor host', rel: 'hv' },
  { key: 'dc', label: 'Datacenter', rel: 'dc' },
  { key: 'subnet', label: 'Subnet', rel: 's' },
  { key: 'inventory', label: 'AAP inventory', rel: 'v', multi: true },
  { key: 'pool', label: 'Horizon pool', rel: 'hp' },
  { key: 'env', label: 'Environment', attr: 'Environment' },
  { key: 'tier', label: 'App tier', attr: 'App tier' },
  { key: 'os', label: 'OS', attr: 'OS (CMDB)' },
  { key: 'type', label: 'Type', attr: 'Type' },
  { key: 'status', label: 'CMDB status', attr: 'Status' },
  { key: 'power', label: 'Power', attr: 'Power (Prism)' },
  { key: 'seen', label: 'Last discovered', attr: 'Last discovered', day: true },
  { key: 'f_cmdb', label: 'In CMDB', attr: 'In CMDB', flag: true },
  { key: 'f_prism', label: 'In Prism', attr: 'In Prism', flag: true },
  { key: 'f_horizon', label: 'In Horizon', attr: 'In Horizon', flag: true },
  { key: 'f_aap', label: 'In AAP', attr: 'In AAP', flag: true },
  { key: 'f_omni', label: 'In OmniCenter', attr: 'In OmniCenter', flag: true },
  { key: 'f_splunk', label: 'In Splunk', attr: 'In Splunk', flag: true },
  { key: 'f_insights', label: 'In Red Hat Insights', attr: 'In Red Hat Insights', flag: true },
  { key: 'f_dns', label: 'In DNS', attr: 'In DNS', flag: true },
  { key: 'dups', label: 'CMDB duplicates', attr: 'CMDB duplicates' },
]
export const DEFAULT_COLS = ['team', 'owner', 'cluster', 'os', 'dc', 'f_cmdb', 'f_prism', 'f_horizon']
export const FACET = Object.fromEntries(FACETS.map(f => [f.key, f]))
export const ROW_KINDS = new Set(['host', 'hv'])

const prefixOf = id => id.slice(0, id.indexOf(':'))

// Index of the whole result: nodes by id, parent lists, and the conflict flags on each host's links
export function indexGraph(raw) {
  const byId = new Map(raw.nodes.map(n => [n.id, n]))
  const parents = new Map()
  const conflicts = new Map()   // child id -> [{col facet key, detail}]
  const direct = new Map()      // child id -> [{id, kind, via}] its direct parents, with the kind of link
  raw.edges.forEach(e => {
    if (e.flag === 'inferred') return
    if (e.kind !== 'monitor') {
      if (!parents.has(e.b)) parents.set(e.b, [])
      parents.get(e.b).push(e.a)
      if (!direct.has(e.b)) direct.set(e.b, [])
      direct.get(e.b).push({ id: e.a, kind: e.kind, via: e.via })
    }
    if (e.flag === 'conflict') {
      const host = e.kind === 'monitor' ? e.a : e.b
      const other = e.kind === 'monitor' ? e.b : e.a
      const col = /OS/i.test(e.label || '') ? 'os' : other.startsWith('s:') ? 'subnet' : other.startsWith('c:') || other.startsWith('hv:') ? 'cluster' : null
      if (col) { if (!conflicts.has(host)) conflicts.set(host, []); conflicts.get(host).push({ col, detail: e.detail }) }
    }
  })
  return { byId, parents, direct, conflicts, cache: new Map() }
}

function ancestors(ix, id) {
  const hit = ix.cache.get(id)
  if (hit) return hit
  const out = []
  const seen = new Set([id])
  let frontier = [id]
  while (frontier.length) {
    const next = []
    for (const x of frontier) for (const p of ix.parents.get(x) || []) if (!seen.has(p)) { seen.add(p); out.push(p); next.push(p) }
    frontier = next
  }
  ix.cache.set(id, out)
  return out
}

// A node's value for a facet: {v: text, id?: node id} or null when missing. Multi facets join their values.
export function valueOf(ix, node, facet) {
  if (facet.direct) {
    const hits = (ix.direct.get(node.id) || []).filter(d => d.id.startsWith(facet.direct + ':') && facet.kinds.includes(d.kind))
    if (!hits.length) return null
    const lab = id => ix.byId.get(id)?.label ?? id.slice(id.indexOf(':') + 1)
    const items = hits.map(h => ({ v: lab(h.id), id: h.id, via: h.via }))
    return { v: items.map(i => i.v).sort().join(', '), id: items[0].id, ids: items.map(i => i.id), items }
  }
  if (facet.rel) {
    const hits = ancestors(ix, node.id).filter(a => prefixOf(a) === facet.rel)
    if (!hits.length) return null
    const lab = id => ix.byId.get(id)?.label ?? id.slice(id.indexOf(':') + 1)
    if (facet.multi) return { v: hits.map(lab).sort().join(', '), id: hits[0], ids: hits, items: hits.map(i => ({ v: lab(i), id: i })) }
    return { v: lab(hits[0]), id: hits[0] }
  }
  const row = (node.attrs || []).find(a => a[0] === facet.attr)
  if (!row || row[1] == null || row[1] === '—' || row[1] === '') return null
  let v = String(row[1])
  if (facet.day) v = v.split(' ')[0]
  return { v }
}

// Short text for a major version difference: "IBM Red Hat Enterprise Linux 7.9" -> "RHEL 7.9" style is left to the label; keep as is.

// ── compare a selection ───────────────────────────────────────────────────────
// Returns {shared: [...], differs: [...], neighbors: [...]}: facets where most share a value; facets where they split
// (with the odd ones out); and nodes of other kinds (people, tools, software…) that several selected nodes connect to.
export function compare(raw, ix, ids) {
  const sel = ids.map(i => ix.byId.get(i)).filter(Boolean)
  const m = sel.length
  const shared = []
  const differs = []
  const hosts = sel.filter(n => ROW_KINDS.has(n.kind))
  for (const f of FACETS) {
    if (hosts.length < 2) break
    const groups = new Map()
    let missing = 0
    for (const n of hosts) {
      const val = valueOf(ix, n, f)
      if (!val) { missing++; continue }
      // a host can have several owners or inventories: each one is its own thing the hosts may share
      for (const it of (f.multi && val.items ? val.items : [val])) {
        if (!groups.has(it.v)) groups.set(it.v, { v: it.v, id: it.id, ids: [], via: it.via })
        groups.get(it.v).ids.push(n.id)
      }
    }
    if (!groups.size) continue
    const ranked = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length)
    if (f.multi) {   // owners, teams, inventories: every one that most of them share is a row of its own
      const common = ranked.filter(g => g.ids.length >= 2 && g.ids.length >= Math.ceil(hosts.length * 0.6))
      common.forEach(g => shared.push({ facet: f, value: g.v, id: g.id, ids: g.ids, of: hosts.length, others: [], missing, odd: null, via: g.via }))
      if (!common.length && ranked.length > 1) differs.push({ facet: f, groups: ranked, of: hosts.length, missing })
      continue
    }
    const top = ranked[0]
    if (top.ids.length >= 2 && top.ids.length >= Math.ceil(hosts.length * 0.6)) {
      const others = ranked.slice(1)
      shared.push({ facet: f, value: top.v, id: top.id, ids: top.ids, of: hosts.length, others, missing,
        odd: others.length && others.reduce((a, g) => a + g.ids.length, 0) === 1 ? others[0] : null })
    } else if (ranked.length > 1) differs.push({ facet: f, groups: ranked, of: hosts.length, missing })
  }
  // common neighbors outside the host facets
  const count = new Map()
  const facetPrefixes = new Set(FACETS.filter(f => f.rel).map(f => f.rel))
  for (const n of sel) {
    const near = new Set()
    raw.edges.forEach(e => { if (e.flag === 'inferred') return; if (e.a === n.id) near.add(e.b); else if (e.b === n.id) near.add(e.a) })
    near.forEach(o => { if (!facetPrefixes.has(prefixOf(o)) || !ROW_KINDS.has(n.kind)) count.set(o, (count.get(o) || 0) + 1) })
  }
  const neighbors = [...count.entries()].filter(([o, c]) => c >= 2 && !ids.includes(o)).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([o, c]) => ({ node: ix.byId.get(o), n: c, of: m })).filter(x => x.node)
  return { shared, differs, neighbors, m }
}

// Shortest paths (over the links shown) from one node to each of the others: the nodes and links to light up
export function pathsTo(model, target, from) {
  const adj = new Map()
  model.edges.forEach(e => {
    ;(adj.get(e.a) ?? adj.set(e.a, []).get(e.a)).push([e.b, e])
    ;(adj.get(e.b) ?? adj.set(e.b, []).get(e.b)).push([e.a, e])
  })
  const prev = new Map([[target, null]])
  const q = [target]
  for (let h = 0; h < q.length; h++) for (const [o, e] of adj.get(q[h]) || []) if (!prev.has(o)) { prev.set(o, [q[h], e]); q.push(o) }
  const nodes = new Set([target])
  const edges = new Set()
  for (const f of from) {
    let cur = f
    while (cur && prev.has(cur)) {
      nodes.add(cur)
      const p = prev.get(cur)
      if (!p) break
      edges.add(p[1].a + '|' + p[1].b)
      cur = p[0]
    }
  }
  return { nodes, edges }
}

// ── pivot grid ────────────────────────────────────────────────────────────────
export function rowsOf(raw, ix) {
  return raw.nodes.filter(n => ROW_KINDS.has(n.kind)).map(n => ({ node: n, id: n.id }))
}

// Outliers: in a column, a handful of rows whose value differs from a clear majority of the rows (or of their group)
export function outliers(rows, ix, cols, groupKey) {
  const out = []
  const groups = new Map()
  for (const r of rows) {
    const g = groupKey ? (valueOf(ix, r.node, FACET[groupKey])?.v ?? '—') : 'all'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(r)
  }
  for (const key of cols) {
    const f = FACET[key]
    if (f.key === groupKey) continue
    for (const [g, list] of groups) {
      if (list.length < 5) continue
      const by = new Map()
      for (const r of list) { const v = valueOf(ix, r.node, f)?.v ?? '(missing)'; by.set(v, [...(by.get(v) || []), r]) }
      if (by.size < 2) continue
      const ranked = [...by.entries()].sort((a, b) => b[1].length - a[1].length)
      const [mv, mrows] = ranked[0]
      const rest = list.length - mrows.length
      if (mrows.length / list.length >= 0.8 && rest <= Math.max(1, Math.floor(list.length * 0.2)) && rest <= 6) {
        for (const [v, rs] of ranked.slice(1)) {
          out.push({ facet: f, group: groupKey ? g : null, majority: mv, share: Math.round((mrows.length / list.length) * 100), value: v, ids: rs.map(r => r.id), names: rs.map(r => r.node.label) })
        }
      }
    }
  }
  return out.sort((a, b) => a.ids.length - b.ids.length).slice(0, 8)
}
