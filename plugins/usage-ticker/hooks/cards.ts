import type { CardText } from './led'

export type ModelRow = {
  modelName: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}
// The part of a `ccusage daily --json` entry the board reads.
export type Day = { totalCost?: number; modelBreakdowns?: ModelRow[] }
// One entry of the list, with the local date it is for (`period`, as YYYY-MM-DD).
export type DayEntry = Day & { period: string }

// A minor version is one or two digits; an eight digit date after it is not a version.
const MINOR = '(\\d{1,2})(?!\\d)'
const NAME_FIRST = new RegExp(`^claude-(opus|sonnet|haiku|fable)-(\\d+)(?:-${MINOR})?(?:-|$)`) // claude-opus-4-1-20250805
const NAME_LAST = new RegExp(`^claude-(\\d+)(?:-${MINOR})?-(opus|sonnet|haiku|fable)(?:-|$)`) // claude-3-5-sonnet-20241022

export const prettyModel = (id: string): string => {
  const version = (major: string | undefined, minor: string | undefined) => (minor === undefined ? major : `${major}.${minor}`)
  const first = id.match(NAME_FIRST)
  if (first) return `${first[1]} ${version(first[2], first[3])}`
  const last = id.match(NAME_LAST)
  if (last) return `${last[3]} ${version(last[1], last[2])}`
  const gpt = id.match(/^gpt-(\d+\.\d+)/)
  if (gpt) return `gpt ${gpt[1]}`
  return id.toUpperCase().slice(0, 12)
}

export const money = (n: number): string => `$${n.toFixed(2)}`

// Tokens in K, M or B, moving up a unit before the number would read 1000.
export const tok = (n: number): string => {
  if (n < 1e3) return String(n)
  if (n < 999_500) return `${Math.round(n / 1e3)}K`
  if (n < 999_500_000) return `${Math.round(n / 1e6)}M`
  return `${(n / 1e9).toFixed(1)}B`
}

const MAX_MODEL_CARDS = 8
const tokensOf = (m: ModelRow) => m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens

// The day's spend: the reported total, else the sum of its models.
export const dayTotal = (day: Day | undefined): number => day?.totalCost ?? (day?.modelBreakdowns ?? []).reduce((sum, m) => sum + m.cost, 0)

export type ModelSum = { name: string; cost: number; tokens: number }

// Each model's cost and tokens, biggest cost first. Ids that shorten to the same name (a dated one and an undated
// one) are one model, as two of one name would only confuse.
export const modelSums = (day: Day | undefined): ModelSum[] => {
  const byName = new Map<string, ModelSum>()
  for (const m of day?.modelBreakdowns ?? []) {
    const name = prettyModel(m.modelName)
    const sum = byName.get(name) ?? { name, cost: 0, tokens: 0 }
    sum.cost += m.cost
    sum.tokens += tokensOf(m)
    byName.set(name, sum)
  }
  return [...byName.values()].sort((a, b) => b.cost - a.cost)
}

// Past eight models the smallest are one `N others` entry, so a long tail does not stretch the crawl. It is
// never an entry for one other.
export const capModels = (models: readonly ModelSum[]): { shown: ModelSum[]; others: ModelSum | null } => {
  if (models.length <= MAX_MODEL_CARDS) return { shown: [...models], others: null }
  const tail = models.slice(MAX_MODEL_CARDS - 1)
  return {
    shown: models.slice(0, MAX_MODEL_CARDS - 1),
    others: { name: `${tail.length} others`, cost: tail.reduce((s, m) => s + m.cost, 0), tokens: tail.reduce((s, m) => s + m.tokens, 0) },
  }
}

// The whole stretch first, named `title`, then each model by cost, biggest first.
export const cardsFromDay = (day: Day | undefined, title = 'today'): CardText[] => {
  const models = modelSums(day)
  const tokens = models.reduce((s, m) => s + m.tokens, 0)
  const { shown, others } = capModels(models)
  return [
    { name: title, value: money(dayTotal(day)), extra: `${tok(tokens)} tokens` },
    ...shown.map(m => ({ name: m.name, value: money(m.cost), extra: tok(m.tokens) })),
    ...(others ? [{ name: others.name, value: money(others.cost), extra: tok(others.tokens) }] : []),
  ]
}

export const unavailableCards = (): CardText[] => [{ name: 'usage unavailable', value: '', extra: '' }]

// Until the first read of ccusage is back.
export const loadingCards = (title = 'today'): CardText[] => [{ name: title, value: '', extra: 'loading' }]

export type Parsed = { ok: true; days: DayEntry[] } | { ok: false }

// Every day in `ccusage daily --json` output. An empty list is fine: no usage yet. An entry whose `period`
// is not text cannot be placed in time, so it is dropped.
export const parseCcusage = (stdout: string): Parsed => {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return { ok: false }
  }
  const daily = (data as { daily?: unknown } | null)?.daily
  if (!Array.isArray(daily)) return { ok: false }
  const days = daily.filter((d: unknown): d is DayEntry => d !== null && typeof d === 'object' && typeof (d as { period?: unknown }).period === 'string')
  return { ok: true, days }
}

export type SpendState = 'loading' | 'ready' | 'failed'
export type Spend = { days: DayEntry[]; state: SpendState }

// What the list of days and its state become after a read. A read that failed leaves a good list as it was.
export const nextSpend = (current: Spend, read: Parsed | null): Spend =>
  read?.ok ? { days: read.days, state: 'ready' } : { days: current.days, state: current.state === 'ready' ? 'ready' : 'failed' }
