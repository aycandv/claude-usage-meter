// Colors are 0xRRGGBB, the form a Raster cell takes.
export const PALETTE = {
  panel: 0x10141c, // blue-black ink the board sits on
  track: 0x232b3a, // unlit gauge
  notch: 0xe9eef7, // where the calendar says you should be
  bulb: 0xf2e8d5, // lit LED, bright tone
  bulbDim: 0xb3ad9c, // lit LED, quiet tone
  label: 0x8d97aa, // gauge label and caption
  glacier: 0x7fb8e6,
  straw: 0xe9c46a,
  ember: 0xf4895b,
  signal: 0xf25c54,
} as const

export const mix = (a: number, b: number, t: number): number => {
  let out = 0
  for (const shift of [16, 8, 0]) {
    const x = (a >> shift) & 255
    const y = (b >> shift) & 255
    out |= Math.round(x + (y - x) * t) << shift
  }
  return out
}

export const smooth = (t: number): number => t * t * (3 - 2 * t)
