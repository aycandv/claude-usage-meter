import { test, expect } from 'claude-code/testing'

import { gaugeShown, newStatus, turnCompleted, turnStarted, withWorking } from './status'

test('a new status is idle, with no turn done', () => {
  expect(newStatus()).toEqual({ working: false, turnsDone: 0 })
})

test('a turn starting marks the status as working, and leaves the old status as it was', () => {
  const idle = newStatus()
  expect(turnStarted(idle)).toEqual({ working: true, turnsDone: 0 })
  expect(idle).toEqual({ working: false, turnsDone: 0 })
})

test('a main turn completing ends the work and counts the turn', () => {
  expect(turnCompleted({ working: true, turnsDone: 2 })).toEqual({ working: false, turnsDone: 3 })
})

test('a subagent turn completing changes nothing: the main turn is still working', () => {
  const running = turnStarted(newStatus())
  expect(turnCompleted(running, 'agent-1')).toBe(running)
  expect(turnCompleted(running, 'agent-1')).toEqual({ working: true, turnsDone: 0 })
})

test('a main turn completing after its subagents counts once', () => {
  let status = turnStarted(newStatus())
  status = turnCompleted(status, 'agent-1')
  status = turnCompleted(status, 'agent-2')
  expect(status.working).toBe(true)
  status = turnCompleted(status)
  expect(status).toEqual({ working: false, turnsDone: 1 })
})

test('withWorking follows the flag the band reports and keeps the count of turns', () => {
  expect(withWorking({ working: false, turnsDone: 4 }, true)).toEqual({ working: true, turnsDone: 4 })
  expect(withWorking({ working: true, turnsDone: 4 }, false)).toEqual({ working: false, turnsDone: 4 })
  const same = { working: true, turnsDone: 1 }
  expect(withWorking(same, true)).toBe(same)
})

test('the gauge shows while a weekly limit exists, however many turns are done', () => {
  expect(gaugeShown(newStatus(), true)).toBe(true)
  expect(gaugeShown({ working: false, turnsDone: 25 }, true)).toBe(true)
})

test('with no limit the gauge shows until a main turn has completed', () => {
  expect(gaugeShown(newStatus(), false)).toBe(true)
  expect(gaugeShown(turnStarted(newStatus()), false)).toBe(true)
  expect(gaugeShown(turnCompleted(turnStarted(newStatus())), false)).toBe(false)
})

test('subagent turns never hide the gauge', () => {
  let status = turnStarted(newStatus())
  for (const id of ['a', 'b', 'c']) status = turnCompleted(status, id)
  expect(gaugeShown(status, false)).toBe(true)
})
