// The canvas side of the graph view. One engine per mode (2D canvas, 3D WebGL), each created
// once and then only updated: node objects survive by id (so x/y/z and velocity carry over),
// and size, color, opacity and label visibility ease toward targets every frame. Nothing
// here rebuilds the scene when a filter, search, expansion, option or theme changes.

import { adjacency } from './analysis'

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
import { drawReticle, reducedMotion } from './reticle'
import { Backdrop } from './backdrop'
import { relation } from './relations'
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const LABEL_PX = 11

async function libs(mode) {
  if (mode === '2d') return { ForceGraph: (await import('force-graph')).default }
  const [fg, st, three] = await Promise.all([import('3d-force-graph'), import('three-spritetext'), import('three')])
  return { ForceGraph3D: fg.default, SpriteText: st.default, THREE: three }
}

// Recency, render only (no layout change): rk is the 0..1 recency score (null = undated). Recent nodes are a little larger and fully lit,
// old ones fade slightly; undated nodes sit in the middle so nothing disappears.
const recFade = rk => (rk == null ? 0.85 : 0.6 + 0.4 * Math.min(1, rk / 0.5))
const recSize = rk => (rk == null ? 1 : 0.92 + 0.16 * Math.min(1, rk / 0.5))

export async function createEngine(mode, el, cb, theme, seed) {
  const L = await libs(mode)
  return new Engine(mode, el, cb, L, theme, seed)
}

class Engine {
  constructor(mode, el, cb, L, theme, seed) {
    this.mode = mode
    this.el = el
    this.cb = cb
    this.L = L
    this.T = theme
    this.store = new Map()
    this.model = { nodes: [], edges: [] }
    this.adj = new Map()
    this.vis = { sel: null, gaps: null, find: null, color: 'kind', arrows: 'smart', focus: null, multiOrder: [] }
    this.hoverId = null
    this.hl = null
    this.f = { center: 30, repel: 520, link: 55, dist: 95, layer: 35 }
    this.fCur = { ...this.f }
    this.seed = seed
    this.first = true
    this.paused = false
    this.refDist = null
    this.linksDirty = 0
    this.autoFit = true      // keep re-framing as the layout settles, until the user moves the camera
    this.linkCache = new Map()
    this.frame = 0
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    const click = (n, ev) => {
      const mod = ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey) ? { shift: true } : null
      const t = performance.now()
      // a second click on a pinned node lets it go
      if (n && n.pinned && this.lastClick && this.lastClick.id === n.id && t - this.lastClick.t < 420) { this.unpin(n); this.lastClick = null; return }
      this.lastClick = n ? { id: n.id, t } : null
      cb.onSelect(n ? n.id : null, mod)
    }
    const common = g => g.width(w).height(h).nodeId('id').nodeLabel(n => this.tip(n)).linkLabel(l => this.linkTip(l))
      .linkDirectionalParticles(l => l.__fc || 0).linkDirectionalParticleSpeed(l => l.__fv || 0.0016).linkDirectionalParticleWidth(l => (l.flag === 'conflict' ? 2.4 : 1.7)).linkDirectionalParticleColor(l => this.flowColor(l))
      .d3AlphaDecay(0.022).d3VelocityDecay(0.42).cooldownTime(20000)
      .onNodeClick((n, ev) => click(n, ev)).onBackgroundClick(ev => click(null, ev))
      .onNodeDrag(n => this.onDrag(n)).onNodeDragEnd(n => this.onDragEnd(n))
      .linkDirectionalArrowLength(l => this.arrowLen(l)).linkDirectionalArrowRelPos(0.86).linkDirectionalArrowColor(l => this.arrowColor(l))
      .onNodeHover(n => { this.hoverId = n ? n.id : null; this.computeHl(); this.updateCursor(); this.linksDirty = performance.now() })
    if (mode === '2d') {
      this.G = common(L.ForceGraph()(el)).backgroundColor('rgba(0,0,0,0)').autoPauseRedraw(false)
        .nodeCanvasObject((n, ctx, k) => this.draw2d(n, ctx, k))
        .nodePointerAreaPaint((n, c, ctx) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(6, n.r + 3), 0, 6.2832); ctx.fill() })
        .linkColor(l => this.linkColor(l)).linkWidth(l => this.linkW(l)).linkCurvature(l => this.curve(l))
        .linkCanvasObjectMode(() => 'replace').linkCanvasObject((l, ctx, k) => this.drawLink(l, ctx, k))
        .onRenderFramePre((ctx, k) => this.drawTopics(ctx, k))
        .linkLineDash(l => (l.flag === 'derived' ? [2, 3] : l.flag === 'missing' ? [4, 4] : l.flag === 'inferred' ? [5, 3] : null))
    } else {
      const { THREE, SpriteText } = L
      this.geo = new THREE.SphereGeometry(1, 14, 10)
      this.G = common(L.ForceGraph3D({ extraRendererConfig: { antialias: true, alpha: true } })(el)).backgroundColor('rgba(0,0,0,0)').showNavInfo(false)
        .numDimensions(3).nodeThreeObject(n => this.make3d(n, THREE, SpriteText)).nodeThreeObjectExtend(false)
        .linkColor(l => this.linkColor(l)).linkWidth(0).linkOpacity(0.9).linkDirectionalParticleResolution(6).linkCurvature(l => this.curve(l)).linkCurveRotation(l => this.rot(l))
      const c = this.G.controls()
      if (c) { c.dynamicDampingFactor = 0.09; c.rotateSpeed = 1.5; c.zoomSpeed = 0.9 }
      // Shift-drag (or right-drag) on empty space pans the map 1:1: the point under the pointer stays under the pointer.
      // A pixel is (2 * distance * tan(fov / 2) / viewport height) world units at the controls' target; the camera and
      // the target move together along the screen plane, with no speed factor and no damping. Over a node, the node drags.
      const dom = this.G.renderer().domElement
      const R = new THREE.Vector3(), U = new THREE.Vector3()
      dom.addEventListener('pointerdown', e => {
        if (!c || this.hoverId || !((e.shiftKey && e.button === 0) || e.button === 2)) return
        const cam = this.G.camera()
        cam.updateMatrix()
        this.pan = { x: e.clientX, y: e.clientY, cam: cam.position.clone(), tgt: c.target.clone(), enabled: c.enabled }
        c.enabled = false
        dom.style.cursor = 'move'
        this.autoFit = false
      }, true)
      window.addEventListener('pointermove', e => {
        if (!this.pan) return
        const cam = this.G.camera()
        const dist = this.pan.cam.distanceTo(this.pan.tgt)
        const wpp = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / (dom.getBoundingClientRect().height || 1)
        R.setFromMatrixColumn(cam.matrix, 0); U.setFromMatrixColumn(cam.matrix, 1)
        const d = R.multiplyScalar(-(e.clientX - this.pan.x) * wpp).add(U.multiplyScalar((e.clientY - this.pan.y) * wpp))
        cam.position.copy(this.pan.cam).add(d)
        c.target.copy(this.pan.tgt).add(d)
      })
      window.addEventListener('pointerup', () => { if (this.pan) { c.enabled = this.pan.enabled; this.pan = null; this.updateCursor() } })
      dom.addEventListener('contextmenu', e => e.preventDefault())
      this.onKey = e => { if (e.key === 'Shift') { this.shiftDown = e.type === 'keydown'; this.updateCursor() } }
      window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey)
    }
    const stop = () => { this.autoFit = false }
    for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, stop, { passive: true })
    this.bd = new Backdrop(el)
    this.bd.resize(w, h)
    if (mode === '3d') this.addStage3d()
    this.G.onEngineStop(() => { if (this.autoFit) this.fit(700) })
    this.installForces()
    this.applyForces()
    this.last = performance.now()
    this.raf = requestAnimationFrame(t => this.loop(t))
  }

  // Gently curved links, each a little different, so a dense graph reads as flowing lines rather than a spiderweb
  hash(l) {
    const a = typeof l.source === 'object' ? l.source.id : l.source, b = typeof l.target === 'object' ? l.target.id : l.target
    let h = 0
    for (const c of a + '>' + b) h = (h * 31 + c.charCodeAt(0)) | 0
    return Math.abs(h)
  }
  curve(l) { if (this.vis.curves === false) return 0
    return l.flag === 'inferred' ? 0.4 : (l.flag === 'derived' ? 0.06 : 0.1) + (this.hash(l) % 5) * 0.025 }
  rot(l) { return (this.hash(l) % 628) / 100 }

  updateCursor() {
    if (this.pan) return
    this.el.style.cursor = this.hoverId ? 'pointer' : this.shiftDown && this.mode === '3d' ? 'move' : 'default'
  }

  // a row of the Details card is pointed at: light that node up in the graph (a highlight only: nothing moves)
  setExtHover(id) { if (this.hoverExt === id) return; this.hoverExt = id || null; this.computeHl() }

  // a link's tooltip reads as a sentence in the stored direction: "Greg Elder manages JJ Rouhana"
  linkTip(l) {
    const T = this.T
    const s = typeof l.source === 'object' ? l.source : this.store.get(l.source)
    const t = typeof l.target === 'object' ? l.target : this.store.get(l.target)
    if (!s || !t) return ''
    const r = relation(l, false)
    const note = l.flag === 'conflict' ? 'sources disagree' : l.flag === 'missing' ? 'expected link missing' : l.flag === 'derived' ? 'joined by name or IP' : l.flag === 'inferred' ? 'inferred pair' : ''
    return `<div style="font:600 12px var(--sans, system-ui, sans-serif);color:${T.text};background:${T.panel};border:1px solid ${T.line};border-radius:8px;padding:5px 9px;max-width:340px">${esc(s.label)} <span style="color:${T.accent}">${esc(r.sentence)}</span> ${esc(t.label)}${note ? `<br><span style="color:${T.dim};font-size:10.5px">${esc(note)}</span>` : ''}</div>`
  }
  tip(n) {
    const T = this.T
    return `<div style="font:600 12px var(--sans, system-ui, sans-serif);color:${T.text};background:${T.panel};border:1px solid ${T.line};border-radius:8px;padding:6px 9px"><b>${esc(n.label)}</b><br><span style="color:${T.muted}">${esc(n.sub || n.kind)}</span><br><span style="color:${T.dim};font-size:10.5px">click: inspect · shift-click: compare</span></div>`
  }

  // ── theme ───────────────────────────────────────────────────────────────
  setTheme(t) {
    this.T = t
    this.linkCache.clear()
    this.retarget()
    if (this.mode === '3d') for (const n of this.store.values()) if (n.__s) { n.__s.color = t.text; n.__s.strokeColor = t.bg }
    this.linksDirty = performance.now()
  }

  // ── data ────────────────────────────────────────────────────────────────
  setModel(model, grow) {
    const now = performance.now()
    this.model = model
    this.adj = adjacency(model.edges)
    const comm = new Map(model.nodes.map(n => [n.id, n.comm]))
    const size = {}
    model.nodes.forEach(n => { size[n.comm] = (size[n.comm] || 0) + 1 })
    const big = Object.keys(size).filter(c => size[c] >= 3).sort((a, b) => size[b] - size[a]).slice(0, 4).map(Number)
    const inter = {}
    model.edges.forEach(e => { const a = comm.get(e.a), b = comm.get(e.b); if (a !== b && big.includes(a) && big.includes(b)) { const k = Math.min(a, b) + '-' + Math.max(a, b); inter[k] = (inter[k] || 0) + 1 } })
    this.gapPairs = []
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) this.gapPairs.push([big[i], big[j], inter[Math.min(big[i], big[j]) + '-' + Math.max(big[i], big[j])] || 0])
    this.gapPairs = this.gapPairs.sort((a, b) => a[2] - b[2]).slice(0, 2)
    const keep = new Set()
    const pos = id => { const n = this.store.get(id); return n && n.a > 0.05 && Number.isFinite(n.x) ? n : null }
    let born = 0
    for (const m of model.nodes) {
      keep.add(m.id)
      let n = this.store.get(m.id)
      if (!n) {
        n = { id: m.id, a: 0, r: 0, la: 0, sa: 0, cr: 0, cg: 0, cb: 0, start: now + (grow ? 60 + 28 * born++ : 0) }
        const near = (this.adj.get(m.id) || []).map(pos).filter(Boolean)
        const sd = this.seed && this.seed.get(m.id)
        const jit = () => (Math.random() - 0.5) * (grow ? 8 : 24)
        if (near.length) {
          // a new node starts at its neighbors, so it grows out of them
          const c = near.reduce((s, o) => ({ x: s.x + o.x / near.length, y: s.y + (o.y || 0) / near.length, z: s.z + (o.z || 0) / near.length }), { x: 0, y: 0, z: 0 })
          n.x = c.x + jit(); n.y = c.y + jit(); n.z = this.mode === '3d' ? c.z + jit() : undefined
        } else if (sd) { n.x = sd.x; n.y = sd.y; n.z = this.mode === '3d' ? (Math.random() - 0.5) * 60 : undefined }
        else { n.x = jit() * 6; n.y = jit() * 6; n.z = this.mode === '3d' ? jit() * 6 : undefined }
        this.store.set(m.id, n)
      }
      n.dying = 0
      Object.assign(n, { kind: m.kind, label: m.label, sub: m.sub, attrs: m.attrs, count: m.count, missing: m.missing, result: m.result, more: m.more,
        deg: m.deg, bc: m.bc, comm: m.comm, val: m.val, tr: m.radius, rank: m.rank, depth: m.depth, hop: m.hop, wt: m.wt ?? 1, rk: m.rk ?? null })
    }
    for (const [id, n] of this.store) if (!keep.has(id) && !n.dying) n.dying = now
    this.retarget()
    this.computeHl()
    // Same nodes and links as before (a size, color, topics or selection change): nothing to give the simulation, so it is
    // not touched at all and nothing moves. Only a change of the node or link set goes to the layout, and gently.
    const sig = model.nodes.map(m => m.id).sort().join('|') + '#' + model.edges.map(e => e.a + '>' + e.b + ':' + e.kind).sort().join('|')
    if (sig === this.sig && !this.first) return
    this.sig = sig
    this.pushData(grow)
    clearTimeout(this.purgeT)
    this.purgeT = setTimeout(() => this.purge(), 900)
    // keep re-framing while the layout settles, until the user moves the camera
    ;(this.fitTs || []).forEach(clearTimeout)
    if (this.autoFit && !this.first) this.fitTs = [1500, 4000, 8000, 14000].map(ms => setTimeout(() => this.autoFit && this.fit(900), ms))
  }

  pushData(grow) {
    const links = this.model.edges.map(e => ({ ...e, source: e.a, target: e.b }))
    this.links = links
    const first = this.first
    this.first = false
    if (first) this.G.warmupTicks(Math.min(300, 60 + this.model.nodes.length))
    // Changing the data restarts the simulation. Heavy damping that relaxes back over ~2 s keeps the
    // nodes already on screen from drifting while new ones settle in.
    if (!first) {
      // A change of the node set: the nodes already on screen are held where they are while the new ones find their place,
      // then let go while the forces are still turned down (they ease back up over a few seconds, see loop())
      this.heat = Math.min(this.heat ?? 1, 0.1)
      this.heatTau = 3.6   // a change of the node set relaxes slowly: a drift you can follow, not a shake
      this.G.d3VelocityDecay(0.7)
      this.applyForces()
      this.held = this.held || []
      for (const n of this.store.values()) {
        if (n.dying || n.pinned || n.__held || Number.isFinite(n.fx) || n.a < 0.5) continue
        n.fx = n.x; n.fy = n.y; if (this.mode === '3d') n.fz = n.z
        n.__held = true
        this.held.push(n)
      }
      this.holdUntil = performance.now() + 2200
    }
    this.G.graphData({ nodes: [...this.store.values()], links })
    if (first) {
      this.G.warmupTicks(0)
      requestAnimationFrame(() => { this.fit(0); this.cb.onReady && this.cb.onReady() })
    }
  }

  purge() {
    const now = performance.now()
    let gone = false
    for (const [id, n] of this.store) if (n.dying && now - n.dying > 700) { this.store.delete(id); gone = true }
    if (gone) this.pushData(false)
  }

  nodeColor(n) {
    const T = this.T
    return n.missing ? T.dim : this.vis.color === 'comm' ? T.comm[n.comm % T.comm.length] : T.kind[n.kind] || T.muted
  }

  retarget() {
    for (const n of this.store.values()) {
      n.tc = hex(this.nodeColor(n))
      if (!n.a) { n.cr = n.tc[0]; n.cg = n.tc[1]; n.cb = n.tc[2] }
    }
  }

  setVis(v) {
    const colorChanged = v.color !== undefined && v.color !== this.vis.color
    const curvesChanged = v.curves !== undefined && v.curves !== this.vis.curves
    const flowChanged = v.flow !== undefined && v.flow !== this.vis.flow
    const hadSel = this.vis.sel
    this.vis = { ...this.vis, ...v }
    if (hadSel && v.sel !== undefined && !v.sel) this.releaseFocus()
    if (v.isolate !== undefined) this.linksDirty = performance.now()
    if (flowChanged) { this.flowDirty = true; this.stepFlow() }
    if (v.multiOrder) { this.multiIdx = new Map(v.multiOrder.map((id, i) => [id, i])) }
    if (colorChanged) this.retarget()
    if (curvesChanged && this.mode === '3d') this.G.linkCurvature(l => this.curve(l))
    this.computeHl()
  }

  computeHl() {
    const id = this.hoverId || this.hoverExt || (this.vis.pathSet ? null : this.vis.sel)
    let set = null
    if (this.vis.pathSet && !this.hoverId) set = this.vis.pathSet
    else if (id) {
      set = new Set([id])
      for (const o of this.adj.get(id) || []) set.add(o)
    } else if (this.vis.find) set = this.vis.find
    else if (this.vis.gaps) set = this.vis.gaps
    this.hl = set
    this.hlId = id
    this.pinLabels = !!(id || this.vis.find || this.vis.pathSet)
    this.linksDirty = performance.now()
  }

  // ── forces ──────────────────────────────────────────────────────────────
  installForces() {
    const eng = this
    let ns = []
    const pull = alpha => {
      const f = eng.fCur
      const k = f.center * 0.012 * alpha * (eng.heat ?? 1) * (1 + Math.min(3, ns.length / 120))
      // gentle layering: parents sit above children; weak enough that the layout stays organic
      const ky = (f.layer / 100) * 0.35 * alpha * (eng.heat ?? 1)
      const gap = f.dist * 0.95
      const sgn = eng.mode === '3d' ? -1 : 1
      for (const n of ns) {
        n.vx -= (n.x || 0) * k; n.vy -= (n.y || 0) * k; if (n.z !== undefined) n.vz -= n.z * k
        if (ky > 0 && n.depth !== undefined) n.vy += (sgn * n.depth * gap - (n.y || 0)) * ky
      }
    }
    pull.initialize = x => { ns = x }
    this.G.d3Force('pull', pull)
  }

  applyForces() {
    const f = this.fCur
    const ch = this.G.d3Force('charge')
    const sc = clamp(Math.pow(30 / Math.max(30, this.store.size), 0.4), 0.3, 1)   // fewer pushes per node as the graph grows
    const heat = this.heat ?? 1
    if (ch) ch.strength(n => -f.repel * sc * heat * (0.4 + (n.tr || 5) / 8)).distanceMax(900)
    const lk = this.G.d3Force('link')
    const deg = n => (typeof n === 'object' ? n.deg || 1 : 1)
    if (lk) lk.distance(l => f.dist + 7 * Math.sqrt(Math.max(deg(l.source), deg(l.target)))).strength(l => (f.link / 55) * 0.7 * heat / Math.sqrt(Math.min(deg(l.source), deg(l.target))))
  }

  setForces(f) {
    this.f = { ...f }
    if (!this.ramping) { this.ramping = true; try { this.G.d3ReheatSimulation() } catch { /* not ready */ } }
  }

  // ── camera ──────────────────────────────────────────────────────────────
  // Frame the body of the graph, not the few stragglers a repulsion pass flings far out
  fitFilter() {
    const ns = [...this.store.values()].filter(n => !n.dying && Number.isFinite(n.x))
    if (ns.length < 30) return () => true
    const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1]
    const cx = med(ns.map(n => n.x)), cy = med(ns.map(n => n.y)), cz = med(ns.map(n => n.z || 0))
    const dist = n => Math.hypot(n.x - cx, n.y - cy, (n.z || 0) - cz)
    const lim = med(ns.map(dist)) * 2.4
    return n => dist(n) <= lim
  }

  fit(ms = 900) {
    if (this.mode === '2d') { this.G.zoomToFit(ms, 70, this.fitFilter()); return }
    // 3D: frame the nodes' own bounds. (The library's box also counts the text labels, whose world size grows with
    // the camera distance, so a far camera made the box bigger, which sent the camera further out.)
    const f = this.fitFilter()
    const ns = [...this.store.values()].filter(n => !n.dying && Number.isFinite(n.x) && f(n))
    if (!ns.length) return
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const n of ns) for (const [i, c] of ['x', 'y', 'z'].entries()) { const v = n[c] || 0; lo[i] = Math.min(lo[i], v - n.r); hi[i] = Math.max(hi[i], v + n.r) }
    const ctr = lo.map((v, i) => (v + hi[i]) / 2)
    const cam = this.G.camera()
    const tan = Math.tan((cam.fov * Math.PI) / 360)
    const aspect = (this.el.clientWidth || 1) / (this.el.clientHeight || 1)
    // sphere around the box, with room for the top bar and the edges
    const rad = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2
    const dist = (rad * 1.18) / Math.min(tan, tan * aspect)
    const dir = [cam.position.x - ctr[0], cam.position.y - ctr[1], cam.position.z - ctr[2]]
    const len = Math.hypot(...dir) || 1
    const pos = { x: ctr[0] + (dir[0] / len) * dist, y: ctr[1] + (dir[1] / len) * dist, z: ctr[2] + (dir[2] / len) * dist }
    this.G.cameraPosition(pos, { x: ctr[0], y: ctr[1], z: ctr[2] }, ms)
    this.refDist = dist
  }

  viewState() {
    if (this.mode === '2d') { const c = this.G.centerAt() || { x: 0, y: 0 }; return { x: c.x || 0, y: c.y || 0, k: this.G.zoom() || 1 } }
    const p = this.G.camera().position, t = this.G.controls().target
    return { p: { x: p.x, y: p.y, z: p.z }, t: { x: t.x, y: t.y, z: t.z } }
  }
  applyView(v, ms) {
    if (this.mode === '2d') { this.G.centerAt(v.x, v.y, ms); this.G.zoom(v.k, ms) } else this.G.cameraPosition(v.p, v.t, ms)
  }
  // Fly to a node. With `track` (a click or a pick), the view from before the first click of the chain is kept, so that
  // clicking off the node can fly back to it. Moving between nodes goes straight from one to the next.
  focus(id, near, track) {
    this.autoFit = false
    const n = this.store.get(id)
    if (!n || !Number.isFinite(n.x)) return
    const ms = this.still ? 0 : 700
    if (track && !this.camSaved) this.camSaved = this.viewState()
    if (this.mode === '2d') {
      this.G.centerAt(n.x, n.y, ms)
      if (this.G.zoom() < 1.1) this.G.zoom(near ? 1.9 : 1.5, ms)
    } else {
      const cam = this.G.camera().position
      const d = clamp(Math.hypot(cam.x - n.x, cam.y - n.y, cam.z - n.z) * 0.8, 130, 420)
      const dir = { x: cam.x - n.x, y: cam.y - n.y, z: cam.z - n.z }
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1
      this.G.cameraPosition({ x: n.x + (dir.x / len) * d, y: n.y + (dir.y / len) * d, z: n.z + (dir.z / len) * d }, { x: n.x, y: n.y, z: n.z }, ms)
    }
    if (track) { this.camAfter = null; clearTimeout(this.camT); this.camT = setTimeout(() => { this.camAfter = this.viewState() }, ms + 90) }
  }
  // The selection was cleared: fly back to the view from before it, unless the user has moved the view since
  releaseFocus() {
    const saved = this.camSaved
    this.camSaved = null
    clearTimeout(this.camT)
    const after = this.camAfter
    this.camAfter = null
    if (!saved) return
    const now = this.viewState()
    let moved = false
    if (after) {
      if (this.mode === '2d') moved = Math.hypot(now.x - after.x, now.y - after.y) * now.k > 12 || Math.abs(now.k / after.k - 1) > 0.05
      else {
        const dist = Math.hypot(after.p.x - after.t.x, after.p.y - after.t.y, after.p.z - after.t.z) || 1
        moved = Math.hypot(now.p.x - after.p.x, now.p.y - after.p.y, now.p.z - after.p.z) > 0.03 * dist || Math.hypot(now.t.x - after.t.x, now.t.y - after.t.y, now.t.z - after.t.z) > 0.03 * dist
      }
    }
    if (!moved) this.applyView(saved, this.still ? 0 : 700)
  }

  resize(w, h) { if (w && h) { this.G.width(w).height(h); this.bd && this.bd.resize(w, h) } }
  pause() { this.paused = true; this.G.pauseAnimation() }
  resume() { this.paused = false; this.last = performance.now(); this.G.resumeAnimation() }
  positions() { const m = new Map(); for (const n of this.store.values()) if (Number.isFinite(n.x)) m.set(n.id, { x: n.x, y: n.y }); return m }

  destroy() {
    cancelAnimationFrame(this.raf)
    if (this.onKey) { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey) }
    clearTimeout(this.purgeT); (this.fitTs || []).forEach(clearTimeout)
    try { this.G.pauseAnimation(); this.G._destructor && this.G._destructor() } catch { /* already gone */ }
    this.bd && this.bd.destroy()
    this.el.replaceChildren()
  }

  // ── per-frame easing ────────────────────────────────────────────────────
  loop(t) {
    this.raf = requestAnimationFrame(tt => this.loop(tt))
    if (this.paused) return
    const dt = Math.min(0.05, (t - this.last) / 1000)
    this.last = t
    this.now = t
    this.frame++
    if (this.still === undefined || this.frame % 45 === 0) this.still = reducedMotion()
    this.step(dt, t)
    this.stepArrows(dt)
    if (!(this.frame % 15)) this.stepFlow()
    if (this.bd) this.bd.frame(this)
    this.stepBackdrop(dt)
    if (this.mode === '3d') this.apply3d()
    if (this.ramping) this.rampForces(dt)
    if (this.held && this.held.length && t > this.holdUntil) {   // let the held nodes go (the pinned ones stay)
      for (const n of this.held) { n.__held = false; if (!n.pinned && n !== this.dragNode) { n.fx = n.fy = n.fz = undefined; n.vx = n.vy = n.vz = 0 } }
      this.held = []
    }
    if (!this.dragNode && this.heat !== undefined && this.heat < 1) {
      this.heat = this.heat > 0.985 ? 1 : this.heat + (1 - this.heat) * (1 - Math.exp(-dt / (this.heatTau || 0.8)))
      this.G.d3VelocityDecay(0.42 + (1 - this.heat) * 0.28)
      this.applyForces()
    }
    if (this.damp && this.damp < 0.42 + 0.01) { this.damp = 0 } else if (this.damp) {
      this.damp = 0.42 + (this.damp - 0.42) * Math.exp(-dt / 0.9)
      this.G.d3VelocityDecay(this.damp)
    }
    if (this.arrowDirty && this.mode === '3d' && t - this.arrowDirty < 400 && t - (this.lastArrowPush || 0) > 110) {
      this.lastArrowPush = t
      this.G.linkDirectionalArrowLength(l => this.arrowLen(l)).linkDirectionalArrowColor(l => this.arrowColor(l))
    }
    if (this.linksDirty && this.mode === '3d' && t - this.linksDirty < 700 && t - (this.lastLinkPush || 0) > 90) {
      this.lastLinkPush = t
      this.G.linkColor(this.G.linkColor())
    }
  }

  step(dt, now) {
    const ka = 1 - Math.exp(-dt / 0.16)
    const kr = 1 - Math.exp(-dt / 0.24)
    const kc = 1 - Math.exp(-dt / 0.3)
    const ks = 1 - Math.exp(-dt / 0.18)
    const kf = 1 - Math.exp(-dt / 0.22)
    const kl = 1 - Math.exp(-dt / 0.065)   // labels fade over ~200 ms
    if (this.frame % 3 === 0) this.declutter()
    const hl = this.hl
    for (const n of this.store.values()) {
      if (n.start && now < n.start) continue
      const dim = hl && !hl.has(n.id)
      n.a += ((n.dying ? 0 : dim ? 0.12 : 1) - n.a) * ka
      n.r += ((n.dying ? 0 : (n.tr || 0) * recSize(n.rk) * (0.84 + 0.16 * (n.fo ?? 1)) * (this.vis.seeds && this.vis.seeds.has(n.id) ? 2.2 : 1) * (1 + 0.4 * (n.sg || 0))) - n.r) * kr
      // focus: kinds outside it recede (render only: opacity, saturation, size, labels), none of it touches the layout
      const fo = !this.vis.focus || this.vis.focus.size === 0 || this.vis.focus.has(n.kind) ? 1 : 0
      n.fo = (n.fo ?? 1) + (fo - (n.fo ?? 1)) * kf
      const ioT = this.vis.isolate && !this.vis.isolate.has(n.id) ? 0 : 1   // isolate: outside the neighborhood, dimmed in place
      n.io = (n.io ?? 1) + (ioT - (n.io ?? 1)) * (this.still ? 1 : kf)
      if (this.vis.sel !== n.id && n.__bornF && (n.sg || 0) < 0.02) n.__bornF = null
      n.sg = (n.sg || 0) + ((this.vis.sel === n.id ? 1 : 0) - (n.sg || 0)) * (this.still ? 1 : ks * 0.6)   // the clicked node grows (about 1.4x) and shrinks back
      n.sa += ((this.vis.sel === n.id || (this.vis.multi && this.vis.multi.has(n.id)) ? 1 : 0) - n.sa) * ks
      if (n.tc) { n.cr += (n.tc[0] - n.cr) * kc; n.cg += (n.tc[1] - n.cg) * kc; n.cb += (n.tc[2] - n.cb) * kc }
      n.la += ((!n.dying && !dim && n.want ? 1 : 0) - n.la) * kl
    }
  }

  rampForces(dt) {
    const k = 1 - Math.exp(-dt / 0.35)
    let done = true
    for (const key of Object.keys(this.f)) {
      const d = this.f[key] - this.fCur[key]
      if (Math.abs(d) > 0.4) done = false
      this.fCur[key] = Math.abs(d) > 0.4 ? this.fCur[key] + d * k : this.f[key]
    }
    this.applyForces()
    if (done) this.ramping = false
  }

  // ── backdrop helpers ────────────────────────────────────────────────────
  viewCenter() {
    if (this.mode === '2d') { const c = this.G.centerAt(); return c ? [c.x || 0, c.y || 0] : null }
    const t = this.G.controls()?.target
    return t ? [t.x, t.y] : null
  }
  viewKey() {
    if (this.mode === '2d') { const c = this.viewCenter() || [0, 0]; return `${c[0] | 0},${c[1] | 0},${(this.G.zoom() || 1).toFixed(2)}` }
    const p = this.G.camera().position
    return `${p.x | 0},${p.y | 0},${p.z | 0}`
  }
  parallax() {
    if (this.mode === '2d') { const c = this.viewCenter() || [0, 0]; const k = this.G.zoom() || 1; return [-c[0] * k * 0.25, -c[1] * k * 0.25] }
    const p = this.G.camera().position, t = this.G.controls()?.target || { x: 0, y: 0, z: 0 }
    const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) || 1
    return [Math.atan2(p.x - t.x, p.z - t.z) * 160, -((p.y - t.y) / d) * 220]
  }
  seedScreen() {
    const id = this.vis.seeds && [...this.vis.seeds].find(i => this.store.has(i))
    const n = id && this.store.get(id)
    if (!n || !Number.isFinite(n.x)) return null
    try { const c = this.G.graph2ScreenCoords(n.x, n.y, n.z || 0); return Number.isFinite(c.x) ? [c.x, c.y] : null } catch { return null }
  }

  // 3D: a faint floor grid under the graph and a distant shell of stars (the 2D canvas backdrop draws behind both)
  addStage3d() {
    const THREE = this.L.THREE
    const scene = this.G.scene()
    const grid = new THREE.GridHelper(2400, 48, 0xffffff, 0xffffff)
    grid.material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false })
    grid.raycast = () => {}
    const N = 450
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) { const a = Math.random() * 6.2832, b = Math.acos(2 * Math.random() - 1), r = 2600 + Math.random() * 900; pos[i * 3] = r * Math.sin(b) * Math.cos(a); pos[i * 3 + 1] = r * Math.cos(b); pos[i * 3 + 2] = r * Math.sin(b) * Math.sin(a) }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, transparent: true, opacity: 0.4, depthWrite: false }))
    stars.raycast = () => {}
    grid.renderOrder = -2; stars.renderOrder = -2
    scene.add(grid, stars)
    this.stage3d = { grid, stars, n: N }
    this.updateStage3d()
  }
  // The backdrop settings (star opacity, saturation, density; grid intensity) ease toward what the user set, so a theme
  // switch or a slider never pops. Zoomed out, the stars thin out and dim so they never rival the data.
  backdropZoom() { const k = this.scaleNow(); return 0.06 + 0.94 * clamp((k - 0.3) / 0.9, 0, 1) }
  stepBackdrop(dt) {
    const t = this.vis.bdv
    if (!t) return
    if (!this.bdCur) this.bdCur = { ...t }
    const k = this.still ? 1 : 1 - Math.exp(-dt / 0.3)
    let moving = false
    for (const key of Object.keys(t)) {
      const d = t[key] - this.bdCur[key]
      if (Math.abs(d) > 0.002) { this.bdCur[key] += d * k; moving = true } else this.bdCur[key] = t[key]
    }
    this.bdKey = Object.values(this.bdCur).map(v => v.toFixed(3)).join(',')
    if (this.stage3d) { const zf = this.backdropZoom(); if (Math.abs(zf - (this.lastZf ?? -1)) > 0.01) { this.lastZf = zf; moving = true } }
    if (this.stage3d && (moving || !(this.frame % 20))) this.updateStage3d()
  }
  updateStage3d() {
    const st = this.stage3d
    if (!st) return
    const bv = this.bdCur || { starOp: 0.12, starSat: 0.25, starDen: 0.3, intensity: 0.4 }
    const level = this.vis.backdrop || 'subtle'
    const light = this.T.light
    const zf = this.backdropZoom()
    st.grid.visible = level === 'full'
    st.stars.visible = level !== 'off'
    // star color: the accent with its saturation turned down toward grey
    const [r, g, b] = hex(this.T.accent)
    const y = 0.3 * r + 0.59 * g + 0.11 * b, sat = bv.starSat
    st.stars.material.color.setRGB((y + (r - y) * sat) / 255, (y + (g - y) * sat) / 255, (y + (b - y) * sat) / 255, this.L.THREE.SRGBColorSpace)
    st.stars.material.opacity = clamp(bv.starOp * 2.2 * zf * (level === 'full' ? 1.25 : 1), 0, 1) * (light ? 0.8 : 1)
    st.stars.material.size = (1.2 + 1.6 * bv.starDen) * (light ? 0.9 : 1)
    st.stars.geometry.setDrawRange(0, Math.max(1, Math.round(st.n * bv.starDen * (0.25 + 0.75 * zf))))
    st.stars.material.blending = light ? this.L.THREE.NormalBlending : this.L.THREE.AdditiveBlending
    st.grid.material.color.copy(new this.L.THREE.Color(this.T.accent))
    st.grid.material.opacity = (light ? 0.14 : 0.1) * (bv.intensity / 0.5) * (0.4 + 0.6 * zf)
    let low = Infinity
    for (const n of this.store.values()) if (Number.isFinite(n.y) && n.y < low) low = n.y
    if (Number.isFinite(low)) st.grid.position.y += ((low - 50) - st.grid.position.y) * 0.2
  }

  // ── flowing particles: only on meaningful links, capped ──────────────────────
  flowCfg() { return { on: true, speed: 40, opacity: 55, sat: 60, density: 40, ...(this.vis.flow || {}) } }
  flowColor(l) {
    const f = this.flowCfg()
    let c
    if (l.flag === 'conflict') c = hex(this.T.flag.conflict)
    else {
      const s = typeof l.source === 'object' ? l.source : this.store.get(l.source)
      const nc = s ? this.nodeColor(s) : null
      c = nc ? (Array.isArray(nc) ? nc : hex(nc)) : hex(this.T.accent)
    }
    const g = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], k = clamp(f.sat / 100, 0, 1)
    const a = clamp((f.opacity / 100) * (l.__fa ?? 1), 0.05, 1)
    return `rgba(${(g + (c[0] - g) * k) | 0},${(g + (c[1] - g) * k) | 0},${(g + (c[2] - g) * k) | 0},${a.toFixed(2)})`
  }
  pushFlow3d() {
    this.G.linkDirectionalParticles(l => l.__fc || 0).linkDirectionalParticleSpeed(l => l.__fv || 0.0016).linkDirectionalParticleColor(l => this.flowColor(l))
  }
  // Pulses run only on links that mean something: the selected node's paths, compare paths, hierarchy next to the focus,
  // conflicts. They quiet down as more links are in view (fewer, slower, softer), and the selected, compared and
  // conflicting paths always stay the strongest. Speed, opacity, saturation and the cap are the user's settings.
  stepFlow() {
    const f = this.flowCfg()
    const mode = this.vis.arrows || 'smart'
    const cand = []
    let visible = 0
    if (f.on && !this.still) {
      const k = this.scaleNow()
      const zoomOk = mode === 'all' || k > 0.45
      for (const l of this.links || []) {
        const s = typeof l.source === 'object' ? l.source : this.store.get(l.source)
        const t = typeof l.target === 'object' ? l.target : this.store.get(l.target)
        if (!s || !t || Math.min(s.a, t.a) < 0.5) continue
        visible++
        const conflict = l.flag === 'conflict'
        if (!conflict && (l.flag === 'inferred' || l.kind === 'found' || l.kind === 'about' || l.kind === 'monitor')) continue
        const focus = Math.min(s.fo ?? 1, t.fo ?? 1)
        if ((!conflict && focus < 0.5) || Math.min(s.io ?? 1, t.io ?? 1) < 0.5) continue
        const lit = this.vis.pathEdges ? this.vis.pathEdges.has(l.a + '|' + l.b) : this.hlId && (l.a === this.hlId || l.b === this.hlId)
        let score = 0
        if (conflict) score = 0.7
        else if (lit) score = 1
        else if (this.hl && this.hl.has(s.id) && this.hl.has(t.id) && l.flag !== 'derived') score = 0.5
        else if (mode === 'all' && zoomOk && l.flag !== 'derived') score = 0.25
        if (score > 0) cand.push([l, score])
      }
    }
    const soft = clamp(1.15 - visible / 450, 0.35, 1)               // many visible links: softer, fewer, slower
    const strong = cand.filter(c => c[1] >= 0.7).length
    const cap = Math.max(strong, Math.round((20 + 1.3 * f.density) * soft))
    cand.sort((a, b) => b[1] - a[1])
    const keep = new Map(cand.slice(0, cap).map(([l, sc]) => [l, sc]))
    const base = 0.0016 * (clamp(f.speed, 5, 100) / 50)
    let changed = false
    for (const l of this.links || []) {
      const sc = keep.get(l)
      const isStrong = sc !== undefined && sc >= 0.7
      const n = sc === undefined ? 0 : isStrong ? (sc >= 1 ? 3 : 2) : sc >= 0.5 ? (soft > 0.7 ? 2 : 1) : 1
      if ((l.__fc || 0) !== n) { l.__fc = n; changed = true }
      l.__fa = isStrong ? 1 : 0.45 + 0.4 * soft
      l.__fv = base * (l.flag === 'conflict' ? 0.6 : isStrong ? 1 : 0.55 + 0.35 * soft)
    }
    if ((changed || this.flowDirty) && this.mode === '3d') this.pushFlow3d()
    this.flowDirty = false
  }

  // Arrows are drawn where they help: strong on the paths you are looking at, lighter on hierarchy, faint on derived links,
  // and fading out as you zoom away or when either end is out of focus. Each link eases to its own target.
  stepArrows(dt) {
    const mode = this.vis.arrows || 'smart'
    const ka = 1 - Math.exp(-dt / 0.18)
    const k = this.scaleNow()
    const zoomF = mode === 'all' ? 1 : clamp((k - 0.6) / 1.5, 0, 1)
    let moving = false
    for (const l of this.links || []) {
      const s = typeof l.source === 'object' ? l.source : this.store.get(l.source)
      const t = typeof l.target === 'object' ? l.target : this.store.get(l.target)
      let target = 0
      if (mode !== 'off' && s && t && !l.__fc) {   // a link with a moving pulse needs no static arrowhead
        const lit = this.vis.pathEdges ? this.vis.pathEdges.has(l.a + '|' + l.b) : this.hlId && (l.a === this.hlId || l.b === this.hlId)
        const rel = lit ? 1 : l.flag === 'derived' || l.kind === 'found' ? 0.22 : l.flag === 'inferred' ? 0 : l.kind === 'owner' ? 0.9 : 0.6
        const vis = Math.min(s.a, t.a) * (this.focusMult(s, t)) * Math.min(s.io ?? 1, t.io ?? 1)
        target = mode === 'all' ? Math.max(0.35, rel) * vis : (lit ? Math.max(zoomF, 0.5) : zoomF) * rel * vis
      }
      const cur = l.__ar ?? 0
      l.__ar = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * ka
      if (Math.abs(target - cur) >= 0.01) moving = true
    }
    if (moving && this.mode === '3d') this.arrowDirty = performance.now()
  }

  focusMult(s, t) {   // both ends in focus: full; one end: medium; neither: faint
    if (!this.vis.focus || this.vis.focus.size === 0) return 1
    return 0.18 + 0.41 * ((s.fo ?? 1) + (t.fo ?? 1))
  }

  scaleNow() {
    if (this.mode === '2d') return this.G.zoom() || 1
    if (!this.refDist) return 1
    const p = this.G.camera().position
    return clamp(this.refDist / (Math.hypot(p.x, p.y, p.z) || 1), 0.1, 6)
  }

  // Which labels to show. Every node is projected to the screen and ranked: the node you point at or picked and its
  // neighbors first, then the biggest hubs (a few of them even when far away, so the scene is never blind), then result
  // nodes, then the rest, each nudged up by how close the camera is and how big the node looks. Labels are then placed
  // greedily from the top, and one is kept only if its box clears every label already placed. Zooming in spreads the
  // nodes apart on screen, so more labels fit by themselves, and the cap rises with zoom as well.
  declutter() {
    const mode = this.vis.labels || 'smart'
    const nodes = [...this.store.values()].filter(n => !n.dying && Number.isFinite(n.x) && n.a > 0.3)
    const k = this.scaleNow()
    const W = this.el.clientWidth, H = this.el.clientHeight
    const base = mode === 'more' ? 150 : 70
    const cap = mode === 'off' ? 0 : Math.round(clamp(base * (0.3 + 0.7 * clamp((k - 0.5) / 2.5, 0, 1)), 8, base))
    const margin = mode === 'more' ? 2 : 6
    let proj
    if (this.mode === '2d') proj = n => { const c = this.G.graph2ScreenCoords(n.x, n.y); return { x: c.x, y: c.y, r: n.r * k, near: clamp(n.r * k / 14, 0, 1) } }
    else {
      const cam = this.G.camera()
      const V = this._v ??= new this.L.THREE.Vector3()
      const ref = this.refDist || cam.position.length() || 1
      const tan = Math.tan((cam.fov * Math.PI) / 360)
      proj = n => {
        V.set(n.x, n.y, n.z || 0)
        const d = V.distanceTo(cam.position)
        V.project(cam)
        if (V.z > 1) return null
        const rr = (n.r * 0.85 * H) / (2 * d * tan)
        return { x: (V.x * 0.5 + 0.5) * W, y: (-V.y * 0.5 + 0.5) * H, r: rr, near: clamp(1 - d / (ref * 1.6), 0, 1) }
      }
    }
    // the biggest hubs by influence: a few always get a label
    const hubs = new Set(nodes.slice().sort((a, b) => (b.bc || 0) - (a.bc || 0)).slice(0, mode === 'more' ? 8 : 4).map(n => n.id))
    const cand = []
    for (const n of nodes) {
      const p = proj(n)
      n.want = false
      n.near = p ? p.near : 0
      if (!p || p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > H + 10) continue
      const focus = n.id === this.hoverId || n.id === this.vis.sel
      const nb = !focus && this.pinLabels && this.hl && this.hl.has(n.id)
      const tier = focus ? 6 : nb ? 5 : hubs.has(n.id) ? 4 : n.result ? 2 : 0
      if (mode === 'off' && !focus) continue
      if (((n.fo ?? 1) < 0.5 || (n.io ?? 1) < 0.5) && !focus && !nb) continue
      const imp = (1 - (n.rank ?? 1)) * 1.2 + (n.wt ?? 1) * 0.5 + clamp(p.r / 10, 0, 1) * 0.6
      cand.push({ n, p, tier, score: tier * 10 + p.near * 3 + imp })
    }
    cand.sort((a, b) => b.score - a.score)
    const placed = []
    let count = 0
    let nbCount = 0
    for (const c of cand) {
      const { n, p, tier } = c
      const w = Math.min(n.label.length, 26) * LABEL_PX * 0.64 + 6 + margin, h = LABEL_PX * 1.45 + margin
      const box = [p.x - w / 2, p.y + p.r + 2, p.x + w / 2, p.y + p.r + 2 + h]
      if (tier < 6) {
        if (tier === 5 ? nbCount >= 40 : (tier < 4 && count >= cap)) continue
        if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue
      }
      n.want = true
      placed.push(box)
      count++
      if (tier === 5) nbCount++
    }
    this.labelsShown = count
  }

  // for tests and the tooltip: how many labels are fading in or fully shown
  labelCount() { let c = 0; for (const n of this.store.values()) if (n.la > 0.5) c++; return c }

  // a node's color with the focus applied: out of focus it loses most of its saturation
  fc(n) {
    if (this.vis.seeds && this.vis.seeds.has(n.id)) return this.seedRgb()
    const f = n.fo ?? 1
    if (f > 0.995) return [n.cr, n.cg, n.cb]
    const g = (n.cr + n.cg + n.cb) / 3, m = 0.6 * (1 - f)
    return [n.cr + (g - n.cr) * m, n.cg + (g - n.cg) * m, n.cb + (g - n.cb) * m]
  }

  // ── 2D ──────────────────────────────────────────────────────────────────
  draw2d(n, ctx, k) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || n.a < 0.015 || n.r < 0.2) return
    const T = this.T
    const fcol = this.fc(n)
    const c = `${fcol[0] | 0},${fcol[1] | 0},${fcol[2] | 0}`
    const r = n.r
    const fa = (0.3 + 0.7 * (n.fo ?? 1)) * (0.06 + 0.94 * (n.io ?? 1)) * recFade(n.rk)
    ctx.save()
    ctx.globalAlpha = n.a * fa
    if (!T.light && (this.store.size < 400 || n.sa > 0.05 || n.id === this.hoverId)) {
      const g = ctx.createRadialGradient(n.x, n.y, r * 0.2, n.x, n.y, r * 3.2)
      g.addColorStop(0, `rgba(${c},.4)`); g.addColorStop(1, `rgba(${c},0)`)
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r * 3.2, 0, 6.2832); ctx.fill()
    }
    if (n.missing) {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = `rgb(${c})`; ctx.lineWidth = 1.6; ctx.fillStyle = T.bg
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.setLineDash([])
    } else {
      ctx.fillStyle = `rgb(${c})`; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.fill()
      ctx.strokeStyle = T.bg; ctx.lineWidth = Math.min(1.4, r * 0.3); ctx.stroke()   // a thin ring in the page color keeps overlapping nodes apart
    }
    if (n.result && r > 3 && this.store.size < 200 && !(this.vis.seeds && this.vis.seeds.has(n.id))) { ctx.strokeStyle = T.accent; ctx.globalAlpha = n.a * 0.4; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = n.a }
    if (n.hop && r > 3) { ctx.strokeStyle = this.seedCss(); ctx.globalAlpha = n.a * Math.max(0.18, 0.6 - n.hop * 0.1); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5 + n.hop, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = n.a }
    const mk = this.markerKind(n)
    if (mk && r > 1.5) {
      if (mk === 'seed' && n.a > 0.5) n.__born ??= this.now
      if (mk === 'focus') n.__bornF ??= this.now
      if (mk === 'seed') { ctx.fillStyle = this.seedCss(); ctx.globalAlpha = n.a * 0.16; ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.2, 0, 6.2832); ctx.fill(); ctx.globalAlpha = n.a }
      ctx.save(); ctx.translate(n.x, n.y)
      drawReticle(ctx, mk, r + 4.5, { color: mk === 'seed' ? this.seedCss() : T.accent, lw: Math.min(2.4, 1.3 / k), t: this.now, a: n.a * (mk === 'sel' ? Math.max(n.sa, 0.35) : mk === 'focus' ? Math.max(n.sg || 0, 0.2) : 1) * (0.45 + 0.55 * (n.fo ?? 1)) * (0.06 + 0.94 * (n.io ?? 1)), born: mk === 'focus' ? n.__bornF : n.__born, still: this.still })
      ctx.restore(); ctx.globalAlpha = n.a
    }
    if (n.pinned) {   // a small pin: dot on a stalk at the upper right
      const px = n.x + r * 0.75, py = n.y - r * 0.75 - 2 / k, pr = 3.2 / k
      ctx.strokeStyle = T.accent; ctx.lineWidth = 1.1 / k; ctx.beginPath(); ctx.moveTo(n.x + r * 0.6, n.y - r * 0.6); ctx.lineTo(px, py); ctx.stroke()
      ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.2832); ctx.fill()
      ctx.strokeStyle = T.text; ctx.lineWidth = 0.9 / k; ctx.stroke()
    }
    const bi = this.multiIdx ? this.multiIdx.get(n.id) : undefined
    if (bi !== undefined) {   // numbered badge on the nodes picked for comparison
      const br = 6.5 / k, bx = n.x - r * 0.8 - 1 / k, by = n.y - r * 0.8 - 1 / k
      ctx.globalAlpha = n.a
      ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.2832); ctx.fill()
      ctx.lineWidth = 1 / k; ctx.strokeStyle = T.bg; ctx.stroke()
      ctx.fillStyle = T.bg; ctx.font = `700 ${9 / k}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(bi + 1), bx, by + 0.4 / k)
      ctx.globalAlpha = n.a * fa
    }
    if (n.la > 0.03) {
      const fs = clamp(LABEL_PX / k, 2.5, 60)
      ctx.globalAlpha = n.a * n.la
      ctx.font = `600 ${fs}px Manrope, 'JetBrains Mono', system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      const t = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label
      ctx.lineWidth = 3 / k; ctx.strokeStyle = T.bg; ctx.lineJoin = 'round'; ctx.strokeText(t, n.x, n.y + r + 2 / k)
      ctx.fillStyle = T.text; ctx.fillText(t, n.x, n.y + r + 2 / k)
    }
    ctx.restore()
  }

  // Topics lens (2D): a soft halo behind each community with its lead name, and the weakest ties between
  // communities drawn as dashed "gap" lines: where the structure is thin.
  drawTopics(ctx, k) {
    if (!this.vis.topics) return
    const T = this.T
    const by = new Map()
    for (const n of this.store.values()) if (!n.dying && n.a > 0.3 && Number.isFinite(n.x)) { if (!by.has(n.comm)) by.set(n.comm, []); by.get(n.comm).push(n) }
    const top = [...by.entries()].filter(([, a]) => a.length >= 3).sort((x, y) => y[1].length - x[1].length).slice(0, 6)
    const cen = new Map()
    for (const [c, arr] of top) {
      const cx = arr.reduce((s, n) => s + n.x, 0) / arr.length, cy = arr.reduce((s, n) => s + n.y, 0) / arr.length
      const rad = Math.max(...arr.map(n => Math.hypot(n.x - cx, n.y - cy))) + 26
      cen.set(c, { cx, cy, rad })
      const col = hex(T.comm[c % T.comm.length])
      const g = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad)
      g.addColorStop(0, `rgba(${col},${T.light ? 0.1 : 0.13})`); g.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.fill()
      const lead = arr.reduce((b, n) => (n.val > b.val ? n : b), arr[0])
      ctx.font = `700 ${clamp(12 / k, 4, 40)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = `rgba(${col},.85)`; ctx.fillText(`${lead.label} · ${arr.length}`, cx, cy - rad * 0.82)
    }
    for (const [a, b, links] of this.gapPairs || []) {
      const A = cen.get(a), B = cen.get(b)
      if (!A || !B) continue
      ctx.save(); ctx.setLineDash([6 / k, 5 / k]); ctx.strokeStyle = T.flag.missing; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.4 / k
      ctx.beginPath(); ctx.moveTo(A.cx, A.cy); ctx.lineTo(B.cx, B.cy); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = T.muted; ctx.font = `600 ${clamp(10 / k, 3, 30)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center'
      ctx.fillText(`gap · ${links} link${links === 1 ? '' : 's'}`, (A.cx + B.cx) / 2, (A.cy + B.cy) / 2)
      ctx.restore()
    }
  }

  // ── dragging and pinning ────────────────────────────────────────────────
  // While one node is held, only its neighbors may move (through their links); every other node is held
  // still and the engine runs at a low heat, so the rest of the graph stays calm. On drop the node stays
  // where it was put (pinned) until it is double-clicked.
  // (force-graph holds the engine at alpha 0.3 for the whole drag and does not expose that; the same calm comes
  // from scaling the forces down and damping harder while a node is held.)
  onDrag(n) {
    if (this.dragNode === n) return
    this.dragNode = n
    this.heat = 0.3
    this.G.d3VelocityDecay(0.7)
    this.applyForces()
    const near = new Set(this.adj.get(n.id) || [])
    this.frozen = []
    for (const m of this.store.values()) {
      if (m === n || near.has(m.id) || m.dying || Number.isFinite(m.fx)) continue
      m.fx = m.x; m.fy = m.y
      if (this.mode === '3d') m.fz = m.z
      this.frozen.push(m)
    }
  }

  onDragEnd(n) {
    for (const m of this.frozen || []) { m.fx = m.fy = m.fz = undefined; m.vx = m.vy = m.vz = 0 }
    this.frozen = []
    this.heatTau = 0.8
    this.dragNode = null   // the forces come back up over about two seconds (see loop), so releasing the others is not a jolt
    this.pin(n)
  }

  pin(n) {
    n.pinned = true
    n.fx = n.x; n.fy = n.y
    if (this.mode === '3d') n.fz = n.z
    this.cb.onPins && this.cb.onPins(this.pinnedIds())
  }

  unpin(n) {
    n.pinned = false
    n.fx = n.fy = n.fz = undefined
    try { this.G.d3ReheatSimulation() } catch { /* not ready */ }
    this.cb.onPins && this.cb.onPins(this.pinnedIds())
  }

  unpinId(id) { const n = this.store.get(id); if (n && n.pinned) this.unpin(n) }
  unpinAll() { for (const n of this.store.values()) if (n.pinned) { n.pinned = false; n.fx = n.fy = n.fz = undefined } try { this.G.d3ReheatSimulation() } catch { /* not ready */ } this.cb.onPins && this.cb.onPins([]) }
  pinnedIds() { return [...this.store.values()].filter(n => n.pinned).map(n => n.id) }

  // ── links: colored by the nodes at their ends (or by relation type), width by weight, arrows parent -> child ──
  linkW(l) {
    if (l.kind === 'owner') return 1.9
    if (l.kind === 'candidate' || l.kind === 'support') return 1.2
    if (l.flag === 'conflict') return 2
    if (l.flag) return 1.4
    const s = typeof l.source === 'object' ? l.source : null, t = typeof l.target === 'object' ? l.target : null
    const w = 0.7 + 0.16 * Math.sqrt(Math.min(s ? s.deg || 1 : 1, t ? t.deg || 1 : 1))
    return clamp(l.flag === 'derived' ? w * 0.7 : w, 0.6, 2.2)
  }
  arrowLen(l) { const a = l.__ar || 0; return a < 0.04 ? 0 : (l.kind === 'owner' ? 5.2 : 3.8) * (0.4 + 0.6 * a) }
  arrowColor(l) {
    const t = typeof l.target === 'object' ? l.target : this.store.get(l.target)
    const c = hex(t ? this.nodeColor(t) : this.T.muted)
    return `rgba(${c[0]},${c[1]},${c[2]},${(l.__ar ?? 0).toFixed(2)})`
  }
  linkAlpha(l) {
    const s = typeof l.source === 'object' ? l.source : this.store.get(l.source)
    const t = typeof l.target === 'object' ? l.target : this.store.get(l.target)
    const a = Math.min(s ? s.a : 1, t ? t.a : 1)
    const big = this.store.size > 250
    const base = l.flag === 'conflict' ? 1 : l.flag === 'missing' ? 0.8 : l.flag === 'inferred' ? 0.8 : l.flag === 'derived' ? (big ? 0.22 : 0.38) : (big ? 0.34 : 0.55)
    const lit = this.vis.pathEdges ? this.vis.pathEdges.has(l.a + '|' + l.b) : this.hlId && (l.a === this.hlId || l.b === this.hlId)
    return clamp(a * this.focusMult(s || {}, t || {}) * (0.04 + 0.96 * Math.min(s?.io ?? 1, t?.io ?? 1)) * (lit ? Math.min(1, base * 1.6) : base), 0, 1)
  }
  drawLink(l, ctx, k) {
    const s = l.source, t = l.target
    if (!s || !t || !Number.isFinite(s.x) || !Number.isFinite(t.x)) return
    const al = this.linkAlpha(l)
    if (al < 0.02) return
    const T = this.T
    ctx.save()
    let stroke
    if (l.flag && T.flag[l.flag]) { const c = hex(T.flag[l.flag]); stroke = `rgba(${c[0]},${c[1]},${c[2]},${al})` }
    else if (this.vis.links === 'type') { const c = hex(T.rel[l.kind] || T.muted); stroke = `rgba(${c[0]},${c[1]},${c[2]},${al})` }
    else {
      const g = ctx.createLinearGradient(s.x, s.y, t.x, t.y)
      g.addColorStop(0, `rgba(${s.cr | 0},${s.cg | 0},${s.cb | 0},${al})`)
      g.addColorStop(1, `rgba(${t.cr | 0},${t.cg | 0},${t.cb | 0},${al})`)
      stroke = g
    }
    const dash = l.kind === 'candidate' ? [6, 3] : l.kind === 'support' ? [2, 3] : l.flag === 'derived' ? [2, 3] : l.flag === 'missing' ? [4, 4] : l.flag === 'inferred' ? [5, 3] : []
    ctx.setLineDash(dash.map(d => d / k))
    ctx.strokeStyle = stroke
    const fm = this.focusMult(s, t)
    ctx.lineWidth = this.linkW(l) * (0.55 + 0.45 * Math.min(1, fm)) / k
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    const cp = l.__controlPoints
    if (cp) ctx[cp.length === 2 ? 'quadraticCurveTo' : 'bezierCurveTo'](...cp, t.x, t.y)
    else ctx.lineTo(t.x, t.y)
    ctx.stroke()
    ctx.restore()
  }

  linkColor(l) {
    const T = this.T
    const q = Math.round(this.linkAlpha(l) * 24)
    const src = typeof l.source === 'object' ? l.source : this.store.get(l.source)
    const lit = this.hlId && (l.a === this.hlId || l.b === this.hlId)
    const col = T.flag[l.flag] || (this.vis.links === 'type' ? T.rel[l.kind] : src ? this.nodeColor(src) : null) || (lit ? T.text : T.muted)
    const key = `${col}|${q}`
    let v = this.linkCache.get(key)
    if (!v) {
      const rgb = hex(col)
      v = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(q / 24).toFixed(2)})`
      this.linkCache.set(key, v)
    }
    return v
  }

  // ── 3D ──────────────────────────────────────────────────────────────────
  // The searched-for node gets its own color, not its kind's: the theme accent pushed to full saturation and a lightness
  // that reads on the current background. The reticle uses the same one.
  seedRgb() {
    const key = this.T.accent + (this.T.light ? 'L' : 'D')
    if (this.seedKey !== key) {
      const [r, g, b] = hex(this.T.accent).map(x => x / 255)
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      let h = 0
      const d = mx - mn
      if (d) h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      h = (h / 6 + 0.5) % 1   // the complement of the accent: the clicked node's reticle is the accent itself, so the two never look alike
      const l = this.T.light ? 0.46 : 0.62
      const q = l < 0.5 ? l * 1.95 : l + 0.95 - l * 0.95, p = 2 * l - q
      const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
      this.seedKey = key
      this.seedCol = [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
    }
    return this.seedCol
  }
  seedCss() { const c = this.seedRgb(); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` }

  // The HUD marker a node gets: the thing searched for (seed), the selected node, the hovered node
  markerKind(n) {
    if (n.id === this.vis.sel) return 'focus'                                        // clicked: the full reticle in the accent
    if (this.vis.seeds && this.vis.seeds.has(n.id)) return 'seed'                    // searched for: the full reticle in the seed color
    if (this.vis.multi && this.vis.multi.has(n.id)) return 'sel'                     // compare picks: a calm arc (and the number)
    if (n.id === this.hoverId || n.id === this.hoverExt) return 'hover'
    return null
  }

  // 3D: the same reticle on a small canvas shown as a camera-facing sprite, sized in screen pixels (clamped) so it
  // stays readable far away and never swallows the node up close. It takes no pointer events.
  marker3d(n, parent, kind, r, d, tan2, H) {
    const THREE = this.L.THREE
    let k = n.__ret
    if (!k) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      sprite.raycast = () => {}; sprite.renderOrder = 9
      parent.add(sprite)
      k = n.__ret = { canvas, ctx: canvas.getContext('2d'), tex, sprite, mat, last: -1 }
    }
    const rp = (r * H) / Math.max(1e-6, d * tan2)                       // node radius in screen pixels
    const want = clamp(rp + 6, 14, 58)                                   // the reticle's ring sits this far from the centre on screen
    const S = (want * 128 / 38) * d * tan2 / H                          // sprite size that puts a 38px canvas radius at `want` screen px
    k.sprite.scale.set(S, S, 1); k.sprite.visible = true
    k.mat.blending = this.T.light ? THREE.NormalBlending : THREE.AdditiveBlending
    const fo = n.fo ?? 1
    const a = Math.min(1, n.a) * (0.45 + 0.55 * fo) * (0.06 + 0.94 * (n.io ?? 1)) * (kind === 'sel' ? Math.max(n.sa, 0.35) : kind === 'focus' ? Math.max(n.sg || 0, 0.2) : 1)
    if (kind === 'seed' && n.a > 0.5) n.__born ??= this.now
    if (kind === 'focus') n.__bornF ??= this.now
    const still = this.still
    if (still && k.kind === kind && k.last >= 0 && Math.abs(k.a - a) < 0.02) return            // reduced motion: draw only when it changes
    if (!still && ((this.frame + (n.__rid ??= Math.floor(Math.random() * 2))) & 1)) return    // otherwise 30 fps is plenty
    k.kind = kind; k.a = a; k.last = this.frame
    k.ctx.clearRect(0, 0, 128, 128)
    k.ctx.save(); k.ctx.translate(64, 64)
    drawReticle(k.ctx, kind, 38, { color: kind === 'seed' ? this.seedCss() : this.T.accent, lw: 1.4, t: this.now, a, born: kind === 'focus' ? n.__bornF : n.__born, lock: 0.6, still })
    k.ctx.restore()
    k.tex.needsUpdate = true
  }

  make3d(n, THREE, SpriteText) {
    const g = new THREE.Group()
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }))
    mesh.scale.setScalar(0.01)
    const sp = new SpriteText(n.label, 4, this.T.text)
    sp.fontFace = 'Manrope, system-ui, sans-serif'; sp.fontWeight = '600'; sp.strokeWidth = 1.2; sp.strokeColor = this.T.bg
    sp.material.transparent = true; sp.material.depthWrite = false; sp.material.depthTest = false; sp.material.opacity = 0
    sp.raycast = () => {}
    sp.renderOrder = 10
    const pin = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffffff }))
    pin.visible = false; pin.raycast = () => {}
    g.add(mesh, sp, pin)
    n.__m = mesh; n.__s = sp; n.__pin = pin
    return g
  }

  apply3d() {
    const cam = this.G.camera()
    const H = this.G.renderer().domElement.clientHeight || 600
    const tan2 = 2 * Math.tan((cam.fov * Math.PI) / 360)
    const ref = this.refDist || cam.position.length() || 1
    const p = cam.position
    for (const n of this.store.values()) {
      const m = n.__m
      if (!m) continue
      let r = Math.max(0.01, n.r * 0.85)
      if (this.vis.seeds && this.vis.seeds.has(n.id)) {   // the searched node: never tiny when far, never a wall when near
        const dd = Math.max(1e-3, Math.hypot(p.x - (n.x || 0), p.y - (n.y || 0), p.z - (n.z || 0)))
        r = (clamp((r * H) / (dd * tan2), 10, 40) * dd * tan2) / H
      }
      m.scale.setScalar(r)
      const w = 0   // no white tint: the selection is the accent reticle
      const fcol = this.fc(n)
      m.material.color.setRGB((fcol[0] + (255 - fcol[0]) * w) / 255, (fcol[1] + (255 - fcol[1]) * w) / 255, (fcol[2] + (255 - fcol[2]) * w) / 255, this.L.THREE.SRGBColorSpace)   // the colors are sRGB, like the 2D canvas
      m.material.opacity = Math.min(1, n.a) * (0.3 + 0.7 * (n.fo ?? 1)) * (0.06 + 0.94 * (n.io ?? 1)) * recFade(n.rk)
      const bi = this.multiIdx ? this.multiIdx.get(n.id) : undefined
      if (bi !== undefined && !n.__badge && this.L.SpriteText) {
        const b = new this.L.SpriteText(String(bi + 1), 3, this.T.bg)
        b.backgroundColor = this.T.accent; b.padding = 1.5; b.borderRadius = 3; b.fontWeight = '700'
        b.material.depthTest = false; b.renderOrder = 12; b.raycast = () => {}
        m.parent.add(b); n.__badge = b
      }
      if (n.__badge) {
        n.__badge.visible = bi !== undefined
        if (bi !== undefined) {
          if (n.__badge.text !== String(bi + 1)) n.__badge.text = String(bi + 1)
          const dd = Math.hypot(p.x - (n.x || 0), p.y - (n.y || 0), p.z - (n.z || 0))
          const bh = clamp((dd * tan2 * 12) / H, 1, 30)
          if (!n.__badge.__h || Math.abs(bh - n.__badge.__h) > 0.03 * n.__badge.__h) { n.__badge.textHeight = bh; n.__badge.__h = bh }
          n.__badge.position.set(-r * 0.9, r * 0.9, 0)
        }
      }
      const pn = n.__pin
      if (pn) { pn.visible = !!n.pinned; if (n.pinned) { pn.scale.setScalar(Math.max(1.3, r * 0.3)); pn.position.set(r * 0.85, r * 0.85, 0); pn.material.color.set(this.T.accent) } }
      const mk = this.markerKind(n)
      if (mk && r > 0.05) this.marker3d(n, m.parent, mk, r, Math.hypot(p.x - (n.x || 0), p.y - (n.y || 0), p.z - (n.z || 0)), tan2, H)
      else if (n.__ret && n.__ret.sprite.visible) n.__ret.sprite.visible = false
      const s = n.__s
      if (n.la < 0.01 && !n.want) { s.material.opacity = 0; s.visible = false; continue }   // hidden labels cost nothing
      if (s.text !== n.label) s.text = n.label
      const d = Math.hypot(p.x - (n.x || 0), p.y - (n.y || 0), p.z - (n.z || 0))
      // constant size on screen, nudged a little bigger when near and smaller when far; far labels are also dimmer
      const px = LABEL_PX * clamp(Math.pow(ref / Math.max(d, 1), 0.18), 0.85, 1.2)
      const h = clamp((d * tan2 * px) / H, 1, 40)
      if (!s.__h || Math.abs(h - s.__h) > 0.03 * s.__h) { s.textHeight = h; s.__h = h }   // the setter rebuilds the sprite: only when it matters
      s.position.y = -(r + (s.__h || h) * 0.75)
      s.material.opacity = n.a * n.la * (0.55 + 0.45 * (n.near ?? 1))
      s.visible = s.material.opacity > 0.02
    }
  }
}
