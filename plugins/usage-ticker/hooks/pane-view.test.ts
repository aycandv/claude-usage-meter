import { test, expect } from 'claude-code/testing'

import type { DayEntry } from './cards'
import { panelInput } from './desktop-state'
import type { DesktopState } from './desktop-state'
import type { Week } from './gauge'
import { paneKey, paneView, ringBadgeSvg, ringKey, sparkKey, sparkSvg } from './pane-view'
import { svgProblems, textOverflow } from './svg-util'

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const row = (modelName: string, cost: number, tokens: number) => ({ modelName, cost, inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })
const DAYS: DayEntry[] = [
  { period: '2026-09-28', totalCost: 10, modelBreakdowns: [row('claude-opus-5-5', 8, 2_000_000), row('claude-sonnet-5-5', 2, 500_000)] },
  { period: '2026-10-01', totalCost: 40, modelBreakdowns: [row('claude-opus-5-5', 30, 8_000_000), row('claude-sonnet-5-5', 10, 1_000_000)] },
]
const WEEK: Week = { usedPct: 39, elapsedFrac: 0.5, resetsAtMs: NOW + 3.5 * DAY }
const state = (over: Partial<DesktopState> = {}): DesktopState => ({ days: DAYS, spend: 'ready', period: 'today', rangeLabel: 'Oct 1', week: WEEK, now: NOW, offsetMin: 0, pacePerHour: 6.4, ...over })
const view = (over: Partial<DesktopState> = {}, columns = 56) => paneView(panelInput(state(over), 400), columns)

test('paneView carries every changing value as text for native elements', () => {
  const v = view()
  expect(v.total).toBe('$40.00')
  expect(v.meta).toBe('9M tokens · Oct 1')
  expect(v.pace).toBe('$6.50/h')
  expect(v.weekLabel).toBe('Weekly limit')
  expect(v.weekCaption).toBe('Lands near 78%, resets Mon')
  expect(v.weekDanger).toBe(false)
  expect(v.rows.map(r => [r.name, r.value, r.detail])).toEqual([
    ['opus 5.5', '$30.00', '8M · 75%'],
    ['sonnet 5.5', '$10.00', '1M · 25%'],
  ])
})

test('the bars are whole-percent fills of a fixed track, the top model in the accent, the rest dimmer', () => {
  const v = view()
  expect(v.rows.map(r => r.bar)).toEqual(['100%', '33%'])
  // The engine takes a percentage only as whole digits (/^\d{1,3}%$/): "33.3%" refuses the whole tree.
  for (const r of v.rows) expect(/^\d{1,3}%$/.test(r.bar)).toBe(true)
  expect(v.rows.map(r => r.top)).toEqual([true, false])
  const tiny = paneView(panelInput(state({ days: [{ period: '2026-10-01', totalCost: 1000.01, modelBreakdowns: [row('claude-opus-5-5', 1000, 1), row('claude-haiku-4-5', 0.01, 1)] }] }), 400), 56)
  expect(tiny.rows[1]!.bar).toBe('2%')
  for (const c of [v.barTrack, v.barRest, v.accent]) expect(c).toMatch(/^#[0-9a-f]{6}$/)
})

test('the row columns always fit the card, from 41 columns (300 px) to 66 (480 px), never overlapping', () => {
  for (const cols of [30, 41, 45, 50, 56, 58, 66, 80]) {
    const v = view({}, cols)
    const used = v.nameCols + 1 + v.barCols + (v.detailCols > 0 ? 1 + v.detailCols : 0) + 1 + v.valueCols
    expect(used).toBeLessThanOrEqual(Math.max(10, cols - 6))
    expect(v.barCols).toBeGreaterThanOrEqual(cols >= 41 ? 6 : 0)
    expect(v.valueCols).toBe(6)
  }
  expect(view({}, 58).detailCols).toBe(8) // roomy: tokens and share shown
  expect(view({}, 30).detailCols).toBe(0) // narrow: the detail goes first, the bar keeps a stub
})

test('no pace, and no weekly reading, read as such', () => {
  const v = view({ pacePerHour: 0, week: null })
  expect(v.pace).toBeNull()
  expect(v.weekCaption).toBe('No weekly limit reading yet')
})

test('a week that runs out is marked for the accent color', () => {
  const v = view({ week: { usedPct: 72, elapsedFrac: 0.55, resetsAtMs: NOW + 3 * DAY } })
  expect(v.weekDanger).toBe(true)
  expect(v.weekCaption.startsWith('Runs out')).toBe(true)
  expect(v.accent).toBe('#f25c54')
})

test('the ring badge is a small standalone drawing of the week alone', () => {
  const svg = ringBadgeSvg(WEEK, NOW, 0)
  expect(svgProblems(svg)).toEqual([])
  expect(textOverflow(svg)).toEqual([])
  expect(svg).toContain('width="64" height="64"')
  expect(svg).toContain('>39<tspan')
  expect(svg).toContain('<title>Weekly limit 39% used. Lands near 78%, resets Mon</title>')
  expect(svg).not.toContain('$')
})

test('ringKey follows the week look only', () => {
  expect(ringKey(WEEK, NOW, 0)).toBe(ringKey(WEEK, NOW + 60_000, 0))
  expect(ringKey(WEEK, NOW, 0)).not.toBe(ringKey({ ...WEEK, usedPct: 41 }, NOW, 0))
})

test('the sparkline is a standalone drawing of the daily series, with a tooltip per day', () => {
  const v = view()
  const svg = sparkSvg(v.daily, v.accent, 340)
  expect(svgProblems(svg)).toEqual([])
  expect(textOverflow(svg)).toEqual([])
  expect(svg).toContain('width="340" height="62"')
  expect(svg.split('class="day"')).toHaveLength(15)
  expect(svg).toContain('<title>Sep 28: $10.00</title>')
  expect(svg).not.toContain('6.50') // no pace
})

test('sparkKey follows the series, the accent and the width only', () => {
  const v = view()
  expect(sparkKey(v.daily, v.accent, 340)).toBe(sparkKey(view({ pacePerHour: 90 }).daily, view({ pacePerHour: 90 }).accent, 340))
  expect(sparkKey(v.daily, v.accent, 340)).not.toBe(sparkKey(v.daily, v.accent, 360))
})

test('an empty period and a placeholder read calmly', () => {
  expect(view({ days: [] }).rows).toEqual([])
  expect(view({ days: [] }).emptyText).toBe('No usage today')
  expect(view({ spend: 'loading' }).emptyText).toBe('Reading usage…')
})

test('paneKey moves with what the pane shows, the pace to the half dollar included, and not with the clock', () => {
  const key = (over: Partial<DesktopState> = {}) => paneKey(view(over))
  expect(key({ pacePerHour: 6.4 })).toBe(key({ pacePerHour: 6.6 }))
  expect(key({ pacePerHour: 6.4 })).not.toBe(key({ pacePerHour: 7.4 }))
  expect(key({ now: NOW + 60_000 })).toBe(key())
  expect(key({ period: 'all' })).not.toBe(key())
})

test('every bar is a whole percent, whatever the costs', () => {
  const costs = [123.456, 0.001, 7, 99.99, 0, 1e-9, 33.333]
  const days: DayEntry[] = [{ period: '2026-10-01', modelBreakdowns: costs.map((c, i) => row(`claude-opus-${i}-${i}`, c, 1)) }]
  for (const r of paneView(panelInput(state({ days }), 400), 56).rows) expect(/^\d{1,3}%$/.test(r.bar)).toBe(true)
})

test('the weekly percent is there as text for a pane drawn without its Svgs', () => {
  expect(view().weekUsed).toBe('39% used')
  expect(view({ week: null }).weekUsed).toBeNull()
})
