import { test, expect } from 'claude-code/testing'

import { WEEK_MS, caption, forecast, gaugeCells, heat, sevenDay, weekFromLimit } from './gauge'
import type { Week } from './gauge'
import { PALETTE, mix } from './palette'

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0) // Thursday 1 October 2026, 12:00 UTC
const week = (usedPct: number, elapsedFrac: number | null, daysToReset: number | null = 3.5): Week => ({
  usedPct,
  elapsedFrac,
  resetsAtMs: daysToReset === null ? null : NOW + daysToReset * DAY,
})

test('weekFromLimit reads how far into the week we are from the reset time', () => {
  const w = weekFromLimit({ percentUsed: 41, resetsAt: new Date(NOW + 3.5 * DAY).toISOString() }, NOW)
  expect(w?.usedPct).toBe(41)
  expect(w?.resetsAtMs).toBe(NOW + 3.5 * DAY)
  expect(Math.abs((w?.elapsedFrac ?? -1) - 0.5)).toBeLessThan(1e-9)
})

test('weekFromLimit starts a reset more than a week away at the beginning of the week', () => {
  const w = weekFromLimit({ percentUsed: 1, resetsAt: new Date(NOW + 9 * DAY).toISOString() }, NOW)
  expect(w?.elapsedFrac).toBe(0)
  expect(w?.resetsAtMs).toBe(NOW + 9 * DAY)
})

test('weekFromLimit a moment before the reset is the end of the week', () => {
  const w = weekFromLimit({ percentUsed: 90, resetsAt: new Date(NOW + 1000).toISOString() }, NOW)
  expect(w).not.toBeNull()
  expect(w?.elapsedFrac).toBeGreaterThan(0.9999)
  expect(w?.elapsedFrac).toBeLessThan(1)
})

test('weekFromLimit is null once the reset time has passed, the window it described being over', () => {
  expect(weekFromLimit({ percentUsed: 80, resetsAt: new Date(NOW - DAY).toISOString() }, NOW)).toBeNull()
  expect(weekFromLimit({ percentUsed: 80, resetsAt: new Date(NOW).toISOString() }, NOW)).toBeNull()
})

test('a reading whose reset has passed is drawn as no reading at all', () => {
  const stale = weekFromLimit({ percentUsed: 80, resetsAt: new Date(NOW - 1000).toISOString() }, NOW)
  expect(caption(stale, NOW, 0).text).toBe('No reading yet')
  expect(gaugeCells(stale, 10).cells).toEqual(gaugeCells(null, 10).cells)
})

test('weekFromLimit has no time information without a usable reset time', () => {
  expect(weekFromLimit({ percentUsed: 5 }, NOW)).toEqual({ usedPct: 5, elapsedFrac: null, resetsAtMs: null })
  expect(weekFromLimit({ percentUsed: 5, resetsAt: 'soon' }, NOW)?.elapsedFrac).toBeNull()
})

test('forecast projects the end of the week at the pace so far', () => {
  const f = forecast(20, 0.5)
  expect(f.projected).toBe(40)
  expect(f.hasForecast).toBe(true)
  expect(f.isOut).toBe(false)
  expect(f.outInFrac).toBeNull()
})

test('forecast says when the limit runs out if the pace would pass 100%', () => {
  const f = forecast(60, 0.5)
  expect(f.projected).toBe(120)
  expect(f.isOut).toBe(true)
  expect(Math.abs((f.outInFrac ?? -1) - 1 / 3)).toBeLessThan(1e-9)
})

test('forecast treats landing exactly on 100% as running out at the reset', () => {
  const f = forecast(50, 0.5)
  expect(f.isOut).toBe(true)
  expect(f.outInFrac).toBe(0.5)
})

test('forecast has nothing to say before the week has begun, or with no usage, or no clock', () => {
  expect(forecast(30, 0.01).hasForecast).toBe(false)
  expect(forecast(0, 0.5).hasForecast).toBe(false)
  expect(forecast(30, null).hasForecast).toBe(false)
})

test('forecast at or past 100% is already out', () => {
  expect(forecast(100, 0.3)).toEqual({ projected: 100, hasForecast: true, isOut: true, outInFrac: 0 })
})

test('heat is one ramp from cool to red, flat at both ends', () => {
  expect(heat(0)).toBe(PALETTE.glacier)
  expect(heat(55)).toBe(PALETTE.glacier)
  expect(heat(85)).toBe(PALETTE.straw)
  expect(heat(100)).toBe(PALETTE.ember)
  expect(heat(112)).toBe(PALETTE.signal)
  expect(heat(400)).toBe(PALETTE.signal)
  expect(heat(70)).toBe(mix(PALETTE.glacier, PALETTE.straw, 0.5))
})

test('caption with no reading yet', () => {
  expect(caption(null, NOW, 120).text).toBe('No reading yet')
})

test('caption under pace says where you land and the weekday of the reset, in local time', () => {
  const c = caption(week(20, 0.5), NOW, 120)
  expect(c.text).toBe('Lands near 40%, resets Mon') // reset is Monday 00:00 UTC, so local day depends on the offset
  expect(c.short).toBe('Lands near 40%')
  expect(c.isDanger).toBe(false)
  expect(caption(week(20, 0.5), NOW, -720).text).toBe('Lands near 40%, resets Sun')
})

test('caption over pace says when it runs out, in local time', () => {
  const c = caption(week(60, 0.5), NOW, 120)
  expect(c.text).toBe('Runs out Sat 22:00')
  expect(c.isDanger).toBe(true)
})

test('caption at the limit says when it resets', () => {
  const c = caption(week(100, 0.5), NOW, 120)
  expect(c.text).toBe('At limit, resets Mon 02:00')
  expect(c.short).toBe('At limit')
  expect(c.isDanger).toBe(true)
})

test('caption early in the week gives only the reset', () => {
  expect(caption(week(5, 0.01), NOW, 120).text).toBe('Resets Mon 02:00')
})

test('caption without a reset time admits it has no forecast', () => {
  expect(caption(week(20, null, null), NOW, 120).text).toBe('No forecast yet')
})

test('an empty gauge is all unlit track', () => {
  const g = gaugeCells(null, 10)
  expect(g.cells).toHaveLength(10)
  for (const cell of g.cells) expect(cell).toEqual([0x20, PALETTE.track, PALETTE.track])
})

test('the fill is whole blocks, then one partial block in eighths', () => {
  const g = gaugeCells(week(41, null), 28) // 41% of 28 cells is 11.5 cells
  for (let i = 0; i < 11; i++) expect(g.cells[i]).toEqual([0x2588, g.hue, g.hue])
  expect(g.cells[11]).toEqual([0x258c, g.hue, PALETTE.track]) // half a block
  for (let i = 12; i < 28; i++) expect(g.cells[i]).toEqual([0x20, PALETTE.track, PALETTE.track])
})

test('the fill takes its color from where the week will land', () => {
  expect(gaugeCells(week(20, 0.5), 28).hue).toBe(PALETTE.glacier) // lands near 40%
  expect(gaugeCells(week(60, 0.5), 28).hue).toBe(PALETTE.signal) // would pass 100%
})

test('a faint ghost runs from the fill to the projected end, with the notch where the calendar is', () => {
  const g = gaugeCells(week(20, 0.5), 28) // fill 5.6 cells, lands near 40% = 11.25 cells, notch at cell 14
  const ghost = mix(PALETTE.panel, g.hue, 0.3)
  expect(g.cells[4]).toEqual([0x2588, g.hue, g.hue])
  expect(g.cells[5]).toEqual([0x258b, g.hue, ghost]) // five eighths of fill over ghost
  for (let i = 6; i <= 10; i++) expect(g.cells[i]).toEqual([0x20, ghost, ghost])
  expect(g.cells[11]).toEqual([0x258e, ghost, PALETTE.track]) // the ghost ends a quarter into the cell
  expect(g.cells[12]).toEqual([0x20, PALETTE.track, PALETTE.track])
  expect(g.cells[14]).toEqual([0x258f, PALETTE.notch, PALETTE.track])
})

test('the ghost stops at the end of the bar when the projection passes 100%', () => {
  const g = gaugeCells(week(60, 0.5), 28)
  const ghost = mix(PALETTE.panel, g.hue, 0.3)
  expect(g.cells[27]).toEqual([0x20, ghost, ghost])
  expect(g.cells).toHaveLength(28)
})

test('a notch inside the fill is drawn over the filled block', () => {
  const g = gaugeCells(week(60, 0.25), 28) // notch at cell 7, inside 16.8 filled cells
  expect(g.cells[7]).toEqual([0x258f, PALETTE.notch, g.hue])
})

test('the notch moves one cell right rather than cover the partial block', () => {
  const g = gaugeCells(week(41, 0.4), 28) // calendar cell 11 is the partial block
  expect(g.cells[11]![0]).toBe(0x258c)
  expect(g.cells[12]![0]).toBe(0x258f)
})

test('there is no notch when the week has no clock', () => {
  const g = gaugeCells(week(41, null), 28)
  expect(g.cells.some(c => c[0] === 0x258f)).toBe(false)
})

test('WEEK_MS is seven days', () => {
  expect(WEEK_MS).toBe(7 * DAY)
})

test('sevenDay picks the seven-day window out of the limits the engine reports', () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 80, resetsAt: 'x' },
    { kind: 'seven_day', percentUsed: 41, resetsAt: 'y' },
    { kind: 'spend_limit', percentUsed: 3 },
  ]
  expect(sevenDay(limits)).toEqual({ percentUsed: 41, resetsAt: 'y' })
})

test('sevenDay is undefined when there is no seven-day window', () => {
  expect(sevenDay([])).toBeUndefined()
  expect(sevenDay([{ kind: 'five_hour', percentUsed: 80 }])).toBeUndefined()
})
