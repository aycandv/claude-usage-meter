// The desktop instrument panel's tokens: one dark glass card in either app theme, quiet text tones,
// and a single accent taken from the weekly heat ramp.
import { forecast, heat } from './gauge'
import type { Week } from './gauge'
import { PALETTE, mix } from './palette'
import { n } from './svg-util'

export const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`

export const INK = {
  cardTop: '#171d27',
  cardBottom: '#0d1117',
  edge: 'rgba(255,255,255,0.1)', // the card's hairline border
  rule: 'rgba(255,255,255,0.07)', // dividers inside the card
  track: hex(PALETTE.track),
  figure: hex(PALETTE.notch), // the numbers that matter
  text: hex(mix(PALETTE.notch, PALETTE.label, 0.42)), // names and words
  label: hex(PALETTE.label), // captions
  dim: hex(mix(PALETTE.label, PALETTE.panel, 0.38)), // the quietest marks
  notch: hex(PALETTE.notch),
} as const

export const FONT = {
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const

// The accent follows where the week lands; with no reading it rests on the coolest tone.
export const accentOf = (week: Week | null): number => (week === null ? PALETTE.glacier : heat(forecast(week.usedPct, week.elapsedFrac).projected))

// Every drawing starts with this: a transparent frame in both color schemes and the two type classes.
export const styleTag = (css: string): string =>
  '<style>:root{color-scheme:light dark} svg{background:transparent}' +
  `.m{font-family:${FONT.mono};font-variant-numeric:tabular-nums}` +
  `.s{font-family:${FONT.sans}}` +
  `${css}</style>`

// A soft halo: the shape blurred, faded to `strength`, laid under the crisp original.
export const glowFilter = (id: string, blur: number, strength: number): string =>
  `<filter id="${id}" x="-50%" y="-100%" width="200%" height="300%" color-interpolation-filters="sRGB">` +
  `<feGaussianBlur in="SourceGraphic" stdDeviation="${n(blur)}" result="b"/>` +
  `<feComponentTransfer in="b" result="g"><feFuncA type="linear" slope="${n(strength)}"/></feComponentTransfer>` +
  '<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'

// The glass card: a top-lit gradient, a hairline edge, and a faint highlight along the top.
export const cardDefs = (id: string, width: number): string =>
  `<linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK.cardTop}"/><stop offset="1" stop-color="${INK.cardBottom}"/></linearGradient>` +
  `<linearGradient id="${id}lit" x1="0" y1="0" x2="${n(width)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`

export const card = (id: string, width: number, height: number, radius: number): string =>
  `<rect x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="${n(radius)}" fill="url(#${id}bg)" stroke="${INK.edge}"/>` +
  `<path d="M${n(radius)} 1.5H${n(width - radius)}" stroke="url(#${id}lit)"/>`
