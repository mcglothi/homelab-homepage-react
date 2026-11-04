import { C, glow } from '../../ui/theme'
// online: true = up, false = unreachable, null = not probed
export function StatusDot({ online = null, title }) {
  const color = online === true ? C.green : online === false ? C.red : C.dim
  return (
    <span title={title} style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: color,
      boxShadow: online != null ? `0 0 6px ${glow(color)}` : 'none',
      flexShrink: 0,
    }} />
  )
}
