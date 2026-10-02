import type { EngineInterface, Register } from 'claude-code'

import { encodeCells } from './base64'
import { BUTTON_COLS, LEAD_PX, boardFrame, rasterWidth, reserveFor, textLine } from './board'
import { cardsFromDay, dayTotal, loadingCards, nextSpend, parseCcusage, unavailableCards } from './cards'
import { PX_PER_COLUMN, deskClock, diagLine, firstReading, framePhase, percentMoved, readingAge, memoMarkup, panelInput, panelWidthFor, reasonFor, redrawDue, stripInput, stripKeyParts, stripWidthFor } from './desktop-state'
import type { DesktopState, Memo, StripPart } from './desktop-state'
import type { DayEntry, Parsed } from './cards'
import { sevenDay, weekFromLimit } from './gauge'
import type { Limit } from './gauge'
import { buildStrip } from './led'
import type { CardText } from './led'
import { DAY_KEEP_MS, SESSION_KEEP_MS, addSample, paceNow, speedFor } from './pace'
import type { Sample } from './pace'
import { INK, hex } from './desktop-theme'
import { PANE_CARD, PANE_EDGE, RING_SIZE, SPARK_HEIGHT, paneKey, paneView, ringBadgeSvg, ringKey, sparkKey, sparkSvg } from './pane-view'
import { PERIODS, aggregate, buttonLabel, cardTitle, earliestPeriod, isPeriod, nextPeriod, rangeFor, rangeText } from './periods'
import type { Period } from './periods'
import { newScroll, remapOffset, stepScroll } from './scroll'
import { gaugeShown, newStatus, turnCompleted, turnStarted, withWorking } from './status'
import { STRIP_HEIGHT, stripAlt, stripSvg } from './strip-svg'
import { RETRY_MS, paintDue, spendDue } from './timing'
import { isoDate, parseUtcOffset } from './zone'

const TICK_MS = 50 // how often the crawl is repainted while it moves
const SAMPLE_MS = 2_000 // how often this session's spend is read to measure its pace
const SPEND_EVERY_MS = 5 * 60_000
const SPEND_MIN_GAP_MS = 60_000 // after a turn, refresh spend at most this often (a read of every day is not cheap)
const FRAME_REFRESH_MS = 60_000 // the gauge notch drifts with the clock, so repaint now and then
const DESK_TICK_MS = 1_000 // the desktop ticker animates itself; this only keeps count of where it is
const PANE_ID = 'usage-panel'
// The strip as an image (false) or an interactive sandboxed frame (true). The desktop reloads an interactive frame
// each time the band is drawn again (the isWorking flip at every turn start and end), which blinks and restarts the
// ticker; as an image it keeps animating and, the markup unchanged, stays put. The cost: no hover, no tooltips on
// the strip. What they said is in the Details pane, which stays interactive (it does not move).
const STRIP_INTERACTIVE = false
// The pane's two drawings (the weekly ring, the daily line), likewise as images: the app re-creates an interactive
// frame each time the pane is delivered, and the pane is delivered whenever one of its figures changes.
const PANE_SVG_INTERACTIVE = false
// With false the pane draws no Svg at all: the week as "39% used" in text, the daily line as its heading alone.
const PANE_SVGS = true
const PANE_REDRAW_MS = 3_000 // while the pane is open, its figures are brought up to date at most this often

// What the drawing reads. A hot reload starts these over and session.start refills them.
let period: Period = 'today' // which stretch of days the crawl adds up; the button steps it, $.store keeps it
let days: DayEntry[] = [] // every day ccusage reported on the last good read
let firstDay: string | undefined // the earliest of those days
let spend: 'loading' | 'ready' | 'failed' = 'loading'
let cards: CardText[] = loadingCards()
let board = buildStrip(cards)
let rangeLabel = '' // the small caption under the button, set together with the cards
let limit: Limit | undefined
let limitAt: number | null = null // when the last weekly reading was received (a push, the sampler, the start)
let status = newStatus() // turns of the main conversation only; a subagent's turn is not one of them
let offsetMin = 0 // minutes east of UTC, from `date +%z`
let scroll = newScroll(LEAD_PX)
let sessionSamples: Sample[] = [] // this session's running cost, for its live pace
let daySamples: Sample[] = [] // today's machine-wide total from ccusage, for the pace of other sessions
let requestId = ''
let cols = 0 // the band's width as the last render saw it, at most 512
let reserve = 0 // columns at its right end left to the button; the mounted Raster is `cols - reserve` wide
let lastTick = 0
let lastPx: number | null = null
let dirty = true
let retryAt = 0 // a repaint the engine refused is not tried again before this time
let textShown = false // the last render was the one line of text, which only a redraw can update
let spendBusy = false
let spendWanted = false // a main turn finished, so the spend has probably moved
let lastSpendAt = 0
// The desktop: the SVG moves the ticker by itself, at one constant speed. Every new drawing reloads the surface's
// frame (a blink, and the ticker restarts from the offset it is given), so the strip on screen is replaced only
// when redrawDue says so: what the person did at once, new figures never mid-turn and rarely otherwise. Any other
// render hands back the identical markup.
let deskBand = false // the last band drawn was the desktop strip
let deskPane = false // the details pane has been drawn and not closed since
let deskColumns: number | undefined // the band's width in cells, as the surface last measured it
let paneColumns: number | undefined
let crawlStart: number | null = null // when the desktop ticker began: its first drawing, or a new period
type Drawing = { source: string; alt: string; width: number; height: number }
type Shown = { key: string; parts: Record<StripPart, unknown>; at: number; placeholder: boolean; drawing: Drawing }
let stripShown: Shown | null = null // the strip on screen, and what it was drawn from
let stripAsked = '' // the key the tick last asked a redraw for, so it asks once
let userWants = false // a period chosen since the strip was last drawn
let idleSince: number | null = null // when the main conversation was last seen idle; null while a turn runs
let ringMemo: Memo<string> | null = null // the pane's two small drawings, each built once per key of its own
let sparkMemo: Memo<string> | null = null
let paneDrawn = '' // what the pane showed when it was last drawn or asked to be
let paneAskedAt = 0 // when the tick last asked the pane to be drawn again
// Diagnostics, shown on the last line of the ring's tooltip as of the latest drawing: desktop band renders, times
// the strip's markup changed, redraws this module asked for, and which parts of the strip changed last.
let deskRenders = 0
let sourceChanges = 0
let invalidates = 0
let lastReason = 'none'

const showGauge = () => gaugeShown(status, limit !== undefined)
const weekAt = (now: number) => (limit ? weekFromLimit(limit, now) : null)
const frameAt = (now: number) =>
  boardFrame({ cols, reserveRight: reserve, week: weekAt(now), now, offsetMin, board, scrollOffset: scroll.offset, showGauge: showGauge() })
const lineAt = (now: number) => textLine(cards, weekAt(now), now, offsetMin, showGauge())
// The week, its caption and the day as the desktop shows them move in ten minute steps (deskClock); the pace is live.
const deskState = (now: number): DesktopState => {
  const at = deskClock(now)
  return { days, spend, period, rangeLabel, week: weekAt(at), now: at, offsetMin, pacePerHour: paceNow(sessionSamples, daySamples, now) }
}
// The strip's input; its phase is where the ticker will be when a frame loaded now starts (framePhase).
const deskStrip = (now: number) => stripInput(deskState(now), stripWidthFor(deskColumns), framePhase((crawlStart ??= now), now))
const deskPanel = (now: number) => panelInput(deskState(now), panelWidthFor(paneColumns))
const noteIdle = (now: number) => {
  if (status.working) idleSince = null
  else idleSince ??= now
}
// Whether the strip on screen should give way to one drawn from `input`.
const stripAsk = (now: number, input: ReturnType<typeof deskStrip>) => {
  const parts = stripKeyParts(input)
  const key = JSON.stringify(parts)
  const resized = stripShown !== null && JSON.stringify(stripShown.parts.width) !== JSON.stringify(parts.width)
  const due = redrawDue({
    working: status.working,
    userInitiated: userWants || resized,
    keyChanged: key !== stripShown?.key,
    lastDrawAt: stripShown?.at ?? null,
    idleSince,
    now,
    showsPlaceholder: stripShown?.placeholder ?? true,
    firstReading: firstReading(stripShown?.parts ?? null, parts),
    percentMoved: percentMoved(stripShown?.parts ?? null, parts),
  })
  return { parts, key, due }
}
// The markup for the band: the strip on screen, unless a new one is due.
const stripDrawing = (now: number): Drawing => {
  noteIdle(now)
  const input = deskStrip(now)
  const ask = stripAsk(now, input)
  if (stripShown === null || ask.due) {
    const reason = reasonFor(stripShown?.parts ?? null, ask.parts)
    if (stripShown !== null) sourceChanges++
    lastReason = reason
    const diag = STRIP_INTERACTIVE ? diagLine({ renders: deskRenders, changes: sourceChanges, invalidates, reason }) : undefined
    const drawing = { source: stripSvg(diag ? { ...input, diag } : input), alt: stripAlt(input), width: input.width, height: STRIP_HEIGHT }
    stripShown = { key: ask.key, parts: ask.parts, at: now, placeholder: spend !== 'ready', drawing }
    userWants = false
  } else if (ask.key !== stripShown.key) {
    stripAsked = '' // held back for now: the tick may ask again once it is due
  }
  return stripShown.drawing
}
// The pane's values, as text for native elements: they change in place, nothing reloads.
const paneNow = (now: number) => paneView(deskPanel(now), paneColumns ?? 56, readingAge(now, limitAt))

// A blit repaints the Raster's cells and nothing else. When what the tree holds has changed (the line of text, the
// button's caption, the band's shape), the band has to be drawn again.
const redrawIf = ($: EngineInterface, treeChanged: boolean) => {
  if (treeChanged || textShown) askRedraw($)
}

// Every redraw this module asks for goes through here, so the desktop diagnostics can count them.
const askRedraw = ($: EngineInterface) => {
  invalidates++
  $.ui.invalidate('ui.render')
}

const clockNow = async ($: EngineInterface): Promise<number> => {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

// The cards and the button's caption for the period on show, from the days already read.
const rebuildCards = (now: number) => {
  const { since, until } = rangeFor(period, now, offsetMin, weekAt(now)?.resetsAtMs ?? null)
  const title = cardTitle(period)
  rangeLabel = rangeText(period, since, firstDay)
  if (spend === 'failed') cards = unavailableCards()
  else if (spend === 'loading') cards = loadingCards(title)
  else cards = cardsFromDay(aggregate(days, since, until), title)
  board = buildStrip(cards)
}

const loadOffset = async ($: EngineInterface) => {
  try {
    const r = await $.process.run(['date', '+%z'])
    const parsed = r.exitCode === 0 ? parseUtcOffset(r.stdout) : null
    if (parsed !== null) {
      offsetMin = parsed
      dirty = true
      return
    }
  } catch {
    // fall through to the module's own idea of local time
  }
  offsetMin = -new Date().getTimezoneOffset()
}

const loadPeriod = async ($: EngineInterface) => {
  try {
    const saved = await $.store.get('period')
    if (isPeriod(saved)) period = saved
  } catch {
    // the default stands
  }
}

// One read of ccusage brings every day, and every period is added up from that list.
const refreshSpend = async ($: EngineInterface) => {
  if (spendBusy) return
  spendBusy = true
  spendWanted = false
  const now = await clockNow($)
  lastSpendAt = now
  let read: Parsed | null = null
  try {
    await loadOffset($) // the offset changes with daylight saving, so it is read again each time
    const r = await $.process.run(['ccusage', 'daily', '--json', '--breakdown'], { timeoutMs: 60_000 })
    read = r.exitCode === 0 ? parseCcusage(r.stdout) : null
  } catch {
    read = null // a failed read leaves the days already read as they were
  } finally {
    spendBusy = false
  }
  const next = nextSpend({ days, state: spend }, read)
  days = next.days
  spend = next.state
  if (read?.ok) {
    firstDay = earliestPeriod(days)
    const todayIso = isoDate(now, offsetMin)
    daySamples = addSample(daySamples, now, dayTotal(days.find(d => d.period === todayIso)), DAY_KEEP_MS)
  }
  const captionBefore = rangeLabel
  const oldLength = board.length
  rebuildCards(now)
  scroll.offset = remapOffset(scroll.offset, oldLength, board.length) // the same place in the new strip, not a jump
  dirty = true
  redrawIf($, rangeLabel !== captionBefore)
}

// A finished main turn asks for a fresh read of the spend by setting a flag. The 2 second timer serves it, at most
// once in SPEND_MIN_GAP_MS, so nothing is started from inside the turn.complete hook after it has returned.
const refreshSpendIfWanted = async ($: EngineInterface) => {
  if (!spendWanted || spendBusy) return
  const now = await clockNow($)
  if (spendDue({ wanted: spendWanted, now, lastAt: lastSpendAt, minGapMs: SPEND_MIN_GAP_MS })) await refreshSpend($)
}

// The engine's running cost for this session grows with every API response, so its slope is the live pace.
// The same read also picks up the weekly limit while none is known: the desktop often reports none at session start
// and none is pushed until a response arrives, so the gauge would otherwise wait for that push.
const sampleSession = async ($: EngineInterface) => {
  try {
    const usage = await $.session.usage()
    if (limit === undefined) {
      const found = sevenDay(usage.rateLimits)
      if (found !== undefined) {
        limit = found
        limitAt = await clockNow($)
        dirty = true
        redrawIf($, false) // as a pushed reading: the text line is drawn again; the strip's tick sees the ring
      }
    }
    const usd = usage.cost?.usd
    if (typeof usd === 'number' && Number.isFinite(usd)) {
      sessionSamples = addSample(sessionSamples, await $.clock.now(), usd, SESSION_KEEP_MS)
    }
  } catch {
    // no sample this time; the pace simply keeps its last value
  }
}

const start = async ($: EngineInterface) => {
  await loadOffset($)
  await loadPeriod($)
  const usage = await $.session.usage().catch(() => null)
  if (usage) limit = sevenDay(usage.rateLimits)
  if (limit !== undefined) limitAt = await clockNow($)
  rebuildCards(await clockNow($)) // until ccusage answers: the loading card and the caption of the saved period
  askRedraw($)
  await sampleSession($)
  await refreshSpend($)
}

// A period chosen: the crawl back at its first card, and its numbers from the days already read. ccusage is
// not run again.
const choosePeriod = async ($: EngineInterface, chosen: Period) => {
  const now = await clockNow($)
  if (chosen !== period) {
    crawlStart = now // the desktop ticker, likewise from its first card
    userWants = true // and drawn at once, even mid-turn
  }
  period = chosen
  rebuildCards(now)
  scroll = newScroll(LEAD_PX)
  dirty = true
  askRedraw($) // the label and the caption are in the tree, so this is a redraw and not a blit
  try {
    await $.store.set('period', period) // the period as it is now, if another press came in meanwhile
  } catch {
    // the choice just does not outlive this session
  }
}

// An error as one short line of plain text: the engine refuses a control character in a Text.
const plainError = (err: unknown): string =>
  String(err instanceof Error ? err.message : err).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200)

// The button: on to the next period.
const pressPeriod = ($: EngineInterface) => choosePeriod($, nextPeriod(period))

// The desktop's Details button. A press is the person asking, so the pane is seated at any width.
const openDetails = async ($: EngineInterface) => {
  try {
    await $.ui.open({ id: PANE_ID, title: 'Usage' })
  } catch {
    // the surface places no pane; the strip stays as it is
  }
}

// Once a second on the desktop: ask for a redraw of the strip only when a new one is due (redrawDue), and of the
// pane when what it shows has changed, at most once in PANE_REDRAW_MS (a tab press is drawn at once).
const deskTick = async ($: EngineInterface) => {
  if (!deskBand && !deskPane) return
  const now = await clockNow($)
  noteIdle(now)
  let changed = false
  if (deskBand && stripShown !== null) {
    const ask = stripAsk(now, deskStrip(now))
    if (ask.due && ask.key !== stripAsked) {
      stripAsked = ask.key
      changed = true
    }
  }
  if (deskPane && now - paneAskedAt >= PANE_REDRAW_MS) {
    const key = paneKey(paneNow(now))
    if (key !== paneDrawn) {
      paneDrawn = key
      paneAskedAt = now
      changed = true
    }
  }
  if (changed) askRedraw($)
}

// Slides the crawl at the speed the current pace calls for and repaints it in place: no redraw of
// the band, only new cells for the Raster. It never stops, so only a changed pixel is repainted.
const tick = async ($: EngineInterface) => {
  if (!requestId || cols === 0) return
  try {
    const now = await $.clock.now()
    const dt = lastTick === 0 ? TICK_MS / 1000 : Math.min(0.25, (now - lastTick) / 1000)
    lastTick = now
    stepScroll(scroll, dt, speedFor(paceNow(sessionSamples, daySamples, now), status.working))
    const px = Math.floor(scroll.offset)
    if (!paintDue({ px, lastPx, dirty, now, retryAt })) return
    const frame = frameAt(now)
    if (frame === null) return
    // The size sent is the mounted Raster's own: the frame is `cols - reserve` wide, as drawn by the last render.
    const result = await $.ui.blit({ requestId, key: 'meter', cells: encodeCells(frame.cells), columns: frame.cols, rows: frame.rows })
    if (result.deny === undefined) {
      lastPx = px
      dirty = false
    } else {
      retryAt = now + RETRY_MS // refused (a resize, a hidden band): stay dirty, ask again in a moment
    }
  } catch {
    // a repaint that fails is retried on the next tick
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void start($)
    $.clock.every(TICK_MS, () => void tick($))
    $.clock.every(SAMPLE_MS, () => {
      void sampleSession($)
      void refreshSpendIfWanted($)
    })
    $.clock.every(SPEND_EVERY_MS, () => void refreshSpend($))
    $.clock.every(FRAME_REFRESH_MS, () => {
      dirty = true
    })
    $.clock.every(DESK_TICK_MS, () => void deskTick($))
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID) deskPane = false
    return next(e)
  })

  // Pushed by the engine when a limit window moves, so there is nothing to poll.
  on('session.measure', async ($, e, next) => {
    limit = sevenDay(e.rateLimits)
    if (limit !== undefined) limitAt = await clockNow($) // measured after each main turn: the last response's reading
    dirty = true
    redrawIf($, false) // the Raster keeps its size when the gauge comes or goes, so only the text line needs a redraw
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    status = turnStarted(status)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    status = turnCompleted(status, e.agentId) // a subagent's turn changes nothing
    if (e.agentId === undefined) {
      spendWanted = true
      dirty = true
      redrawIf($, false)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    status = withWorking(status, e.props.isWorking)
    const now = await $.clock.now()
    if (e.surface === 'terminal') {
      const { Box, Button, Raster, Text } = $.ui.resolve(e)
      requestId = e.requestId
      cols = rasterWidth(e.props.bodyColumns)
      reserve = reserveFor(e.props.bodyColumns)
      const frame = frameAt(now)
      if (frame !== null) {
        textShown = false
        const meter = <Raster key="meter" columns={frame.cols} rows={frame.rows} cells={encodeCells(frame.cells)} />
        if (reserve === 0) return meter
        return (
          <Box flexDirection="row">
            {meter}
            <Box flexDirection="column" width={BUTTON_COLS}>
              <Button key="period" label={buttonLabel(period)} hotkey="p" onPress={() => void pressPeriod($)} />
              <Text dimColor wrap="truncate">{rangeLabel || cardTitle(period)}</Text>
            </Box>
          </Box>
        )
      }
      textShown = true
      return <Text dimColor wrap="truncate">{lineAt(now)}</Text>
    }
    if (e.surface === 'desktop') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      deskBand = true
      textShown = false
      deskColumns = e.viewport?.columns ?? e.props.bodyColumns
      deskRenders++
      const strip = stripDrawing(now)
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={strip.source} alt={strip.alt} width={strip.width} height={strip.height} isInteractive={STRIP_INTERACTIVE} />
          <Button key="period" label={buttonLabel(period)} hotkey="p" onPress={() => void pressPeriod($)} />
          <Button key="details" label="Details" onPress={() => void openDetails($)} />
        </Box>
      )
    }
    // The editor and the phone: one line of text.
    const { Text } = $.ui.resolve(e)
    deskBand = false
    textShown = true
    return <Text dimColor wrap="truncate">{lineAt(now)}</Text>
  })

  // The details pane, opened from the desktop's Details button: the period as tabs above a panel card.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    const now = await clockNow($)
    if (e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor wrap="truncate">{lineAt(now)}</Text>
    }
    try {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      deskPane = true
      paneColumns = e.props.bodyColumns
      const v = paneNow(now)
      paneDrawn = paneKey(v)
      // The card's width inside its border and padding (two cells a side); the surface scales an Svg down if it is less.
      const sparkWidth = Math.min(480, Math.max(200, Math.round((paneColumns ?? 56) * PX_PER_COLUMN) - 31))
      if (PANE_SVGS && v.week) ringMemo = memoMarkup(ringMemo, ringKey(v.week, v.now, v.offsetMin), () => ringBadgeSvg(v.week!, v.now, v.offsetMin))
      if (PANE_SVGS && v.daily.length > 0) sparkMemo = memoMarkup(sparkMemo, sparkKey(v.daily, v.accent, sparkWidth), () => sparkSvg(v.daily, v.accent, sparkWidth))
      const diag = diagLine({ renders: deskRenders, changes: sourceChanges, invalidates, reason: lastReason })
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            {PERIODS.map(p => (
              <Button key={`tab-${p}`} label={buttonLabel(p)} {...(p === period ? { variant: 'primary' as const } : {})} onPress={() => void choosePeriod($, p)} />
            ))}
          </Box>
          <Box flexDirection="column" backgroundColor={hex(PANE_CARD)} borderStyle="round" borderColor={PANE_EDGE} paddingX={2} paddingY={1}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
              <Text bold color={INK.figure}>{v.total}</Text>
              <Text color={INK.label} wrap="truncate">{v.meta}</Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
              <Text color={INK.label}>By model</Text>
              <Text color={INK.dim} wrap="truncate">{v.source}</Text>
            </Box>
            {v.emptyText !== null ? (
              <Text color={INK.dim}>{v.emptyText}</Text>
            ) : (
              v.rows.map(r => (
                <Box key={`row-${r.top ? 'top' : r.name.replace(/[^a-z0-9]+/gi, '-')}`} flexDirection="row" gap={1}>
                  <Box width={v.nameCols}>
                    <Text color={INK.text} wrap="truncate">{r.name}</Text>
                  </Box>
                  <Box width={v.barCols} flexGrow={1} height={1} backgroundColor={v.barTrack}>
                    <Box width={r.bar} height={1} backgroundColor={r.top ? v.accent : v.barRest} />
                  </Box>
                  {v.detailCols > 0 ? (
                    <Box width={v.detailCols} justifyContent="flex-end">
                      <Text color={INK.label}>{r.detail}</Text>
                    </Box>
                  ) : null}
                  <Box width={v.valueCols} justifyContent="flex-end">
                    <Text color={INK.figure}>{r.value}</Text>
                  </Box>
                </Box>
              ))
            )}
            <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
              <Text color={INK.label}>{v.daily.length > 0 ? `Last ${v.daily.length} days` : 'No daily history yet'}</Text>
              <Text color={INK.dim}>{v.peak}</Text>
            </Box>
            {PANE_SVGS && sparkMemo && v.daily.length > 0 ? <Svg source={sparkMemo.value} alt={`Daily spend, ${v.peak}`} width={sparkWidth} height={SPARK_HEIGHT} isInteractive={PANE_SVG_INTERACTIVE} /> : null}
            <Box flexDirection="row" gap={2} alignItems="center" marginTop={1}>
              {PANE_SVGS && ringMemo && v.week ? <Svg source={ringMemo.value} alt={v.weekCaption} width={RING_SIZE} height={RING_SIZE} isInteractive={PANE_SVG_INTERACTIVE} /> : null}
              <Box flexDirection="column">
                <Text color={INK.label}>{v.weekLabel}</Text>
                {!PANE_SVGS && v.weekUsed !== null ? <Text color={v.accent}>{v.weekUsed}</Text> : null}
                <Text color={v.weekDanger ? v.accent : INK.figure}>{v.weekCaption}</Text>
                {v.pace !== null ? (
                  <Text color={INK.label}>
                    Pace <Text color={INK.text}>{v.pace}</Text>
                    {v.readingAge !== null ? <Text color={INK.dim}>{` · ${v.readingAge}`}</Text> : null}
                  </Text>
                ) : v.readingAge !== null ? (
                  <Text color={INK.dim}>{v.readingAge}</Text>
                ) : null}
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text color={INK.dim} wrap="wrap">{diag}</Text>
            </Box>
          </Box>
        </Box>
      )
    } catch (err) {
      // Drawing the pane failed: the figures as one line and the reason, rather than no pane at all.
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            {PERIODS.map(p => (
              <Button key={`tab-${p}`} label={buttonLabel(p)} {...(p === period ? { variant: 'primary' as const } : {})} onPress={() => void choosePeriod($, p)} />
            ))}
          </Box>
          <Text wrap="truncate">{lineAt(now)}</Text>
          <Text dimColor wrap="truncate">{`Details could not be drawn: ${plainError(err)}`}</Text>
        </Box>
      )
    }
  })
}
