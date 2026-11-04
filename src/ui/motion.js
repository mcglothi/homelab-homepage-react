// Shared show/hide timings, so every Docket panel that opens on hover feels the same. These are the values the
// result rows in the search results already use (hover dwell and the expand/collapse animation); the grace delay is
// how long a panel waits after the pointer leaves before it hides, so moving between its rail icon and itself never flickers.
export const HOVER_INTENT_MS = 400    // the pointer rests this long before something opens
export const HOVER_GRACE_MS = 600     // after the pointer leaves, hide only if it has not come back
export const ANIM_MS = 280            // expand / collapse
export const EASE = 'cubic-bezier(.2,.8,.2,1)'
export const REDUCED_MS = 90          // reduced motion: a short fade, no travel
export const reducedMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced'
// transition values for opacity/transform animations (never layout properties)
export const motion = () => (reducedMotion() ? { ms: REDUCED_MS, travel: 0 } : { ms: ANIM_MS, travel: 14 })

// How panels that hover open move. Calm is the default: a long, soft ease-out in, a gentler ease-in-out out, a larger
// travel, and the fade starts a beat after the slide so it follows it. Reduced motion is a short fade with no travel.
export const PANEL_MOTION = {
  calm: { inMs: 440, outMs: 360, travel: 36, easeIn: 'cubic-bezier(.22,.9,.28,1)', easeOut: 'cubic-bezier(.45,0,.25,1)', fadeDelay: 70 },
  normal: { inMs: ANIM_MS, outMs: ANIM_MS, travel: 14, easeIn: EASE, easeOut: EASE, fadeDelay: 0 },
  snappy: { inMs: 180, outMs: 160, travel: 10, easeIn: EASE, easeOut: EASE, fadeDelay: 0 },
}
export const panelMotion = mode => (reducedMotion() ? { inMs: REDUCED_MS, outMs: REDUCED_MS, travel: 0, easeIn: 'ease', easeOut: 'ease', fadeDelay: 0 } : PANEL_MOTION[mode] || PANEL_MOTION.calm)
