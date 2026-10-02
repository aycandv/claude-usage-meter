import { test, expect } from 'claude-code/testing'

import type { DayEntry } from './cards'
import {
  DEFER_IDLE_MS,
  DEFER_MIN_GAP_MS,
  DESK_CLOCK_MS,
  DESK_SPEED,
  FRAME_LATENCY_MS,
  STRIP_PARTS,
  dailySeries,
  deskClock,
  diagLine,
  firstReading,
  reasonFor,
  stripKeyParts,
  framePhase,
  memoMarkup,
  phaseAt,
  redrawDue,
  panelInput,
  panelWidthFor,
  paceShown,
  stripInput,
  stripKey,
  stripWidthFor,
  tickerCards,
} from './desktop-state'
import type { DesktopState } from './desktop-state'
import type { Week } from './gauge'
import { panelSvg } from './panel-svg'
import { stripSvg } from './strip-svg'
import { svgProblems } from './svg-util'

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0) // Thursday 1 October 2026, 12:00 UTC
const row = (modelName: string, cost: number, tokens: number) => ({ modelName, cost, inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })
const DAYS: DayEntry[] = [
  { period: '2026-09-28', totalCost: 10, modelBreakdowns: [row('claude-opus-5-5', 8, 2_000_000), row('claude-sonnet-5-5', 2, 500_000)] },
  { period: '2026-09-30', totalCost: 20, modelBreakdowns: [row('claude-opus-5-5', 20, 4_000_000)] },
  { period: '2026-10-01', totalCost: 40, modelBreakdowns: [row('claude-opus-5-5', 30, 8_000_000), row('claude-sonnet-5-5', 10, 1_000_000)] },
]
const WEEK: Week = { usedPct: 39, elapsedFrac: 0.5, resetsAtMs: NOW + 3.5 * DAY }
const state = (over: Partial<DesktopState> = {}): DesktopState => ({
  days: DAYS,
  spend: 'ready',
  period: 'today',
  rangeLabel: 'Oct 1',
  week: WEEK,
  now: NOW,
  offsetMin: 0,
  pacePerHour: 6.4,
  ...over,
})

test('the strip takes the band less the buttons, within its range', () => {
  expect(stripWidthFor(106)).toBe(Math.round(106 * 7.25) - 190) // the owner's window: about 769 px of band
  expect(stripWidthFor(40)).toBe(420)
  expect(stripWidthFor(400)).toBe(1100)
  expect(stripWidthFor(undefined)).toBe(stripWidthFor(106))
  expect(stripWidthFor(Number.NaN)).toBe(stripWidthFor(106))
})

test('the panel is about 400 wide, within its range', () => {
  expect(panelWidthFor(undefined)).toBe(400)
  expect(panelWidthFor(10)).toBe(360)
  expect(panelWidthFor(200)).toBe(480)
  expect(panelWidthFor(56)).toBe(Math.round(56 * 7.25) - 16)
})

test('the desktop ticker moves at one constant speed', () => {
  expect(DESK_SPEED).toBe(12)
  const input = stripInput(state(), 600, 0)
  expect(input.speedPxPerSec).toBe(DESK_SPEED)
})

test('the ticker position is the speed times the time since the crawl began, never summed tick by tick', () => {
  const T = 5_000
  expect(phaseAt(T, T)).toBe(0)
  expect(phaseAt(T, T + 2500)).toBe(30)
  expect(phaseAt(T, T - 1000)).toBe(0) // a clock that steps back moves nothing
  expect(phaseAt(T, T + 3_600_000)).toBe(12 * 3600) // an hour of one-second ticks, exactly
})

test('the frame phase looks ahead by the frame latency, in one place', () => {
  expect(FRAME_LATENCY_MS).toBe(150)
  expect(framePhase(0, 10_000)).toBe(phaseAt(0, 10_000 + FRAME_LATENCY_MS))
  expect(framePhase(0, 10_000)).toBe(121.8)
})

test('neither the pace nor a turn has any part in the strip: no speed in its key', () => {
  const key = (pace: number) => stripKey(stripInput(state({ pacePerHour: pace }), 600, 0))
  expect(key(0)).toBe(key(250))
  expect(STRIP_PARTS).not.toContain('speed' as never)
})

const due = (over: Partial<Parameters<typeof redrawDue>[0]> = {}) =>
  redrawDue({ working: false, userInitiated: false, keyChanged: true, lastDrawAt: 0, idleSince: 0, now: 10 * 60_000, showsPlaceholder: false, firstReading: false, ...over })

test('redrawDue: nothing to draw when the key has not moved, whoever asks', () => {
  expect(due({ keyChanged: false })).toBe(false)
  expect(due({ keyChanged: false, userInitiated: true })).toBe(false)
})

test('redrawDue: what the person did is drawn at once, even mid-turn', () => {
  expect(due({ userInitiated: true, working: true, lastDrawAt: 10 * 60_000 - 1, idleSince: null })).toBe(true)
})

test('redrawDue: new figures wait while a turn runs', () => {
  expect(due({ working: true, idleSince: null })).toBe(false)
  expect(due({ working: true, idleSince: 0 })).toBe(false) // a turn that began since idle was last seen
})

test('redrawDue: after a turn, new figures wait for 15 s of quiet', () => {
  const now = 10 * 60_000
  expect(due({ idleSince: now - 14_999 })).toBe(false)
  expect(due({ idleSince: now - DEFER_IDLE_MS })).toBe(true)
  expect(due({ idleSince: null })).toBe(false) // idle not yet seen
})

test('redrawDue: and at most once in five minutes', () => {
  const now = 10 * 60_000
  expect(due({ lastDrawAt: now - 4 * 60_000 })).toBe(false)
  expect(due({ lastDrawAt: now - DEFER_MIN_GAP_MS })).toBe(true)
  expect(DEFER_MIN_GAP_MS).toBe(300_000)
})

test('redrawDue: a placeholder on screen (still reading, or a failed read) makes way for figures at once', () => {
  expect(due({ showsPlaceholder: true, working: true, idleSince: null, lastDrawAt: 10 * 60_000 })).toBe(true)
})

test('memoMarkup builds once per key and hands back the same markup while the key holds', () => {
  let builds = 0
  const build = () => {
    builds++
    return { source: `<svg>${builds}</svg>`, alt: 'a' }
  }
  const a = memoMarkup(null, 'k1', build)
  const b = memoMarkup(a, 'k1', build)
  expect(b).toBe(a)
  expect(builds).toBe(1)
  const c = memoMarkup(b, 'k2', build)
  expect(c.key).toBe('k2')
  expect(c.value.source).toBe('<svg>2</svg>')
})

test('deskClock holds the desktop picture of the week to ten minute steps', () => {
  expect(DESK_CLOCK_MS).toBe(600_000)
  expect(deskClock(Date.UTC(2026, 9, 1, 12, 9, 59))).toBe(Date.UTC(2026, 9, 1, 12, 0, 0))
  expect(deskClock(Date.UTC(2026, 9, 1, 12, 10, 0))).toBe(Date.UTC(2026, 9, 1, 12, 10, 0))
})

test('paceShown rounds to half dollars and hides a pace of nothing', () => {
  expect(paceShown(6.4)).toBe(6.5)
  expect(paceShown(6.2)).toBe(6)
  expect(paceShown(0)).toBeNull()
  expect(paceShown(0.2)).toBeNull()
  expect(paceShown(Number.NaN)).toBeNull()
})

test('dailySeries is the last fourteen local days, today last, a missing day at zero', () => {
  const series = dailySeries(DAYS, '2026-10-01')
  expect(series).toHaveLength(14)
  expect(series[13]).toEqual({ label: 'Oct 1', cost: 40 })
  expect(series[12]).toEqual({ label: 'Sep 30', cost: 20 })
  expect(series[11]).toEqual({ label: 'Sep 29', cost: 0 })
  expect(series[10]).toEqual({ label: 'Sep 28', cost: 10 })
  expect(series[0]!.label).toBe('Sep 18')
  expect(dailySeries([], '2026-03-01', 3).map(d => d.label)).toEqual(['Feb 27', 'Feb 28', 'Mar 1'])
  expect(dailySeries(DAYS, 'not a date')).toEqual([])
})

test('tickerCards are the models of the period with their share and a tooltip', () => {
  const cards = tickerCards(state())
  expect(cards.map(c => [c.name, c.value, c.share])).toEqual([
    ['opus 5.5', '$30.00', 0.75],
    ['sonnet 5.5', '$10.00', 0.25],
  ])
  expect(cards[0]!.tooltip).toBe('opus 5.5: $30.00, 8M tokens, 75% of today')
})

test('tickerCards follow the period on show', () => {
  const week = tickerCards(state({ period: 'all' }))
  expect(week.map(c => c.value)).toEqual(['$58.00', '$12.00'])
  expect(week[0]!.tooltip).toBe('opus 5.5: $58.00, 14M tokens, 83% of all time')
})

test('a tiny share says under one percent, not zero', () => {
  const days: DayEntry[] = [{ period: '2026-10-01', totalCost: 1000.1, modelBreakdowns: [row('claude-opus-5-5', 1000, 1), row('claude-haiku-4-5', 0.1, 1)] }]
  expect(tickerCards(state({ days }))[1]!.tooltip).toContain('<1% of today')
})

test('past eight models the ticker and the panel show seven and the rest as N others', () => {
  const names = ['opus-5-5', 'sonnet-5-5', 'haiku-4-5', 'fable-5-1', 'opus-4-1', 'sonnet-4', 'haiku-3-5', 'opus-3', 'sonnet-3-7', 'fable-4']
  const days: DayEntry[] = [{ period: '2026-10-01', modelBreakdowns: names.map((n, i) => row(`claude-${n}`, 10 - i, 1000)) }]
  const cards = tickerCards(state({ days }))
  expect(cards).toHaveLength(8)
  expect(cards[7]!.name).toBe('3 others')
  expect(cards[7]!.value).toBe('$6.00')
  const rows = panelInput(state({ days }), 400).models
  expect(rows).toHaveLength(8)
  expect(rows[7]).toMatchObject({ name: '3 others', value: '$6.00', cost: 6 })
})

test('stripInput carries the total, the tokens, the cards, the week and the motion', () => {
  const input = stripInput(state(), 600, 123)
  expect(input).toMatchObject({ width: 600, title: 'today', total: '$40.00', tokens: '9M tokens', rangeChip: 'Oct 1', speedPxPerSec: 12, phasePx: 123, now: NOW, offsetMin: 0, week: WEEK })
  expect(input.cards).toHaveLength(2)
  expect(svgProblems(stripSvg(input))).toEqual([])
})

test('while loading or after a failed read the strip says so instead of a total', () => {
  const loading = stripInput(state({ spend: 'loading' }), 600, 0)
  expect(loading).toMatchObject({ total: '…', tokens: 'loading', cards: [], emptyText: 'Reading usage…' })
  const failed = stripInput(state({ spend: 'failed' }), 600, 0)
  expect(failed).toMatchObject({ total: '–', tokens: 'usage unavailable', cards: [], emptyText: 'Usage unavailable' })
  expect(stripSvg(failed)).toContain('Usage unavailable')
})

test('panelInput carries the rows, the daily series, the week and the pace', () => {
  const p = panelInput(state(), 400)
  expect(p).toMatchObject({ width: 400, title: 'today', total: '$40.00', tokens: '9M tokens', range: 'Oct 1', pacePerHour: 6.5, header: 0, source: 'Prices are ccusage estimates' })
  expect(p.models.map(m => [m.name, m.value, m.cost])).toEqual([
    ['opus 5.5', '$30.00', 30],
    ['sonnet 5.5', '$10.00', 10],
  ])
  expect(p.models[0]!.tooltip).toBe('opus 5.5: $30.00, 8M tokens, 75% of today')
  expect(p.daily).toHaveLength(14)
  expect(svgProblems(panelSvg(p))).toEqual([])
})

test('the week is null-safe: no reading gives the calm states', () => {
  const s = state({ week: null })
  expect(stripInput(s, 600, 0).week).toBeNull()
  expect(panelSvg(panelInput(s, 400))).toContain('No weekly limit reading yet')
})

test('the period follows the week start, from the reset time', () => {
  const p = panelInput(state({ period: 'week', rangeLabel: 'since Sep 28' }), 400)
  expect(p.title).toBe('this week')
  expect(p.total).toBe('$70.00') // 28 Sep to 1 Oct: the reset is 3.5 days off, so the week began 3.5 days ago
})

test('stripKey changes with what the strip shows, and not with the clock or the ticker position', () => {
  const base = stripKey(stripInput(state(), 600, 0))
  expect(stripKey(stripInput(state(), 600, 999))).toBe(base)
  expect(stripKey(stripInput(state({ now: NOW + 60_000 }), 600, 0))).toBe(base) // a minute on: the same caption
  expect(stripKey(stripInput(state({ period: 'week' }), 600, 0))).not.toBe(base)
  expect(stripKey(stripInput(state({ week: { ...WEEK, usedPct: 41 } }), 600, 0))).not.toBe(base)
  expect(stripKey(stripInput(state({ week: null }), 600, 0))).not.toBe(base)
  expect(stripKey(stripInput(state(), 640, 0))).not.toBe(base)
  const moreSpend: DayEntry[] = [...DAYS.slice(0, 2), { ...DAYS[2]!, totalCost: 41, modelBreakdowns: [row('claude-opus-5-5', 31, 8_000_000), row('claude-sonnet-5-5', 10, 1_000_000)] }]
  expect(stripKey(stripInput(state({ days: moreSpend }), 600, 0))).not.toBe(base)
})

test('stripKey follows the notch as the week goes on, a percent at a time', () => {
  const at = (ms: number) => stripKey(stripInput(state({ now: NOW + ms, week: { ...WEEK, elapsedFrac: 0.5 + ms / (7 * DAY) } }), 600, 0))
  expect(at(60_000)).toBe(at(0))
  expect(at(7 * DAY * 0.02)).not.toBe(at(0))
})


test('reasonFor names the parts of the strip that changed, in a fixed order', () => {
  const base = stripInput(state(), 600, 0)
  const parts = stripKeyParts(base)
  expect(reasonFor(null, parts)).toBe('none')
  expect(reasonFor(parts, parts)).toBe('none')
  expect(reasonFor(parts, stripKeyParts(stripInput(state(), 600, 50)))).toBe('none') // the phase is no part of it
  expect(reasonFor(parts, stripKeyParts(stripInput(state(), 640, 0)))).toBe('width')
  expect(reasonFor(parts, stripKeyParts(stripInput(state({ week: null }), 600, 0)))).toBe('week')
  expect(reasonFor(parts, stripKeyParts(stripInput(state({ rangeLabel: 'Oct 2' }), 600, 0)))).toBe('range')
  expect(reasonFor(parts, stripKeyParts(stripInput(state({ period: 'week', rangeLabel: 'since Sep 28' }), 600, 0)))).toBe('period+total+cards+range')
  const more: DayEntry[] = [...DAYS.slice(0, 2), { ...DAYS[2]!, totalCost: 41 }]
  expect(reasonFor(parts, stripKeyParts(stripInput(state({ days: more }), 600, 0)))).toBe('total+cards') // the shares moved too
})

test('diagLine is one short line of the counters and the last reason', () => {
  expect(diagLine({ renders: 12, changes: 2, invalidates: 2, reason: 'total+cards' })).toBe('diag r12 c2 i2 last: total+cards')
})

test('stripKey is the parts, so equal parts are equal keys', () => {
  expect(stripKey(stripInput(state(), 600, 0))).toBe(JSON.stringify(stripKeyParts(stripInput(state(), 600, 99))))
})


test('redrawDue: the first weekly reading fills the empty ring at once, even mid-turn', () => {
  expect(due({ firstReading: true, working: true, idleSince: null, lastDrawAt: 10 * 60_000 - 1 })).toBe(true)
  expect(due({ firstReading: false, working: true, idleSince: null, lastDrawAt: 10 * 60_000 - 1 })).toBe(false) // a later change waits
})

test('firstReading: a strip without a reading on screen meets one', () => {
  const none = stripKeyParts(stripInput(state({ week: null }), 600, 0))
  const some = stripKeyParts(stripInput(state(), 600, 0))
  const more = stripKeyParts(stripInput(state({ week: { ...WEEK, usedPct: 60 } }), 600, 0))
  expect(firstReading(none, some)).toBe(true)
  expect(firstReading(some, more)).toBe(false)
  expect(firstReading(some, none)).toBe(false)
  expect(firstReading(null, some)).toBe(false) // nothing on screen yet: that is the first drawing anyway
})
