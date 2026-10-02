import { test, expect } from 'claude-code/testing'

import { IDLE_PX_S, MAX_PX_S, WORKING_FLOOR_PX_S, addSample, fade, paceNow, rateOf, speedFor } from './pace'

const MIN = 60_000

test('with no spending the crawl drifts at the idle speed', () => {
  expect(speedFor(0, false)).toBe(IDLE_PX_S)
})

test('while Claude works it never drops below the working floor', () => {
  expect(speedFor(0, true)).toBe(WORKING_FLOOR_PX_S)
  expect(speedFor(1, true)).toBeGreaterThanOrEqual(WORKING_FLOOR_PX_S)
  expect(WORKING_FLOOR_PX_S).toBeGreaterThan(IDLE_PX_S)
})

test('the working floor does not slow down a faster pace', () => {
  expect(speedFor(60, true)).toBe(speedFor(60, false))
})

test('speed rises with the pace', () => {
  const speeds = [0, 1, 5, 20, 60, 120].map(rate => speedFor(rate, false))
  for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!)
})

test('about twenty dollars an hour is about the old cruising speed', () => {
  expect(speedFor(20, false)).toBeGreaterThan(21)
  expect(speedFor(20, false)).toBeLessThan(25)
})

test('speed is capped at the maximum', () => {
  expect(speedFor(1e9, false)).toBe(MAX_PX_S)
  expect(speedFor(1e9, true)).toBe(MAX_PX_S)
})

test('a pace that is not a usable number counts as no pace', () => {
  expect(speedFor(Number.NaN, false)).toBe(IDLE_PX_S)
  expect(speedFor(-5, false)).toBe(IDLE_PX_S)
  expect(speedFor(Number.POSITIVE_INFINITY, false)).toBe(IDLE_PX_S)
})

test('addSample appends and drops samples older than the window', () => {
  let s = addSample([], 0, 1, 90_000)
  s = addSample(s, 30_000, 2, 90_000)
  s = addSample(s, 100_000, 3, 90_000)
  expect(s).toEqual([
    { t: 30_000, usd: 2 },
    { t: 100_000, usd: 3 },
  ])
})

test('rateOf is dollars per hour between the first and the last sample', () => {
  expect(rateOf([{ t: 0, usd: 10 }, { t: MIN, usd: 10.5 }], 8_000)).toBe(30)
  expect(rateOf([{ t: 0, usd: 10 }, { t: 30_000, usd: 10.1 }, { t: 2 * MIN, usd: 11 }], 8_000)).toBe(30)
})

test('rateOf has nothing to say with too few samples, too short a span, or a total that went down', () => {
  expect(rateOf([], 8_000)).toBe(0)
  expect(rateOf([{ t: 0, usd: 1 }], 8_000)).toBe(0)
  expect(rateOf([{ t: 0, usd: 1 }, { t: 5_000, usd: 2 }], 8_000)).toBe(0)
  expect(rateOf([{ t: 0, usd: 50 }, { t: MIN, usd: 2 }], 8_000)).toBe(0) // a new day starts the total over
  expect(rateOf([{ t: 0, usd: 5 }, { t: MIN, usd: 5 }], 8_000)).toBe(0)
})

test('fade decays a pace with the age of its last sample', () => {
  expect(fade(100, 0, 180_000)).toBe(100)
  expect(Math.abs(fade(100, 180_000, 180_000) - 100 / Math.E)).toBeLessThan(1e-9)
  expect(fade(100, -5_000, 180_000)).toBe(100)
})

test('paceNow takes the faster of the live session rate and the faded machine rate', () => {
  const now = 10 * MIN
  const idleSession = [{ t: now - 60_000, usd: 5 }, { t: now, usd: 5 }]
  const busySession = [{ t: now - 60_000, usd: 5 }, { t: now, usd: 5.5 }] // 30 $/h
  const machine = [{ t: now - 10 * MIN, usd: 100 }, { t: now, usd: 104 }] // 24 $/h, last sample just now
  expect(paceNow(idleSession, machine, now)).toBe(24)
  expect(paceNow(busySession, machine, now)).toBe(30)
  expect(Math.abs(paceNow(idleSession, machine, now + 180_000) - 24 / Math.E)).toBeLessThan(1e-9)
  expect(paceNow([], [], now)).toBe(0)
})
