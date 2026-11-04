// The canvas backdrop: a quiet "holo-table" behind the data. One 2D canvas under the graph canvas (both modes), drawn
// from a few pre-rendered layers so a frame costs a handful of blits:
//   lattice   a faint hex-dot grid that drifts slower than the graph when you pan (parallax), pre-rendered to a pattern
//   vignette  edge darkening (light theme: edge paper tone), pre-rendered
//   dust      about 40 slow motes
//   scan      one thin sweep that crosses every ~16 s (Full only)
//   range     concentric range rings and a turning tick scale around the first search node (Full only)
//   frame     corner brackets and a one-line readout at low contrast
// Everything is accent-colored and low alpha, so nodes, links and labels always win. Reduced motion draws it once
// (no drift, no dust, no scan, no spin) and again only when something it shows changes.
// Design notes (Hansen on the Avengers HUDs): restraint, negative space, every graphic has a purpose, read as patterns.

const TAU = Math.PI * 2
const MONO = "ui-monospace, 'JetBrains Mono', Menlo, monospace"

// accent color with its saturation turned down toward grey (sat 0..1)
function satRgba(hex, sat, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return `rgba(150,170,200,${a})`
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255, y = 0.3 * r + 0.59 * g + 0.11 * bl
  return `rgba(${(y + (r - y) * sat) | 0},${(y + (g - y) * sat) | 0},${(y + (bl - y) * sat) | 0},${a})`
}

function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return `rgba(150,170,200,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

export class Backdrop {
  constructor(el) {
    this.el = el
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '-1', pointerEvents: 'none' })
    el.style.isolation = 'isolate'
    el.insertBefore(this.canvas, el.firstChild)
    this.ctx = this.canvas.getContext('2d')
    this.w = 0; this.h = 0
    this.dust = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, ph: Math.random() * TAU }))
    this.key = ''
    this.drawn = ''
  }

  resize(w, h) {
    if (!w || !h || (w === this.w && h === this.h)) return
    this.w = w; this.h = h
    this.canvas.width = w; this.canvas.height = h
    this.key = ''
  }

  destroy() { this.canvas.remove() }

  // pre-rendered layers, rebuilt when the size, theme or mode changes
  layers(T, level) {
    const key = [this.w, this.h, T.accent, T.light ? 1 : 0, level].join('|')
    if (key === this.key) return
    this.key = key
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
    // hex-dot lattice tile (repeats)
    const s = 34
    const tile = mk(s * 2, Math.round(s * 1.732))
    const tc = tile.getContext('2d')
    tc.fillStyle = rgba(T.accent, T.light ? 0.38 : 0.34)
    for (const [x, y] of [[0, 0], [s, 0], [s * 2, 0], [s / 2, tile.height / 2], [s * 1.5, tile.height / 2], [0, tile.height], [s, tile.height], [s * 2, tile.height]]) { tc.beginPath(); tc.arc(x, y, 1.3, 0, TAU); tc.fill() }
    this.pattern = this.ctx.createPattern(tile, 'repeat')
    this.tile = [tile.width, tile.height]
    // vignette
    const v = mk(this.w, this.h)
    const vc = v.getContext('2d')
    const g = vc.createRadialGradient(this.w / 2, this.h * 0.45, Math.min(this.w, this.h) * 0.25, this.w / 2, this.h * 0.5, Math.hypot(this.w, this.h) * 0.62)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, T.light ? rgba(T.accent, 0.05) : 'rgba(0,0,0,0.5)')
    vc.fillStyle = g; vc.fillRect(0, 0, this.w, this.h)
    this.vig = v
    // corner brackets
    const f = mk(this.w, this.h)
    const fc = f.getContext('2d')
    fc.strokeStyle = rgba(T.accent, T.light ? 0.4 : 0.4); fc.lineWidth = 1.2
    const L = 22, m = 8
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [this.w - m, m, -1, 1], [m, this.h - m, 1, -1], [this.w - m, this.h - m, -1, -1]]) {
      fc.beginPath(); fc.moveTo(x, y + dy * L); fc.lineTo(x, y); fc.lineTo(x + dx * L, y); fc.stroke()
    }
    this.frameLayer = f
  }

  // eng: the engine (view, nodes, theme); called once per frame
  frame(eng) {
    const level = eng.vis.backdrop || 'subtle'
    const ctx = this.ctx
    if (level === 'off') { if (this.drawn !== 'off') { ctx.clearRect(0, 0, this.w, this.h); this.drawn = 'off' } return }
    const T = eng.T
    const still = eng.still
    const full = level === 'full'
    this.layers(T, level)
    const t = eng.now || performance.now()
    // a static backdrop is drawn again only when what it shows has changed
    const view = eng.viewKey ? eng.viewKey() : ''
    const stamp = [this.key, view, eng.store.size, eng.bdKey || '', Math.floor(t / 1000)].join('|')
    if (still && stamp.slice(0, stamp.lastIndexOf('|')) === this.drawn) return
    this.drawn = still ? stamp.slice(0, stamp.lastIndexOf('|')) : 'live'
    ctx.clearRect(0, 0, this.w, this.h)
    const bv = eng.bdCur || { starOp: 0.25, starSat: 0.3, starDen: 0.35, intensity: 0.45 }
    const gk = (T.light ? 0.7 : 1) * (bv.intensity / 0.5)       // grid, rings, scan, marks: the intensity slider
    const zf = eng.backdropZoom ? eng.backdropZoom() : 1       // fewer, dimmer motes when zoomed out
    // lattice with parallax: the pan moves it at a fraction of the graph's pace
    const [ox, oy] = still ? [0, 0] : eng.parallax ? eng.parallax() : [0, 0]
    ctx.save()
    ctx.globalAlpha = (full ? 0.85 : 0.5) * gk
    ctx.translate(ox % this.tile[0], oy % this.tile[1])
    ctx.fillStyle = this.pattern
    ctx.fillRect(-this.tile[0], -this.tile[1], this.w + this.tile[0] * 2, this.h + this.tile[1] * 2)
    ctx.restore()
    ctx.drawImage(this.vig, 0, 0)
    // dust
    ctx.fillStyle = satRgba(T.accent, bv.starSat, 1)
    const dn = Math.ceil(this.dust.length * bv.starDen * (0.25 + 0.75 * zf))
    for (let di = 0; di < dn; di++) {
      const d = this.dust[di]
      const s = still ? 0 : t / 1000
      const x = ((d.x + Math.sin(s * 0.03 * d.z + d.ph) * 0.02 + s * 0.002 * d.z) % 1 + 1) % 1 * this.w
      const y = ((d.y - s * 0.004 * d.z) % 1 + 1) % 1 * this.h
      ctx.globalAlpha = (0.12 + 0.12 * Math.sin(s * 0.6 + d.ph)) * d.z * (bv.starOp / 0.25) * zf
      ctx.beginPath(); ctx.arc(x, y, (0.8 + d.z * 0.9) * (0.7 + 0.6 * bv.starDen), 0, TAU); ctx.fill()
    }
    ctx.globalAlpha = 1
    // range rings and scale around the first search node
    if (full) {
      const seed = eng.seedScreen && eng.seedScreen()
      if (seed) {
        ctx.save(); ctx.translate(seed[0], seed[1])
        ctx.strokeStyle = rgba(T.accent, 0.5); ctx.lineWidth = 1
        const spin = still ? 0 : t / 1000
        ctx.setLineDash([2, 7])
        for (const r of [90, 170, 260]) { ctx.globalAlpha = 0.5 * gk; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke() }
        ctx.setLineDash([])
        ctx.globalAlpha = 0.55 * gk
        ctx.beginPath()
        for (let i = 0; i < 72; i++) {
          const a = spin * 0.04 + (i * TAU) / 72, len = i % 6 === 0 ? 9 : 4
          ctx.moveTo(Math.cos(a) * 260, Math.sin(a) * 260); ctx.lineTo(Math.cos(a) * (260 + len), Math.sin(a) * (260 + len))
        }
        ctx.stroke()
        ctx.globalAlpha = 0.22 * gk; ctx.beginPath()
        ctx.moveTo(-270, 0); ctx.lineTo(-14, 0); ctx.moveTo(14, 0); ctx.lineTo(270, 0); ctx.moveTo(0, -270); ctx.lineTo(0, -14); ctx.moveTo(0, 14); ctx.lineTo(0, 270); ctx.stroke()
        ctx.restore()
      }
      // scan line: crosses every 16 s
      if (!still) {
        const p = ((t / 1000) % 16) / 16
        if (p < 0.45) {
          const y = (p / 0.45) * (this.h + 80) - 40
          const g = ctx.createLinearGradient(0, y - 40, 0, y)
          g.addColorStop(0, rgba(T.accent, 0)); g.addColorStop(1, rgba(T.accent, (T.light ? 0.06 : 0.08)))
          ctx.fillStyle = g; ctx.fillRect(0, y - 40, this.w, 40)
        }
      }
    }
    ctx.globalAlpha = (full ? 1 : 0.8) * gk
    ctx.drawImage(this.frameLayer, 0, 0)
    ctx.globalAlpha = 1
    // readout: coordinates, scale, nodes, clock
    const top = (eng.vis.backdropTop ?? 8) + 12
    const c = eng.viewCenter ? eng.viewCenter() : null
    const d = new Date()
    const txt = `${c ? `X ${c[0].toFixed(0)}  Y ${c[1].toFixed(0)}  ·  ` : ''}SCALE ${eng.scaleNow().toFixed(2)}  ·  ${eng.store.size} NODES  ·  ${d.toTimeString().slice(0, 8)}`
    ctx.font = `10px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = rgba(T.accent, 1); ctx.globalAlpha = (T.light ? 0.5 : 0.42)
    ctx.fillText(txt, this.w / 2, top)
    ctx.globalAlpha = 1
  }
}
