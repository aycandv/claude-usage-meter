import { dayTotal } from './cards'
import type { Day, DayEntry, ModelRow } from './cards'
import { isoDate, monthStartIso, weekStartIso } from './zone'

// The stretches of time the crawl can show, and the button that steps through them.
export const PERIODS = ['today', 'week', 'month', 'all'] as const
export type Period = (typeof PERIODS)[number]

export const isPeriod = (x: unknown): x is Period => typeof x === 'string' && (PERIODS as readonly string[]).includes(x)

export const nextPeriod = (p: Period): Period => PERIODS[(PERIODS.indexOf(p) + 1) % PERIODS.length]!

const LABELS: Record<Period, string> = { today: 'Today', week: 'Week', month: 'Month', all: 'All time' }
const TITLES: Record<Period, string> = { today: 'today', week: 'this week', month: 'this month', all: 'all time' }

// On the button.
export const buttonLabel = (p: Period): string => LABELS[p]

// The name on the first LED card.
export const cardTitle = (p: Period): string => TITLES[p]

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

// The days from `sinceIso` (every day, when null) to `untilIso`, both included, as one stretch: the sum of their
// totals, and each model added up across them. Dates are YYYY-MM-DD, which sort as text. A figure that is not a
// usable number counts as zero. The days themselves are not changed.
export const aggregate = (days: readonly DayEntry[], sinceIso: string | null, untilIso: string): Day => {
  let totalCost = 0
  const byModel = new Map<string, ModelRow>()
  for (const d of days) {
    if ((sinceIso !== null && d.period < sinceIso) || d.period > untilIso) continue
    totalCost += num(dayTotal(d))
    for (const m of d.modelBreakdowns ?? []) {
      const sum = byModel.get(m.modelName) ?? { modelName: m.modelName, cost: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
      sum.cost += num(m.cost)
      sum.inputTokens += num(m.inputTokens)
      sum.outputTokens += num(m.outputTokens)
      sum.cacheCreationTokens += num(m.cacheCreationTokens)
      sum.cacheReadTokens += num(m.cacheReadTokens)
      byModel.set(m.modelName, sum)
    }
  }
  return { totalCost, modelBreakdowns: [...byModel.values()] }
}

export type Range = { since: string | null; until: string }

// The local days a period covers: `since` is null for all time. A week that would begin after today is held to today.
export const rangeFor = (period: Period, now: number, offsetMin: number, resetsAtMs: number | null): Range => {
  const until = isoDate(now, offsetMin)
  switch (period) {
    case 'today':
      return { since: until, until }
    case 'week': {
      const since = weekStartIso(now, offsetMin, resetsAtMs)
      return { since: since < until ? since : until, until }
    }
    case 'month':
      return { since: monthStartIso(now, offsetMin), until }
    case 'all':
      return { since: null, until }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The parts of a YYYY-MM-DD date, or null when it is anything else.
const dateParts = (iso: string | null | undefined): { year: string; month: string; day: number } | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  const day = Number(m?.[3])
  return m && month && day >= 1 && day <= 31 ? { year: m[1]!, month, day } : null
}

// The small caption under the button, 14 characters at most: which days the crawl is adding up. A date
// that cannot be read leaves the name of the period.
export const rangeText = (period: Period, since: string | null, firstPeriod?: string): string => {
  if (period === 'all') {
    const first = dateParts(firstPeriod)
    return first ? `since ${first.month} ${first.year}` : cardTitle(period)
  }
  const from = dateParts(since)
  if (!from) return cardTitle(period)
  return period === 'today' ? `${from.month} ${from.day}` : `since ${from.month} ${from.day}`
}

// The first day in the data, whatever order the days come in.
export const earliestPeriod = (days: readonly DayEntry[]): string | undefined => {
  let first: string | undefined
  for (const d of days) if (first === undefined || d.period < first) first = d.period
  return first
}
