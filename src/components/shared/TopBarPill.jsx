import { C, alpha, glow } from '../../ui/theme'
export function TopBarPill({ children, color = alpha(C.text, '30'), textColor = C.muted, glow: glowing = false }) {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono',monospace", fontSize: 11,
      color: textColor, padding: '3px 10px',
      border: `1px solid ${color}`,
      borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 5,
      boxShadow: glowing ? `0 0 8px ${glow(textColor, '40')}` : 'none',
      backdropFilter: 'blur(4px)',
      background: glowing ? `${alpha(textColor, '10')}` : 'transparent',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}
