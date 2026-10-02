// The weekly ring, shared by the strip (small) and the panel (large): the fill is what is used, a faint
// ghost runs on to where the week lands (never past a full turn), and a notch marks where the calendar is.
import { forecast } from './gauge'
import type { Week } from './gauge'
import { INK, accentOf, hex } from './desktop-theme'
import { arcPath, clamp01, n, polar } from './svg-util'

export type RingModel = { fill: number; ghost: number; notch: number | null; accent: number; pct: string }

export const ringModel = (week: Week): RingModel => {
  const f = forecast(week.usedPct, week.elapsedFrac)
  const fill = clamp01(week.usedPct / 100)
  return {
    fill,
    ghost: f.hasForecast ? Math.max(fill, clamp01(f.projected / 100)) : fill,
    notch: week.elapsedFrac === null ? null : clamp01(week.elapsedFrac),
    accent: accentOf(week),
    pct: String(Math.round(Math.max(0, week.usedPct))),
  }
}

// Degrees on screen, clockwise from three o'clock, as SVG measures them: twelve o'clock is -90.
export const notchAngle = (frac: number): number => -90 + 360 * clamp01(frac)

export type RingSize = { cx: number; cy: number; r: number; stroke: number }

export const ringSvg = ({ cx, cy, r, stroke }: RingSize, ring: RingModel | null): string => {
  const track = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${INK.track}" stroke-width="${n(stroke)}"${ring ? '' : ' stroke-opacity="0.7"'}/>`
  if (ring === null) return track
  const accent = hex(ring.accent)
  const arc = (from: number, to: number, color: string, extra = '') => {
    const d = arcPath(cx, cy, r, from, to)
    return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(stroke)}" stroke-linecap="round"${extra}/>` : ''
  }
  let notch = ''
  if (ring.notch !== null) {
    const a = polar(cx, cy, r - stroke * 0.95, ring.notch)
    const b = polar(cx, cy, r + stroke * 0.95, ring.notch)
    const d = `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`
    notch = `<path d="${d}" stroke="${INK.cardBottom}" stroke-width="${n(Math.max(2.6, stroke * 0.7))}" stroke-linecap="round"/><path d="${d}" stroke="${INK.notch}" stroke-width="${n(Math.max(1.2, stroke * 0.3))}" stroke-linecap="round"/>`
  }
  return track + arc(ring.fill, ring.ghost, accent, ' stroke-opacity="0.3"') + arc(0, ring.fill, accent) + notch
}
