import { useState } from 'react'
import { link } from '../../router'
import { C, alpha, glow } from '../../ui/theme'

// Docket's mark: the three-row glyph from the original Docket (a status block and a
// bar per row — in progress, waiting, needs status) with the wordmark beside it.
// The bars grow in on load and "re-sort" on hover; the wordmark carries a slow accent
// shimmer. Keyframes live here so the component is self-contained.
const ROWS = [
  { color: C.green, w: 12.6 },
  { color: C.amber, w: 9.4 },
  { color: C.violet, w: 6.2 },
]

const KEYFRAMES = `
@keyframes dk-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes dk-shimmer { 0%, 70% { background-position: 160% 0 } 100% { background-position: -60% 0 } }
@keyframes dk-breathe { 0%, 100% { opacity: .85 } 50% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .dk-anim { animation: none !important } }`

export function DocketMark({ accent, compact }) {
  const [hover, setHover] = useState(false)
  return (
    <a href="/" onClick={link('/')} title="Docket — home"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
      <style>{KEYFRAMES}</style>
      <svg viewBox="0 0 24 24" width={compact ? 22 : 26} height={compact ? 22 : 26} aria-hidden="true"
        style={{ filter: `drop-shadow(0 0 6px ${glow(accent, '55')})`, overflow: 'visible' }}>
        {ROWS.map((r, i) => {
          const y = 4.2 + i * 5.85
          // On hover the bars briefly swap lengths, like a list being re-ranked.
          const w = hover ? ROWS[(i + 1) % 3].w : r.w
          return (
            <g key={i}>
              <rect x="2.6" y={y} width="4.4" height="3.9" rx="1.5" 
                style={{ fill: r.color, filter: `drop-shadow(0 0 3px ${glow(r.color)})` }}
                className="dk-anim" />
              <rect x="8.8" y={y} height="3.9" rx="1.5" opacity=".5" className="dk-anim"
                // width as CSS (not the attribute) so the hover re-rank can transition.
                // Colors as CSS too: var() doesn't work in SVG presentation attributes.
                style={{ fill: C.bright, width: w, transformBox: 'fill-box', transformOrigin: 'left center',
                         transition: 'width .35s cubic-bezier(.2,.8,.2,1)',
                         animation: `dk-grow .7s ${0.12 * i}s cubic-bezier(.2,.8,.2,1) both` }} />
            </g>
          )
        })}
      </svg>
      <span className="dk-anim" style={{
        fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: compact ? 17 : 20,
        letterSpacing: '-0.02em', lineHeight: 1,
        backgroundImage: `linear-gradient(100deg, ${C.bright} 0%, ${C.bright} 40%, ${accent} 50%, ${C.bright} 60%, ${C.bright} 100%)`,
        backgroundSize: '250% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        animation: 'dk-shimmer 7s ease-in-out infinite',
        textShadow: `0 0 18px ${glow(accent, '33')}`,
      }}>docket</span>
      {!compact && (
        <span className="dk-anim" style={{
          fontFamily: "'JetBrains Mono',monospace", fontSize: 9, fontWeight: 600, letterSpacing: 1.5,
          color: accent, border: `1px solid ${alpha(accent, '66')}`, background: `${alpha(accent, '14')}`,
          padding: '1px 5px', borderRadius: 4, alignSelf: 'flex-start', marginTop: -2,
          boxShadow: `0 0 10px ${glow(accent, '33')}`, animation: 'dk-breathe 3.2s ease-in-out infinite',
        }}>home</span>
      )}
    </a>
  )
}
