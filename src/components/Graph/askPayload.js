// The graph on screen as the model sees it: numbered names and links, never the real ids
export function askPayload(model, question, max = 300) {
  const nodes = model.nodes.slice().sort((x, y) => (y.val || 0) - (x.val || 0)).slice(0, max)
  const num = new Map(nodes.map((n, i) => [n.id, String(i + 1)]))
  const edges = model.edges.filter(e => num.has(e.a) && num.has(e.b)).slice(0, 600).map(e => [num.get(e.a), num.get(e.b), e.kind || 'links'])
  return { body: { question, nodes: nodes.map(n => ({ id: num.get(n.id), label: n.label, kind: n.kind })), edges }, back: new Map([...num].map(([id, k]) => [k, id])) }
}
