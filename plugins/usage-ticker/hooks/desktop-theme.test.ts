import { test, expect } from 'claude-code/testing'

import { FONT, INK, card, cardDefs, glowFilter, hex, styleTag } from './desktop-theme'
import { PALETTE } from './palette'
import { svgProblems } from './svg-util'

test('hex writes a six digit color', () => {
  expect(hex(PALETTE.glacier)).toBe('#7fb8e6')
  expect(hex(0x000a0b)).toBe('#000a0b')
})

test('the ink tokens are hex or rgba, derived from the board palette', () => {
  expect(INK.track).toBe('#232b3a')
  expect(INK.label).toBe('#8d97aa')
  expect(INK.figure).toBe('#e9eef7')
  for (const v of Object.values(INK)) expect(/^(#[0-9a-f]{6}|rgba\([\d., ]+\))$/.test(v)).toBe(true)
})

test('styleTag declares the transparent frame and both type stacks', () => {
  const s = styleTag('.x{fill:red}')
  expect(s).toContain(':root{color-scheme:light dark} svg{background:transparent}')
  expect(s).toContain(FONT.mono)
  expect(s).toContain(FONT.sans)
  expect(s).toContain('tabular-nums')
  expect(s).toContain('.x{fill:red}')
})

test('the card, its gradients and the glow make a valid standalone drawing', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="48" viewBox="0 0 100 48">${styleTag('')}<defs>${cardDefs('t', 100)}${glowFilter('tg', 3, 0.4)}</defs>${card('t', 100, 48, 10)}</svg>`
  expect(svgProblems(svg)).toEqual([])
  expect(svg).toContain('stdDeviation="3"')
  expect(svg).toContain('slope="0.4"')
  expect(svg).toContain('fill="url(#tbg)"')
})
