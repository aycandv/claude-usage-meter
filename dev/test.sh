#!/bin/sh
# Runs the pure-module tests under bun, with the engine's test kit mapped to bun:test.
# hooks/register.test.tsx mounts the band through the engine, so it needs `claude plugin test`.
cd "$(dirname "$0")/.." || exit 1
set -- ./plugins/usage-ticker/hooks/*.test.ts
exec bun test --preload ./dev/bun-shim.ts "$@"
