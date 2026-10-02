import { test, expect } from 'claude-code/testing'

import type { Week } from './gauge'
import { STRIP_HEIGHT, layoutCards, stillOffset, stripAlt, stripSvg, tickerMotion, tileCount, trackWidth } from './strip-svg'
import type { StripInput, TickerCard } from './strip-svg'
import { parseXml, svgProblems, textOverflow, walk } from './svg-util'

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const week = (usedPct: number, elapsedFrac: number): Week => ({ usedPct, elapsedFrac, resetsAtMs: NOW + (1 - elapsedFrac) * 7 * DAY })
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

const card = (name: string, value: string, share: number): TickerCard => ({ name, value, share, tooltip: `${name}: ${value}, ${Math.round(share * 100)}% of today` })
const CARDS = [card('opus 5.5', '$31.50', 0.75), card('sonnet 5.5', '$8.20', 0.19), card('haiku 4.5', '$1.86', 0.04), card('fable 5.1', '$0.62', 0.01)]
const input = (over: Partial<StripInput> = {}): StripInput => ({
  width: 770,
  title: 'today',
  total: '$42.18',
  tokens: '96M tokens',
  cards: CARDS,
  week: week(39, 0.5),
  now: NOW,
  offsetMin: 120,
  speedPxPerSec: 6,
  phasePx: 0,
  rangeChip: 'Oct 1',
  ...over,
})

const count = (s: string, needle: string) => s.split(needle).length - 1
const attr = (svg: string, name: string, key: string): string[] => {
  const p = parseXml(svg)
  const out: string[] = []
  if (p.ok) walk(p.root, node => node.name === name && node.attrs[key] !== undefined && out.push(node.attrs[key]!))
  return out
}

test('tickerMotion takes one loop of the track at the given speed', () => {
  expect(tickerMotion(300, 6, 0)).toEqual({ dur: 50, begin: 0 })
  expect(tickerMotion(440, 44, 0)?.dur).toBe(10)
})

test('tickerMotion turns the distance already travelled into a negative begin, wrapped to one loop', () => {
  expect(tickerMotion(300, 6, 30)?.begin).toBe(-5)
  expect(tickerMotion(300, 6, 330)?.begin).toBe(-5)
  expect(tickerMotion(300, 6, 600)?.begin).toBe(0)
  expect(tickerMotion(300, 6, -30)?.begin).toBe(-45) // a phase behind the start is the same place one loop on
})

test('tickerMotion is still, never a division by zero, without a usable speed or track', () => {
  for (const speed of [0, -3, Number.NaN, Infinity]) expect(tickerMotion(300, speed, 10)).toBeNull()
  expect(tickerMotion(0, 6, 10)).toBeNull()
  expect(tickerMotion(Number.NaN, 6, 10)).toBeNull()
})

test('stillOffset wraps the phase into one track', () => {
  expect(stillOffset(300, 450)).toBe(150)
  expect(stillOffset(300, -50)).toBe(250)
  expect(stillOffset(0, 50)).toBe(0)
  expect(stillOffset(300, Number.NaN)).toBe(0)
})

test('tileCount lays enough copies that the window is covered wherever the loop is', () => {
  expect(tileCount(300, 250)).toBe(2)
  expect(tileCount(100, 250)).toBe(4)
  expect(tileCount(0, 250)).toBe(1)
  for (const track of [40, 99, 250, 333, 1000]) {
    for (const visible of [10, 180, 400, 900]) {
      const k = tileCount(track, visible)
      // The first copy may have slid a whole track left; what is left must still reach the right edge.
      expect((k - 1) * track).toBeGreaterThanOrEqual(visible)
    }
  }
})

test('a short crawl is padded to its window so it passes alone; a fuller one repeats back to back', () => {
  expect(trackWidth(120, 400)).toBe(400)
  expect(trackWidth(199, 400)).toBe(400)
  expect(trackWidth(200, 400)).toBe(200)
  expect(trackWidth(900, 400)).toBe(900)
})

test('layoutCards places the cards one after another, names in capitals', () => {
  const { placed, contentWidth } = layoutCards(CARDS)
  expect(placed.map(p => p.name)).toEqual(['OPUS 5.5', 'SONNET 5.5', 'HAIKU 4.5', 'FABLE 5.1'])
  expect(placed[0]!.x).toBe(0)
  for (let i = 1; i < placed.length; i++) expect(placed[i]!.x).toBeGreaterThan(placed[i - 1]!.x + placed[i - 1]!.w)
  expect(contentWidth).toBeGreaterThan(placed[3]!.x + placed[3]!.w)
  expect(layoutCards([])).toEqual({ placed: [], contentWidth: 0 })
})

test('layoutCards cuts an absurdly long name or value', () => {
  const { placed } = layoutCards([card('x'.repeat(80), `$${'9'.repeat(40)}`, 1)])
  expect(placed[0]!.name.endsWith('…')).toBe(true)
  expect(placed[0]!.value.endsWith('…')).toBe(true)
})

test('every strip is a safe, standalone, well formed drawing', () => {
  const cases: Partial<StripInput>[] = [
    {},
    { width: 420 },
    { width: 1100 },
    { week: null },
    { week: week(72, 0.55) },
    { week: week(130, 0.9) },
    { cards: [] },
    { cards: CARDS.slice(0, 1) },
    { speedPxPerSec: 0 },
    { phasePx: 1e9 },
  ]
  for (const c of cases) expect(svgProblems(stripSvg(input(c)))).toEqual([])
})

test('the strip is 48 high, and its width stays in range', () => {
  const sizes = (w: number) => /width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(stripSvg(input({ width: w })))!.slice(1).map(Number)
  expect(sizes(770)).toEqual([770, STRIP_HEIGHT, 770, STRIP_HEIGHT])
  expect(sizes(100)).toEqual([420, 48, 420, 48])
  expect(sizes(5000)).toEqual([1100, 48, 1100, 48])
  expect(sizes(Number.NaN)).toEqual([420, 48, 420, 48])
})

test('the ticker animates by its track width, resuming at the phase it was given', () => {
  const svg = stripSvg(input({ phasePx: 200, speedPxPerSec: 10 }))
  const anim = /<animateTransform[^>]*\/>/.exec(svg)![0]
  const to = Number(/to="(-?[\d.]+) 0"/.exec(anim)![1])
  const dur = Number(/dur="([\d.]+)s"/.exec(anim)![1])
  const begin = Number(/begin="(-?[\d.]+)s"/.exec(anim)![1])
  const track = -to
  near(dur, Math.round((track / 10) * 1000) / 1000)
  expect(begin).toBeLessThanOrEqual(0)
  expect(-begin).toBeLessThan(dur)
  expect(anim).toContain('repeatCount="indefinite"')
  // Moving on: a later phase starts further into the loop by exactly the distance travelled.
  const later = /begin="(-?[\d.]+)s"/.exec(stripSvg(input({ phasePx: 230, speedPxPerSec: 10 })))!
  near(Math.round((Number(later[1]) - begin) * 1000) / 1000, -3)
})

test('a still ticker has no animation and rests where the phase left it', () => {
  const svg = stripSvg(input({ speedPxPerSec: 0 }))
  expect(svg).not.toContain('animateTransform')
  expect(count(svg, 'class="k"')).toBeGreaterThan(0)
})

test('reduced motion swaps the moving ticker for a still copy', () => {
  const svg = stripSvg(input())
  expect(svg).toContain('@media (prefers-reduced-motion:reduce){.moving{display:none}.still{display:inline}}')
  expect(svg).toContain('class="moving"')
  expect(svg).toContain('class="still"')
})

test('each copy of the track holds every card, with its tooltip', () => {
  const svg = stripSvg(input())
  const cards = count(svg, 'class="k"')
  expect(cards % CARDS.length).toBe(0)
  expect(cards).toBeGreaterThanOrEqual(CARDS.length * 2 * 2) // at least two copies, moving and still
  expect(count(svg, '<title>opus 5.5: $31.50, 75% of today</title>')).toBe(cards / CARDS.length)
})

test('the ticker sits under a clip and a fade mask, the copies meet exactly one track apart', () => {
  const svg = stripSvg(input({ speedPxPerSec: 0 }))
  expect(svg).toContain('clip-path="url(#usclip)"')
  expect(svg).toContain('mask="url(#usfade)"')
  const xs = attr(svg, 'text', 'x')
  const names = attr(svg, 'text', 'class').map((c, i) => [c, xs[i]] as const).filter(([c]) => c === 'm nm').map(([, x]) => Number(x))
  const gaps = new Set(names.slice(CARDS.length).map((x, i) => Math.round((x - names[i]!) * 100) / 100))
  expect(gaps.size).toBe(1) // every card is the same distance from its twin in the next copy
})

test('the strip escapes every text it is given', () => {
  const evil = `<b>&"'`
  const svg = stripSvg(input({ title: evil, total: evil, tokens: evil, rangeChip: evil, cards: [{ name: evil, value: evil, share: 0.5, tooltip: evil }] }))
  expect(svgProblems(svg)).toEqual([])
  expect(svg).not.toContain('<b>')
  expect(svg).toContain('&lt;B&gt;&amp;&quot;&#39;') // the card name, in capitals
  expect(svg).toContain('<title>&lt;b&gt;&amp;&quot;&#39;</title>')
})

test('text outside the ticker stays inside the strip, however long the figures', () => {
  for (const width of [420, 560, 770, 1100]) {
    const svg = stripSvg(input({ width, title: 'all time', total: '$1,234,567.89', tokens: '12.3B tokens', rangeChip: 'since Jan 2025, a very long label' }))
    expect(textOverflow(svg)).toEqual([])
  }
})

test('the range label shows on a roomy strip and gives way on a narrow one', () => {
  expect(stripSvg(input({ width: 770 }))).toContain('>Oct 1</text>')
  expect(stripSvg(input({ width: 420 }))).not.toContain('>Oct 1</text>')
})

test('an empty period says so quietly and does not move', () => {
  const svg = stripSvg(input({ cards: [] }))
  expect(svg).toContain('No usage yet')
  expect(svg).not.toContain('animateTransform')
})

test('without a weekly reading the ring is an empty track with a dash', () => {
  const svg = stripSvg(input({ week: null }))
  expect(svg).toContain('>–</text>')
  expect(svg).toContain('Weekly limit: no reading yet')
  expect(svg).not.toContain('stroke-linecap="round"/><path') // no arcs, no notch
})

test('the ring reports the week in its tooltip and its middle', () => {
  const svg = stripSvg(input())
  expect(svg).toContain('<title>Weekly limit 39% used. Lands near 78%, resets Mon</title>')
  expect(svg).toContain('>39</text>')
})

test('a long crawl of long cards at the widest strip stays far under the size cap', () => {
  const many = Array.from({ length: 9 }, (_, i) => card(`model with a long name ${i}`, '$1,234.56', 0.1))
  expect(stripSvg(input({ width: 1100, cards: many })).length).toBeLessThan(65536)
})

test('stripAlt says the total, the models and the week in words', () => {
  expect(stripAlt(input())).toBe('$42.18 today, 96M tokens. opus 5.5 $31.50, sonnet 5.5 $8.20, haiku 4.5 $1.86, fable 5.1 $0.62. weekly limit 39% used, Lands near 78%, resets Mon')
})

test('a diagnostic line rides at the end of the ring tooltip, escaped, and nowhere else', () => {
  const svg = stripSvg(input({ diag: 'diag: renders 3, changes 1, invalidates 1, last: <speed>' }))
  expect(svg).toContain('<title>Weekly limit 39% used. Lands near 78%, resets Mon\ndiag: renders 3, changes 1, invalidates 1, last: &lt;speed&gt;</title>')
  expect(svgProblems(svg)).toEqual([])
  expect(stripSvg(input())).not.toContain('diag:')
  expect(stripSvg(input({ week: null, diag: 'diag: x' }))).toContain('<title>Weekly limit: no reading yet\ndiag: x</title>')
})
