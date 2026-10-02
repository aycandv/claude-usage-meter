import { test, expect } from 'claude-code/testing'

import { accentOf, hex } from './desktop-theme'
import type { Week } from './gauge'
import { heat } from './gauge'
import { PALETTE } from './palette'
import { notchAngle, ringModel, ringSvg } from './ring-svg'
import { arcPath } from './svg-util'

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)
const week = (usedPct: number, elapsedFrac: number | null): Week => ({ usedPct, elapsedFrac, resetsAtMs: null })
const SIZE = { cx: 20, cy: 20, r: 10, stroke: 3 }

test('ringModel fills what is used and ghosts out to where the week lands', () => {
  const r = ringModel(week(39, 0.5))
  near(r.fill, 0.39)
  near(r.ghost, 0.78)
  expect(r.notch).toBe(0.5)
  expect(r.pct).toBe('39')
  expect(r.accent).toBe(heat(78))
})

test('ringModel never draws the ghost or the fill past a full turn', () => {
  const hot = ringModel(week(72, 0.55))
  near(hot.fill, 0.72)
  expect(hot.ghost).toBe(1)
  const over = ringModel(week(120, 0.9))
  expect(over.fill).toBe(1)
  expect(over.ghost).toBe(1)
  expect(over.pct).toBe('120')
})

test('ringModel without a forecast has no ghost, and without a reset time no notch', () => {
  const r = ringModel(week(30, null))
  expect(r.ghost).toBe(r.fill)
  expect(r.notch).toBeNull()
  expect(ringModel(week(30, 0.01)).ghost).toBe(0.3) // too early in the week to forecast
})

test('notchAngle starts at twelve o clock and runs clockwise', () => {
  expect(notchAngle(0)).toBe(-90)
  expect(notchAngle(0.25)).toBe(0)
  expect(notchAngle(0.5)).toBe(90)
  expect(notchAngle(1)).toBe(270)
  expect(notchAngle(2)).toBe(270)
})

test('ringSvg draws the fill arc in the heat color over a fainter ghost of the same hue', () => {
  const r = ringModel(week(39, 0.5))
  const svg = ringSvg(SIZE, r)
  expect(svg).toContain(`d="${arcPath(20, 20, 10, 0, 0.39)}"`)
  expect(svg).toContain(`d="${arcPath(20, 20, 10, 0.39, 0.78)}"`)
  expect(svg).toContain(`stroke="${hex(heat(78))}"`)
  expect(svg).toContain('stroke-opacity="0.3"')
  expect(svg.indexOf(arcPath(20, 20, 10, 0.39, 0.78))).toBeLessThan(svg.indexOf(arcPath(20, 20, 10, 0, 0.39))) // ghost underneath
})

test('ringSvg puts the notch across the ring at the calendar position', () => {
  const svg = ringSvg(SIZE, ringModel(week(10, 0.25)))
  // A quarter of the week is three o clock: a horizontal tick right of the centre.
  expect(svg).toContain('d="M27.15 20L32.85 20"')
})

test('ringSvg with no reading is a quiet empty track', () => {
  const svg = ringSvg(SIZE, null)
  expect(svg.startsWith('<circle')).toBe(true)
  expect(svg).not.toContain('<path')
})

test('the accent is glacier with no reading, and runs the heat ramp to signal', () => {
  expect(accentOf(null)).toBe(PALETTE.glacier)
  expect(accentOf(week(22, 0.5))).toBe(PALETTE.glacier)
  expect(accentOf(week(72, 0.55))).toBe(PALETTE.signal)
  expect(accentOf(week(39, 0.5))).toBe(heat(78))
})
