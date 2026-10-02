// The Details pane as the desktop draws it: native Box and Text for everything that changes (they update in
// place), and two small SVGs for what changes rarely, each with its own key: the weekly ring and the daily
// sparkline. An Svg can only change by being replaced, which reloads its frame, so nothing live goes in one.
import { money } from './cards'
import { INK, accentOf, glowFilter, hex, styleTag } from './desktop-theme'
import { mix } from './palette'
import { weekLook } from './desktop-state'
import { caption } from './gauge'
import type { Week } from './gauge'
import { sparkPath, sparkPoints } from './panel-svg'
import type { PanelDay, PanelInput } from './panel-svg'
import { ringModel, ringSvg } from './ring-svg'
import { escape, fit, n, sansWidth } from './svg-util'

const NAME_MAX_COLS = 14
const CARD_CHROME_COLS = 6 // the card's border and padding, both sides, in cells
const MIN_BAR_COLS = 6
// The pane's card, flattened from the strip's glass (a native Box takes one color), and its hairline.
export const PANE_CARD = 0x12171f
export const PANE_EDGE = '#2a303b'

// A model's row, in flow: name | bar track | detail | price. The bar fills its track to the model's share of the
// biggest one, in whole percents (the engine refuses "33.3%"); the top model's bar is in the accent.
export type PaneRow = { name: string; value: string; detail: string; bar: string; top: boolean }
export type PaneView = {
  total: string
  meta: string // '96M tokens · Oct 1'
  source: string
  rows: PaneRow[]
  emptyText: string | null
  barTrack: string // the empty part of a bar: barely there
  barRest: string // the bars after the first: the accent, sunk halfway into the card
  nameCols: number // the row's columns, in cells, fitted to the pane; detailCols is 0 when it is too narrow for it
  barCols: number
  detailCols: number
  valueCols: number
  daily: PanelDay[]
  peak: string
  pace: string | null // '$6.50/h'
  week: Week | null
  now: number
  offsetMin: number
  weekLabel: string
  weekCaption: string
  weekDanger: boolean
  weekUsed: string | null // '39% used', for a pane drawn without its ring
  readingAge: string | null // 'reading 4 min ago': how stale the weekly figures are
  accent: string
}

const finite = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0)

// The row's columns for a pane `columns` cells across: name, a gap, the bar, a gap, the detail (dropped first when
// there is no room), a gap, the price. The bar keeps at least a stub; the name shrinks before it goes.
export const rowColumns = (columns: number, nameW: number, detailW: number, valueW: number) => {
  const inner = Math.max(10, (Number.isFinite(columns) ? columns : 0) - CARD_CHROME_COLS)
  let nameCols = Math.min(nameW, NAME_MAX_COLS)
  let detailCols = detailW
  let barCols = inner - nameCols - valueW - detailCols - 3
  if (barCols < MIN_BAR_COLS) {
    detailCols = 0
    barCols = inner - nameCols - valueW - 2
  }
  if (barCols < MIN_BAR_COLS) {
    nameCols = Math.max(4, inner - valueW - 2 - MIN_BAR_COLS)
    barCols = Math.max(0, inner - nameCols - valueW - 2)
  }
  return { nameCols, barCols, detailCols, valueCols: valueW }
}

export const paneView = (input: PanelInput, columns: number, readingAge: string | null = null): PaneView => {
  const names = input.models.map(m => m.name.slice(0, NAME_MAX_COLS))
  const details = input.models.map(m => m.detail ?? '')
  const longest = (xs: string[]) => Math.max(0, ...xs.map(x => [...x].length))
  const cols = rowColumns(columns, longest(names), longest(details), longest(input.models.map(m => m.value)))
  const top = Math.max(0, ...input.models.map(m => finite(m.cost)))
  const rows = input.models.map((m, i) => {
    const frac = top > 0 ? finite(m.cost) / top : 0
    // Whole percents only: the engine refuses a tree with "33.3%" (a width is a number or /^\d{1,3}%$/).
    const pct = frac > 0 ? Math.max(2, Math.round(frac * 100)) : 0 // a model that cost anything shows a sliver
    return { name: names[i]!, value: m.value, detail: details[i]!, bar: `${pct}%`, top: i === 0 }
  })
  const accent = accentOf(input.week)
  const cap = input.week ? caption(input.week, input.now, input.offsetMin) : null
  const peak = Math.max(0, ...input.daily.map(d => finite(d.cost)))
  return {
    total: input.total,
    meta: [input.tokens, input.range].filter(Boolean).join(' · '),
    source: input.source,
    rows,
    emptyText: rows.length === 0 ? (input.emptyText ?? `No usage ${input.title}`) : null,
    barTrack: hex(mix(0xffffff, PANE_CARD, 0.975)),
    barRest: hex(mix(accent, PANE_CARD, 0.62)),
    ...cols,
    daily: input.daily,
    peak: input.daily.length > 0 ? `peak ${money(peak)}` : '',
    pace: input.pacePerHour === null || !Number.isFinite(input.pacePerHour) ? null : `${money(Math.max(0, input.pacePerHour))}/h`,
    week: input.week,
    now: input.now,
    offsetMin: input.offsetMin,
    weekLabel: 'Weekly limit',
    weekCaption: cap ? cap.text : 'No weekly limit reading yet',
    weekDanger: cap?.isDanger ?? false,
    weekUsed: input.week ? `${Math.round(Math.max(0, input.week.usedPct))}% used` : null,
    readingAge: input.week ? readingAge : null,
    accent: hex(accent),
  }
}

const svgOpen = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`

// The weekly ring alone, 64 px, on a transparent ground (the native card shows through).
export const RING_SIZE = 64
export const ringBadgeSvg = (week: Week, now: number, offsetMin: number): string => {
  const ring = ringModel(week)
  const c = RING_SIZE / 2
  const tip = `Weekly limit ${ring.pct}% used. ${caption(week, now, offsetMin).text}`
  return (
    svgOpen(RING_SIZE, RING_SIZE) +
    styleTag('') +
    `<g><title>${escape(tip)}</title>${ringSvg({ cx: c, cy: c, r: 27, stroke: 5 }, ring)}</g>` +
    `<text class="m" x="${c}" y="${c + 4.5}" font-size="14" fill="${INK.figure}" text-anchor="middle">${escape(ring.pct)}<tspan fill="${INK.label}" font-size="10">%</tspan></text>` +
    '</svg>'
  )
}
export const ringKey = (week: Week | null, now: number, offsetMin: number): string => JSON.stringify(weekLook(week, now, offsetMin))

// The daily spend line alone: area, line, today's dot, the first and last day under it, a tooltip per day.
export const SPARK_HEIGHT = 62
export const sparkSvg = (daily: readonly PanelDay[], accent: string, width: number): string => {
  const W = Math.round(Math.min(480, Math.max(200, Number.isFinite(width) ? width : 340)))
  const top = 6
  const floor = 44
  const pts = sparkPoints(daily, 3, top, W - 6, floor - top)
  const parts: string[] = [`<path d="M0 ${floor + 0.5}H${W}" stroke="${INK.rule}"/>`]
  if (pts.length > 1) {
    const line = sparkPath(pts)
    parts.push(`<path d="${line}L${n(pts[pts.length - 1]!.x)} ${floor}L${n(pts[0]!.x)} ${floor}Z" fill="url(#ksarea)"/>`)
    parts.push(`<path d="${line}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`)
  }
  const colW = daily.length > 1 ? (W - 6) / (daily.length - 1) : W
  daily.forEach((d, i) => {
    const p = pts[i]!
    const x0 = Math.max(0, p.x - colW / 2)
    const x1 = Math.min(W, p.x + colW / 2)
    parts.push(
      `<g class="day"><title>${escape(`${d.label}: ${money(finite(d.cost))}`)}</title>` +
        `<rect class="hi" x="${n(x0)}" y="0" width="${n(x1 - x0)}" height="${floor + 2}" fill="#fff" pointer-events="all"/></g>`,
    )
  })
  const last = pts[pts.length - 1]
  if (last) parts.push(`<circle cx="${n(last.x)}" cy="${n(last.y)}" r="5.5" fill="${accent}" fill-opacity="0.16"/><circle cx="${n(last.x)}" cy="${n(last.y)}" r="2.6" fill="${accent}" filter="url(#ksglow)"/>`)
  const label = (s: string, x: number, anchor = '') =>
    `<text class="s" x="${n(x)}" y="58" font-size="9.5" fill="${INK.dim}"${anchor}>${escape(fit(s, W / 2 - 4, t => sansWidth(t, 9.5)))}</text>`
  if (daily.length > 0) parts.push(label(daily[0]!.label, 0))
  if (daily.length > 1) parts.push(label(daily[daily.length - 1]!.label, W, ' text-anchor="end"'))
  return (
    svgOpen(W, SPARK_HEIGHT) +
    styleTag('.day .hi{fill-opacity:0;transition:fill-opacity .15s}.day:hover .hi{fill-opacity:.05}') +
    '<defs>' +
    glowFilter('ksglow', 4, 0.4) +
    `<linearGradient id="ksarea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.26"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient>` +
    '</defs>' +
    parts.join('') +
    '</svg>'
  )
}
export const sparkKey = (daily: readonly PanelDay[], accent: string, width: number): string => JSON.stringify([daily, accent, width])

// What a pane redraw is for: everything the pane shows that changes, as one string. The diagnostic line is no part
// of it: it is read afresh at every draw, and asking a redraw for it would chase its own counters.
export const paneKey = (v: PaneView): string =>
  JSON.stringify([v.total, v.meta, v.source, v.rows, v.emptyText, v.peak, v.pace, v.weekCaption, v.weekDanger, v.readingAge, v.accent, ringKey(v.week, v.now, v.offsetMin), v.daily])
