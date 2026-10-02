import { test, expect } from 'claude-code/testing'

import { BUTTON_COLS, RASTER_MAX_COLS, boardFrame, layoutFor, rasterWidth, reserveFor, textLine } from './board'
import type { BoardInput } from './board'
import { caption, gaugeCells } from './gauge'
import type { Week } from './gauge'
import { buildStrip, crawlCells } from './led'
import type { Cell } from './led'
import { PALETTE } from './palette'

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const week = (usedPct: number, elapsedFrac: number | null): Week => ({ usedPct, elapsedFrac, resetsAtMs: NOW + 3.5 * DAY })
const cards = buildStrip(['today', 'opus 5.5', 'sonnet 5.5'].map(name => ({ name, value: '$1.00', extra: '5M' })))

const input = (cols: number, w: Week | null = week(20, 0.5), scrollOffset = -12): BoardInput => ({ cols, week: w, now: NOW, offsetMin: 120, board: cards, scrollOffset })
const text = (cells: Cell[], cols: number, row: number, from: number, length: number) =>
  cells.slice(row * cols + from, row * cols + from + length).map(c => String.fromCodePoint(c[0])).join('')

test('a Raster may be at most 512 columns wide, so the band is cut to that', () => {
  expect(RASTER_MAX_COLS).toBe(512)
  expect(rasterWidth(120)).toBe(120)
  expect(rasterWidth(512)).toBe(512)
  expect(rasterWidth(513)).toBe(512)
  expect(rasterWidth(2000)).toBe(512)
})

test('under 50 columns there is no board: the caller falls back to one line of text', () => {
  expect(layoutFor(49)).toBeNull()
  expect(boardFrame(input(49))).toBeNull()
})

test('the layout has three tiers by width', () => {
  expect(layoutFor(110)).toEqual({ gaugeX: 6, gaugeW: 28, crawlX: 37, crawlW: 72, captionMax: 30 })
  expect(layoutFor(100)).toEqual({ gaugeX: 6, gaugeW: 28, crawlX: 37, crawlW: 62, captionMax: 30 })
  expect(layoutFor(99)).toEqual({ gaugeX: 6, gaugeW: 20, crawlX: 29, crawlW: 69, captionMax: 22 })
  expect(layoutFor(70)).toEqual({ gaugeX: 6, gaugeW: 20, crawlX: 29, crawlW: 40, captionMax: 22 })
  expect(layoutFor(69)).toEqual({ gaugeX: 6, gaugeW: 20, crawlX: null, crawlW: 0, captionMax: 62 })
  expect(layoutFor(50)).toEqual({ gaugeX: 6, gaugeW: 20, crawlX: null, crawlW: 0, captionMax: 43 })
})

test('a frame is two rows of the full width', () => {
  const frame = boardFrame(input(110))!
  expect(frame.cols).toBe(110)
  expect(frame.rows).toBe(2)
  expect(frame.cells).toHaveLength(220)
})

test('the label, gauge and caption sit where the layout says', () => {
  const frame = boardFrame(input(110))!
  expect(text(frame.cells, 110, 0, 1, 4)).toBe('Week')
  const gauge = gaugeCells(week(20, 0.5), 28).cells
  expect(frame.cells.slice(6, 34)).toEqual(gauge)
  expect(text(frame.cells, 110, 1, 6, 26)).toBe('Lands near 40%, resets Mon')
  expect(frame.cells[110 + 6]![1]).toBe(PALETTE.label)
})

test('the crawl fills the rest of the width, leaving one blank column at the right', () => {
  const frame = boardFrame(input(110, week(20, 0.5), 40))!
  const crawl = crawlCells(cards, 40, 72, 6)
  for (let r = 0; r < 2; r++) {
    expect(frame.cells.slice(r * 110 + 37, r * 110 + 109)).toEqual(crawl.slice(r * 72, r * 72 + 72))
    expect(frame.cells[r * 110 + 109]).toEqual([0x20, PALETTE.label, PALETTE.panel])
  }
})

test('a caption that means danger is drawn in the signal color', () => {
  const frame = boardFrame(input(110, week(60, 0.5)))!
  expect(text(frame.cells, 110, 1, 6, 18)).toBe('Runs out Sat 22:00')
  expect(frame.cells[110 + 6]![1]).toBe(PALETTE.signal)
})

test('on a medium width the gauge is narrower and the caption uses its short form', () => {
  const frame = boardFrame(input(80))!
  expect(frame.cells.slice(6, 26)).toEqual(gaugeCells(week(20, 0.5), 20).cells)
  expect(text(frame.cells, 80, 1, 6, 14)).toBe('Lands near 40%')
  expect(text(frame.cells, 80, 1, 20, 3)).toBe('   ') // the long form is not drawn
  expect(frame.cells[29]).toEqual(crawlCells(cards, -12, 50, 6)[0]) // crawl begins at column 29
})

test('on a narrow width there is a gauge and caption but no crawl', () => {
  const frame = boardFrame(input(60))!
  expect(text(frame.cells, 60, 1, 6, 26)).toBe('Lands near 40%, resets Mon')
  for (let c = 29; c < 60; c++) expect(frame.cells[c]).toEqual([0x20, PALETTE.label, PALETTE.panel])
})

test('with no weekly reading the gauge is empty and the caption says so', () => {
  const frame = boardFrame(input(110, null))!
  expect(text(frame.cells, 110, 1, 6, 14)).toBe('No reading yet')
  expect(frame.cells.slice(6, 34)).toEqual(gaugeCells(null, 28).cells)
})

test('the at-limit caption keeps its reset time when there is room and drops it when there is not', () => {
  const frame = boardFrame({ ...input(110), week: { usedPct: 100, elapsedFrac: 0.5, resetsAtMs: NOW + 3.5 * DAY } })!
  expect(text(frame.cells, 110, 1, 6, 26)).toBe('At limit, resets Mon 02:00')
  const tight = boardFrame({ ...input(80), week: { usedPct: 100, elapsedFrac: 0.5, resetsAtMs: NOW + 3.5 * DAY } })!
  expect(text(tight.cells, 80, 1, 6, 8)).toBe('At limit')
  expect(text(tight.cells, 80, 1, 14, 3)).toBe('   ')
})

test('every cell honors the Raster contract and the frame stays within its color budget', () => {
  const frame = boardFrame(input(110, week(60, 0.4), 123))!
  const pairs = new Set<string>()
  for (const [cp, fg, bg] of frame.cells) {
    expect(Number.isInteger(cp)).toBe(true)
    expect(cp).toBeGreaterThanOrEqual(0x20)
    expect(cp).toBeLessThanOrEqual(0xffff)
    expect(fg).toBeLessThanOrEqual(0xffffff)
    expect(bg).toBeLessThanOrEqual(0xffffff)
    pairs.add(`${fg}/${bg}`)
  }
  expect(pairs.size).toBeLessThan(1024)
})

test('without a gauge the crawl takes the whole width but for a column of margin each side', () => {
  expect(layoutFor(100, false)).toEqual({ gaugeX: 0, gaugeW: 0, crawlX: 1, crawlW: 98, captionMax: 0 })
  expect(layoutFor(30, false)).toEqual({ gaugeX: 0, gaugeW: 0, crawlX: 1, crawlW: 28, captionMax: 0 })
  expect(layoutFor(29, false)).toBeNull()
})

test('a frame without a gauge is only the crawl on the panel', () => {
  const frame = boardFrame({ ...input(110, null, 40), showGauge: false })!
  const crawl = crawlCells(cards, 40, 108, 6)
  for (let r = 0; r < 2; r++) {
    expect(frame.cells[r * 110]).toEqual([0x20, PALETTE.label, PALETTE.panel])
    expect(frame.cells.slice(r * 110 + 1, r * 110 + 109)).toEqual(crawl.slice(r * 108, r * 108 + 108))
    expect(frame.cells[r * 110 + 109]).toEqual([0x20, PALETTE.label, PALETTE.panel])
  }
})

test('a reserve on the right makes the frame that much narrower, and the tier is still chosen from the whole width', () => {
  const frame = boardFrame({ ...input(110), reserveRight: 14 })!
  expect(frame.cols).toBe(96)
  expect(frame.rows).toBe(2)
  expect(frame.cells).toHaveLength(192)
  expect(frame.cells.slice(6, 34)).toEqual(gaugeCells(week(20, 0.5), 28).cells) // the full tier's gauge, as at 110 columns
  expect(text(frame.cells, 96, 0, 1, 4)).toBe('Week')
})

test('with a reserve the crawl ends that many cells earlier, and nothing is drawn past the frame', () => {
  const frame = boardFrame({ ...input(110, week(20, 0.5), 40), reserveRight: 14 })!
  const crawl = crawlCells(cards, 40, 58, 6) // the 72 cells of the full tier, less the 14 reserved
  for (let r = 0; r < 2; r++) {
    expect(frame.cells.slice(r * 96 + 37, r * 96 + 95)).toEqual(crawl.slice(r * 58, r * 58 + 58))
    expect(frame.cells[r * 96 + 95]).toEqual([0x20, PALETTE.label, PALETTE.panel]) // the blank column at the right
  }
})

test('a reserve of nothing is the frame as before', () => {
  expect(boardFrame({ ...input(110, week(60, 0.4), 123), reserveRight: 0 })).toEqual(boardFrame(input(110, week(60, 0.4), 123)))
})

test('the caption still fits inside the narrower frame', () => {
  const frame = boardFrame({ ...input(110), reserveRight: 14 })!
  expect(text(frame.cells, 96, 1, 6, 26)).toBe('Lands near 40%, resets Mon')
})

test('a caption that no longer fits the frame is drawn in its short form', () => {
  const frame = boardFrame({ ...input(110), reserveRight: 80 })! // 30 columns: room for 23 after the gauge starts
  expect(frame.cols).toBe(30)
  expect(text(frame.cells, 30, 1, 6, 14)).toBe('Lands near 40%')
  expect(text(frame.cells, 30, 1, 20, 3)).toBe('   ')
})

test('a reserve that leaves less room than the gauge never wraps into the next row', () => {
  const frame = boardFrame({ ...input(110), reserveRight: 100 })! // 10 columns wide
  expect(frame.cols).toBe(10)
  expect(frame.cells).toHaveLength(20)
  expect(frame.cells.slice(10, 16)).toEqual(Array.from({ length: 6 }, () => [0x20, PALETTE.label, PALETTE.panel])) // row 1 before the caption
  expect(frame.cells.slice(6, 10)).toEqual(gaugeCells(week(20, 0.5), 28).cells.slice(0, 4)) // the gauge is cut at the edge
})

test('there is no frame when the reserve takes the whole width', () => {
  expect(boardFrame({ ...input(110), reserveRight: 110 })).toBeNull()
  expect(boardFrame({ ...input(110), reserveRight: 400 })).toBeNull()
})

test('a frame without a gauge and with a reserve is the crawl alone, ending earlier', () => {
  const frame = boardFrame({ ...input(110, null, 40), showGauge: false, reserveRight: 14 })!
  const crawl = crawlCells(cards, 40, 94, 6)
  expect(frame.cols).toBe(96)
  for (let r = 0; r < 2; r++) {
    expect(frame.cells[r * 96]).toEqual([0x20, PALETTE.label, PALETTE.panel])
    expect(frame.cells.slice(r * 96 + 1, r * 96 + 95)).toEqual(crawl.slice(r * 94, r * 94 + 94))
    expect(frame.cells[r * 96 + 95]).toEqual([0x20, PALETTE.label, PALETTE.panel])
  }
})

test('a button column of 14 is kept back at 100 columns or more, with or without a gauge', () => {
  expect(BUTTON_COLS).toBe(14)
  expect(reserveFor(100)).toBe(14)
  expect(reserveFor(120)).toBe(14)
  expect(reserveFor(600)).toBe(14)
})

test('an account with no weekly limit, and so no gauge, still gets the button column', () => {
  expect(reserveFor(120)).toBe(14)
})

test('there is no button column under 100 columns', () => {
  expect(reserveFor(99)).toBe(0)
  expect(reserveFor(60)).toBe(0)
})

const lines = [
  { name: 'today', value: '$42.18', extra: '96M tokens' },
  { name: 'opus 5.5', value: '$31.50', extra: '80M' },
  { name: 'sonnet 5.5', value: '$9.25', extra: '14M' },
  { name: 'fable 5.1', value: '$1.43', extra: '2M' },
]

test('textLine is the weekly caption then the first three cards, in plain words', () => {
  expect(textLine(lines, week(20, 0.5), NOW, 120)).toBe('Lands near 40%, resets Mon   today $42.18 96M tokens   opus 5.5 $31.50 80M   sonnet 5.5 $9.25 14M')
})

test('textLine leaves out the caption when there is no gauge', () => {
  expect(textLine(lines.slice(0, 2), null, NOW, 120, false)).toBe('today $42.18 96M tokens   opus 5.5 $31.50 80M')
})

test('textLine drops the gaps of a card with no value or extra', () => {
  expect(textLine([{ name: 'usage unavailable', value: '', extra: '' }], null, NOW, 120, false)).toBe('usage unavailable')
})
