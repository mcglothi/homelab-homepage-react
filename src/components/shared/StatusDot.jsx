// online: true = up, false = unreachable, null = not probed
export function StatusDot({ online = null, title }) {
  const color = online === true ? '#39ff5a' : online === false ? '#ff4d4f' : '#555'
  return (
    <span title={title} style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: color,
      boxShadow: online != null ? `0 0 6px ${color}` : 'none',
      flexShrink: 0,
    }} />
  )
}
