import type { Cell } from './led'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard base64 with padding. Written out so it needs nothing from the host.
export const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!
    out += c === undefined ? '=' : ALPHABET[n & 63]!
  }
  return out
}

// A Raster's `cells`: per cell, glyph, foreground and background as little-endian 32-bit words.
export const cellBytes = (cells: readonly Cell[]): Uint8Array => {
  const out = new Uint8Array(cells.length * 12)
  const view = new DataView(out.buffer)
  cells.forEach(([cp, fg, bg], i) => {
    view.setUint32(i * 12, cp, true)
    view.setUint32(i * 12 + 4, fg, true)
    view.setUint32(i * 12 + 8, bg, true)
  })
  return out
}

export const encodeCells = (cells: readonly Cell[]): string => base64(cellBytes(cells))
