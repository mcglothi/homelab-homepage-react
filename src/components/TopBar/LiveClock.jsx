import { useState, useEffect } from 'react'

export function useClock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const raw = t.getHours()
  const isPM = raw >= 12
  const h12 = raw % 12 || 12
  const hh = String(h12)
  const mm = String(t.getMinutes()).padStart(2, '0')
  const ss = String(t.getSeconds()).padStart(2, '0')
  const ampm = isPM ? 'PM' : 'AM'
  const dateStr = t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return { hh, mm, ss, ampm, dateStr }
}
