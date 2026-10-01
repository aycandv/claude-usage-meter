import { caption, gaugeCells } from './gauge'
import type { Week } from './gauge'
import { crawlCells } from './led'
import type { Board, CardText, Cell } from './led'
import { PALETTE } from './palette'

export const FADE_CELLS = 6
// The crawl rests with a card this many pixels in, just past the soft left edge.
export const LEAD_PX = FADE_CELLS * 2

const GAUGE_X = 6 // after one blank column and the word "Week"

// The engine takes a Raster of 1 to 512 columns; a band wider than that is drawn 512 wide.
export const RASTER_MAX_COLS = 512
export const rasterWidth = (bodyColumns: number): number => Math.min(RASTER_MAX_COLS, bodyColumns)

// The period button lives in a column at the right end of the band, which the Raster leaves free. It is
// there from 100 columns up, with or without a gauge.
export const BUTTON_COLS = 14
const BUTTON_MIN_COLS = 100
export const reserveFor = (bodyColumns: number): number => (bodyColumns >= BUTTON_MIN_COLS ? BUTTON_COLS : 0)

export type Layout = { gaugeX: number; gaugeW: number; crawlX: number | null; crawlW: number; captionMax: number }
// `reserveRight` columns at the right edge are left to something else (the period button): the frame is that much
// narrower and the crawl ends that much sooner, while the layout is still the one for the whole `cols`.
export type BoardInput = {
  cols: number
  reserveRight?: number
  week: Week | null
  now: number
  offsetMin: number
  board: Board
  scrollOffset: number
  showGauge?: boolean
}
export type Frame = { cols: number; rows: 2; cells: Cell[] }

// Three tiers by width. Under 50 columns there is no board, only a line of text.
// With no gauge (an account that has no weekly limit) the crawl takes the whole width.
export const layoutFor = (cols: number, showGauge = true): Layout | null => {
  if (!showGauge) return cols < 30 ? null : { gaugeX: 0, gaugeW: 0, crawlX: 1, crawlW: cols - 2, captionMax: 0 }
  if (cols < 50) return null
  if (cols >= 100) return { gaugeX: GAUGE_X, gaugeW: 28, crawlX: 37, crawlW: cols - 1 - 37, captionMax: 30 }
  if (cols >= 70) return { gaugeX: GAUGE_X, gaugeW: 20, crawlX: 29, crawlW: cols - 1 - 29, captionMax: 22 }
  return { gaugeX: GAUGE_X, gaugeW: 20, crawlX: null, crawlW: 0, captionMax: cols - 1 - GAUGE_X }
}

// The whole band as two rows of cells.
export const boardFrame = (input: BoardInput): Frame | null => {
  const { cols, reserveRight = 0, week, now, offsetMin, board, scrollOffset, showGauge = true } = input
  const layout = layoutFor(cols, showGauge)
  if (layout === null) return null
  const reserve = Math.max(0, reserveRight)
  const width = cols - reserve
  if (width < 1) return null
  const cells: Cell[] = Array.from({ length: width * 2 }, (): Cell => [0x20, PALETTE.label, PALETTE.panel])
  const put = (col: number, row: number, str: string, fg: number) => {
    let x = col
    for (const ch of str) {
      if (x < width) cells[row * width + x] = [ch.codePointAt(0)!, fg, PALETTE.panel]
      x++
    }
  }
  if (showGauge) {
    put(1, 0, 'Week', PALETTE.label)
    gaugeCells(week, layout.gaugeW).cells.forEach((cell, i) => {
      if (layout.gaugeX + i < width) cells[layout.gaugeX + i] = cell
    })
    const cap = caption(week, now, offsetMin)
    const room = Math.max(0, Math.min(layout.captionMax, width - 1 - layout.gaugeX)) // the caption stays inside the frame
    const fitted = cap.text.length <= room ? cap.text : cap.short.slice(0, room)
    put(layout.gaugeX, 1, fitted, cap.isDanger ? PALETTE.signal : PALETTE.label)
  }
  // The crawl's right end is one blank column short of the frame's, with or without a reserve.
  const crawlW = layout.crawlX === null ? 0 : Math.max(0, layout.crawlW - reserve)
  if (layout.crawlX !== null && crawlW > 0) {
    const crawl = crawlCells(board, scrollOffset, crawlW, FADE_CELLS)
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < crawlW; c++) cells[r * width + layout.crawlX + c] = crawl[r * crawlW + c]!
    }
  }
  return { cols: width, rows: 2, cells }
}

// One line for where the board cannot be drawn: a narrow terminal, or a surface with no Raster.
export const textLine = (cards: readonly CardText[], week: Week | null, now: number, offsetMin: number, showGauge = true, maxCards = 3): string => {
  const parts = showGauge ? [caption(week, now, offsetMin).text] : []
  for (const card of cards.slice(0, maxCards)) parts.push([card.name, card.value, card.extra].filter(Boolean).join(' '))
  return parts.join('   ')
}
