import { useState, useEffect } from 'react'

export function useCountUp(target, duration = 1200) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const num = parseFloat(target)
    if (isNaN(num)) { setVal(target); return }
    const tick = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = eased * num
      if (typeof target === 'string' && target.includes('.')) {
        setVal(current.toFixed(1))
      } else {
        setVal(Math.round(current))
      }
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])
  return val
}
