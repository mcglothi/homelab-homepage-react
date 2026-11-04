import { createContext, useContext } from 'react'

// The console look, in one place. Every color is a CSS variable set on :root
// (defaults in index.html, theme overrides from the Appearance panel), so a theme
// or light mode restyles every view without a re-render.
export const MONO = "'JetBrains Mono',monospace"
export const SANS = "'Space Grotesk',sans-serif"

const v = name => `var(--${name})`
export const C = {
  // Text, brightest to faintest
  bright: v('bright'), text: v('text'), body: v('body'), muted: v('muted'), dim: v('dim'), faint: v('faint'),
  line: v('line'), line2: v('line2'),
  // Surfaces, darkest to lightest (dark themes): page < field < card < card hover
  bg: v('bg'), field: v('field'), panel: v('panel'), panel2: v('panel2'),
  green: v('green'), amber: v('amber'), orange: v('orange'), red: v('red'),
  violet: v('violet'), blue: v('blue'), cyan: v('cyan'),
  accent: v('accent'),
}

// A color at partial opacity. `a` is a two-digit hex alpha ('40') or 0..1.
// color-mix works on var() colors, where appending hex digits doesn't.
export function alpha(color, a) {
  const f = typeof a === 'string' ? parseInt(a, 16) / 255 : a
  return `color-mix(in srgb, ${color} ${+(f * 100).toFixed(1)}%, transparent)`
}

// A colored glow (box-shadow, text-shadow, drop-shadow) at partial opacity. Same as
// alpha(), but scaled by --glow-k so light themes and reduced motion can tone glows
// down without touching the color.
export function glow(color, a = 'ff') {
  const f = typeof a === 'string' ? parseInt(a, 16) / 255 : a
  return `color-mix(in srgb, ${color} calc(${+(f * 100).toFixed(1)}% * var(--glow-k, 1)), transparent)`
}

// Docket statuses → console colours (same meaning as Docket's own palette).
export const STATUS = {
  in_progress: { label: 'In progress', color: C.green, glyph: '▶' },
  waiting: { label: 'Waiting on', color: C.amber, glyph: '❚❚' },
  unknown: { label: 'Needs status', color: C.violet, glyph: '?' },
  planned: { label: 'Planned', color: C.blue, glyph: '○' },
  done: { label: 'Complete', color: C.dim, glyph: '✓' },
}
export const STATUS_ORDER = ['in_progress', 'waiting', 'unknown', 'planned', 'done']

// Alert levels from the Turing feeds → colours.
export const LEVEL = { crit: C.red, warn: C.amber, info: C.blue, ok: C.green }

// Density scales the main spacing (page padding, card padding, gaps) via sp()
export const DENSITY = { compact: 0.72, comfortable: 1, spacious: 1.3 }

export const ThemeContext = createContext({ accent: C.accent, cardRadius: 12, isMobile: false, sp: n => n })
export const useTheme = () => useContext(ThemeContext)
