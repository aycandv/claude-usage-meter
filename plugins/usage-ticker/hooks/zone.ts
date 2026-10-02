const two = (n: number) => String(n).padStart(2, '0')

// Minutes east of UTC from the +HHMM that `date +%z` prints; null when it is not a plausible offset.
export const parseUtcOffset = (z: string): number | null => {
  const m = z.trim().match(/^([+-])(\d{2})(\d{2})$/)
  if (!m) return null
  const hours = Number(m[2])
  const minutes = Number(m[3])
  if (hours > 14 || minutes > 59) return null
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes)
}

const DAY_MS = 86400e3

// The local calendar day as YYYY-MM-DD, the form of a `period` in ccusage's JSON. ISO dates sort as text.
// A shifted Date read with its UTC getters is local time for a fixed offset east of UTC, in minutes.
export const isoDate = (ms: number, offsetMin: number): string => {
  const d = new Date(ms + offsetMin * 60e3)
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`
}

// The local day the weekly limit's window began: seven days before it resets. With no usable
// reset time, the most recent Monday (today, when today is one).
export const weekStartIso = (now: number, offsetMin: number, resetsAtMs: number | null): string => {
  if (resetsAtMs !== null && Number.isFinite(resetsAtMs)) return isoDate(resetsAtMs - 7 * DAY_MS, offsetMin)
  const sinceMonday = (new Date(now + offsetMin * 60e3).getUTCDay() + 6) % 7 // Sunday is 0, so it is six days after Monday
  return isoDate(now - sinceMonday * DAY_MS, offsetMin)
}

// The first day of the local month.
export const monthStartIso = (now: number, offsetMin: number): string => `${isoDate(now, offsetMin).slice(0, 8)}01`
