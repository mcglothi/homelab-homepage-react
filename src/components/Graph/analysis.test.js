// node --test src/components/Graph/analysis.test.js   (no dependencies; the shared score table is also used by backend/tests)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { capGroups, rankGroup, recScore, decay, foldSummary, agoText, isDated, diversity, modularity } from './analysis.js'

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
