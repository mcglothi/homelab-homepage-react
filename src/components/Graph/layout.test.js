import test from 'node:test'
import assert from 'node:assert/strict'
import { forceSimulation, forceManyBody, forceLink } from 'd3-force-3d'
import { levelPull } from './analysis.js'

// Run the real d3 simulation with the dashboard's strong repulsion, plus the level pull, and measure where levels land.
function settle(lay) {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 600
  const nodes = []
  for (let lvl = 0; lvl < 3; lvl++) for (let i = 0; i < [12, 8, 6][lvl]; i++) nodes.push({ id: `${lvl}-${i}`, depth: lvl - 1.1, x: rnd(), y: rnd() })
  const links = nodes.filter(n => !n.id.startsWith('0-')).map((n, i) => ({ source: n.id, target: `0-${i % 12}` }))
  const gap = 90
  const pull = alpha => levelPull(nodes, lay, gap, 0.36 * 0.012 * alpha, (lay === 'rings' ? 0.9 : 0.5) * alpha)
  pull.initialize = () => {}
  const sim = forceSimulation(nodes, 2).force('charge', forceManyBody().strength(-520 * 1.0).distanceMax(900))
    .force('link', forceLink(links).id(n => n.id).distance(95)).force('pull', pull).stop()
  for (let i = 0; i < 300; i++) sim.tick()
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1]
  return [0, 1, 2].map(l => {
    const ns = nodes.filter(n => n.id.startsWith(l + '-'))
    return { r: med(ns.map(n => Math.hypot(n.x, n.y))), y: med(ns.map(n => n.y)) }
  })
}

test('rings: deeper levels land on wider rings, even against strong repulsion', () => {
  const [a, b, c] = settle('rings')
  assert.ok(a.r < b.r && b.r < c.r, JSON.stringify([a, b, c]))
})

test('tree: deeper levels land on lower rows', () => {
  const [a, b, c] = settle('tree')
  assert.ok(a.y < b.y && b.y < c.y, JSON.stringify([a, b, c]))
})

test('ask payload numbers nodes, keeps only links between sent nodes, and maps answers back', async () => {
  const { askPayload } = await import('./askPayload.js')
  const model = { nodes: [{ id: 'h:turing', label: 'turing', kind: 'host', val: 5 }, { id: 'a:plex', label: 'plex', kind: 'app', val: 9 }, { id: 'x', label: 'x', val: 1 }],
    edges: [{ a: 'h:turing', b: 'a:plex', kind: 'runs' }, { a: 'h:turing', b: 'x', kind: 'links' }] }
  const { body, back } = askPayload(model, 'q', 2)
  assert.deepEqual(body.nodes.map(n => n.label), ['plex', 'turing'])   // biggest first, capped
  assert.ok(!JSON.stringify(body).includes('h:turing'))                 // real ids never leave the page
  assert.deepEqual(body.edges, [['2', '1', 'runs']])
  assert.equal(back.get('1'), 'a:plex')
})
