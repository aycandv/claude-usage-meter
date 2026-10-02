import { test, expect } from 'claude-code/testing'

import { isoDate, monthStartIso, parseUtcOffset, weekStartIso } from './zone'

test('parseUtcOffset reads the +HHMM that `date +%z` prints, in minutes east of UTC', () => {
  expect(parseUtcOffset('+0200')).toBe(120)
  expect(parseUtcOffset('-0530')).toBe(-330)
  expect(parseUtcOffset('+0000')).toBe(0)
  expect(parseUtcOffset('+1345')).toBe(825)
})

test('parseUtcOffset ignores surrounding whitespace, such as the trailing newline', () => {
  expect(parseUtcOffset('+0100\n')).toBe(60)
  expect(parseUtcOffset('  -0800 ')).toBe(-480)
})

test('parseUtcOffset gives null for anything that is not a plausible offset', () => {
  expect(parseUtcOffset('')).toBeNull()
  expect(parseUtcOffset('CEST')).toBeNull()
  expect(parseUtcOffset('+02')).toBeNull()
  expect(parseUtcOffset('+2500')).toBeNull()
  expect(parseUtcOffset('+0260')).toBeNull()
})

const DAY = 86400e3
const THURSDAY = Date.UTC(2026, 9, 1, 12, 0) // Thursday 1 October 2026, 12:00 UTC

test('isoDate is the local calendar day as YYYY-MM-DD', () => {
  const lateEvening = Date.UTC(2026, 9, 1, 22, 30) // 22:30 UTC on 1 October
  expect(isoDate(lateEvening, 120)).toBe('2026-10-02') // it is already the 2nd at UTC+2
  expect(isoDate(lateEvening, 0)).toBe('2026-10-01')
  expect(isoDate(lateEvening, -300)).toBe('2026-10-01')
  expect(isoDate(Date.UTC(2026, 9, 1, 1, 0), -300)).toBe('2026-09-30') // still the 30th at UTC-5
})

test('isoDate pads month and day, and crosses a year end', () => {
  expect(isoDate(Date.UTC(2026, 0, 5, 12), 0)).toBe('2026-01-05')
  expect(isoDate(Date.UTC(2026, 11, 31, 23, 30), 60)).toBe('2027-01-01')
})

test('weekStartIso is the local day a week before the reset when the reset time is known', () => {
  const resets = Date.UTC(2026, 9, 5, 2, 0) // Monday 5 October, 02:00 UTC
  expect(weekStartIso(THURSDAY, 0, resets)).toBe('2026-09-28') // across the month boundary
  expect(weekStartIso(THURSDAY, -300, resets)).toBe('2026-09-27') // 21:00 on the 27th at UTC-5
  expect(weekStartIso(THURSDAY, 120, resets)).toBe('2026-09-28')
})

test('weekStartIso with no reset time is the most recent Monday, today counting when it is Monday', () => {
  expect(weekStartIso(THURSDAY, 0, null)).toBe('2026-09-28') // Thursday 1 October: back into September
  expect(weekStartIso(Date.UTC(2026, 9, 5, 12), 0, null)).toBe('2026-10-05') // Monday itself
  expect(weekStartIso(Date.UTC(2026, 9, 4, 12), 0, null)).toBe('2026-09-28') // Sunday belongs to the week before
})

test('weekStartIso falls back to Monday when the reset time is not a usable number', () => {
  expect(weekStartIso(THURSDAY, 0, Number.NaN)).toBe('2026-09-28')
  expect(weekStartIso(THURSDAY, 0, Number.POSITIVE_INFINITY)).toBe('2026-09-28')
})

test('weekStartIso goes back across a year end and across a leap day', () => {
  expect(weekStartIso(Date.UTC(2027, 0, 1, 12), 0, null)).toBe('2026-12-28') // Friday 1 January 2027
  expect(weekStartIso(Date.UTC(2028, 2, 1, 12), 0, null)).toBe('2028-02-28') // Wednesday 1 March 2028, after 29 February
  expect(weekStartIso(Date.UTC(2027, 0, 1, 12), 0, Date.UTC(2027, 0, 4, 2))).toBe('2026-12-28') // a reset on 4 January began its week on 28 December
})

test('weekStartIso follows the offset when it moves the local day over midnight', () => {
  const sundayNight = Date.UTC(2026, 9, 4, 23, 30) // Sunday 4 October, 23:30 UTC
  expect(weekStartIso(sundayNight, 0, null)).toBe('2026-09-28') // still Sunday
  expect(weekStartIso(sundayNight, 120, null)).toBe('2026-10-05') // already Monday 01:30 at UTC+2
})

test('monthStartIso is the first of the local month', () => {
  expect(monthStartIso(THURSDAY, 0)).toBe('2026-10-01')
  expect(monthStartIso(Date.UTC(2026, 9, 31, 12), 0)).toBe('2026-10-01')
  expect(monthStartIso(Date.UTC(2026, 1, 28, 12), 0)).toBe('2026-02-01')
})

test('monthStartIso follows the offset across a month end and a year end', () => {
  const lastEvening = Date.UTC(2026, 8, 30, 23, 30) // 30 September, 23:30 UTC
  expect(monthStartIso(lastEvening, 0)).toBe('2026-09-01')
  expect(monthStartIso(lastEvening, 120)).toBe('2026-10-01') // already 1 October at UTC+2
  expect(monthStartIso(Date.UTC(2026, 11, 31, 23, 30), 60)).toBe('2027-01-01')
  expect(monthStartIso(Date.UTC(2027, 0, 1, 0, 30), -60)).toBe('2026-12-01') // still December at UTC-1
})

test('a week back from a reset is exactly seven days', () => {
  const resets = Date.UTC(2026, 9, 5, 2, 0)
  expect(isoDate(resets - 7 * DAY, 0)).toBe(weekStartIso(THURSDAY, 0, resets))
})
