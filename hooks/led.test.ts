import { test, expect } from 'claude-code/testing'

import { ADVANCE, FONT_ROWS, SEP_DOTS, TONE_BRIGHT, TONE_DIM, buildStrip, crawlCells, glyphCols } from './led'
import type { Board } from './led'
import { PALETTE } from './palette'

// A board of `length` blank columns with the given columns lit.
const boardOf = (length: number, lit: Record<number, { m: number; tone?: 0 | 1 }>): Board => ({
  strip: Array.from({ length }, (_, x) => ({ m: lit[x]?.m ?? 0, tone: lit[x]?.tone ?? TONE_BRIGHT })),
  starts: [0],
  length,
})
const NO_FADE = 0.5 // a fade shorter than half a cell leaves every cell at full strength

test('every glyph is 7 rows of 5 pixels', () => {
  for (const [ch, rows] of Object.entries(FONT_ROWS)) {
    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(row.length).toBe(5)
      expect(/^[#.]+$/.test(row)).toBe(true)
    }
    expect(ch.length).toBe(1)
  }
})

test('glyphCols turns rows into column masks with the top row in bit 0', () => {
  const t = glyphCols('T')
  expect(t).toHaveLength(5)
  expect(t.every(m => (m & 1) === 1)).toBe(true) // the bar across the top
  expect(t[2]).toBe(0b1111111) // the stem
  expect(t[0]).toBe(1)
})

test('glyphCols of a character the font lacks is blank', () => {
  expect(glyphCols('~')).toEqual([0, 0, 0, 0, 0])
})

test('buildStrip lays a card as name, value, extra, then a dotted tick', () => {
  const b = buildStrip([{ name: 'a', value: 'b', extra: 'c' }])
  expect(ADVANCE).toBe(6)
  expect(b.starts).toEqual([0])
  expect(b.length).toBe(6 + 12 + 6 + 12 + 6 + 16 + 1 + 16)
  expect(b.strip).toHaveLength(b.length)
  expect(b.strip[6 + 12 + 6 + 12 + 6 + 16]!.m).toBe(SEP_DOTS)
})

test('buildStrip records where each card starts', () => {
  const b = buildStrip([
    { name: 'a', value: 'b', extra: 'c' },
    { name: 'a', value: 'b', extra: 'c' },
  ])
  expect(b.starts).toEqual([0, 75])
  expect(b.length).toBe(150)
})

test('names and extras are quiet, values are bright', () => {
  const b = buildStrip([{ name: 'a', value: 'b', extra: 'c' }])
  expect(b.strip[0]!.tone).toBe(TONE_DIM)
  expect(b.strip[18]!.tone).toBe(TONE_BRIGHT)
  expect(b.strip[36]!.tone).toBe(TONE_DIM)
})

test('lower case letters draw the same as capitals', () => {
  const lower = buildStrip([{ name: 'opus', value: 'x', extra: 'y' }])
  const upper = buildStrip([{ name: 'OPUS', value: 'x', extra: 'y' }])
  expect(lower.strip.map(c => c.m)).toEqual(upper.strip.map(c => c.m))
})

test('crawlCells is two rows of cells and blank where nothing is lit', () => {
  const cells = crawlCells(boardOf(8, {}), 0, 5, NO_FADE)
  expect(cells).toHaveLength(10)
  for (const [cp, , bg] of cells) {
    expect(cp).toBe(0x20)
    expect(bg).toBe(PALETTE.panel)
  }
})

test('crawlCells packs each pixel into its braille dot', () => {
  // pixel (x, y) of the first cell, and the dot bit braille gives it
  const dots: [number, number, number][] = [
    [0, 0, 0x01], [0, 1, 0x02], [0, 2, 0x04], [0, 3, 0x40],
    [1, 0, 0x08], [1, 1, 0x10], [1, 2, 0x20], [1, 3, 0x80],
  ]
  for (const [x, y, bit] of dots) {
    const cells = crawlCells(boardOf(4, { [x]: { m: 1 << y } }), 0, 2, NO_FADE)
    expect(cells[0]![0]).toBe(0x2800 + bit)
  }
})

test('pixels in the lower four rows land in the second row of cells', () => {
  const cells = crawlCells(boardOf(4, { 0: { m: 1 << 4 } }), 0, 2, NO_FADE)
  expect(cells[0]![0]).toBe(0x20) // top row stays blank
  expect(cells[2]![0]).toBe(0x2801) // second row, first cell, top-left dot
})

test('a bright pixel takes the bulb color and a dim one the quiet color', () => {
  const bright = crawlCells(boardOf(4, { 0: { m: 1, tone: TONE_BRIGHT } }), 0, 2, NO_FADE)
  const dim = crawlCells(boardOf(4, { 0: { m: 1, tone: TONE_DIM } }), 0, 2, NO_FADE)
  expect(bright[0]![1]).toBe(PALETTE.bulb)
  expect(dim[0]![1]).toBe(PALETTE.bulbDim)
  expect(bright[0]![2]).toBe(PALETTE.panel)
})

test('the offset slides the strip left by whole pixels and wraps, also when negative', () => {
  const board = boardOf(4, { 3: { m: 1 } }) // one lit pixel at strip x=3
  expect(crawlCells(board, 3, 2, NO_FADE)[0]![0]).toBe(0x2801) // now at view x=0
  expect(crawlCells(board, 1, 2, NO_FADE)[1]![0]).toBe(0x2801) // view x=2 is cell 1
  expect(crawlCells(board, -1, 2, NO_FADE)[0]![0]).toBe(0x2801)
  expect(crawlCells(board, 7, 2, NO_FADE)[0]![0]).toBe(0x2801) // a whole lap later
})

test('both ends fade into the panel, the same on each side, and the middle is full strength', () => {
  const all = boardOf(8, Object.fromEntries(Array.from({ length: 8 }, (_, x) => [x, { m: 0xff }])))
  const cells = crawlCells(all, 0, 20, 6)
  const topRow = cells.slice(0, 20)
  for (let c = 0; c < 20; c++) expect(topRow[c]![1]).toBe(topRow[19 - c]![1])
  expect(topRow[10]![1]).toBe(PALETTE.bulb)
  expect(topRow[0]![1]).toBeLessThan(topRow[5]![1])
  for (let c = 1; c < 6; c++) expect(topRow[c]![1]).toBeGreaterThanOrEqual(topRow[c - 1]![1])
  expect(topRow[0]![1]).toBeLessThan(PALETTE.bulb)
})
