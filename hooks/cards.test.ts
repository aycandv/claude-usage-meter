import { test, expect } from 'claude-code/testing'

import { cardsFromDay, dayTotal, loadingCards, money, nextSpend, parseCcusage, prettyModel, tok, unavailableCards } from './cards'
import type { Day } from './cards'

const row = (modelName: string, cost: number, inputTokens: number, outputTokens: number, cacheCreationTokens: number, cacheReadTokens: number) => ({
  modelName,
  cost,
  inputTokens,
  outputTokens,
  cacheCreationTokens,
  cacheReadTokens,
})

test('prettyModel shortens Claude model ids to name and version', () => {
  expect(prettyModel('claude-opus-5-5')).toBe('opus 5.5')
  expect(prettyModel('claude-sonnet-5-5')).toBe('sonnet 5.5')
  expect(prettyModel('claude-fable-5-1')).toBe('fable 5.1')
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
})

test('prettyModel never takes a date suffix for a minor version', () => {
  expect(prettyModel('claude-sonnet-4-20250514')).toBe('sonnet 4')
  expect(prettyModel('claude-opus-4-1-20250805')).toBe('opus 4.1')
  expect(prettyModel('claude-opus-4-5-20251101')).toBe('opus 4.5')
  expect(prettyModel('claude-sonnet-5')).toBe('sonnet 5')
})

test('prettyModel reads the older ids that put the version before the name', () => {
  expect(prettyModel('claude-3-5-sonnet-20241022')).toBe('sonnet 3.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('haiku 3.5')
  expect(prettyModel('claude-3-opus-20240229')).toBe('opus 3')
  expect(prettyModel('claude-3-sonnet-20240229')).toBe('sonnet 3')
})

test('prettyModel accepts a minor version of one or two digits and no more', () => {
  expect(prettyModel('claude-opus-4-9')).toBe('opus 4.9')
  expect(prettyModel('claude-opus-4-12')).toBe('opus 4.12')
  expect(prettyModel('claude-opus-4-12-20260101')).toBe('opus 4.12')
  expect(prettyModel('claude-opus-4-20260101')).toBe('opus 4')
})

test('prettyModel shortens GPT ids', () => {
  expect(prettyModel('gpt-6.1-sol')).toBe('gpt 6.1')
})

test('an unknown model id is upper-cased and cut to 12 characters', () => {
  expect(prettyModel('some-very-long-model-id')).toBe('SOME-VERY-LO')
  expect(prettyModel('x1')).toBe('X1')
})

test('money shows dollars and cents with no thousands separator', () => {
  expect(money(42.176)).toBe('$42.18')
  expect(money(0)).toBe('$0.00')
  expect(money(1234.5)).toBe('$1234.50')
})

test('tok picks the unit that keeps the number short', () => {
  expect(tok(0)).toBe('0')
  expect(tok(900)).toBe('900')
  expect(tok(15_000)).toBe('15K')
  expect(tok(96_300_000)).toBe('96M')
  expect(tok(1_700_000)).toBe('2M')
  expect(tok(2_340_000_000)).toBe('2.3B')
})

test('tok moves up a unit rather than print 1000K', () => {
  expect(tok(999_400)).toBe('999K')
  expect(tok(999_600)).toBe('1M')
  expect(tok(999_600_000)).toBe('1.0B')
})

test('the first card is today, then models from the biggest spender down', () => {
  const day: Day = {
    totalCost: 40.75,
    modelBreakdowns: [
      row('claude-sonnet-5-5', 9.25, 100_000, 200_000, 300_000, 13_400_000), // 14M
      row('claude-opus-5-5', 31.5, 1_000_000, 2_000_000, 3_000_000, 74_000_000), // 80M
    ],
  }
  expect(cardsFromDay(day)).toEqual([
    { name: 'today', value: '$40.75', extra: '94M tokens' },
    { name: 'opus 5.5', value: '$31.50', extra: '80M' },
    { name: 'sonnet 5.5', value: '$9.25', extra: '14M' },
  ])
})

test('without a total, today adds up the models', () => {
  const day: Day = { modelBreakdowns: [row('claude-opus-5-5', 1.5, 1, 1, 1, 1), row('claude-haiku-4-5', 0.25, 1, 1, 1, 1)] }
  expect(cardsFromDay(day)[0]).toEqual({ name: 'today', value: '$1.75', extra: '8 tokens' })
})

test('a day with no usage, or no day at all, is one empty card', () => {
  const empty = [{ name: 'today', value: '$0.00', extra: '0 tokens' }]
  expect(cardsFromDay(undefined)).toEqual(empty)
  expect(cardsFromDay({ totalCost: 0, modelBreakdowns: [] })).toEqual(empty)
})

test('the first card takes the name it is given, and the models keep their own', () => {
  const day: Day = { totalCost: 2, modelBreakdowns: [row('claude-opus-5-5', 2, 1, 1, 1, 1)] }
  expect(cardsFromDay(day)[0]?.name).toBe('today')
  expect(cardsFromDay(day, 'this week')).toEqual([
    { name: 'this week', value: '$2.00', extra: '4 tokens' },
    { name: 'opus 5.5', value: '$2.00', extra: '4' },
  ])
})

test('a period with no usage is still one card, named for the period', () => {
  expect(cardsFromDay(undefined, 'all time')).toEqual([{ name: 'all time', value: '$0.00', extra: '0 tokens' }])
  expect(cardsFromDay({ totalCost: 0, modelBreakdowns: [] }, 'this month')).toEqual([{ name: 'this month', value: '$0.00', extra: '0 tokens' }])
})

test('models whose ids shorten to the same name are one card, their costs and tokens added', () => {
  const day: Day = {
    modelBreakdowns: [
      row('claude-opus-4-5', 10, 1_000_000, 0, 0, 3_000_000),
      row('claude-opus-4-5-20251101', 5, 1_000_000, 0, 0, 1_000_000),
      row('claude-sonnet-5-5', 8, 1_000_000, 0, 0, 0),
    ],
  }
  expect(cardsFromDay(day)).toEqual([
    { name: 'today', value: '$23.00', extra: '7M tokens' },
    { name: 'opus 4.5', value: '$15.00', extra: '6M' },
    { name: 'sonnet 5.5', value: '$8.00', extra: '1M' },
  ])
})

test('the cost of a merged card, not of its parts, decides where it stands', () => {
  const day: Day = {
    modelBreakdowns: [row('gpt-5.2', 4, 1, 1, 1, 1), row('claude-opus-5-5', 6, 1, 1, 1, 1), row('gpt-5.2-high', 4, 1, 1, 1, 1)],
  }
  expect(cardsFromDay(day).map(c => c.name)).toEqual(['today', 'gpt 5.2', 'opus 5.5'])
})

test('while the first read is under way there is one card saying loading, named for the period', () => {
  expect(loadingCards()).toEqual([{ name: 'today', value: '', extra: 'loading' }])
  expect(loadingCards('this week')).toEqual([{ name: 'this week', value: '', extra: 'loading' }])
})

test('when ccusage cannot be read there is one plain card saying so', () => {
  expect(unavailableCards()).toEqual([{ name: 'usage unavailable', value: '', extra: '' }])
})

test('parseCcusage returns every day of the ccusage JSON output, in the order given', () => {
  const out = JSON.stringify({ daily: [{ period: '2026-09-30', totalCost: 1 }, { period: '2026-10-01', totalCost: 2.5, modelBreakdowns: [] }] })
  expect(parseCcusage(out)).toEqual({
    ok: true,
    days: [
      { period: '2026-09-30', totalCost: 1 },
      { period: '2026-10-01', totalCost: 2.5, modelBreakdowns: [] },
    ],
  })
})

test('parseCcusage reports an empty list as ok, with no days', () => {
  expect(parseCcusage(JSON.stringify({ daily: [] }))).toEqual({ ok: true, days: [] })
})

test('parseCcusage drops entries that have no period as text', () => {
  const out = JSON.stringify({ daily: [{ totalCost: 1 }, { period: 20261001, totalCost: 2 }, null, 'x', 7, { period: '2026-10-01', totalCost: 3 }] })
  expect(parseCcusage(out)).toEqual({ ok: true, days: [{ period: '2026-10-01', totalCost: 3 }] })
})

test('parseCcusage reports output it cannot use as not ok', () => {
  expect(parseCcusage('not json')).toEqual({ ok: false })
  expect(parseCcusage('{}')).toEqual({ ok: false })
  expect(parseCcusage('null')).toEqual({ ok: false })
  expect(parseCcusage('')).toEqual({ ok: false })
})

test('dayTotal is the reported total, or the sum of the models, or zero', () => {
  expect(dayTotal({ totalCost: 12.5, modelBreakdowns: [row('claude-opus-5-5', 1, 1, 1, 1, 1)] })).toBe(12.5)
  expect(dayTotal({ modelBreakdowns: [row('claude-opus-5-5', 1.5, 1, 1, 1, 1), row('claude-haiku-4-5', 0.25, 1, 1, 1, 1)] })).toBe(1.75)
  expect(dayTotal(undefined)).toBe(0)
  expect(dayTotal({})).toBe(0)
})

// n invented models, the first the most expensive: model-a $100, model-b $95, and so on
const models = (n: number) => Array.from({ length: n }, (_, i) => row(`model-${String.fromCharCode(97 + i)}`, 100 - i * 5, 1_000_000 * (i + 1), 0, 0, 0))

test('a day with more than eight models shows the top seven and one card for all the others', () => {
  const cards = cardsFromDay({ modelBreakdowns: models(12) })
  expect(cards).toHaveLength(1 + 8)
  expect(cards.slice(1, 8).map(c => c.name)).toEqual(['MODEL-A', 'MODEL-B', 'MODEL-C', 'MODEL-D', 'MODEL-E', 'MODEL-F', 'MODEL-G'])
  expect(cards[8]).toEqual({ name: '5 others', value: '$275.00', extra: '50M' }) // models h to l: 65+60+55+50+45 dollars, 8M to 12M tokens
})

test('exactly eight models are all shown, with no card for the others', () => {
  const cards = cardsFromDay({ modelBreakdowns: models(8) })
  expect(cards).toHaveLength(1 + 8)
  expect(cards.some(c => c.name.includes('others'))).toBe(false)
})

test('nine models give seven and one card for two others, never a card for one other', () => {
  const cards = cardsFromDay({ modelBreakdowns: models(9) })
  expect(cards).toHaveLength(1 + 8)
  expect(cards[8]!.name).toBe('2 others')
})

test('the first card still counts every model, the hidden ones included', () => {
  const all = models(12)
  const total = all.reduce((sum, m) => sum + m.cost, 0)
  expect(cardsFromDay({ modelBreakdowns: all })[0]!.value).toBe(money(total))
})

const good = (periods: string[]) => ({ ok: true as const, days: periods.map(period => ({ period, totalCost: 1 })) })

test('a good read replaces the days and is ready', () => {
  expect(nextSpend({ days: [{ period: '2026-09-30' }], state: 'ready' }, good(['2026-10-01']))).toEqual({ days: [{ period: '2026-10-01', totalCost: 1 }], state: 'ready' })
})

test('an empty list is a good read: there is just no usage yet', () => {
  expect(nextSpend({ days: [], state: 'loading' }, good([]))).toEqual({ days: [], state: 'ready' })
})

test('a failed read keeps the days already read, so a hiccup does not blank the board', () => {
  const before = { days: [{ period: '2026-10-01', totalCost: 5 }], state: 'ready' as const }
  expect(nextSpend(before, null)).toEqual(before)
  expect(nextSpend(before, { ok: false })).toEqual(before)
})

test('a failed read with nothing read before is failed', () => {
  expect(nextSpend({ days: [], state: 'loading' }, null)).toEqual({ days: [], state: 'failed' })
  expect(nextSpend({ days: [], state: 'failed' }, { ok: false })).toEqual({ days: [], state: 'failed' })
})
