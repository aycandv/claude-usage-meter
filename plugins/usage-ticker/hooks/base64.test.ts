import { test, expect } from 'claude-code/testing'

import { base64, cellBytes, encodeCells } from './base64'
import type { Cell } from './led'

const bytes = (s: string) => Uint8Array.from(s, ch => ch.charCodeAt(0))

test('base64 matches the standard test vectors, with padding', () => {
  expect(base64(bytes(''))).toBe('')
  expect(base64(bytes('f'))).toBe('Zg==')
  expect(base64(bytes('fo'))).toBe('Zm8=')
  expect(base64(bytes('foo'))).toBe('Zm9v')
  expect(base64(bytes('foob'))).toBe('Zm9vYg==')
  expect(base64(bytes('fooba'))).toBe('Zm9vYmE=')
  expect(base64(bytes('foobar'))).toBe('Zm9vYmFy')
})

test('base64 handles every byte value', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i)
  const text = base64(all)
  expect(text.length).toBe(Math.ceil(256 / 3) * 4)
  expect(text.startsWith('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v')).toBe(true)
  expect(text.endsWith('/P3+/w==')).toBe(true) // 255 bytes in whole groups, then the single byte 0xff
})

test('cellBytes writes each cell as three little-endian 32-bit words: glyph, foreground, background', () => {
  const cell: Cell = [0x2801, 0x0a0b0c, 0x112233]
  expect(Array.from(cellBytes([cell]))).toEqual([0x01, 0x28, 0, 0, 0x0c, 0x0b, 0x0a, 0, 0x33, 0x22, 0x11, 0])
})

test('cellBytes keeps cells in order', () => {
  const out = cellBytes([
    [0x41, 0, 0],
    [0x42, 0, 0],
  ])
  expect(out).toHaveLength(24)
  expect(out[0]).toBe(0x41)
  expect(out[12]).toBe(0x42)
})

test('encodeCells is the base64 of those bytes', () => {
  const cells: Cell[] = [[0x41, 0x000001, 0x000002]]
  expect(encodeCells(cells)).toBe(base64(cellBytes(cells)))
  expect(encodeCells(cells)).toBe('QQAAAAEAAAACAAAA')
})
