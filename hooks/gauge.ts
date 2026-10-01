import type { Cell } from './led'
import { PALETTE, mix } from './palette'

export const WEEK_MS = 7 * 86400e3

export type Limit = { percentUsed: number; resetsAt?: string }
// usedPct is 0..100; elapsedFrac is how far into the week we are (null when the reset time is unknown).
export type Week = { usedPct: number; elapsedFrac: number | null; resetsAtMs: number | null }
export type Forecast = { projected: number; hasForecast: boolean; isOut: boolean; outInFrac: number | null }
export type Caption = { text: string; short: string; isDanger: boolean }

// A reset time that has already passed means the window this reading described is over, so there is no week to draw until the engine reports the next one.
export const weekFromLimit = (limit: Limit, now: number): Week | null => {
  const resetsAtMs = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  if (Number.isNaN(resetsAtMs)) return { usedPct: limit.percentUsed, elapsedFrac: null, resetsAtMs: null }
  if (resetsAtMs <= now) return null
  const elapsedFrac = Math.max(0, 1 - (resetsAtMs - now) / WEEK_MS) // a reset more than a week away is the start of a week
  return { usedPct: limit.percentUsed, elapsedFrac, resetsAtMs }
}

// Straight line: use so far, divided by the share of the week gone.
export const forecast = (usedPct: number, elapsedFrac: number | null): Forecast => {
  if (usedPct >= 100) return { projected: usedPct, hasForecast: true, isOut: true, outInFrac: 0 }
  if (elapsedFrac === null || elapsedFrac < 0.02 || usedPct <= 0) {
    return { projected: usedPct, hasForecast: false, isOut: false, outInFrac: null }
  }
  const projected = usedPct / elapsedFrac
  const isOut = projected >= 100
  return { projected, hasForecast: true, isOut, outInFrac: isOut ? (elapsedFrac * 100) / usedPct - elapsedFrac : null }
}

// One continuous ramp from cool to red instead of a traffic light.
export const heat = (projectedPct: number): number => {
  const stops: [number, number][] = [
    [55, PALETTE.glacier],
    [85, PALETTE.straw],
    [100, PALETTE.ember],
    [112, PALETTE.signal],
  ]
  if (projectedPct <= stops[0]![0]) return stops[0]![1]
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!
    const [p0, c0] = stops[i - 1]!
    if (projectedPct <= p1) return mix(c0, c1, (projectedPct - p0) / (p1 - p0))
  }
  return PALETTE.signal
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const two = (n: number) => String(n).padStart(2, '0')
// Local day and time from a UTC instant and the machine's offset east of UTC, in minutes.
const local = (ms: number, offsetMin: number) => {
  const d = new Date(Math.round(ms) + offsetMin * 60e3)
  return { day: DAYS[d.getUTCDay()]!, time: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}` }
}

export const caption = (week: Week | null, now: number, offsetMin: number): Caption => {
  if (week === null) return { text: 'No reading yet', short: 'No reading', isDanger: false }
  const f = forecast(week.usedPct, week.elapsedFrac)
  const reset = week.resetsAtMs === null ? null : local(week.resetsAtMs, offsetMin)
  if (week.usedPct >= 100) {
    return { text: reset ? `At limit, resets ${reset.day} ${reset.time}` : 'At limit', short: 'At limit', isDanger: true }
  }
  if (!f.hasForecast) {
    const text = reset ? `Resets ${reset.day} ${reset.time}` : 'No forecast yet'
    return { text, short: text, isDanger: false }
  }
  if (f.isOut) {
    const out = local(now + (f.outInFrac ?? 0) * WEEK_MS, offsetMin)
    const text = `Runs out ${out.day} ${out.time}`
    return { text, short: text, isDanger: true }
  }
  const lands = `Lands near ${Math.round(f.projected)}%`
  return { text: reset ? `${lands}, resets ${reset.day}` : lands, short: lands, isDanger: false }
}

const PARTIAL = [0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589] // 1/8 to 7/8 of a cell, from the left

// One row: the fill, a faint ghost out to where you land, and a notch where the calendar is.
export const gaugeCells = (week: Week | null, width: number): { cells: Cell[]; hue: number } => {
  if (week === null) {
    return { cells: Array.from({ length: width }, (): Cell => [0x20, PALETTE.track, PALETTE.track]), hue: PALETTE.glacier }
  }
  const f = forecast(week.usedPct, week.elapsedFrac)
  const hue = heat(f.projected)
  const ghostColor = mix(PALETTE.panel, hue, 0.3)
  const eighths = (pct: number) => Math.round((Math.min(pct, 100) / 100) * width * 8)
  const used8 = eighths(week.usedPct)
  const ghost8 = Math.max(used8, eighths(f.projected))
  let notchCell = week.elapsedFrac === null ? -1 : Math.min(width - 1, Math.floor(week.elapsedFrac * width))
  if (notchCell === Math.floor(used8 / 8) && used8 % 8 !== 0) notchCell = Math.min(width - 1, notchCell + 1)
  const cells: Cell[] = []
  for (let i = 0; i < width; i++) {
    const lo = i * 8
    const u = Math.min(Math.max(used8 - lo, 0), 8)
    const g = Math.min(Math.max(ghost8 - lo, 0), 8)
    let cell: Cell
    if (u === 8) cell = [0x2588, hue, hue]
    else if (u > 0) cell = [PARTIAL[u - 1]!, hue, g > u ? ghostColor : PALETTE.track]
    else if (g === 8) cell = [0x20, ghostColor, ghostColor]
    else if (g > 0) cell = [PARTIAL[g - 1]!, ghostColor, PALETTE.track]
    else cell = [0x20, PALETTE.track, PALETTE.track]
    if (i === notchCell) cell = [0x258f, PALETTE.notch, cell[0] === 0x2588 ? hue : cell[2]]
    cells.push(cell)
  }
  return { cells, hue }
}

// Only the seven-day window is drawn; any other kind the engine reports is ignored.
export const sevenDay = (limits: readonly (Limit & { kind: string })[]): Limit | undefined => {
  const found = limits.find(l => l.kind === 'seven_day')
  return found ? { percentUsed: found.percentUsed, resetsAt: found.resetsAt } : undefined
}
