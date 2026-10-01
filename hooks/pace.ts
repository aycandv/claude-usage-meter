// How fast the crawl slides. It always moves: a slow drift when nothing is happening,
// faster the quicker money is being spent, and never below a visible floor while a turn runs.
export const IDLE_PX_S = 6 // about one character a second
export const WORKING_FLOOR_PX_S = 14 // so the crawl visibly picks up the moment a turn starts
export const MAX_PX_S = 44 // about seven characters a second

const PACE_SCALE = 9.5 // px/s gained per natural-log step of pace
const PACE_KNEE = 4 // dollars an hour at which the curve starts to bend

export const SESSION_KEEP_MS = 90_000 // this session's spend, sampled every couple of seconds
export const DAY_KEEP_MS = 15 * 60_000 // today's machine-wide total, sampled every few minutes
const SESSION_MIN_SPAN_MS = 8_000
const DAY_MIN_SPAN_MS = 60_000
const DAY_TAU_MS = 180_000 // how fast the machine-wide pace fades once its samples stop changing

export type Sample = { t: number; usd: number }

export const speedFor = (usdPerHour: number, working: boolean): number => {
  const rate = Number.isFinite(usdPerHour) && usdPerHour > 0 ? usdPerHour : 0
  const paced = IDLE_PX_S + PACE_SCALE * Math.log(1 + rate / PACE_KNEE)
  return Math.min(MAX_PX_S, Math.max(working ? WORKING_FLOOR_PX_S : IDLE_PX_S, paced))
}

export const addSample = (samples: readonly Sample[], t: number, usd: number, keepMs: number): Sample[] =>
  [...samples, { t, usd }].filter(s => t - s.t <= keepMs)

// Dollars an hour between the first and last sample. Zero when there is too little to say,
// or the total went down (a new day starts the machine-wide total over).
export const rateOf = (samples: readonly Sample[], minSpanMs: number): number => {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last || samples.length < 2) return 0
  const span = last.t - first.t
  const spent = last.usd - first.usd
  return span >= minSpanMs && spent > 0 ? (spent * 3600e3) / span : 0
}

export const fade = (rate: number, ageMs: number, tauMs: number): number => rate * Math.exp(-Math.max(0, ageMs) / tauMs)

// The faster of this session's live pace and the machine-wide pace, which fades as it ages.
export const paceNow = (session: readonly Sample[], day: readonly Sample[], now: number): number => {
  const lastDay = day[day.length - 1]
  const machine = lastDay ? fade(rateOf(day, DAY_MIN_SPAN_MS), now - lastDay.t, DAY_TAU_MS) : 0
  return Math.max(rateOf(session, SESSION_MIN_SPAN_MS), machine)
}
