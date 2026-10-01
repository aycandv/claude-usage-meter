// Maps the engine's test kit onto bun:test so pure-module tests run while `claude plugin test` is gated off.
import { plugin } from 'bun'
import * as bunTest from 'bun:test'

plugin({
  name: 'claude-code-testing-shim',
  setup(build) {
    build.module('claude-code/testing', () => ({ exports: { ...bunTest }, loader: 'object' }))
  },
})
