import test from 'node:test'
import assert from 'node:assert/strict'
import { dateKey, dateFromKey, weekKeys, toggleDate } from '../src/components/Sidebar/calendarDates.js'
import { fetchCalendarEvents } from '../src/api/index.js'

test('Sunday-to-Saturday week spans month and year boundaries', () => {
  assert.deepEqual(weekKeys(new Date(2027, 0, 1)), [
    '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
  ])
  assert.equal(dateKey(dateFromKey('2027-01-01')), '2027-01-01')
})

test('date selection adds chronologically, toggles off, and crosses months', () => {
  let selected = toggleDate([], '2026-11-01')
  selected = toggleDate(selected, '2026-10-31')
  assert.deepEqual(selected, ['2026-10-31', '2026-11-01'])
  selected = toggleDate(selected, '2026-11-01')
  assert.deepEqual(selected, ['2026-10-31'])
  assert.deepEqual(toggleDate(selected, '2026-10-31'), [])
})

test('API keeps dates across months, handles local air times and date-only releases', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async path => ({ ok: true, json: async () => path.includes('sonarr') ? [
    { airDateUtc: '2026-11-01T01:00:00Z', series: { title: 'Midnight show' }, seasonNumber: 2, episodeNumber: 3 },
    { airDateUtc: 'invalid' },
  ] : [{ physicalRelease: '2026-11-01', title: 'November movie' }] })
  try {
    const events = await fetchCalendarEvents()
    const localKey = dateKey(new Date('2026-11-01T01:00:00Z'))
    assert.ok(events[localKey].some(event => event.label === 'Midnight show S02E03'))
    assert.ok(events['2026-11-01'].some(event => event.label === 'November movie' && event.type === 'movie'))
    assert.equal(Object.values(events).flat().length, 2)
  } finally { globalThis.fetch = original }
})

test('empty successful calendars differ from unavailable calendars', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] })
    assert.deepEqual(await fetchCalendarEvents(), {})
    globalThis.fetch = async () => ({ ok: false })
    assert.equal(await fetchCalendarEvents(), null)
  } finally { globalThis.fetch = original }
})
