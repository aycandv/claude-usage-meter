// When the board acts. The decisions are plain functions of their inputs so that the clock stays in register.tsx.

// A repaint the engine refused (the band is being resized, or is hidden) is not tried again for this long,
// so a refusal that lasts is asked about twice a second rather than twenty times.
export const RETRY_MS = 500

type PaintState = {
  px: number // the pixel the crawl is at now
  lastPx: number | null // the pixel last painted; null before the first paint
  dirty: boolean // something besides the crawl changed since then
  now: number
  retryAt: number // not before this time
}

export const paintDue = ({ px, lastPx, dirty, now, retryAt }: PaintState): boolean => now >= retryAt && (dirty || px !== lastPx)

type SpendState = {
  wanted: boolean // a turn finished since the last refresh
  now: number
  lastAt: number // when the last refresh began
  minGapMs: number
}

export const spendDue = ({ wanted, now, lastAt, minGapMs }: SpendState): boolean => wanted && now - lastAt >= minGapMs
