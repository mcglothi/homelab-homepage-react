// Calendar keys use local dates; UTC timestamps are converted before grouping.
export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function weekKeys(today) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
  return Array.from({ length: 7 }, (_, i) => dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)))
}

export function toggleDate(selected, key) {
  return selected.includes(key) ? selected.filter(day => day !== key) : [...selected, key].sort()
}
