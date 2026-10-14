import { useCountUp } from '../../hooks/useCountUp'

export function AnimatedValue({ raw, color, size = 12 }) {
  // Animate plain numbers ("961", "1,204", "8/8", "2 / 52"); leave versions like "2.0.0-rc.17" alone
  const m = String(raw).match(/^(\d[\d,]*(?:\.\d+)?)(.*)$/)
  const match = m && !/^[.\w-]/.test(m[2]) ? m : null
  // The hook must run on every render: values flip between "—" and numbers as data arrives
  const counted = useCountUp(match ? parseFloat(match[1].replace(/,/g, '')) : NaN, 1000)
  const style = { fontFamily: "'JetBrains Mono',monospace", fontSize: size, color, fontWeight: 600 }
  if (!match) return <span style={style}>{raw}</span>
  const [, num, suffix] = match
  const display = num.includes(',') ? Number(counted).toLocaleString() : counted
  return <span style={style}>{display}{suffix}</span>
}
