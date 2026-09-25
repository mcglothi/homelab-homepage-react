export function ServiceIcon({ name, color, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: color + '22',
      border: `1px solid ${color}55`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, color, fontFamily: "'JetBrains Mono', monospace",
      fontWeight: 600, flexShrink: 0,
    }}>
      {name.charAt(0)}
    </div>
  )
}
