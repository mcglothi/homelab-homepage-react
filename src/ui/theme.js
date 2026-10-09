import { createContext, useContext } from 'react'

// The console look, in one place (ported from work Docket). Views read accent/radius
// from context so the Appearance panel (⚙ on Home) restyles every tab, not just the
// service grid.
export const MONO = "'JetBrains Mono',monospace"
export const SANS = "'Space Grotesk',sans-serif"

export const C = {
  text: '#e8e8e8', body: '#c8c8c8', muted: '#8a8a8a', dim: '#555', faint: '#333',
  line: '#ffffff17', line2: '#ffffff28',
  // Surfaces, darkest to lightest: page < field < card < card hover.
  field: '#0b0b0e', panel: '#111115', panel2: '#17171c',
  green: '#39ff5a', amber: '#ffab00', red: '#ff4d4f', violet: '#bf5fff', blue: '#2979ff', cyan: '#00fff7',
}

// Alert levels from the Turing feeds → colours.
export const LEVEL = { crit: C.red, warn: C.amber, info: C.blue, ok: C.green }

export const ThemeContext = createContext({ accent: '#ff2d6b', cardRadius: 12, isMobile: false })
export const useTheme = () => useContext(ThemeContext)
