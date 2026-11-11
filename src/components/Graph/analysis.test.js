// node --test src/components/Graph/analysis.test.js   (no dependencies; the shared score table is also used by backend/tests)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initialOrder, capGroups, rankGroup, recScore, decay, foldSummary, agoText, isDated, diversity, modularity, surprising, suggestions, clusterAnchors } from './analysis.js'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const DAY = 86400000
const at = d => new Date(NOW - d * DAY).toISOString()
const host = (id, d, extra = {}) => ({ id: 'h:' + id, kind: 'host', label: id, sub: 'host', count: 1, ...(d == null ? {} : { last: at(d), via: 'logged in', sig: [{ last: at(d), via: 'logged in', s: 0.5 }] }), ...extra })
const wOf = () => 1

test('the score table matches the backend', () => {
  const cases = JSON.parse(readFileSync(new URL('../../../backend/tests/score_cases.json', import.meta.url)))
  for (const c of cases) {
    const got = c.strength * decay(c.age_days, c.half_life)
    assert.ok(Math.abs(got - c.expect) < 1e-4, JSON.stringify(c))
  }
})

test('rescoring uses the best signal, and a longer half-life lifts old nodes', () => {
  const n = { last: at(2), sig: [{ last: at(2), s: 0.5 }, { last: at(60), s: 1.0 }] }
  assert.ok(Math.abs(recScore(n, NOW, 30) - Math.max(0.5 * decay(2, 30), decay(60, 30))) < 1e-9)
  const old = { last: at(90), sig: [{ last: at(90), s: 1 }] }
  assert.ok(recScore(old, NOW, 180) > recScore(old, NOW, 30))
  assert.equal(recScore({ id: 'x' }, NOW), null)        // undated
})

test('ranking: flagged, then newest, undated last, then links', () => {
  const arr = [host('undated-big', null, { count: 9 }), host('old', 200), host('new', 1), host('flag', 300), host('mid', 20), host('undated-small', null, { count: 1 })]
  const order = rankGroup(arr, new Set(['h:flag']), NOW, 30).map(n => n.label)
  assert.deepEqual(order, ['flag', 'new', 'mid', 'old', 'undated-big', 'undated-small'])
})

test('a dated node beats an undated one even when the dated one is very old', () => {
  const order = rankGroup([host('u', null, { count: 50 }), host('ancient', 4000)], new Set(), NOW, 30).map(n => n.label)
  assert.deepEqual(order, ['ancient', 'u'])
})

const raw = nodes => ({ nodes: [{ id: 'p:me', kind: 'person', label: 'me', result: true }, ...nodes], edges: nodes.map(n => ({ a: 'p:me', b: n.id, kind: 'named', label: 'named on' })) })

test('the cap folds the oldest and the bubble says how old', () => {
  const nodes = [host('a', 1), host('b', 5), host('c', 40), host('d', 400), host('e', 450), host('f', null)]
  const out = capGroups(raw(nodes), 3, wOf, new Set(), new Set(), { windowDays: 0, now: NOW })
  const shown = out.nodes.filter(n => n.id.startsWith('h:')).map(n => n.label)
  assert.deepEqual(shown, ['a', 'b'])                   // limit 3 -> 2 shown + the bubble
  const more = out.nodes.find(n => n.more)
  assert.equal(more.count, 4)
  assert.match(more.label, /\+4 more/)
  assert.match(more.sub, /3 dated \(/)
  assert.match(more.sub, /1 undated/)
  assert.match(more.sub, /to .*ago/)
})

test('the window folds old dated nodes but never undated ones, and always keeps something', () => {
  const nodes = [host('a', 2), host('b', 100), host('c', 200), host('u', null)]
  const out = capGroups(raw(nodes), 50, wOf, new Set(), new Set(), { windowDays: 30, now: NOW })
  const labels = out.nodes.filter(n => n.id.startsWith('h:')).map(n => n.label).sort()
  assert.deepEqual(labels, ['a', 'u'])                  // b and c are outside 30 days, u stays
  assert.equal(out.nodes.find(n => n.more).count, 2)
  const allOld = [host('x', 100), host('y', 200), host('z', 300)]
  const out2 = capGroups(raw(allOld), 50, wOf, new Set(), new Set(), { windowDays: 7, now: NOW })
  assert.deepEqual(out2.nodes.filter(n => n.id.startsWith('h:')).map(n => n.label), ['x', 'y'])    // the default view still shows the newest two
})

test('revealing a bubble shows everything; boosted nodes are never folded', () => {
  const nodes = [host('a', 1), host('b', 400), host('c', 500)]
  const open = capGroups(raw(nodes), 2, wOf, new Set(['more:h']), new Set(), { windowDays: 30, now: NOW })
  assert.equal(open.nodes.filter(n => n.id.startsWith('h:')).length, 3)
  const boosted = capGroups(raw(nodes), 2, wOf, new Set(), new Set(['h:c']), { windowDays: 30, now: NOW })
  assert.ok(boosted.nodes.some(n => n.label === 'c'))
})

test('stats and the bubble agree with the window', () => {
  const nodes = [host('a', 2), host('b', 100), host('c', 200), host('d', 5), host('u', null), host('v', null)]
  const out = capGroups(raw(nodes), 3, wOf, new Set(), new Set(), { windowDays: 30, now: NOW })
  // window 30: b and c are older than it; limit 3 -> 2 shown + bubble, so one more (u or v or d) folds by the limit
  const bubble = out.nodes.find(n => n.more)
  assert.equal(out.stats.window, 2)
  assert.equal(out.stats.window + out.stats.cap, bubble.count)
  assert.equal(bubble.fold.window, 2)
  assert.match(bubble.sub, /2 older than 30 days/)
  assert.ok(bubble.attrs.some(a => a[0] === 'Older than 30 days' && a[1] === '2'))
  // no window: nothing is "older than", and the bubble does not claim it
  const all = capGroups(raw(nodes), 3, wOf, new Set(), new Set(), { windowDays: 0, now: NOW })
  assert.equal(all.stats.window, 0)
  assert.doesNotMatch(all.nodes.find(n => n.more).sub, /older than/)
  assert.equal(all.stats.cap, all.nodes.find(n => n.more).count)
})

test('a group whose dated nodes are all outside the window keeps its newest two, and the stats count only what folded', () => {
  const out = capGroups(raw([host('x', 100), host('y', 200), host('z', 300), host('u', null)]), 50, wOf, new Set(), new Set(), { windowDays: 7, now: NOW })
  assert.deepEqual(out.nodes.filter(n => n.id.startsWith('h:')).map(n => n.label).sort(), ['u', 'x', 'y'])
  assert.equal(out.stats.window, 1)
})

test('edges to folded nodes are redirected to the bubble', () => {
  const nodes = [host('a', 1), host('b', 400), host('c', 500)]
  const out = capGroups(raw(nodes), 50, wOf, new Set(), new Set(), { windowDays: 30, now: NOW })
  assert.ok(out.edges.some(e => e.b === 'more:h'))
  assert.ok(!out.edges.some(e => e.b === 'h:b' || e.b === 'h:c'))
})

test('helpers', () => {
  assert.equal(agoText(0.2), 'today')
  assert.equal(agoText(5), '5 days')
  assert.equal(agoText(95), '3 months')
  assert.equal(agoText(800), '2 years')
  assert.ok(isDated(host('x', 1)) && !isDated(host('y', null)))
  assert.equal(foldSummary([host('u', null)], NOW), '1 undated')
})

test('diversity describes the current Louvain communities', () => {
  const nodes = [{ id: 'a', comm: 0 }, { id: 'b', comm: 0 }, { id: 'c', comm: 1 }, { id: 'd', comm: 1 }]
  const edges = [{ a: 'a', b: 'b' }, { a: 'c', b: 'd' }]
  assert.ok(modularity(nodes, edges) > 0)
  assert.equal(diversity(nodes, edges).label, 'diversified')
  assert.equal(diversity([{ id: 'a', comm: 0 }, { id: 'b', comm: 0 }, { id: 'c', comm: 1 }], edges).label, 'biased')
})

test('surprising links are rare cross-community, cross-kind ties without hubs', () => {
  const nodes = [
    { id: 'hub', kind: 'host', comm: 0, bc: 99 }, { id: 'hub2', kind: 'host', comm: 0, bc: 98 }, { id: 'hub3', kind: 'host', comm: 1, bc: 97 },
    { id: 'a', kind: 'host', comm: 0, bc: 1 }, { id: 'b', kind: 'app', comm: 1, bc: 1 },
    { id: 'c', kind: 'dataset', comm: 0, bc: 1 }, { id: 'd', kind: 'app', comm: 1, bc: 1 }, { id: 'same', kind: 'host', comm: 0, bc: 1 },
  ]
  const edges = [{ a: 'hub', b: 'b', label: 'hub link' }, { a: 'a', b: 'b', label: 'common' }, { a: 'c', b: 'd', label: 'rare' }, { a: 'a', b: 'same', label: 'same topic' }]
  assert.deepEqual(surprising(nodes, edges).map(x => x.label), ['rare', 'common'])
  assert.equal(surprising(nodes, edges)[0].a, 'c')
})

test('suggestions lead with a community path, then hosts and concepts without repeating the query', () => {
  const model = { lens: 'concepts', nodes: [
    { id: 'a', label: 'Alpha', kind: 'host', comm: 0, bc: 4, deg: 5 }, { id: 'b', label: 'Beta', kind: 'host', comm: 1, bc: 3, deg: 4 },
    { id: 'c', label: 'ZFS', kind: 'concept', comm: 0, bc: 1, count: 8 }, { id: 'd', label: 'Plex', kind: 'concept', comm: 1, bc: 1, count: 4 },
  ] }
  assert.deepEqual(suggestions(model, 'host:Alpha', 5), ['Alpha .. Beta', 'host:Beta', 'kb: ZFS', 'kb: Plex'])
})

test('fold placeholders never show up as surprising ties or suggestions', () => {
  const nodes = [
    { id: 'h', label: 'babbage', kind: 'host', comm: 0, bc: 0, deg: 9 }, { id: 'more:x', label: '+72 more', kind: 'app', comm: 1, bc: 9, deg: 1, fold: { total: 72 } },
    { id: 'p', label: 'plex', kind: 'app', comm: 1, bc: 2, deg: 2 }, { id: 'q', label: 'Plex note', kind: 'note', comm: 0, bc: 0, deg: 1 },
    { id: 'z1', label: 'z1', kind: 'host', comm: 2, bc: 50 }, { id: 'z2', label: 'z2', kind: 'host', comm: 2, bc: 49 }, { id: 'z3', label: 'z3', kind: 'host', comm: 2, bc: 48 },
  ]
  const edges = [{ a: 'h', b: 'more:x', label: 'folded' }, { a: 'p', b: 'q', label: 'mentions' }]
  assert.deepEqual(surprising(nodes, edges).map(x => x.label), ['mentions'])
  assert.ok(!suggestions({ nodes }, 'babbage').some(s => s.includes('more')))
})

test('media seeds order the Media facet first; Prometheus targets stay fleet', () => {
  for (const id of ['yt:a1', 'ch:nodus labs', 'tt:50', 'u:1']) assert.equal(initialOrder(id)[0], 'media', id)
  assert.notEqual(initialOrder('t:node|10.0.0.2:9100')[0], 'media')
})

test('modularity counts only links inside the node set and never returns NaN', () => {
  const nodes = [{ id: 'a', comm: 0 }, { id: 'b', comm: 0 }, { id: 'c', comm: 1 }, { id: 'd', comm: 1 }]
  const inside = [{ a: 'a', b: 'b' }, { a: 'c', b: 'd' }]
  assert.equal(modularity(nodes, [{ a: 'a', b: 'gone' }, { a: 'x', b: 'y' }]), 0)
  assert.equal(modularity(nodes, [...inside, { a: 'a', b: 'gone' }, { a: 'c', b: 'c' }]), modularity(nodes, inside))
})

test('surprising picks hubs among real bridges only', () => {
  // one real hub; the fold bubble and bc-0 nodes must not take the other hub slots
  const nodes = [
    { id: 'hub', kind: 'host', comm: 0, bc: 9 }, { id: 'more', kind: 'app', comm: 1, bc: 50, fold: { total: 9 } },
    { id: 'a', kind: 'host', comm: 0, bc: 0 }, { id: 'b', kind: 'app', comm: 1, bc: 0 },
  ]
  const edges = [{ a: 'hub', b: 'b', label: 'hub link' }, { a: 'a', b: 'b', label: 'plain' }]
  assert.deepEqual(surprising(nodes, edges).map(x => x.label), ['plain'])
})

test('clusters: biggest community in the middle, others on a ring, small ones get no spot', () => {
  const g = (comm, n, p = comm) => ({ comm, members: Array.from({ length: n }, (_, i) => `${p}${i}`) })
  const a = clusterAnchors([g(1, 4), g(0, 9), g(2, 2), g(3, 3)], new Map(), 100)
  assert.deepEqual([a.get(0).x, a.get(0).y], [0, 0])
  assert.equal(a.has(2), false)                                  // a pair stays loose
  assert.equal(Math.round(Math.hypot(a.get(1).x, a.get(1).y)), 100)
  assert.equal(Math.round(Math.hypot(a.get(3).x, a.get(3).y)), 100)
  assert.notDeepEqual([a.get(1).x, a.get(1).y], [a.get(3).x, a.get(3).y])
})

test('clusters: spots are distinct and fill a second ring after six', () => {
  const groups = Array.from({ length: 9 }, (_, c) => ({ comm: c, members: Array.from({ length: 20 - c }, (_, i) => `${c}-${i}`) }))
  const a = clusterAnchors(groups, new Map(), 100)
  const spots = [...a.values()].map(p => `${p.x},${p.y}`)
  assert.equal(new Set(spots).size, 9)
  assert.equal([...a.values()].filter(p => Math.abs(Math.hypot(p.x, p.y) - 200) < 2).length, 2)
})

test('clusters: renumbered communities keep their old spots when expanded', () => {
  const g = (comm, ids) => ({ comm, members: ids })
  const first = clusterAnchors([g(0, ['a', 'b', 'c', 'd', 'e']), g(1, ['p', 'q', 'r'])], new Map(), 100)
  // the second community grew past the first, so the recount swaps their numbers
  const next = clusterAnchors([g(0, ['p', 'q', 'r', 's', 't', 'u']), g(1, ['a', 'b', 'c', 'd', 'e'])], first, 100)
  assert.deepEqual([next.get(1).x, next.get(1).y], [first.get(0).x, first.get(0).y])
  assert.deepEqual([next.get(0).x, next.get(0).y], [first.get(1).x, first.get(1).y])
})
