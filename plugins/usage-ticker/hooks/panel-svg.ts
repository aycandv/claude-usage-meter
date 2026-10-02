// The docked detail card: the period's total, a bar per model, two weeks of daily spend, and the weekly
// limit in words. The period tabs are native buttons laid over the top 40 px, so that band holds no drawing.
import { caption } from './gauge'
import type { Week } from './gauge'
import { money } from './cards'
import { INK, accentOf, card, cardDefs, glowFilter, hex, styleTag } from './desktop-theme'
import { ringModel, ringSvg } from './ring-svg'
import { escape, fit, monoWidth, n, sansWidth } from './svg-util'

export const PANEL_MIN_WIDTH = 360
export const PANEL_MAX_WIDTH = 480
export const PANEL_MAX_HEIGHT = 520
export const PANEL_HEADER = 40

export type PanelModel = { name: string; value: string; cost: number; tooltip: string; detail?: string } // detail: '71M · 75%'
export type PanelDay = { label: string; cost: number }
export type PanelInput = {
  width: number
  title: string
  total: string
  tokens: string
  range: string // 'since Oct 11'
  models: PanelModel[] // already capped, an 'N others' row included
  daily: PanelDay[] // oldest first, today last
  week: Week | null
  now: number
  offsetMin: number
  pacePerHour: number | null
  source: string // 'Prices are ccusage estimates'
  // Room left at the top for native tabs laid over the card; 0 when they sit above it. PANEL_HEADER when absent.
  header?: number
  emptyText?: string // in the rows' place when there are no models; 'No usage <title>' when absent
  diag?: string // a diagnostic line, small, at the foot of the card; absent, none
}

const PAD = 20
const TOTAL_SIZE = 30
const SECTION_SIZE = 10.5
const ROW_SIZE = 12
const BAR_H = 4
const RING = { r: 27, stroke: 5 }

export const panelWidth = (w: number): number =>
  Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number.isFinite(w) ? w : PANEL_MIN_WIDTH)))

const finite = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0)

// Bar lengths as a share of the biggest model; a model that cost anything shows at least a dot.
export const barFractions = (models: readonly PanelModel[]): number[] => {
  const top = Math.max(0, ...models.map(m => finite(m.cost)))
  return models.map(m => (top > 0 ? finite(m.cost) / top : 0))
}

export type Point = { x: number; y: number }

// Each day's point: evenly spaced across the box, the highest day touching its top, nothing below its floor.
export const sparkPoints = (daily: readonly PanelDay[], x: number, y: number, w: number, h: number): Point[] => {
  const top = Math.max(0, ...daily.map(d => finite(d.cost)))
  const step = daily.length > 1 ? w / (daily.length - 1) : 0
  return daily.map((d, i) => ({
    x: daily.length > 1 ? x + i * step : x + w,
    y: y + h - (top > 0 ? (finite(d.cost) / top) * h : 0),
  }))
}

// A smooth line through the points that never swings past them (monotone cubic, Fritsch and Carlson),
// so a quiet day never dips below the floor.
export const sparkPath = (pts: readonly Point[]): string => {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`
  const k = pts.length
  const slope: number[] = []
  for (let i = 0; i < k - 1; i++) slope.push((pts[i + 1]!.y - pts[i]!.y) / (pts[i + 1]!.x - pts[i]!.x || 1))
  const t: number[] = pts.map((_, i) => {
    if (i === 0) return slope[0]!
    if (i === k - 1) return slope[k - 2]!
    const a = slope[i - 1]!
    const b = slope[i]!
    return a * b <= 0 ? 0 : (a + b) / 2
  })
  for (let i = 0; i < k - 1; i++) {
    const m = slope[i]!
    if (m === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i]! / m
    const b = t[i + 1]! / m
    const s = a * a + b * b
    if (s > 9) {
      t[i] = (3 / Math.sqrt(s)) * a * m
      t[i + 1] = (3 / Math.sqrt(s)) * b * m
    }
  }
  let d = `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`
  for (let i = 0; i < k - 1; i++) {
    const p = pts[i]!
    const q = pts[i + 1]!
    const dx = (q.x - p.x) / 3
    d += `C${n(p.x + dx)} ${n(p.y + t[i]! * dx)} ${n(q.x - dx)} ${n(q.y - t[i + 1]! * dx)} ${n(q.x)} ${n(q.y)}`
  }
  return d
}

const CSS =
  `.row .nm{fill:${INK.text};transition:fill .2s}.row:hover .nm{fill:${INK.figure}}` +
  '.row .bar{opacity:.8;transition:opacity .2s}.row:hover .bar{opacity:1}' +
  '.day .hi{fill-opacity:0;transition:fill-opacity .15s}.day:hover .hi{fill-opacity:.05}' +
  '.day .pt{opacity:0;transition:opacity .15s}.day:hover .pt{opacity:1}'

type T = { x: number; y: number; size: number; cls: string; fill: string; anchor?: 'end' | 'middle'; extra?: string }
// `inner` is markup already escaped (tspans); plain strings go through `text`.
const textRaw = (t: T, inner: string): string =>
  `<text class="${t.cls}" x="${n(t.x)}" y="${n(t.y)}" font-size="${t.size}" fill="${t.fill}"${t.anchor ? ` text-anchor="${t.anchor}"` : ''}${t.extra ?? ''}>${inner}</text>`
const text = (t: T, s: string): string => textRaw(t, escape(s))
const span = (s: string, fill: string, mono = false): string => `<tspan${mono ? ' class="m"' : ''} fill="${fill}">${escape(s)}</tspan>`

const ID = 'up'
const BOTTOM_PAD = 22

// Row and chart heights, roomiest first; the first that keeps the card under the cap is used.
export const DENSITIES = [
  { rowH: 28, chartH: 48 },
  { rowH: 25, chartH: 44 },
  { rowH: 23, chartH: 40 },
  { rowH: 21, chartH: 32 },
] as const

// Everything but the card, from the top down; `bottom` is where the last section ends.
const body = (input: PanelInput, W: number, rowH: number, chartH: number): { parts: string[]; bottom: number } => {
  const id = ID
  const accentHex = hex(accentOf(input.week))
  const L = PAD
  const R = W - PAD
  const inner = R - L
  const parts: string[] = []

  // Under the tabs: the total, with its tokens and range on the same baseline at the right.
  const header = Math.max(0, Number.isFinite(input.header) ? input.header! : PANEL_HEADER)
  if (header > 0) parts.push(`<path d="M${L} ${n(header + 0.5)}H${R}" stroke="${INK.rule}"/>`)
  let y = header
  const heroBase = y + (header > 0 ? 46 : 44)
  const total = fit(input.total, inner * 0.62, s => monoWidth(s, TOTAL_SIZE))
  parts.push(text({ x: L, y: heroBase, size: TOTAL_SIZE, cls: 'm', fill: INK.figure, extra: ` filter="url(#${id}glow)"` }, total))
  const room = inner - monoWidth(total, TOTAL_SIZE) - 18
  const range = fit(input.range, room / 2, s => sansWidth(s, 11))
  const tokens = fit(input.tokens, room - sansWidth(` · ${range}`, 11), s => monoWidth(s, 11))
  const meta = [tokens && span(tokens, INK.text, true), range && span(`${tokens ? ' · ' : ''}${range}`, INK.label)].filter(Boolean).join('')
  if (meta) parts.push(textRaw({ x: R, y: heroBase, size: 11, cls: 's', fill: INK.label, anchor: 'end' }, meta))
  y = heroBase + 26

  const section = (label: string, right = '') => {
    parts.push(text({ x: L, y: y + 10, size: SECTION_SIZE, cls: 's', fill: INK.label }, label))
    if (right) parts.push(textRaw({ x: R, y: y + 10, size: SECTION_SIZE, cls: 's', fill: INK.dim, anchor: 'end' }, right))
    y += 20
  }

  // One line per model: name, a bar scaled to the biggest, the price.
  section('By model', escape(fit(input.source, inner * 0.55, s => sansWidth(s, SECTION_SIZE))))
  if (input.models.length === 0) {
    parts.push(text({ x: L, y: y + rowH / 2 + 4, size: ROW_SIZE, cls: 's', fill: INK.dim }, input.emptyText ?? `No usage ${input.title}`))
    y += rowH
  } else {
    const fr = barFractions(input.models)
    const values = input.models.map(m => fit(m.value, inner * 0.3, s => monoWidth(s, ROW_SIZE)))
    const valueCol = Math.max(...values.map(v => monoWidth(v, ROW_SIZE)))
    const names = input.models.map(m => fit(m.name, inner * 0.36, s => sansWidth(s, ROW_SIZE)))
    const nameCol = Math.max(...names.map(s => sansWidth(s, ROW_SIZE)))
    const barX = L + nameCol + 14
    const barMax = Math.max(0, R - valueCol - 14 - barX)
    input.models.forEach((m, i) => {
      const base = y + rowH / 2 + 4
      const barW = fr[i]! > 0 ? Math.max(BAR_H, fr[i]! * barMax) : 0
      parts.push(
        `<g class="row"><title>${escape(m.tooltip)}</title>` +
          `<rect x="${L}" y="${n(y)}" width="${n(inner)}" height="${rowH}" fill="#000" fill-opacity="0" pointer-events="all"/>` +
          text({ x: L, y: base, size: ROW_SIZE, cls: 's nm', fill: INK.text }, names[i]!) +
          `<rect x="${n(barX)}" y="${n(base - 6)}" width="${n(barMax)}" height="${BAR_H}" rx="${BAR_H / 2}" fill="#fff" fill-opacity="0.04"/>` +
          (barW > 0 ? `<rect class="bar" x="${n(barX)}" y="${n(base - 6)}" width="${n(barW)}" height="${BAR_H}" rx="${BAR_H / 2}" fill="url(#${id}bar)"/>` : '') +
          text({ x: R, y: base, size: ROW_SIZE, cls: 'm', fill: INK.figure, anchor: 'end' }, values[i]!) +
          '</g>',
      )
      y += rowH
    })
  }
  y += 18

  // Daily spend, today last.
  const days = input.daily
  const peak = Math.max(0, ...days.map(d => finite(d.cost)))
  section(days.length > 0 ? `Last ${days.length} ${days.length === 1 ? 'day' : 'days'}` : 'Daily', days.length > 0 ? `peak ${span(money(peak), INK.label, true)}` : '')
  if (days.length === 0) {
    parts.push(text({ x: L, y: y + 10, size: ROW_SIZE, cls: 's', fill: INK.dim }, 'No daily history yet'))
    y += 18
  } else {
    const top = y + 6
    const pts = sparkPoints(days, L + 3, top, inner - 6, chartH - 6)
    const floor = top + chartH - 6
    const line = sparkPath(pts)
    const first = pts[0]!
    const last = pts[pts.length - 1]!
    parts.push(`<path d="M${L} ${n(floor + 0.5)}H${R}" stroke="${INK.rule}"/>`)
    if (pts.length > 1) {
      parts.push(`<path d="${line}L${n(last.x)} ${n(floor)}L${n(first.x)} ${n(floor)}Z" fill="url(#${id}area)"/>`)
      parts.push(`<path d="${line}" fill="none" stroke="${accentHex}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
    const colW = days.length > 1 ? (inner - 6) / (days.length - 1) : inner
    days.forEach((d, i) => {
      const p = pts[i]!
      const x0 = Math.max(L, p.x - colW / 2)
      const x1 = Math.min(R, p.x + colW / 2)
      parts.push(
        `<g class="day"><title>${escape(`${d.label}: ${money(finite(d.cost))}`)}</title>` +
          `<rect class="hi" x="${n(x0)}" y="${n(top - 6)}" width="${n(x1 - x0)}" height="${chartH + 2}" fill="#fff" pointer-events="all"/>` +
          (i < days.length - 1 ? `<circle class="pt" cx="${n(p.x)}" cy="${n(p.y)}" r="2" fill="${INK.figure}"/>` : '') +
          '</g>',
      )
    })
    parts.push(
      `<circle cx="${n(last.x)}" cy="${n(last.y)}" r="5.5" fill="${accentHex}" fill-opacity="0.16"/>` +
        `<circle cx="${n(last.x)}" cy="${n(last.y)}" r="2.6" fill="${accentHex}" filter="url(#${id}glow)"/>`,
    )
    y = floor + 4
    const lab = (s: string, x: number, anchor?: 'end') => text({ x, y: y + 10, size: 9.5, cls: 's', fill: INK.dim, anchor }, fit(s, inner / 2 - 4, t => sansWidth(t, 9.5)))
    parts.push(lab(days[0]!.label, L))
    if (days.length > 1) parts.push(lab(days[days.length - 1]!.label, R, 'end'))
    y += 14
  }
  y += 16

  // The week, in a ring and in words.
  parts.push(`<path d="M${L} ${n(y + 0.5)}H${R}" stroke="${INK.rule}"/>`)
  y += 18
  if (input.week === null) {
    parts.push(text({ x: L, y: y + 12, size: ROW_SIZE, cls: 's', fill: INK.label }, 'No weekly limit reading yet'))
    y += 18
  } else {
    const ring = ringModel(input.week)
    const cap = caption(input.week, input.now, input.offsetMin)
    const size = RING.r * 2 + RING.stroke
    const cx = L + size / 2
    const cy = y + size / 2
    parts.push(`<g><title>${escape(`Weekly limit ${ring.pct}% used. ${cap.text}`)}</title>${ringSvg({ cx, cy, r: RING.r, stroke: RING.stroke }, ring)}</g>`)
    parts.push(textRaw({ x: cx, y: cy + 4.5, size: 14, cls: 'm', fill: INK.figure, anchor: 'middle' }, `${escape(ring.pct)}<tspan fill="${INK.label}" font-size="10">%</tspan>`))
    const tx = L + size + 18
    const room = R - tx
    const hasPace = input.pacePerHour !== null && Number.isFinite(input.pacePerHour)
    const top = cy - (hasPace ? 27 : 17)
    parts.push(text({ x: tx, y: top + 10, size: SECTION_SIZE, cls: 's', fill: INK.label }, 'Weekly limit'))
    parts.push(text({ x: tx, y: top + 30, size: 14, cls: 's', fill: cap.isDanger ? accentHex : INK.figure }, fit(cap.text, room, s => sansWidth(s, 14))))
    if (hasPace) {
      const pace = `${money(Math.max(0, input.pacePerHour!))}/h`
      parts.push(textRaw({ x: tx, y: top + 50, size: 11, cls: 's', fill: INK.label }, `Pace ${span(pace, INK.text, true)}`))
    }
    y += size
  }
  if (input.diag) {
    // One line, or two when it is too long: the counters, then from ', last:' on.
    const cut = input.diag.indexOf(', last:')
    const lines = monoWidth(input.diag, 9) <= inner || cut < 0 ? [input.diag] : [input.diag.slice(0, cut), input.diag.slice(cut + 2)]
    y += 11
    for (const line of lines) {
      y += 12
      parts.push(text({ x: L, y, size: 9, cls: 'm', fill: INK.dim }, fit(line, inner, s => monoWidth(s, 9))))
    }
    y += 2
  }
  return { parts, bottom: y }
}

// The height the card takes and the density it settles on.
export const panelLayout = (input: PanelInput): { height: number; bottom: number; rowH: number; chartH: number } => {
  const W = panelWidth(input.width)
  for (const d of DENSITIES) {
    const { bottom } = body(input, W, d.rowH, d.chartH)
    if (bottom + BOTTOM_PAD <= PANEL_MAX_HEIGHT || d === DENSITIES[DENSITIES.length - 1]) {
      return { height: Math.min(PANEL_MAX_HEIGHT, Math.ceil(bottom + BOTTOM_PAD)), bottom, rowH: d.rowH, chartH: d.chartH }
    }
  }
  throw new Error('unreachable')
}

export const panelSvg = (input: PanelInput): string => {
  const W = panelWidth(input.width)
  const id = ID
  const accent = accentOf(input.week)
  const accentHex = hex(accent)
  const { height: H, rowH, chartH } = panelLayout(input)
  const drawn = body(input, W, rowH, chartH)

  const defs =
    '<defs>' +
    cardDefs(id, W) +
    glowFilter(`${id}glow`, 4, 0.4) +
    `<linearGradient id="${id}bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accentHex}"/><stop offset="1" stop-color="${accentHex}" stop-opacity="0.45"/></linearGradient>` +
    `<linearGradient id="${id}area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accentHex}" stop-opacity="0.26"/><stop offset="1" stop-color="${accentHex}" stop-opacity="0"/></linearGradient>` +
    '</defs>'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    styleTag(CSS) +
    defs +
    card(id, W, H, 14) +
    drawn.parts.join('') +
    '</svg>'
  )
}

export const panelAlt = (input: PanelInput): string => {
  const cap = caption(input.week, input.now, input.offsetMin)
  return [
    `${input.total} ${input.title}, ${input.tokens}, ${input.range}`,
    input.models.map(m => `${m.name} ${m.value}`).join(', '),
    input.week ? `weekly limit ${Math.round(input.week.usedPct)}% used, ${cap.text}` : 'no weekly limit reading yet',
  ]
    .filter(Boolean)
    .join('. ')
}
