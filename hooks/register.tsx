import type { EngineInterface, Register } from 'claude-code'

import { encodeCells } from './base64'
import { BUTTON_COLS, LEAD_PX, boardFrame, rasterWidth, reserveFor, textLine } from './board'
import { cardsFromDay, dayTotal, loadingCards, nextSpend, parseCcusage, unavailableCards } from './cards'
import type { DayEntry, Parsed } from './cards'
import { sevenDay, weekFromLimit } from './gauge'
import type { Limit } from './gauge'
import { buildStrip } from './led'
import type { CardText } from './led'
import { DAY_KEEP_MS, SESSION_KEEP_MS, addSample, paceNow, speedFor } from './pace'
import type { Sample } from './pace'
import { aggregate, buttonLabel, cardTitle, earliestPeriod, isPeriod, nextPeriod, rangeFor, rangeText } from './periods'
import type { Period } from './periods'
import { newScroll, remapOffset, stepScroll } from './scroll'
import { gaugeShown, newStatus, turnCompleted, turnStarted, withWorking } from './status'
import { RETRY_MS, paintDue, spendDue } from './timing'
import { isoDate, parseUtcOffset } from './zone'

const TICK_MS = 50 // how often the crawl is repainted while it moves
const SAMPLE_MS = 2_000 // how often this session's spend is read to measure its pace
const SPEND_EVERY_MS = 5 * 60_000
const SPEND_MIN_GAP_MS = 60_000 // after a turn, refresh spend at most this often (a read of every day is not cheap)
const FRAME_REFRESH_MS = 60_000 // the gauge notch drifts with the clock, so repaint now and then

// What the drawing reads. A hot reload starts these over and session.start refills them.
let period: Period = 'today' // which stretch of days the crawl adds up; the button steps it, $.store keeps it
let days: DayEntry[] = [] // every day ccusage reported on the last good read
let firstDay: string | undefined // the earliest of those days
let spend: 'loading' | 'ready' | 'failed' = 'loading'
let cards: CardText[] = loadingCards()
let board = buildStrip(cards)
let rangeLabel = '' // the small caption under the button, set together with the cards
let limit: Limit | undefined
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

const showGauge = () => gaugeShown(status, limit !== undefined)
const weekAt = (now: number) => (limit ? weekFromLimit(limit, now) : null)
const frameAt = (now: number) =>
  boardFrame({ cols, reserveRight: reserve, week: weekAt(now), now, offsetMin, board, scrollOffset: scroll.offset, showGauge: showGauge() })
const lineAt = (now: number) => textLine(cards, weekAt(now), now, offsetMin, showGauge())

// A blit repaints the Raster's cells and nothing else. When what the tree holds has changed (the line of text, the
// button's caption, the band's shape), the band has to be drawn again.
const redrawIf = ($: EngineInterface, treeChanged: boolean) => {
  if (treeChanged || textShown) $.ui.invalidate('ui.render')
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
const sampleSession = async ($: EngineInterface) => {
  try {
    const usd = (await $.session.usage()).cost?.usd
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
  rebuildCards(await clockNow($)) // until ccusage answers: the loading card and the caption of the saved period
  $.ui.invalidate('ui.render')
  await sampleSession($)
  await refreshSpend($)
}

// The button: on to the next period, with the crawl back at its first card, and its numbers from the days
// already read. ccusage is not run again.
const pressPeriod = async ($: EngineInterface) => {
  period = nextPeriod(period)
  rebuildCards(await clockNow($))
  scroll = newScroll(LEAD_PX)
  dirty = true
  $.ui.invalidate('ui.render') // the label and the caption are in the tree, so this is a redraw and not a blit
  try {
    await $.store.set('period', period) // the period as it is now, if another press came in meanwhile
  } catch {
    // the choice just does not outlive this session
  }
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
    return next(e)
  })

  // Pushed by the engine when a limit window moves, so there is nothing to poll.
  on('session.measure', async ($, e, next) => {
    limit = sevenDay(e.rateLimits)
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
    const { Text } = $.ui.resolve(e)
    textShown = true
    return <Text dimColor wrap="truncate">{lineAt(now)}</Text>
  })
}
