import { test, expect } from 'claude-code/testing'

import { hex } from './desktop-theme'
import type { Week } from './gauge'
import { PANEL_MAX_HEIGHT, barFractions, panelAlt, panelLayout, panelSvg, sparkPath, sparkPoints } from './panel-svg'
import type { PanelInput, PanelModel } from './panel-svg'
import { PALETTE } from './palette'
import { n, svgProblems, textOverflow } from './svg-util'

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const week = (usedPct: number, elapsedFrac: number): Week => ({ usedPct, elapsedFrac, resetsAtMs: NOW + (1 - elapsedFrac) * 7 * DAY })

const model = (name: string, cost: number): PanelModel => ({ name, value: `$${cost.toFixed(2)}`, cost, tooltip: `${name}: $${cost.toFixed(2)}` })
const MODELS = [model('opus 5.5', 31.5), model('sonnet 5.5', 8.2), model('haiku 4.5', 1.86), model('fable 5.1', 0.62)]
const EIGHT = [...MODELS, model('opus 4.1', 0.5), model('sonnet 4', 0.4), model('gpt 5.1', 0.3), model('3 others', 0.2)]
const DAILY = [18.4, 22.1, 9.6, 4.2, 26.8, 31.5, 12, 15.3, 28.9, 36.2, 19.7, 7.4, 24.6, 42.18].map((cost, i) => ({ label: `Sep ${18 + i}`, cost }))
const input = (over: Partial<PanelInput> = {}): PanelInput => ({
  width: 420,
  title: 'today',
  total: '$42.18',
  tokens: '96M tokens',
  range: 'Oct 1',
  models: MODELS,
  daily: DAILY,
  week: week(39, 0.5),
  now: NOW,
  offsetMin: 120,
  pacePerHour: 6.4,
  source: 'Prices are ccusage estimates',
  ...over,
})
const size = (svg: string) => /width="(\d+)" height="(\d+)"/.exec(svg)!.slice(1).map(Number)

test('barFractions scales each model to the biggest, and a bad cost to nothing', () => {
  expect(barFractions([model('a', 40), model('b', 10), model('c', 0)])).toEqual([1, 0.25, 0])
  expect(barFractions([{ ...model('a', 1), cost: Number.NaN }, { ...model('b', 1), cost: -5 }])).toEqual([0, 0])
  expect(barFractions([])).toEqual([])
})

test('sparkPoints spans the box, the highest day at its top and a quiet day on its floor', () => {
  const pts = sparkPoints([{ label: 'a', cost: 0 }, { label: 'b', cost: 10 }, { label: 'c', cost: 5 }], 10, 100, 200, 40)
  expect(pts).toEqual([{ x: 10, y: 140 }, { x: 110, y: 100 }, { x: 210, y: 120 }])
  expect(sparkPoints([{ label: 'a', cost: 3 }], 10, 100, 200, 40)).toEqual([{ x: 210, y: 100 }]) // a lone day is today, at the right
  expect(sparkPoints([{ label: 'a', cost: 0 }, { label: 'b', cost: 0 }], 0, 0, 10, 10).map(p => p.y)).toEqual([10, 10])
})

test('sparkPath is a smooth line that never swings above the peak or below the floor', () => {
  const pts = sparkPoints(DAILY, 0, 100, 300, 40)
  const d = sparkPath(pts)
  expect(d.startsWith(`M${n(pts[0]!.x)} ${n(pts[0]!.y)}C`)).toBe(true)
  expect(d.split('C')).toHaveLength(DAILY.length)
  const ys = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => Number(m[2]))
  for (const y of ys) {
    expect(y).toBeGreaterThanOrEqual(100 - 0.01)
    expect(y).toBeLessThanOrEqual(140 + 0.01)
  }
  expect(sparkPath([])).toBe('')
  expect(sparkPath([{ x: 1, y: 2 }])).toBe('M1 2')
})

test('every panel is a safe, standalone, well formed drawing', () => {
  const cases: Partial<PanelInput>[] = [
    {},
    { width: 360 },
    { width: 480, models: EIGHT },
    { week: null, pacePerHour: null },
    { week: week(72, 0.55), pacePerHour: 18.9 },
    { models: [], daily: [], week: null },
    { daily: DAILY.slice(-1) },
    { pacePerHour: Number.NaN },
  ]
  for (const c of cases) expect(svgProblems(panelSvg(input(c)))).toEqual([])
})

test('the panel keeps its width in range and its height under the cap with eight rows', () => {
  expect(size(panelSvg(input({ width: 100 })))[0]).toBe(360)
  expect(size(panelSvg(input({ width: 9999 })))[0]).toBe(480)
  for (const width of [360, 420, 480]) {
    const layout = panelLayout(input({ width, models: EIGHT }))
    expect(layout.height).toBeLessThanOrEqual(PANEL_MAX_HEIGHT)
    expect(layout.bottom).toBeLessThan(layout.height) // the last section ends inside the card
    expect(size(panelSvg(input({ width, models: EIGHT })))[1]).toBe(layout.height)
  }
})

test('a short panel uses the roomiest rows; a full one tightens them', () => {
  const roomy = panelLayout(input())
  const full = panelLayout(input({ models: EIGHT }))
  expect(roomy.rowH).toBeGreaterThan(full.rowH)
  expect(full.height).toBeGreaterThan(roomy.height)
})

test('the empty states speak calmly', () => {
  const svg = panelSvg(input({ models: [], daily: [], week: null, pacePerHour: null }))
  expect(svg).toContain('No usage today')
  expect(svg).toContain('No daily history yet')
  expect(svg).toContain('No weekly limit reading yet')
  expect(svg).not.toContain('Pace')
  expect(textOverflow(svg)).toEqual([])
})

test('the week reads in words beside the ring, with the pace', () => {
  const svg = panelSvg(input())
  expect(svg).toContain('>Lands near 78%, resets Mon</text>')
  expect(svg).toContain('$6.40/h')
  expect(svg).toContain('>39<tspan')
})

test('a week that runs out says so in the signal color', () => {
  const svg = panelSvg(input({ week: week(72, 0.55) }))
  expect(svg).toContain(`fill="${hex(PALETTE.signal)}">Runs out`)
})

test('the daily chart has a tooltip per day and marks today', () => {
  const svg = panelSvg(input())
  expect(svg.split('class="day"')).toHaveLength(DAILY.length + 1)
  expect(svg).toContain('<title>Sep 31: $42.18</title>')
  expect(svg).toContain('peak <tspan class="m"')
})

test('the panel escapes every text it is given', () => {
  const evil = `<b>&"'`
  const svg = panelSvg(input({ title: evil, total: evil, tokens: evil, range: evil, source: evil, models: [{ name: evil, value: evil, cost: 1, tooltip: evil }], daily: [{ label: evil, cost: 1 }] }))
  expect(svgProblems(svg)).toEqual([])
  expect(svg).not.toContain('<b>')
  expect(svg).toContain('&lt;b&gt;&amp;&quot;&#39;')
})

test('text stays inside the card for long names and big figures at every width', () => {
  const long = [model('a model with a remarkably long name indeed', 123456.78), model('3 others', 1)]
  for (const width of [360, 420, 480]) {
    const svg = panelSvg(input({ width, total: '$1,234,567.89', tokens: '12.3B tokens', range: 'since Jan 2025', models: long, source: 'Prices are ccusage estimates, which are not your bill' }))
    expect(textOverflow(svg)).toEqual([])
  }
})

test('panelAlt says the total, the models and the week in words', () => {
  expect(panelAlt(input({ models: MODELS.slice(0, 1) }))).toBe('$42.18 today, 96M tokens, Oct 1. opus 5.5 $31.50. weekly limit 39% used, Lands near 78%, resets Mon')
  expect(panelAlt(input({ models: [], week: null }))).toBe('$42.18 today, 96M tokens, Oct 1. no weekly limit reading yet')
})

test('with the tabs above the card instead of over it, the header band goes and the card is that much shorter', () => {
  const over = panelLayout(input())
  const above = panelLayout(input({ header: 0 }))
  expect(over.height - above.height).toBe(42) // the 40 px band, and the total sits 2 px higher
  const svg = panelSvg(input({ header: 0 }))
  expect(svgProblems(svg)).toEqual([])
  expect(textOverflow(svg)).toEqual([])
  expect(svg).toContain('y="44" font-size="30"') // the total sits near the top
  expect(panelSvg(input())).toContain('y="86" font-size="30"')
})

test('a diagnostic line sits small at the foot of the panel, escaped and inside the card', () => {
  const plain = panelSvg(input())
  const svg = panelSvg(input({ diag: 'diag: renders 11, changes 5, invalidates 7, last: <total+cards>' }))
  expect(svg).toContain('>diag: renders 11, changes 5, invalidates 7, last: &lt;total+cards&gt;</text>')
  expect(svgProblems(svg)).toEqual([])
  expect(textOverflow(svg)).toEqual([])
  expect(size(svg)[1]!).toBeGreaterThan(size(plain)[1]!)
  expect(plain).not.toContain('diag:')
  expect(size(panelSvg(input({ width: 480, models: EIGHT, diag: 'diag: x' })))[1]).toBeLessThanOrEqual(PANEL_MAX_HEIGHT)
})

test('the weekly sentence and each model in full are in the panel, where the strip tooltips used to carry them', () => {
  const svg = panelSvg(input())
  expect(svg).toContain('<title>Weekly limit 39% used. Lands near 78%, resets Mon</title>')
  expect(svg).toContain('<title>opus 5.5: $31.50</title>') // each row carries the caller's full tooltip
  expect(svg).toContain('>Lands near 78%, resets Mon</text>') // and the sentence is on show, not only on hover
})

test('a diagnostic line too long for the card breaks before its last reason', () => {
  const svg = panelSvg(input({ width: 360, diag: 'diag: renders 1234, changes 567, invalidates 890, last: period+total+cards+range' }))
  expect(svg).toContain('>diag: renders 1234, changes 567, invalidates 890</text>')
  expect(svg).toContain('>last: period+total+cards+range</text>')
  expect(textOverflow(svg)).toEqual([])
})
