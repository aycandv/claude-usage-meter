import { test, expect } from 'claude-code/testing'

import { PALETTE, mix, smooth } from './palette'

test('mix returns the first color at t=0 and the second at t=1', () => {
  expect(mix(0x102030, 0xa0b0c0, 0)).toBe(0x102030)
  expect(mix(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0)
})

test('mix blends each channel on its own', () => {
  expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080)
  expect(mix(0xff0000, 0x0000ff, 0.5)).toBe(0x800080)
})

test('smooth eases from 0 to 1, meets at the middle and starts slowly', () => {
  expect(smooth(0)).toBe(0)
  expect(smooth(1)).toBe(1)
  expect(smooth(0.5)).toBe(0.5)
  expect(smooth(0.25)).toBeLessThan(0.25)
  expect(Math.abs(smooth(0.25) + smooth(0.75) - 1)).toBeLessThan(1e-9)
})

test('every palette color fits in 24 bits, as a Raster color must', () => {
  for (const color of Object.values(PALETTE)) {
    expect(color).toBeGreaterThanOrEqual(0)
    expect(color).toBeLessThanOrEqual(0xffffff)
  }
})
