// The desktop strip: 48 px of instrument panel above the prompt. A weekly ring, the period's total,
// then a ticker of the models that loops without a seam, carried on from where it was at each redraw.
import { caption } from './gauge'
import type { Week } from './gauge'
import { INK, accentOf, card, cardDefs, glowFilter, hex, styleTag } from './desktop-theme'
import { ringModel, ringSvg } from './ring-svg'
import { clamp01, escape, fit, monoWidth, n, sansWidth } from './svg-util'

export const STRIP_HEIGHT = 48
export const STRIP_MIN_WIDTH = 420
export const STRIP_MAX_WIDTH = 1100

export type TickerCard = { name: string; value: string; share: number; tooltip: string }
export type StripInput = {
  width: number
  title: string // 'today'
  total: string // '$42.18'
  tokens: string // '96M tokens'
  cards: TickerCard[]
  week: Week | null
  now: number
  offsetMin: number
  speedPxPerSec: number
  phasePx: number // how far the ticker has already travelled
  rangeChip: string
  emptyText?: string // in the ticker's place when there are no cards; 'No usage yet' when absent
  diag?: string // a diagnostic line at the end of the ring's tooltip; absent, none
}

// Type scale and the strip's horizontal rhythm.
const PAD = 14
const RING = { r: 12, stroke: 2.5 }
const TOTAL_SIZE = 18
const CAPTION_SIZE = 10
const NAME_SIZE = 9
const NAME_SPACING = 0.6
const VALUE_SIZE = 12.5
const NAME_GAP = 7 // between a card's name and its price
const CARD_GAP = 34 // between cards, the separator dot in the middle
const FADE = 28
const BASE = 25.5 // the baseline every figure in the strip sits on
const CHIP_MIN_STRIP = 540 // the range label only where the ticker can spare the room
const CHIP_SIZE = 10.5

export const stripWidth = (w: number): number =>
  Math.round(Math.min(STRIP_MAX_WIDTH, Math.max(STRIP_MIN_WIDTH, Number.isFinite(w) ? w : STRIP_MIN_WIDTH)))

// One card as laid out on the track.
type Placed = { name: string; value: string; share: number; tooltip: string; x: number; nameW: number; w: number }

export const layoutCards = (cards: readonly TickerCard[]): { placed: Placed[]; contentWidth: number } => {
  let x = 0
  const placed = cards.map(c => {
    const name = fit(c.name.toUpperCase(), 140, s => monoWidth(s, NAME_SIZE, NAME_SPACING))
    const value = fit(c.value, 120, s => monoWidth(s, VALUE_SIZE))
    const nameW = monoWidth(name, NAME_SIZE, NAME_SPACING)
    const w = nameW + (name && value ? NAME_GAP : 0) + monoWidth(value, VALUE_SIZE)
    const p = { name, value, share: clamp01(c.share), tooltip: c.tooltip, x, nameW, w }
    x += w + CARD_GAP
    return p
  })
  return { placed, contentWidth: x }
}

// A crawl that fills at least half the window repeats back to back, like a ticker; a shorter one (a lone
// card, two small ones) is padded to the window so it passes alone instead of stuttering copies of itself.
export const trackWidth = (contentWidth: number, visibleWidth: number): number =>
  contentWidth >= visibleWidth / 2 ? contentWidth : visibleWidth

// Enough copies of the track side by side that the window is always covered, wherever the loop is.
export const tileCount = (track: number, visible: number): number =>
  track > 0 && visible > 0 ? Math.ceil(visible / track) + 1 : 1

export type Motion = { dur: number; begin: number } | null

// Seconds per loop and the (negative) start that resumes a loop already `phasePx` along. Null is a still ticker.
export const tickerMotion = (track: number, speedPxPerSec: number, phasePx: number): Motion => {
  if (!(Number.isFinite(speedPxPerSec) && speedPxPerSec > 0 && Number.isFinite(track) && track > 0)) return null
  const offset = stillOffset(track, phasePx)
  return { dur: track / speedPxPerSec, begin: offset === 0 ? 0 : -offset / speedPxPerSec }
}

// Where a still ticker rests: the phase wrapped into one track.
export const stillOffset = (track: number, phasePx: number): number => {
  if (!(track > 0) || !Number.isFinite(phasePx)) return 0
  return ((phasePx % track) + track) % track
}

const secs = (s: number): string => `${Math.round(s * 1000) / 1000}s`

const CSS =
  `.k .nm{fill:${INK.label};transition:fill .25s}.k:hover .nm{fill:${INK.figure}}` +
  `.k .v{fill:${INK.text};transition:fill .25s}.k:hover .v{fill:#fff}` +
  '.k .sh{opacity:.55;transition:opacity .25s}.k:hover .sh{opacity:1}' +
  '.still{display:none}@media (prefers-reduced-motion:reduce){.moving{display:none}.still{display:inline}}'

const cardMarkup = (c: Placed, accent: string, dx: number): string => {
  const x = c.x + dx
  const bar = Math.max(1.5, c.share * c.w)
  return (
    `<g class="k"><title>${escape(c.tooltip)}</title>` +
    `<rect x="${n(x - 6)}" y="8" width="${n(c.w + 12)}" height="32" fill="#000" fill-opacity="0" pointer-events="all"/>` +
    `<text class="m nm" x="${n(x)}" y="${BASE}" font-size="${NAME_SIZE}" letter-spacing="${NAME_SPACING}">${escape(c.name)}</text>` +
    `<text class="m v" x="${n(x + c.w)}" y="${BASE}" font-size="${VALUE_SIZE}" text-anchor="end">${escape(c.value)}</text>` +
    `<rect x="${n(x)}" y="31.5" width="${n(c.w)}" height="1.5" rx="0.75" fill="#fff" fill-opacity="0.05"/>` +
    `<rect class="sh" x="${n(x)}" y="31.5" width="${n(bar)}" height="1.5" rx="0.75" fill="${accent}"/>` +
    '</g>'
  )
}

const trackMarkup = (placed: readonly Placed[], accent: string, dx: number, track: number): string =>
  placed
    .map((c, i) => {
      const next = i + 1 < placed.length ? placed[i + 1]!.x : track
      const gap = next - (c.x + c.w)
      // The separator sits in the gap; a long gap (a short, padded track) is left empty.
      const dot = gap <= CARD_GAP + 0.5 ? `<circle cx="${n(dx + c.x + c.w + gap / 2)}" cy="${BASE - 4}" r="1.1" fill="${INK.dim}"/>` : ''
      return cardMarkup(c, accent, dx) + dot
    })
    .join('')

export const stripSvg = (input: StripInput): string => {
  const W = stripWidth(input.width)
  const H = STRIP_HEIGHT
  const id = 'us'
  const accent = accentOf(input.week)
  const accentHex = hex(accent)

  // Ring.
  const ring = { cx: PAD + RING.r + RING.stroke / 2, cy: H / 2, r: RING.r, stroke: RING.stroke }
  const cap = caption(input.week, input.now, input.offsetMin)
  const ringTip =
    (input.week === null ? 'Weekly limit: no reading yet' : `Weekly limit ${Math.round(input.week.usedPct)}% used. ${cap.text}`) +
    (input.diag ? `\n${input.diag}` : '')
  const model = input.week ? ringModel(input.week) : null
  const pct = model ? model.pct : '–'
  const ringPart =
    `<g><title>${escape(ringTip)}</title>${ringSvg(ring, model)}` +
    `<text class="m" x="${n(ring.cx)}" y="${n(ring.cy + 3)}" font-size="${pct.length > 2 ? 7 : 8.5}" text-anchor="middle" fill="${model ? INK.text : INK.dim}">${escape(pct)}</text></g>`

  // Total and its caption.
  const x0 = ring.cx + RING.r + RING.stroke / 2 + 12
  const total = fit(input.total, 150, s => monoWidth(s, TOTAL_SIZE))
  const capText = fit([input.title, input.tokens].filter(Boolean).join(' · '), 170, s => sansWidth(s, CAPTION_SIZE))
  const blockW = Math.max(monoWidth(total, TOTAL_SIZE), sansWidth(capText, CAPTION_SIZE))
  const totalPart =
    `<text class="m" x="${n(x0)}" y="${BASE}" font-size="${TOTAL_SIZE}" fill="${INK.figure}" filter="url(#${id}glow)">${escape(total)}</text>` +
    `<text class="s" x="${n(x0)}" y="38.5" font-size="${CAPTION_SIZE}" fill="${INK.label}">${escape(capText)}</text>`

  // The range at the right end, behind its own hairline: a label, not a control (the period button is a native
  // one beside the strip). Dropped on narrow strips, where the ticker needs the room.
  const chipText = W >= CHIP_MIN_STRIP ? fit(input.rangeChip, 110, s => sansWidth(s, CHIP_SIZE)) : ''
  const chipX = W - PAD
  const chipDiv = chipText ? chipX - sansWidth(chipText, CHIP_SIZE) - 14 : W
  const chipPart = chipText
    ? `<path d="M${n(chipDiv)} 13V35" stroke="${INK.rule}"/>` +
      `<text class="s" x="${n(chipX)}" y="28" font-size="${CHIP_SIZE}" text-anchor="end" fill="${INK.label}">${escape(chipText)}</text>`
    : ''

  // Ticker window, between the two hairlines.
  const divX = x0 + blockW + 16
  const tx = divX + 1
  const tEnd = chipText ? chipDiv - 1 : W - 1.5
  const visible = Math.max(0, tEnd - tx)
  const { placed, contentWidth } = layoutCards(input.cards)
  const track = trackWidth(contentWidth, visible)
  const lead = CARD_GAP / 2 + 3 // at phase 0 the separator before the first card sits inside the fade, unseen
  let ticker: string
  if (placed.length === 0) {
    ticker = `<text class="s" x="${n(tx + lead)}" y="${BASE}" font-size="11" fill="${INK.dim}">${escape(input.emptyText ?? 'No usage yet')}</text>`
  } else {
    // At phase 0 the first card sits `lead` in from the left edge; the copies before it fill the edge.
    const phase = input.phasePx - lead
    const copies = tileCount(track, visible)
    const tiles = (offset: number) =>
      Array.from({ length: copies }, (_, k) => trackMarkup(placed, accentHex, tx + k * track - offset, track)).join('')
    const motion = tickerMotion(track, input.speedPxPerSec, phase)
    const still = `<g>${tiles(stillOffset(track, phase))}</g>`
    const inner = motion
      ? `<g class="moving"><g>${tiles(0)}<animateTransform attributeName="transform" type="translate" from="0 0" to="${n(-track)} 0" dur="${secs(motion.dur)}" begin="${secs(motion.begin)}" repeatCount="indefinite"/></g></g><g class="still">${still}</g>`
      : still
    ticker = `<g clip-path="url(#${id}clip)" mask="url(#${id}fade)">${inner}</g>`
  }

  const defs =
    '<defs>' +
    cardDefs(id, W) +
    glowFilter(`${id}glow`, 3.2, 0.42) +
    `<clipPath id="${id}clip"><rect x="${n(tx)}" y="1" width="${n(visible)}" height="${H - 2}"/></clipPath>` +
    `<linearGradient id="${id}fadeg" x1="${n(tx)}" y1="0" x2="${n(tEnd)}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#000"/><stop offset="${n(FADE / Math.max(visible, 1))}" stop-color="#fff"/>` +
    `<stop offset="${n(1 - FADE / Math.max(visible, 1))}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<mask id="${id}fade" maskUnits="userSpaceOnUse" x="${n(tx)}" y="0" width="${n(visible)}" height="${H}"><rect x="${n(tx)}" y="0" width="${n(visible)}" height="${H}" fill="url(#${id}fadeg)"/></mask>` +
    '</defs>'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    styleTag(CSS) +
    defs +
    card(id, W, H, 10) +
    ringPart +
    totalPart +
    `<path d="M${n(divX)} 13V35" stroke="${INK.rule}"/>` +
    ticker +
    chipPart +
    '</svg>'
  )
}

export const stripAlt = (input: StripInput): string => {
  const cap = caption(input.week, input.now, input.offsetMin)
  const models = input.cards.map(c => `${c.name} ${c.value}`).join(', ')
  return [`${input.total} ${input.title}, ${input.tokens}`, models, input.week ? `weekly limit ${Math.round(input.week.usedPct)}% used, ${cap.text}` : '']
    .filter(Boolean)
    .join('. ')
}
