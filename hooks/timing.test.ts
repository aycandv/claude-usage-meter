import { test, expect } from 'claude-code/testing'

import { RETRY_MS, paintDue, spendDue } from './timing'

const clean = { px: 40, lastPx: 40, dirty: false, now: 10_000, retryAt: 0 }

test('nothing is painted while the pixel is where it was and nothing else changed', () => {
  expect(paintDue(clean)).toBe(false)
})

test('a crawl that moved a pixel is painted', () => {
  expect(paintDue({ ...clean, px: 41 })).toBe(true)
  expect(paintDue({ ...clean, px: 39 })).toBe(true)
})

test('a changed frame is painted even when the pixel did not move', () => {
  expect(paintDue({ ...clean, dirty: true })).toBe(true)
})

test('the first frame is painted, as nothing is on screen yet', () => {
  expect(paintDue({ ...clean, lastPx: null })).toBe(true)
})

test('after a refused paint nothing is tried before the retry time, however much has changed', () => {
  const refused = { ...clean, now: 10_000, retryAt: 10_000 + RETRY_MS, dirty: true, px: 99 }
  expect(paintDue(refused)).toBe(false)
  expect(paintDue({ ...refused, now: 10_000 + RETRY_MS - 1 })).toBe(false)
})

test('from the retry time on a refused frame is tried again', () => {
  const refused = { ...clean, retryAt: 10_000, dirty: true }
  expect(paintDue({ ...refused, now: 10_000 })).toBe(true)
  expect(paintDue({ ...refused, now: 10_001 })).toBe(true)
})

test('the retry wait is about half a second, far longer than a tick of the crawl', () => {
  expect(RETRY_MS).toBe(500)
})

test('spend is refreshed only when a turn asked for it', () => {
  expect(spendDue({ wanted: false, now: 1_000_000, lastAt: 0, minGapMs: 30_000 })).toBe(false)
  expect(spendDue({ wanted: true, now: 1_000_000, lastAt: 0, minGapMs: 30_000 })).toBe(true)
})

test('spend is not refreshed again before the minimum gap has passed since the last refresh', () => {
  expect(spendDue({ wanted: true, now: 129_999, lastAt: 100_000, minGapMs: 30_000 })).toBe(false)
  expect(spendDue({ wanted: true, now: 130_000, lastAt: 100_000, minGapMs: 30_000 })).toBe(true)
})
