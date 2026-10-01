import { test, expect } from 'claude-code/testing'

import type { DayEntry, ModelRow } from './cards'
import { PERIODS, aggregate, buttonLabel, cardTitle, earliestPeriod, isPeriod, nextPeriod, rangeFor, rangeText } from './periods'

const DAY = 86400e3
const THURSDAY = Date.UTC(2026, 9, 1, 12, 0) // Thursday 1 October 2026, 12:00 UTC

const row = (modelName: string, cost: number, input = 0, output = 0, cacheCreation = 0, cacheRead = 0): ModelRow => ({
  modelName,
  cost,
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: cacheCreation,
  cacheReadTokens: cacheRead,
})
const entry = (period: string, totalCost: number, rows: ModelRow[] = []): DayEntry => ({ period, totalCost, modelBreakdowns: rows })

const days: DayEntry[] = [
  entry('2026-09-27', 5, [row('claude-opus-5-5', 5, 1000)]),
  entry('2026-09-28', 10, [row('claude-opus-5-5', 8, 2000), row('claude-sonnet-5-5', 2, 500)]),
  entry('2026-09-30', 20, [row('claude-opus-5-5', 20, 4000)]),
  entry('2026-10-01', 40, [row('claude-opus-5-5', 30, 8000), row('claude-sonnet-5-5', 10, 1000)]),
]

test('there are four periods, in the order the button steps through them', () => {
  expect(PERIODS).toEqual(['today', 'week', 'month', 'all'])
})

test('isPeriod accepts the four periods and nothing else', () => {
  for (const p of PERIODS) expect(isPeriod(p)).toBe(true)
  for (const bad of ['', 'Today', 'weeks', 'year', null, undefined, 3, {}, ['today']]) expect(isPeriod(bad)).toBe(false)
})

test('nextPeriod steps today, week, month, all and then round to today again', () => {
  expect(nextPeriod('today')).toBe('week')
  expect(nextPeriod('week')).toBe('month')
  expect(nextPeriod('month')).toBe('all')
  expect(nextPeriod('all')).toBe('today')
})

test('the button is labelled with the period being shown', () => {
  expect(buttonLabel('today')).toBe('Today')
  expect(buttonLabel('week')).toBe('Week')
  expect(buttonLabel('month')).toBe('Month')
  expect(buttonLabel('all')).toBe('All time')
})

test('the first LED card is named for the period', () => {
  expect(cardTitle('today')).toBe('today')
  expect(cardTitle('week')).toBe('this week')
  expect(cardTitle('month')).toBe('this month')
  expect(cardTitle('all')).toBe('all time')
})

test('aggregate adds up the days from the first to the last, both included', () => {
  expect(aggregate(days, '2026-09-28', '2026-10-01').totalCost).toBe(70)
  expect(aggregate(days, '2026-09-28', '2026-09-30').totalCost).toBe(30)
})

test('aggregate with no first day takes everything up to the last', () => {
  expect(aggregate(days, null, '2026-10-01').totalCost).toBe(75)
  expect(aggregate(days, null, '2026-09-30').totalCost).toBe(35)
})

test('aggregate of one day is that day alone', () => {
  const day = aggregate(days, '2026-10-01', '2026-10-01')
  expect(day.totalCost).toBe(40)
  expect(day.modelBreakdowns).toEqual([row('claude-opus-5-5', 30, 8000), row('claude-sonnet-5-5', 10, 1000)])
})

test('aggregate leaves out days after the last, such as one dated tomorrow', () => {
  expect(aggregate([...days, entry('2026-10-02', 99)], null, '2026-10-01').totalCost).toBe(75)
})

test('aggregate adds a model up across days, its cost and each of its four token counts', () => {
  const two = [entry('2026-09-30', 4, [row('claude-opus-5-5', 1.5, 1, 2, 3, 4)]), entry('2026-10-01', 6, [row('claude-opus-5-5', 2.5, 10, 20, 30, 40)])]
  expect(aggregate(two, null, '2026-10-01').modelBreakdowns).toEqual([row('claude-opus-5-5', 4, 11, 22, 33, 44)])
})

test('aggregate keeps different models apart', () => {
  const names = aggregate(days, '2026-09-28', '2026-10-01').modelBreakdowns?.map(m => m.modelName).sort()
  expect(names).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
})

test('aggregate of no days, or of days out of range, is a stretch with no spend', () => {
  expect(aggregate([], null, '2026-10-01')).toEqual({ totalCost: 0, modelBreakdowns: [] })
  expect(aggregate(days, '2027-01-01', '2027-02-01')).toEqual({ totalCost: 0, modelBreakdowns: [] })
})

test('aggregate leaves the days it reads as they were', () => {
  const before = JSON.stringify(days)
  aggregate(days, null, '2026-10-01')
  aggregate(days, null, '2026-10-01')
  expect(JSON.stringify(days)).toBe(before)
})

test('aggregate counts a day with no total as the sum of its models', () => {
  const noTotal: DayEntry = { period: '2026-10-01', modelBreakdowns: [row('claude-opus-5-5', 1.5), row('claude-sonnet-5-5', 0.25)] }
  expect(aggregate([noTotal], '2026-10-01', '2026-10-01').totalCost).toBe(1.75)
})

test('aggregate counts a figure it cannot use as zero, so one bad entry cannot spoil the total', () => {
  const bad = { period: '2026-10-01', totalCost: null, modelBreakdowns: [{ modelName: 'claude-opus-5-5', cost: 'x', inputTokens: null }] } as unknown as DayEntry
  const day = aggregate([bad, entry('2026-10-01', 4, [row('claude-opus-5-5', 4, 10)])], '2026-10-01', '2026-10-01')
  expect(day.totalCost).toBe(4)
  expect(day.modelBreakdowns).toEqual([row('claude-opus-5-5', 4, 10)])
})

test('today is the one local day', () => {
  expect(rangeFor('today', THURSDAY, 0, null)).toEqual({ since: '2026-10-01', until: '2026-10-01' })
})

test('this week runs from the day the weekly limit window began, up to today', () => {
  const resets = Date.UTC(2026, 9, 5, 2, 0) // Monday 5 October, 02:00 UTC
  expect(rangeFor('week', THURSDAY, 0, resets)).toEqual({ since: '2026-09-28', until: '2026-10-01' })
})

test('this week with no reset time runs from the most recent Monday', () => {
  expect(rangeFor('week', THURSDAY, 0, null)).toEqual({ since: '2026-09-28', until: '2026-10-01' })
})

test('a week start that would fall after today is held to today', () => {
  const farOff = THURSDAY + 10 * DAY // a reset more than a week away puts the week start in the future
  expect(rangeFor('week', THURSDAY, 0, farOff)).toEqual({ since: '2026-10-01', until: '2026-10-01' })
})

test('this month runs from the first of the local month, up to today', () => {
  expect(rangeFor('month', THURSDAY, 0, null)).toEqual({ since: '2026-10-01', until: '2026-10-01' })
  expect(rangeFor('month', Date.UTC(2026, 9, 20, 12), 0, null)).toEqual({ since: '2026-10-01', until: '2026-10-20' })
})

test('all time has no first day and runs up to today', () => {
  expect(rangeFor('all', THURSDAY, 0, null)).toEqual({ since: null, until: '2026-10-01' })
})

test('every range counts local days: late in the evening UTC it is already tomorrow at UTC+2', () => {
  const lateEvening = Date.UTC(2026, 9, 1, 22, 30)
  expect(rangeFor('today', lateEvening, 120, null)).toEqual({ since: '2026-10-02', until: '2026-10-02' })
  expect(rangeFor('month', lateEvening, 120, null)).toEqual({ since: '2026-10-01', until: '2026-10-02' })
})

test('the range of a period picks the days that period shows', () => {
  const total = (p: 'today' | 'week' | 'month' | 'all') => {
    const { since, until } = rangeFor(p, THURSDAY, 0, null)
    return aggregate(days, since, until).totalCost
  }
  expect(total('today')).toBe(40)
  expect(total('week')).toBe(70) // Monday 28 September onward: the 27th is the week before
  expect(total('month')).toBe(40) // 1 October only: a week that began in September holds more than the month so far
  expect(total('all')).toBe(75)
})

test('the caption of today is its month and day', () => {
  expect(rangeText('today', '2026-10-01')).toBe('Oct 1')
  expect(rangeText('today', '2026-12-25')).toBe('Dec 25')
})

test('the caption of this week and this month says since when', () => {
  expect(rangeText('week', '2026-09-28')).toBe('since Sep 28')
  expect(rangeText('month', '2026-10-01')).toBe('since Oct 1')
})

test('the caption of all time says since which month and year the data begins', () => {
  expect(rangeText('all', null, '2025-10-01')).toBe('since Oct 2025')
  expect(rangeText('all', null, '2026-01-31')).toBe('since Jan 2026')
})

test('the caption of all time with no data to say when it began is plain all time', () => {
  expect(rangeText('all', null)).toBe('all time')
  expect(rangeText('all', null, undefined)).toBe('all time')
})

test('a date that cannot be read leaves the caption as the name of the period', () => {
  expect(rangeText('today', null)).toBe('today')
  expect(rangeText('week', 'soon')).toBe('this week')
  expect(rangeText('month', '2026-13-01')).toBe('this month')
  expect(rangeText('all', null, 'recently')).toBe('all time')
})

test('every month has its English abbreviation', () => {
  const abbreviations = Array.from({ length: 12 }, (_, i) => rangeText('today', `2026-${String(i + 1).padStart(2, '0')}-09`))
  expect(abbreviations).toEqual(['Jan 9', 'Feb 9', 'Mar 9', 'Apr 9', 'May 9', 'Jun 9', 'Jul 9', 'Aug 9', 'Sep 9', 'Oct 9', 'Nov 9', 'Dec 9'])
})

test('a caption is never more than 14 characters, whatever the date', () => {
  for (let month = 1; month <= 12; month++) {
    for (const day of [1, 9, 10, 28, 31]) {
      const iso = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      for (const p of PERIODS) expect(rangeText(p, p === 'all' ? null : iso, iso).length).toBeLessThanOrEqual(14)
    }
  }
})

test('earliestPeriod is the first day in the data, whatever order the days come in', () => {
  expect(earliestPeriod(days)).toBe('2026-09-27')
  expect(earliestPeriod([...days].reverse())).toBe('2026-09-27')
})

test('earliestPeriod of no days is undefined', () => {
  expect(earliestPeriod([])).toBeUndefined()
})
