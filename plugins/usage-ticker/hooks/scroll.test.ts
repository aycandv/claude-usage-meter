import { test, expect } from 'claude-code/testing'

import { ACCEL, DECEL, newScroll, remapOffset, stepScroll } from './scroll'
import type { Scroll } from './scroll'

const DT = 0.05
const run = (s: Scroll, seconds: number, target: number) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) stepScroll(s, DT, target)
  return s
}

test('a new crawl starts with the first card in view, standing still', () => {
  expect(newScroll(12)).toEqual({ offset: -12, v: 0 })
})

test('it speeds up toward the target at the acceleration limit and settles exactly on it', () => {
  const s = newScroll(12)
  stepScroll(s, DT, 20)
  expect(s.v).toBeLessThanOrEqual(ACCEL * DT + 1e-9)
  run(s, 3, 20)
  expect(s.v).toBe(20)
})

test('it slows toward a lower target at the deceleration limit and never goes below it', () => {
  const s: Scroll = { offset: 0, v: 40 }
  stepScroll(s, DT, 6)
  expect(40 - s.v).toBeLessThanOrEqual(DECEL * DT + 1e-9)
  run(s, 5, 6)
  expect(s.v).toBe(6)
})

test('the strip advances by speed times time', () => {
  const s: Scroll = { offset: 100, v: 10 }
  run(s, 2, 10)
  expect(Math.abs(s.offset - 120)).toBeLessThan(1e-9)
})

test('a target of zero brings it to a stop', () => {
  const s = run({ offset: 0, v: 12 }, 3, 0)
  expect(s.v).toBe(0)
})

test('a target that is negative or not a number means standing still', () => {
  expect(run({ offset: 0, v: 5 }, 3, -4).v).toBe(0)
  expect(run({ offset: 0, v: 5 }, 3, Number.NaN).v).toBe(0)
})

test('one huge time step, as after a stalled timer, moves it by half a second at most', () => {
  const s: Scroll = { offset: 0, v: 20 }
  stepScroll(s, 10, 20)
  expect(Math.abs(s.offset - 10)).toBeLessThan(1e-9)
})

test('remapOffset keeps the same relative position when the strip gets longer or shorter', () => {
  expect(remapOffset(75, 150, 300)).toBe(150) // halfway through stays halfway through
  expect(remapOffset(75, 150, 100)).toBe(50)
  expect(remapOffset(0, 150, 300)).toBe(0)
})

test('remapOffset drops whole laps first, also when the offset is negative', () => {
  expect(remapOffset(375, 150, 300)).toBe(150) // two laps and halfway
  expect(Math.abs(remapOffset(-12, 150, 300) - 276)).toBeLessThan(1e-9) // 12 pixels before the start is 138 of 150
})

test('remapOffset keeps the position inside the new strip', () => {
  for (const offset of [-1e6, -12, 0, 149.9, 150, 1e6 + 0.5]) {
    const out = remapOffset(offset, 150, 220)
    expect(out).toBeGreaterThanOrEqual(0)
    expect(out).toBeLessThan(220)
  }
})

test('remapOffset leaves an offset alone when the strip keeps its length', () => {
  expect(remapOffset(375.5, 150, 150)).toBe(375.5)
  expect(remapOffset(-12, 150, 150)).toBe(-12)
})

test('remapOffset leaves the offset alone when either strip is empty', () => {
  expect(remapOffset(40, 0, 150)).toBe(40)
  expect(remapOffset(40, 150, 0)).toBe(40)
  expect(remapOffset(-12, 0, 0)).toBe(-12)
})
