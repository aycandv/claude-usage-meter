import { PALETTE, mix, smooth } from './palette'

// A Raster cell: code point, foreground, background.
export type Cell = [codePoint: number, fg: number, bg: number]
export type Tone = 0 | 1
export type StripColumn = { m: number; tone: Tone }
export type Board = { strip: StripColumn[]; starts: number[]; length: number }
export type CardText = { name: string; value: string; extra: string }

export const TONE_BRIGHT: Tone = 0
export const TONE_DIM: Tone = 1
export const ADVANCE = 6 // a 5 pixel glyph and a 1 pixel gap
export const SEP_DOTS = 0b0101010 // the dotted tick between cards

// 5x7 dot-matrix face. Capitals, digits and the few symbols a price needs.
export const FONT_ROWS: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

const BRAILLE_LEFT = [0x01, 0x02, 0x04, 0x40] // left pixel column, top to bottom
const BRAILLE_RIGHT = [0x08, 0x10, 0x20, 0x80] // right pixel column

// The 5 column masks of a glyph, row 0 in bit 0. A character the font lacks is blank.
export const glyphCols = (ch: string): number[] => {
  const rows = FONT_ROWS[ch] ?? FONT_ROWS[' ']!
  const cols: number[] = []
  for (let x = 0; x < 5; x++) {
    let m = 0
    for (let y = 0; y < 7; y++) if (rows[y]?.[x] === '#') m |= 1 << y
    cols.push(m)
  }
  return cols
}

const textStrip = (text: string, tone: Tone): StripColumn[] => {
  const out: StripColumn[] = []
  for (const ch of text) {
    for (const m of glyphCols(ch.toUpperCase())) out.push({ m, tone })
    out.push({ m: 0, tone })
  }
  return out
}

const blank = (n: number): StripColumn[] => Array.from({ length: n }, () => ({ m: 0, tone: TONE_DIM }))

// One long 8 pixel tall bitmap of every card, and where each card begins in it.
export const buildStrip = (cards: readonly CardText[]): Board => {
  const strip: StripColumn[] = []
  const starts: number[] = []
  for (const card of cards) {
    starts.push(strip.length)
    strip.push(...textStrip(card.name, TONE_DIM), ...blank(ADVANCE * 2))
    strip.push(...textStrip(card.value, TONE_BRIGHT), ...blank(ADVANCE * 2))
    strip.push(...textStrip(card.extra, TONE_DIM))
    strip.push(...blank(16), { m: SEP_DOTS, tone: TONE_DIM }, ...blank(16))
  }
  return { strip, starts, length: strip.length }
}

// The crawl as two rows of braille cells, `offset` pixels into the strip, with soft ends.
export const crawlCells = (board: Board, offset: number, cols: number, fadeCells: number): Cell[] => {
  const cells: Cell[] = []
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      let bits = 0
      let tone: Tone | null = null
      for (let px = 0; px < 2 && board.length > 0; px++) {
        const x = Math.floor(offset) + c * 2 + px
        const col = board.strip[((x % board.length) + board.length) % board.length]!
        const nibble = (col.m >> (4 * r)) & 0xf
        if (!nibble) continue
        if (tone === null) tone = col.tone
        for (let dy = 0; dy < 4; dy++) {
          if (nibble & (1 << dy)) bits |= (px === 0 ? BRAILLE_LEFT : BRAILLE_RIGHT)[dy]!
        }
      }
      const edge = Math.min(c + 0.5, cols - c - 0.5) / fadeCells
      const strength = edge >= 1 ? 1 : smooth(Math.max(0, edge))
      const lit = tone === TONE_DIM ? PALETTE.bulbDim : PALETTE.bulb
      cells.push([bits ? 0x2800 + bits : 0x20, mix(PALETTE.panel, lit, strength), PALETTE.panel])
    }
  }
  return cells
}
