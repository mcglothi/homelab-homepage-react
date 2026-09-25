export function StatusDot({ online = true }) {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: online ? '#39ff5a' : '#555',
      boxShadow: online ? '0 0 6px #39ff5a' : 'none',
      flexShrink: 0,
    }} />
  )
}
