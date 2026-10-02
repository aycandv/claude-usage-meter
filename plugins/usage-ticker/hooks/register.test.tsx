import { test, expect, mock } from 'claude-code/testing'

// These mount the band through the engine, so they run under `claude plugin test`, not bun.
// The plugin reads the clock while it draws, so each one answers the clock from memory first.
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)

const band = (bodyColumns: number, extra: Record<string, unknown> = {}) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
  ...extra,
})

test('at 100 columns or more the band is a two-row Raster with a period button beside it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(120), viewport: { columns: 120, rows: 40 } })
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.key).toBe('meter')
  expect(raster?.props.columns).toBe(106) // the band's 120, less the 14 of the button column
  expect(raster?.props.rows).toBe(2)
  expect(typeof raster?.props.cells).toBe('string')
  const button = await ui.find({ type: 'Button', key: 'period' })
  expect(button).toBeDefined()
  expect(button?.props.label).toBe('Today')
  await ui.unmount()
})

test('under 100 columns the Raster is as wide as the band and there is no button', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(90), viewport: { columns: 90, rows: 40 } })
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.key).toBe('meter')
  expect(raster?.props.columns).toBe(90)
  expect(raster?.props.rows).toBe(2)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('a band wider than the 512 columns a Raster may have is drawn 512 wide, button column included', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(600), viewport: { columns: 600, rows: 40 } })
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(512 - 14)
  await ui.unmount()
})

test('on a narrow terminal the band is one line of text', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(40), viewport: { columns: 40, rows: 40 } })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text' })).toBeDefined()
  await ui.unmount()
})

test('in the editor and on the phone the band is one line of text', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-ticker', surface, component: 'AbovePrompt', props: band(120) })
    expect(await ui.find({ type: 'Text' })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('on the desktop the band is an SVG strip, drawn as an image, with the period and Details buttons beside it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'desktop', component: 'AbovePrompt', props: band(106), viewport: { columns: 106, rows: 48 } })
  const svg = await ui.find({ type: 'Svg' }) // an Svg carries no key
  expect(svg?.props.width).toBe(Math.round(106 * 7.25) - 190)
  expect(svg?.props.height).toBe(48)
  expect(svg?.props.isInteractive ?? false).toBe(false) // drawn as an image: the app does not reload it on a re-render
  expect(String(svg?.props.source)).toContain('color-scheme:light dark')
  expect((await ui.find({ type: 'Button', key: 'period' }))?.props.label).toBe('Today')
  expect((await ui.find({ type: 'Button', key: 'details' }))?.props.label).toBe('Details')
  await ui.unmount()
})

test('on the desktop a redraw with nothing new to show hands back the identical markup, so the frame does not reload', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'desktop', component: 'AbovePrompt', props: band(106), viewport: { columns: 106, rows: 48 } })
  const source = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  // A mount runs no session.start, so the strip here is the loading one; the stand-in harness covers a moving one.
  const first = await source()
  expect(first).toContain('<svg')
  for (let i = 0; i < 5; i++) {
    await clock.advance(3000)
    await ui.redraw(band(106, { maxRows: 10 + i, scroll: { offset: i, bodyRows: 10 } }))
    expect(await source()).toBe(first)
  }
  await ui.unmount()
})

test('on the desktop the period button steps the periods as on the terminal', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'desktop', component: 'AbovePrompt', props: band(106), viewport: { columns: 106, rows: 48 } })
  const label = async () => (await ui.find({ type: 'Button', key: 'period' }))?.props.label
  await ui.press({ key: 'period' })
  expect(await label()).toBe('Week')
  for (let i = 0; i < 3; i++) await ui.press({ key: 'period' }) // round to Today again
  expect(await label()).toBe('Today')
  await ui.unmount()
})

test('Details opens the usage pane, from the press', async ($, on) => {
  mock.clock(on, { now: NOW })
  const opened: { id: string; title?: string }[] = []
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } } // stands for the surface beneath the plugin
  })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'desktop', component: 'AbovePrompt', props: band(106), viewport: { columns: 106, rows: 48 } })
  await ui.press({ key: 'details' })
  expect(opened).toEqual([{ id: 'usage-panel', title: 'Usage' }])
  await ui.unmount()
})

const PANE = { title: 'Usage', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }

test('the usage pane is four period tabs above a native card, the active tab primary', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'desktop', component: 'Pane', requestId: 'usage-panel', props: PANE })
  const tabs = await ui.findAll({ type: 'Button' })
  expect(tabs.map(t => t.key)).toEqual(['tab-today', 'tab-week', 'tab-month', 'tab-all'])
  expect(tabs.map(t => t.props.variant ?? null)).toEqual(['primary', null, null, null])
  // Values are native text, updated in place; the only Svg without a weekly reading is the daily sparkline.
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(1)
  expect(svgs[0]?.props.isInteractive).toBe(false) // an image: the app does not re-create it at each delivery
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(texts).toContain('No weekly limit reading yet')
  expect(texts).toContain('diag r')
  expect(String(svgs[0]?.props.source)).not.toContain('diag r')
  await ui.press({ key: 'tab-all' }) // straight to All time, not one step
  expect((await ui.find({ type: 'Button', key: 'tab-all' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'tab-today' }) // leaves the plugin where this test found it
  await ui.unmount()
})

test('while a survey holds the band the plugin draws nothing and passes it on', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text> // stands for the engine's own band beneath the plugin
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-ticker', surface, component: 'AbovePrompt', props: band(120, { hasSurvey: true }), viewport: { columns: 120, rows: 40 } })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ type: 'Text' }))?.text).toBe('survey')
    await ui.unmount()
  }
})

test('pressing the period button steps through the periods and round to the first again', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(120), viewport: { columns: 120, rows: 40 } })
  const label = async () => (await ui.find({ type: 'Button', key: 'period' }))?.props.label
  expect(await label()).toBe('Today')
  await ui.press({ key: 'period' })
  expect(await label()).toBe('Week')
  await ui.press({ key: 'period' })
  expect(await label()).toBe('Month')
  await ui.press({ key: 'period' })
  expect(await label()).toBe('All time')
  await ui.press({ key: 'period' })
  expect(await label()).toBe('Today')
  await ui.unmount()
})

test('a press keeps the period in the plugin store, for the next session', async ($, on) => {
  mock.clock(on, { now: NOW })
  const saved: Record<string, unknown> = {}
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined } // stands for the engine's own store beneath the plugin
  })
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(120), viewport: { columns: 120, rows: 40 } })
  await ui.press({ key: 'period' })
  expect(saved.period).toBe('week')
  await ui.press({ key: 'period' })
  expect(saved.period).toBe('month')
  await ui.press({ key: 'period' })
  await ui.press({ key: 'period' }) // all, then today again: leaves the plugin where this test found it
  expect(saved.period).toBe('today')
  await ui.unmount()
})

// Last in the file: a main turn that ends with no weekly limit hides the gauge for good, in this module's state.
test('on a narrow terminal the line of text follows the main turn, and a subagent finishing changes nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.complete', () => ({ text: '' })) // stands for the engine beneath the plugin
  const ui = await $.ui.mount({ plugin: 'usage-ticker', surface: 'terminal', component: 'AbovePrompt', props: band(40), viewport: { columns: 40, rows: 40 } })
  const line = async () => (await ui.find({ type: 'Text' }))?.text ?? ''
  expect(await line()).toContain('No reading yet')
  const done = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...done, turnId: 'sub-1', agentId: 'agent-1' })
  expect(await line()).toContain('No reading yet') // a subagent's turn: the gauge, and so its caption, stays
  await $.turn.complete({ ...done, turnId: 'main-1' })
  expect(await line()).not.toContain('No reading yet') // a main turn with no limit: the caption goes, and the line was drawn again
  await ui.unmount()
})
