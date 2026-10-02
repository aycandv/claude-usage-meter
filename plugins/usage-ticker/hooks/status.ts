// What the board knows about the main conversation's turns. A subagent's turn is the main turn's own
// business: its completion must neither end the main turn's work nor count toward hiding the gauge.
export type Status = { working: boolean; turnsDone: number }

export const newStatus = (): Status => ({ working: false, turnsDone: 0 })

export const turnStarted = (status: Status): Status => ({ ...status, working: true })

// `agentId` is set on the turn.complete of a subagent's turn; that changes nothing here.
export const turnCompleted = (status: Status, agentId?: string): Status =>
  agentId === undefined ? { working: false, turnsDone: status.turnsDone + 1 } : status

// The band reports whether a turn is running each time it is drawn; that is the last word on `working`.
export const withWorking = (status: Status, working: boolean): Status => (status.working === working ? status : { ...status, working })

// An account with no weekly limit shows no gauge once a main turn has completed without one appearing.
export const gaugeShown = (status: Status, hasLimit: boolean): boolean => hasLimit || status.turnsDone === 0
