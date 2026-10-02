export const ACCEL = 30 // px/s^2 speeding up
export const DECEL = 20 // px/s^2 slowing down

export type Scroll = { offset: number; v: number }

// Starts with the first card just past the soft left edge, `lead` pixels in, standing still.
export const newScroll = (lead: number): Scroll => ({ offset: -lead, v: 0 })

// Where the same spot is once the strip has been rebuilt at another length: the same share of the way round.
// Whole laps are dropped, so the result lies inside the new strip. An empty strip, or one that kept its length, leaves the offset alone.
export const remapOffset = (offset: number, oldLength: number, newLength: number): number => {
  if (oldLength <= 0 || newLength <= 0 || oldLength === newLength) return offset
  const position = ((offset % oldLength) + oldLength) % oldLength
  return (position * newLength) / oldLength
}

// Eases the speed toward `target` (pixels a second) and moves the strip. It never stops on its own.
export const stepScroll = (s: Scroll, dt: number, target: number): Scroll => {
  const step = Math.min(dt, 0.5) // a stalled timer must not fling the strip
  const want = Number.isFinite(target) && target > 0 ? target : 0
  s.v = s.v < want ? Math.min(want, s.v + ACCEL * step) : Math.max(want, s.v - DECEL * step)
  s.offset += s.v * step
  return s
}
