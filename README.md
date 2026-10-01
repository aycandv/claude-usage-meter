# claude-usage-meter

A usage board for Claude Code: two terminal rows above the prompt. On the left, a gauge for your weekly limit. On the right, a dot-matrix crawl of what you have spent, model by model.

![The usage board above a Claude Code prompt: a weekly gauge, a dot-matrix crawl of spend, and a period button.](docs/usage-meter.gif)

*Rendered from the mod's own output with sample figures, not a screen recording.*

## What it shows

- **Gauge.** Your seven-day limit. The fill is what you have used, colored by where you will land (cool under about 55%, red past 100%). The faint extension is that projected landing, and the white notch is where the calendar says you should be. The caption says it in words: `Lands near 82%, resets Mon`, `Runs out Sat 22:00`.
- **Crawl.** A total card, then each model, biggest first (seven models and an `N others` card past eight). Prices are [ccusage](https://github.com/ryoppippi/ccusage)'s API-equivalent estimates, not your bill, and cover every agent it reports on.
- **Period button.** Click it to cycle Today, This week, This month, All time. *This week* runs since your weekly limit last reset. The gauge does not change, and your choice is remembered. Without fullscreen mode (`"tui": "fullscreen"`), click the board or press Ctrl+X then Tab, then `p`.
- **Speed.** The crawl always slides: slowly when idle, faster as spending picks up (about four characters a second at $20 an hour), and never below about two while Claude is working.

## Requirements

- Claude Code 2.1.287 or later, with hooks modules enabled for your account (see Caveats)
- `ccusage` on your `PATH`: `npm install -g ccusage`
- A 24-bit-color terminal that draws braille. Built against Ghostty on macOS; others are untested.
- A plan with a seven-day limit. Without one, the gauge hides.

## Install

```sh
claude plugin marketplace add aycandv/claude-usage-meter
claude plugin install usage-ticker@claude-usage-meter
```

Then run `/reload-plugins`, or restart Claude Code.

## How it works

- It reads `ccusage daily --json --breakdown` at session start, after turns (at most once a minute) and every 5 minutes. All periods are added up from that one list.
- Pace is the faster of this session's live cost rate and the machine-wide change in ccusage's total, in dollars an hour.
- The forecast is a straight line (used so far divided by the share of the week gone), so it ignores nights and runs pessimistic.
- Width: 100 columns or more gets the full layout and the button; 70 to 99 a narrower gauge; 50 to 69 a gauge without the crawl; under 50, and on the desktop app, one line of text.

## Caveats

- Hooks modules sit behind a rollout flag (`tengu_plugin_hooks_modules`). If Claude Code says they are turned off, the mod cannot load.
- Only the seven-day window is drawn, and periods are whole local days.
- The 197 pure-module tests pass. The 9 engine tests (`hooks/register.test.tsx`) need `claude plugin test` and have not been run. The board and button were tried by hand in Ghostty.

## Development

```sh
dev/test.sh                        # pure-module tests under bun
claude plugin test .               # everything, including the engine tests
claude plugin validate . --strict
```

`hooks/register.tsx` wires the engine's events to pure modules, each with a test file beside it. To type-check, load the mod once so Claude Code writes its types, then run `tsc -p .claude-plugin/types/tsconfig.json`.

## License

MIT. See [LICENSE](LICENSE).
