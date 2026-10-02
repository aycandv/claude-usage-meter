import { test, expect } from 'claude-code/testing'

import { arcPath, escape, fit, monoWidth, n, parseXml, polar, sansWidth, svgProblems, textOf } from './svg-util'

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const STYLE = '<style>:root{color-scheme:light dark} svg{background:transparent}</style>'
const svg = (body: string, attrs = 'width="10" height="20" viewBox="0 0 10 20"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${STYLE}${body}</svg>`

test('escape makes every markup character safe in text and attributes', () => {
  expect(escape(`<b> & "q" 'a'`)).toBe('&lt;b&gt; &amp; &quot;q&quot; &#39;a&#39;')
  expect(escape('opus 5.5')).toBe('opus 5.5')
})

test('n writes short, finite coordinates', () => {
  expect(n(1.23456)).toBe('1.23')
  expect(n(-0.001)).toBe('0')
  expect(n(Number.NaN)).toBe('0')
  expect(n(Infinity)).toBe('0')
  expect(n(40)).toBe('40')
})

test('polar starts at twelve o clock and turns clockwise', () => {
  const top = polar(10, 10, 5, 0)
  near(top.x, 10)
  near(top.y, 5)
  const right = polar(10, 10, 5, 0.25)
  near(right.x, 15)
  near(right.y, 10)
  const bottom = polar(10, 10, 5, 0.5)
  near(bottom.y, 15)
})

test('arcPath draws from the start fraction to the end fraction', () => {
  expect(arcPath(10, 10, 5, 0, 0.25)).toBe('M10 5A5 5 0 0 1 15 10')
  expect(arcPath(10, 10, 5, 0, 0.75)).toBe('M10 5A5 5 0 1 1 5 10') // past half a turn takes the large arc
  expect(arcPath(10, 10, 5, 0.25, 0.5)).toBe('M15 10A5 5 0 0 1 10 15')
})

test('arcPath draws nothing for an empty arc and two halves for a whole turn', () => {
  expect(arcPath(10, 10, 5, 0.3, 0.3)).toBe('')
  expect(arcPath(10, 10, 5, 0.6, 0.2)).toBe('')
  expect(arcPath(10, 10, 5, 0, 1)).toBe('M10 5A5 5 0 1 1 10 15A5 5 0 1 1 10 5')
  expect(arcPath(10, 10, 5, -1, 3)).toBe(arcPath(10, 10, 5, 0, 1)) // clamped to one turn
})

test('monoWidth counts characters at 0.6 em plus letter spacing', () => {
  expect(monoWidth('$42.18', 10)).toBe(36)
  expect(monoWidth('ab', 10, 1)).toBe(14)
  expect(monoWidth('', 10)).toBe(0)
})

test('sansWidth is wider for capitals and wide letters than for narrow ones', () => {
  expect(sansWidth('MMMM', 10)).toBeGreaterThan(sansWidth('mmmm', 10) - 0.001)
  expect(sansWidth('iiii', 10)).toBeLessThan(sansWidth('aaaa', 10))
  expect(sansWidth('today', 10)).toBeGreaterThan(20)
})

test('fit keeps text that fits and cuts the rest with an ellipsis', () => {
  const m = (s: string) => monoWidth(s, 10)
  expect(fit('opus', 100, m)).toBe('opus')
  expect(fit('a very long model name', 60, m)).toBe('a very lo…') // ten characters of 6 px
  expect(m(fit('a very long model name', 60, m))).toBeLessThanOrEqual(60)
  expect(fit('abc', 1, m)).toBe('')
})

test('parseXml reads elements, attributes and decoded text', () => {
  const r = parseXml(`<?xml version="1.0"?><a x="1" y='&lt;2'><!-- c --><b/>hi &amp; bye<c>t</c></a>`)
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.root.name).toBe('a')
  expect(r.root.attrs).toEqual({ x: '1', y: '<2' })
  expect(r.root.children.map(c => c.name)).toEqual(['b', 'c'])
  expect(textOf(r.root)).toBe('hi & byet')
})

test('parseXml refuses markup that is not well formed', () => {
  const bad = [
    '<a><b></a></b>',
    '<a>',
    '<a></a><b></b>',
    'x<a></a>',
    '<a x=1></a>',
    '<a x="1" x="2"></a>',
    '<a x="1"y="2"></a>',
    '<a>1 < 2</a>',
    '<a>fish & chips</a>',
    '<a x="<"></a>',
    '<a><!-- open</a>',
    '</a>',
    '',
  ]
  for (const s of bad) expect(parseXml(s).ok).toBe(false)
})

test('svgProblems passes a minimal standalone drawing', () => {
  expect(svgProblems(svg('<rect width="10" height="20" fill="url(#g)"/><use href="#g"/>'))).toEqual([])
})

test('svgProblems catches size, viewBox and the missing transparent style', () => {
  expect(svgProblems(svg('', 'width="10" height="20" viewBox="0 0 10 21"'))[0]).toContain('does not match')
  expect(svgProblems(svg('', 'width="10" viewBox="0 0 10 20"'))[0]).toContain('required')
  expect(svgProblems('<svg width="1" height="1" viewBox="0 0 1 1"></svg>')).toContain('missing the color-scheme and transparent background style')
  expect(svgProblems(svg(`<desc>${'x'.repeat(140000)}</desc>`))[0]).toContain('over 131072')
})

test('svgProblems catches scripts, event attributes and outside references', () => {
  expect(svgProblems(svg('<script>alert(1)</script>')).join()).toContain('<script>')
  expect(svgProblems(svg('<rect onclick="x()"/>')).join()).toContain('onclick')
  expect(svgProblems(svg('<use xlink:href="http://x.test/a.svg#b"/>')).join()).toContain('outside')
  expect(svgProblems(svg('<rect fill="url(http://x.test/p)"/>')).join()).toContain('outside')
  expect(svgProblems(svg('<image href="#a"/>')).join()).toContain('<image>')
  expect(svgProblems(svg('<foreignObject/>')).join()).toContain('<foreignObject>')
  expect(svgProblems(svg('<style>@import "x.css";</style>')).join()).toContain('outside')
  expect(svgProblems(svg('<x>no')).join()).toContain('not well formed')
})
