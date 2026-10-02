// Renders the desktop strip and panel from invented figures into a folder of SVGs, HTML scenes and 2x PNG
// screenshots (headless Chrome), plus a contact sheet. Every number here is made up.
//
//   bun dev/design/render.ts <out-dir> [chrome-binary]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { Week } from '../../hooks/gauge'
import { panelSvg } from '../../hooks/panel-svg'
import type { PanelInput, PanelModel } from '../../hooks/panel-svg'
import { STRIP_HEIGHT, stripSvg } from '../../hooks/strip-svg'
import type { StripInput, TickerCard } from '../../hooks/strip-svg'
import { svgProblems } from '../../hooks/svg-util'

const OUT = resolve(process.argv[2] ?? 'design-out')
// Playwright's headless shell exits once the shot is written; Chrome's --headless=new can hang after it.
const SHELL = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
const CHROME = process.argv[3] ?? SHELL

const DAY = 86400e3
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0) // Thursday 1 October 2026
const OFFSET = 120 // a UTC+2 desk
const week = (usedPct: number, elapsedFrac: number): Week => ({ usedPct, elapsedFrac, resetsAtMs: NOW + (1 - elapsedFrac) * 7 * DAY })
const CALM = week(22, 0.5) // lands near 44%
const MID = week(39, 0.5) // lands near 78%
const HOT = week(72, 0.55) // runs out before the reset

type M = { name: string; cost: number; tokens: string }
const TODAY: M[] = [
  { name: 'opus 5.5', cost: 31.5, tokens: '71M' },
  { name: 'sonnet 5.5', cost: 8.2, tokens: '19M' },
  { name: 'haiku 4.5', cost: 1.86, tokens: '5M' },
  { name: 'fable 5.1', cost: 0.62, tokens: '1M' },
]
const WEEK_MODELS: M[] = [
  { name: 'opus 5.5', cost: 148.2, tokens: '340M' },
  { name: 'sonnet 5.5', cost: 52.4, tokens: '120M' },
  { name: 'opus 4.1', cost: 18.0, tokens: '30M' },
  { name: 'sonnet 4', cost: 9.6, tokens: '22M' },
  { name: 'haiku 4.5', cost: 6.4, tokens: '18M' },
  { name: 'gpt 5.1', cost: 4.1, tokens: '9M' },
  { name: 'fable 5.1', cost: 2.2, tokens: '4M' },
  { name: '3 others', cost: 1.1, tokens: '2M' },
]
const money = (x: number) => `$${x.toFixed(2)}`
const sum = (ms: M[]) => ms.reduce((s, m) => s + m.cost, 0)
const share = (m: M, all: M[]) => (sum(all) > 0 ? m.cost / sum(all) : 0)
const tip = (m: M, all: M[], title: string) => `${m.name}: ${money(m.cost)}, ${m.tokens} tokens, ${Math.round(share(m, all) * 100)}% of ${title}`

const cards = (ms: M[], title: string): TickerCard[] => ms.map(m => ({ name: m.name, value: money(m.cost), share: share(m, ms), tooltip: tip(m, ms, title) }))
const rows = (ms: M[], title: string): PanelModel[] => ms.map(m => ({ name: m.name, value: money(m.cost), cost: m.cost, tooltip: tip(m, ms, title) }))

const DAILY_COSTS = [18.4, 22.1, 9.6, 4.2, 26.8, 31.5, 12.0, 15.3, 28.9, 36.2, 19.7, 7.4, 24.6, 42.18]
const daily = DAILY_COSTS.map((cost, i) => {
  const d = new Date(NOW - (DAILY_COSTS.length - 1 - i) * DAY)
  return { label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}`, cost }
})

const strip = (over: Partial<StripInput>): StripInput => ({
  width: 770,
  title: 'today',
  total: '$42.18',
  tokens: '96M tokens',
  cards: cards(TODAY, 'today'),
  week: MID,
  now: NOW,
  offsetMin: OFFSET,
  speedPxPerSec: 6,
  phasePx: 0,
  rangeChip: 'Oct 1',
  ...over,
})

const panel = (over: Partial<PanelInput>): PanelInput => ({
  width: 420,
  title: 'today',
  total: '$42.18',
  tokens: '96M tokens',
  range: 'Oct 1',
  models: rows(TODAY, 'today'),
  daily,
  week: MID,
  now: NOW,
  offsetMin: OFFSET,
  pacePerHour: 6.4,
  source: 'Prices are ccusage estimates',
  ...over,
})

type Scene = { name: string; note: string; kind: 'strip' | 'panel'; light?: boolean; svg: string; width: number; height: number; zoom?: { scale: number; crop: number }; mod?: boolean; composite?: boolean }
const S = (name: string, note: string, input: StripInput, light = false): Scene => ({
  name, note, kind: 'strip', light, svg: stripSvg(input), width: Math.round(Math.min(1100, Math.max(420, input.width))), height: STRIP_HEIGHT,
})
const P = (name: string, note: string, input: PanelInput, light = false): Scene => {
  const svg = panelSvg(input)
  const m = /width="(\d+)" height="(\d+)"/.exec(svg)!
  return { name, note, kind: 'panel', light, svg, width: Number(m[1]), height: Number(m[2]) }
}

// The split experiment: the same strip as three frames side by side (ring and total | ticker | range), each a crop
// of one drawing through its own viewBox, cut at whole pixels just past each hairline divider.
const splitHtml = (svg: string, width: number): string => {
  const cuts = [...svg.matchAll(/<path d="M([\d.]+) 13V35"/g)].map(m => Math.ceil(Number(m[1])) + 1)
  const edges = [0, ...cuts, width]
  return `<div style="display:flex;gap:0">${edges
    .slice(1)
    .map((x1, i) => {
      const x0 = edges[i]!
      return svg.replace(`width="${width}" height="48" viewBox="0 0 ${width} 48"`, `width="${x1 - x0}" height="48" viewBox="${x0} 0 ${x1 - x0} 48"`)
    })
    .join('')}</div>`
}
const SPLIT = (name: string, note: string, input: StripInput): Scene => ({ ...S(name, note, input), svg: splitHtml(stripSvg(input), input.width), composite: true })

const LONG: M[] = [
  { name: 'claude-experimental-long-name <beta> & "x"', cost: 12345.67, tokens: '9.9B' },
  { name: 'sonnet 5.5', cost: 980.5, tokens: '2.1B' },
]
const scenes: Scene[] = [
  S('strip-dark', 'Strip, 770 px, dark app. Week lands near 78%. Ticker at phase 0.', strip({})),
  S('strip-dark-moved', 'The same strip with the ticker 180 px further along (phasePx 180).', strip({ phasePx: 180 })),
  S('strip-light', 'Strip on a light app: the card carries its own dark glass.', strip({}), true),
  S('strip-narrow', 'Narrow window, 420 px: the chip gives its room to the ticker.', strip({ width: 420 })),
  S('strip-wide', 'Wide window, 1000 px.', strip({ width: 1000 })),
  S('strip-calm', 'Calm week: lands near 44%, cool ring.', strip({ week: CALM })),
  S('strip-hot', 'Hot week: runs out before the reset, the accent turns signal red.', strip({ week: HOT })),
  S('strip-noweek', 'No weekly reading: a quiet empty ring, accent rests on glacier.', strip({ week: null })),
  S('strip-single', 'A single model: the card passes alone, the track padded to the window.', strip({ cards: cards(TODAY.slice(0, 1), 'today'), total: '$31.50', tokens: '71M tokens' })),
  S('strip-empty', 'An empty day: no cards yet.', strip({ cards: [], total: '$0.00', tokens: '0 tokens' })),
  S('strip-long', 'Stress: a long hostile name and a five-figure total, escaped and clipped.', strip({ width: 560, cards: cards(LONG, 'all time'), title: 'all time', total: '$13,326.17', tokens: '12B tokens', rangeChip: 'since Jan 2025' })),
  { ...S('strip-mod', 'As the mod draws it in the owner\'s window (106 columns): a 579 px strip, then the native period and Details buttons (mocked here).', strip({ width: 579 })), mod: true },
  SPLIT('strip-split', 'Experiment: the same strip as three adjacent frames (ring and total, ticker, range), joined at whole pixels. Compare with strip-dark.', strip({})),
  { ...SPLIT('strip-split-detail', 'The split joins at 3x: the left join (after the total divider).', strip({})), zoom: { scale: 3, crop: 420 } },
  { ...S('strip-detail', 'Detail at 3x: the ring, the total and the first card, to judge the small marks.', strip({})), zoom: { scale: 3, crop: 420 } },
  { ...P('panel-pane', 'As the mod draws the Details pane: native tabs (mocked) in a row above a 400 px panel with no header band.', panel({ width: 400, header: 0 })), mod: true },
  P('panel-dark', 'Panel, 420 px, dark app, today. Week lands near 78%.', panel({})),
  P('panel-light', 'Panel on a light app.', panel({}), true),
  P('panel-hot', 'Hot week: "Runs out" in the accent, everything shifts to signal.', panel({ week: HOT, pacePerHour: 18.9 })),
  P('panel-calm-narrow', 'Calm week at the narrowest width, 360 px.', panel({ week: CALM, width: 360, pacePerHour: 2.1 })),
  P('panel-noweek', 'No weekly reading: a calm line instead of the ring.', panel({ week: null, pacePerHour: null })),
  P('panel-many', 'This week, eight-plus models (seven and "3 others"), 480 px: rows tighten to keep under 520.', panel({ width: 480, title: 'this week', total: money(sum(WEEK_MODELS)), tokens: '549M tokens', range: 'since Sep 27', models: rows(WEEK_MODELS, 'this week') })),
  P('panel-empty', 'An empty day with no history: every empty state at once.', panel({ total: '$0.00', tokens: '0 tokens', models: [], daily: [], week: null, pacePerHour: null })),
]

const TABS = ['Today', 'Week', 'Month', 'All time']
const page = (s: Scene, svg: string): string => {
  const bg = s.light ? '#f4f4f5' : '#141414'
  const band = s.light ? '#ffffff' : '#1a1a1a'
  const bandEdge = s.light ? '#e4e4e7' : '#232323'
  const prompt = s.light ? '#fafafa' : '#1f1f1f'
  const promptText = s.light ? '#a1a1aa' : '#5c5c5c'
  const tabs =
    s.kind === 'panel'
      ? `<div class="tabs${s.mod ? ' above' : ''}">${TABS.map((t, i) => `<span class="${i === 0 ? 'on' : ''}">${t}</span>`).join('')}</div>`
      : ''
  const native = s.mod && s.kind === 'strip' ? '<span class="nb">Today</span><span class="nb">Details</span>' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${s.name}</title><style>
html,body{margin:0;background:${bg};font-family:system-ui,-apple-system,sans-serif}
.app{padding:20px;width:max-content}
.band{background:${band};border:1px solid ${bandEdge};border-radius:12px;padding:12px}
.slot{position:relative;width:${s.width}px;height:${s.height}px}
.slot svg{display:block}
.zoom{zoom:${s.zoom?.scale ?? 1};width:${s.zoom?.crop ?? s.width}px;overflow:hidden}
.tabs{position:absolute;left:14px;top:9px;display:flex;gap:2px;font-size:12px}
.tabs span{padding:4px 10px;border-radius:7px;color:#8d97aa}
.tabs span.on{background:rgba(255,255,255,.08);color:#e9eef7}
.tabs.above{position:static;margin:0 0 8px;gap:6px}
.tabs.above span{background:rgba(255,255,255,.06);color:#d4d4d8}
.tabs.above span.on{background:#e9eef7;color:#141414}
.row{display:flex;align-items:center;gap:8px}
.nb{font-size:12px;padding:5px 11px;border-radius:7px;background:rgba(255,255,255,.07);color:#d4d4d8;white-space:nowrap}
.prompt{margin-top:10px;height:40px;border-radius:10px;background:${prompt};border:1px solid ${bandEdge};color:${promptText};font-size:13px;display:flex;align-items:center;padding:0 14px}
</style></head><body><div class="app"><div class="band">${s.zoom ? `<div class="zoom"><div class="slot">${svg}</div></div>` : s.mod
      ? s.kind === 'strip'
        ? `<div class="row"><div class="slot">${svg}</div>${native}</div><div class="prompt">Reply…</div>`
        : `${tabs}<div class="slot">${svg}</div>`
      : `<div class="slot">${svg}${tabs}</div>${s.kind === 'strip' ? '<div class="prompt">Reply…</div>' : ''}`}</div></div></body></html>`
}

const windowSize = (s: Scene) =>
  s.zoom
    ? { w: s.zoom.crop * s.zoom.scale + 2 * 20 + 2 * 12 + 2, h: s.height * s.zoom.scale + 2 * 20 + 2 * 12 + 2 }
    : { w: s.width + 2 * 20 + 2 * 12 + 2 + (s.mod && s.kind === 'strip' ? 150 : 0), h: s.height + 2 * 20 + 2 * 12 + 2 + (s.kind === 'strip' ? 52 : 0) + (s.mod && s.kind === 'panel' ? 34 : 0) }

mkdirSync(OUT, { recursive: true })
const profile = join(OUT, '.chrome-profile')
let failed = 0
for (const s of scenes) {
  const problems = s.composite ? [] : svgProblems(s.svg)
  if (problems.length > 0) {
    failed++
    console.error(`${s.name}: ${problems.join('; ')}`)
  }
  writeFileSync(join(OUT, `${s.name}.svg`), s.svg)
  const html = join(OUT, `${s.name}.html`)
  writeFileSync(html, page(s, s.svg))
  const { w, h } = windowSize(s)
  const r = Bun.spawnSync([
    CHROME, '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--force-device-scale-factor=2', `--window-size=${w},${h}`,
    `--screenshot=${join(OUT, `${s.name}.png`)}`, `file://${html}`,
  ], { timeout: 30_000 })
  if (r.exitCode !== 0) {
    failed++
    console.error(`${s.name}: chrome exited ${r.exitCode}: ${r.stderr.toString().slice(0, 400)}`)
  } else console.log(`${s.name}.png  ${w}x${h} @2x  ${s.svg.length} chars`)
}
rmSync(profile, { recursive: true, force: true })

const sheet = `<!doctype html><html><head><meta charset="utf-8"><title>Usage meter desktop scenes</title><style>
:root{color-scheme:dark}
body{margin:0;background:#0f0f10;color:#d4d4d8;font:14px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:20px;font-weight:600;margin:0 0 4px}
p.lede{color:#8d97aa;margin:0 0 28px}
section{margin:0 0 36px}
h2{font-size:13px;font-weight:600;margin:0 0 2px;font-family:ui-monospace,Menlo,monospace;color:#e9eef7}
section p{margin:0 0 10px;color:#8d97aa;font-size:13px}
img{display:block;max-width:100%;height:auto;border-radius:6px}
a{color:inherit}
</style></head><body><main><h1>Usage meter, desktop scenes</h1>
<p class="lede">Strip (48 px, above the prompt) and docked panel. Screenshots at 2x from headless Chrome; every figure is invented. Each heading links the live HTML scene (hover the ticker and rows for tooltips).</p>
${scenes.map(s => `<section><h2><a href="${s.name}.html">${s.name}</a></h2><p>${s.note.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><img src="${s.name}.png" width="${windowSize(s).w}" alt="${s.name}"></section>`).join('\n')}
</main></body></html>`
writeFileSync(join(OUT, 'index.html'), sheet)
console.log(failed === 0 ? `ok, ${scenes.length} scenes` : `${failed} problems`)
process.exit(failed === 0 ? 0 : 1)
