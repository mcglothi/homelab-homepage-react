import { useCountUp } from '../../hooks/useCountUp'

export function AnimatedValue({ raw, color, size = 12 }) {
  const match = String(raw).match(/^([\d.,]+)(.*)$/)
  if (!match) {
    return (
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: size, color, fontWeight: 600 }}>
        {raw}
      </span>
    )
  }
  const num = match[1]
  const suffix = match[2]
  const counted = useCountUp(parseFloat(num.replace(',', '')), 1000)
  const display = num.includes(',') ? Number(counted).toLocaleString() : counted
  return (
    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: size, color, fontWeight: 600 }}>
      {display}{suffix}
    </span>
  )
}
