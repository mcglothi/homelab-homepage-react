export function TopBarPill({ children, color = '#ffffff30', textColor = '#888', glow = false }) {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono',monospace", fontSize: 11,
      color: textColor, padding: '3px 10px',
      border: `1px solid ${color}`,
      borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 5,
      boxShadow: glow ? `0 0 8px ${textColor}40` : 'none',
      backdropFilter: 'blur(4px)',
      background: glow ? `${textColor}10` : 'transparent',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}
