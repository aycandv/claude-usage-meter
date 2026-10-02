// From the module's state to what the desktop draws: the strip's and the panel's inputs, their widths, the
// ticker's quantized speed and travelled distance, and the keys that say when a redraw is due. Pure.
import { capModels, dayTotal, modelSums, money, tok } from './cards'
import type { Day, DayEntry, ModelSum, SpendState } from './cards'
import { caption } from './gauge'
import type { Week } from './gauge'
import type { PanelDay, PanelInput, PanelModel } from './panel-svg'
import { aggregate, cardTitle, rangeFor } from './periods'
import type { Period } from './periods'
import type { StripInput, TickerCard } from './strip-svg'
import { STRIP_MAX_WIDTH, STRIP_MIN_WIDTH } from './strip-svg'
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from './panel-svg'
import { isoDate } from './zone'

export type DesktopState = {
  days: DayEntry[]
  spend: SpendState
  period: Period
  rangeLabel: string
  week: Week | null
  now: number
  offsetMin: number
  pacePerHour: number
}

export const PX_PER_COLUMN = 7.25 // the desktop's code-font advance, as measured on the owner's app
export const STRIP_RESERVED_PX = 190 // the period and Details buttons beside the strip, with the gaps
const DEFAULT_COLUMNS = 106 // the owner's band, when the surface has not measured yet
export const PANEL_DEFAULT_WIDTH = 400
const PANEL_INSET_PX = 16
export const DAILY_DAYS = 14
export const SOURCE = 'Prices are ccusage estimates'

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const usable = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0

export const stripWidthFor = (columns: number | undefined): number =>
  clamp(Math.round((usable(columns) ? columns : DEFAULT_COLUMNS) * PX_PER_COLUMN) - STRIP_RESERVED_PX, STRIP_MIN_WIDTH, STRIP_MAX_WIDTH)

export const panelWidthFor = (columns: number | undefined): number =>
  usable(columns) ? clamp(Math.round(columns * PX_PER_COLUMN) - PANEL_INSET_PX, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH) : PANEL_DEFAULT_WIDTH

// The desktop ticker moves at one speed. A change of speed cannot be smooth in an SVG animation (the frame takes
// new markup and its animation starts over), so pace, turns and idling never touch it; the panel shows the pace.
// 12 px/s is about one and a half monospace characters a second at the ticker's 12.5 px values: calm enough to
// read a card as it passes, quick enough to be seen moving, and a 580 px strip turns over in about half a minute.
export const DESK_SPEED = 12

// Where the ticker is at `t`: the speed times the time since the crawl began (`start`). Derived, never summed.
export const phaseAt = (start: number, t: number): number => (DESK_SPEED * Math.max(0, t - start)) / 1000

// An estimate, to tune: how long after the markup is handed over the desktop's frame starts its SMIL clock.
// The begin offset is computed for that moment, so a reloaded frame picks up where the old one would be.
export const FRAME_LATENCY_MS = 150
export const framePhase = (start: number, now: number): number => phaseAt(start, now + FRAME_LATENCY_MS)

// When new figures may replace the strip on screen. Every new drawing reloads the surface's frame (a blink, and
// the ticker restarts), so: what the person did (a period, a tab, a resize, the first drawing) at once; a
// placeholder ("Reading usage…") and the first weekly reading into an empty ring at once; anything else never
// while a turn runs, only after 15 s of quiet, and
// at most once in five minutes.
export const DEFER_IDLE_MS = 15_000
export const DEFER_MIN_GAP_MS = 5 * 60_000
export type RedrawAsk = {
  working: boolean
  userInitiated: boolean
  keyChanged: boolean
  lastDrawAt: number | null
  idleSince: number | null // when the last turn ended (null while one runs)
  now: number
  showsPlaceholder: boolean
  firstReading: boolean // the ring on screen is empty and a weekly reading has arrived
  percentMoved: boolean // the ring's whole percent differs from the one on screen
}

// A new whole percent on the ring is worth a quicker redraw than other figures: after the turn, 3 s of quiet,
// and at least 60 s since the last drawing.
export const FAST_IDLE_MS = 3_000
export const FAST_GAP_MS = 60_000
export const redrawDue = (a: RedrawAsk): boolean => {
  if (!a.keyChanged) return false
  if (a.userInitiated || a.showsPlaceholder || a.firstReading || a.lastDrawAt === null) return true
  if (a.working || a.idleSince === null) return false
  if (a.percentMoved && a.now - a.idleSince >= FAST_IDLE_MS && a.now - a.lastDrawAt >= FAST_GAP_MS) return true
  if (a.now - a.idleSince < DEFER_IDLE_MS) return false
  return a.now - a.lastDrawAt >= DEFER_MIN_GAP_MS
}

// One drawing per key: while the key holds, every render hands back the identical markup (and the phase
// baked into it), so the surface has nothing new to load.
export type Memo<V> = { key: string; value: V }
export const memoMarkup = <V>(prev: Memo<V> | null, key: string, build: () => V): Memo<V> =>
  prev !== null && prev.key === key ? prev : { key, value: build() }

// The desktop's picture of time moves in ten minute steps: the week's caption ("Runs out Sat 22:00" drifts by
// the minute), its notch and the day boundary, so the clock alone never reloads the strip more often than that.
export const DESK_CLOCK_MS = 10 * 60_000
export const deskClock = (now: number): number => Math.floor(now / DESK_CLOCK_MS) * DESK_CLOCK_MS

// The pace as the panel shows it: to the half dollar, and nothing when there is none to speak of.
export const paceShown = (usdPerHour: number): number | null => {
  const half = Number.isFinite(usdPerHour) ? Math.round(usdPerHour * 2) / 2 : 0
  return half > 0 ? half : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The last `n` local days up to `todayIso`, oldest first, each with its spend; a day ccusage has no entry for is zero.
export const dailySeries = (days: readonly DayEntry[], todayIso: string, n = DAILY_DAYS): PanelDay[] => {
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso) || Number.isNaN(today)) return []
  const byDay = new Map(days.map(d => [d.period, dayTotal(d)]))
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today - (n - 1 - i) * 86400e3)
    const iso = isoDate(d.getTime(), 0)
    const cost = byDay.get(iso)
    return { label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, cost: typeof cost === 'number' && Number.isFinite(cost) ? cost : 0 }
  })
}

// The period's days added up, from the days already read.
const periodDay = (s: DesktopState): Day => {
  const { since, until } = rangeFor(s.period, s.now, s.offsetMin, s.week?.resetsAtMs ?? null)
  return aggregate(s.days, since, until)
}

type Shown = { total: string; tokens: string; models: ModelSum[]; totalCost: number; emptyText?: string }

const shown = (s: DesktopState): Shown => {
  if (s.spend === 'loading') return { total: '…', tokens: 'loading', models: [], totalCost: 0, emptyText: 'Reading usage…' }
  if (s.spend === 'failed') return { total: '–', tokens: 'usage unavailable', models: [], totalCost: 0, emptyText: 'Usage unavailable' }
  const day = periodDay(s)
  const models = modelSums(day)
  const { shown: top, others } = capModels(models)
  const totalCost = dayTotal(day)
  return { total: money(totalCost), tokens: `${tok(models.reduce((sum, m) => sum + m.tokens, 0))} tokens`, models: others ? [...top, others] : top, totalCost }
}

const shareOf = (m: ModelSum, total: number) => (total > 0 && Number.isFinite(m.cost) ? Math.min(1, Math.max(0, m.cost / total)) : 0)
const percent = (share: number) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`)
const tooltip = (m: ModelSum, total: number, title: string) => `${m.name}: ${money(m.cost)}, ${tok(m.tokens)} tokens, ${percent(shareOf(m, total))} of ${title}`

export const tickerCards = (s: DesktopState): TickerCard[] => {
  const v = shown(s)
  const title = cardTitle(s.period)
  return v.models.map(m => ({ name: m.name, value: money(m.cost), share: shareOf(m, v.totalCost), tooltip: tooltip(m, v.totalCost, title) }))
}

export const stripInput = (s: DesktopState, width: number, phasePx: number): StripInput => {
  const v = shown(s)
  return {
    width,
    title: cardTitle(s.period),
    total: v.total,
    tokens: v.tokens,
    cards: tickerCards(s),
    week: s.week,
    now: s.now,
    offsetMin: s.offsetMin,
    speedPxPerSec: DESK_SPEED,
    phasePx,
    rangeChip: s.rangeLabel,
    ...(v.emptyText ? { emptyText: v.emptyText } : {}),
  }
}

export const panelInput = (s: DesktopState, width: number): PanelInput => {
  const v = shown(s)
  const title = cardTitle(s.period)
  const models: PanelModel[] = v.models.map(m => ({
    name: m.name,
    value: money(m.cost),
    cost: m.cost,
    tooltip: tooltip(m, v.totalCost, title),
    detail: `${tok(m.tokens)} · ${percent(shareOf(m, v.totalCost))}`,
  }))
  return {
    width,
    title,
    total: v.total,
    tokens: v.tokens,
    range: s.rangeLabel,
    models,
    daily: dailySeries(s.days, isoDate(s.now, s.offsetMin)),
    week: s.week,
    now: s.now,
    offsetMin: s.offsetMin,
    pacePerHour: paceShown(s.pacePerHour),
    source: SOURCE,
    header: 0, // the tabs are native buttons above the card
    ...(v.emptyText ? { emptyText: v.emptyText } : {}),
  }
}

// What the week looks like at the resolution the drawings show it: the caption, the used percent, the notch.
export const weekLook = (week: Week | null, now: number, offsetMin: number) =>
  week === null ? null : [caption(week, now, offsetMin).text, Math.round(week.usedPct), week.elapsedFrac === null ? null : Math.round(week.elapsedFrac * 100)]

// What the strip shows, part by part, give or take the ticker's position. Equal parts draw the same picture.
export const STRIP_PARTS = ['width', 'period', 'total', 'cards', 'range', 'week', 'percent'] as const
export type StripPart = (typeof STRIP_PARTS)[number]
export const stripKeyParts = (i: StripInput): Record<StripPart, unknown> => ({
  width: i.width,
  period: i.title,
  total: [i.total, i.tokens],
  cards: [i.cards, i.emptyText ?? ''],
  range: i.rangeChip,
  week: i.week === null ? null : [caption(i.week, i.now, i.offsetMin).text, i.week.elapsedFrac === null ? null : Math.round(i.week.elapsedFrac * 100)],
  percent: i.week === null ? null : Math.round(i.week.usedPct), // the ring's figure, apart from the clock's drift
})

// The ring's whole percent moved between two readings (a first reading has its own rule).
export const percentMoved = (shown: Record<StripPart, unknown> | null, next: Record<StripPart, unknown>): boolean =>
  shown !== null && shown.percent !== null && next.percent !== null && shown.percent !== next.percent

// How old the weekly reading is: the engine's figures are those of this session's last response, so they go stale
// while it is idle, whatever other sessions spend. From when it was received, not when it was drawn.
export const readingAge = (now: number, readAt: number | null): string | null => {
  if (readAt === null) return null
  const min = Math.floor(Math.max(0, now - readAt) / 60_000)
  if (min < 1) return 'reading just now'
  if (min < 90) return `reading ${min} min ago`
  return `reading ${Math.round(min / 6) / 10} h ago`
}

// The empty ring on screen meets its first weekly reading (the desktop often has none until the first response).
export const firstReading = (shown: Record<StripPart, unknown> | null, next: Record<StripPart, unknown>): boolean =>
  shown !== null && shown.week === null && next.week !== null

// A redraw is due only when the key moves.
export const stripKey = (i: StripInput): string => JSON.stringify(stripKeyParts(i))

// Which parts changed between two drawings, for the diagnostic line: 'total+cards', 'period+total+cards+range', or 'none'.
export const reasonFor = (prev: Record<StripPart, unknown> | null, next: Record<StripPart, unknown>): string => {
  if (prev === null) return 'none'
  const changed = STRIP_PARTS.filter(p => JSON.stringify(prev[p]) !== JSON.stringify(next[p]))
  return changed.length > 0 ? changed.join('+') : 'none'
}

export type Diag = { renders: number; changes: number; invalidates: number; reason: string }
export const diagLine = (d: Diag): string => `diag r${d.renders} c${d.changes} i${d.invalidates} last: ${d.reason}`
