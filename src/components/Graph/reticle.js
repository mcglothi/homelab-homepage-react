// The HUD reticle drawn around the node a search is about. One drawing routine serves both engines: 2D draws it on the
// graph canvas, 3D draws it onto a small canvas that becomes a camera-facing sprite. Pure canvas strokes, no state.
//
//   seed   double ring in segments that turn against each other, a tick ring, a radar sweep, a soft pulsing halo and
//          a ripple every few seconds. When it first shows it starts large and locks onto the node in about half a second.
//   sel    one calm turning arc on a faint ring (the selected node)
//   hover  just a soft glow
// With reduced motion everything is the same shape, still: no spin, no pulse, no ripple, no lock-on.

const TAU = Math.PI * 2
const easeOut = x => 1 - Math.pow(1 - x, 3)
const LOCK_MS = 520
const RIPPLE_S = 3.8

export const reducedMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced'

// ctx is translated to the node centre. R0 is the radius to wrap (node radius plus a margin), lw a line width in the
// current units, t the clock in ms, born the time the marker first showed (or null), lock how far out the lock-on starts.
export function drawReticle(ctx, kind, R0, o) {
  const { color, lw, t, born = null, lock = 2.4, still = false } = o
  let a = o.a ?? 1
  let R = R0
  if (!still && born != null && (kind === 'seed' || kind === 'focus')) {
    const p = Math.min(1, (t - born) / LOCK_MS)
    if (p < 1) { R = R0 * (1 + (1 - easeOut(p)) * lock); a *= 0.3 + 0.7 * p }
  }
  const s = still ? 0 : t / 1000
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  if (kind === 'hover') {
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = a * 0.22 / (i + 1); ctx.lineWidth = lw * (2.6 + i * 2.2); ctx.beginPath(); ctx.arc(0, 0, R0 + i * lw * 1.6, 0, TAU); ctx.stroke() }
    ctx.restore()
    return
  }
  if (kind === 'sel') {
    ctx.globalAlpha = a * 0.28; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke()
    ctx.globalAlpha = a * 0.9; ctx.lineWidth = lw * 1.5
    const a0 = s * 0.9
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + 1.6); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, R, a0 + Math.PI, a0 + Math.PI + 0.55); ctx.stroke()
    ctx.restore()
    return
  }
  // halo: soft rings, pulsing
  const pulse = still ? 0.7 : 0.55 + 0.45 * Math.sin(s * TAU / 2.2)
  for (let i = 0; i < 4; i++) { ctx.globalAlpha = a * pulse * 0.34 / (i + 1); ctx.lineWidth = lw * (3.4 + i * 2.8); ctx.beginPath(); ctx.arc(0, 0, R * 0.98 + i * lw * 1.4, 0, TAU); ctx.stroke() }
  // outer ring: three long arcs with gaps, slowly turning
  ctx.globalAlpha = a; ctx.lineWidth = lw * 1.8
  for (let i = 0; i < 3; i++) { const a0 = s * 0.3 + (i * TAU) / 3 + 0.12; ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + TAU / 3 - 0.5); ctx.stroke() }
  // inner ring: fine ticks, turning the other way
  const Ri = R * 0.8
  ctx.globalAlpha = a * 0.85; ctx.lineWidth = lw * 1.1
  const n = 32
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const ang = -s * 0.45 + (i * TAU) / n
    const len = i % 8 === 0 ? lw * 4.2 : lw * 2.2
    ctx.moveTo(Math.cos(ang) * Ri, Math.sin(ang) * Ri); ctx.lineTo(Math.cos(ang) * (Ri + len), Math.sin(ang) * (Ri + len))
  }
  ctx.stroke()
  // radar sweep: a short bright arc with a fading tail
  const Rs = R * 1.16
  const head = s * 1.1
  ctx.lineWidth = lw * 2
  for (let i = 0; i < 6; i++) { ctx.globalAlpha = a * (1 - i * 0.15); ctx.beginPath(); ctx.arc(0, 0, Rs, head - (i + 1) * 0.1, head - i * 0.1); ctx.stroke() }
  // ripple
  if (!still) {
    const ph = (s % RIPPLE_S) / RIPPLE_S
    ctx.globalAlpha = a * Math.pow(1 - ph, 2) * 0.55; ctx.lineWidth = lw
    ctx.beginPath(); ctx.arc(0, 0, R * (1.1 + ph * 0.55), 0, TAU); ctx.stroke()
  }
  ctx.restore()
}
