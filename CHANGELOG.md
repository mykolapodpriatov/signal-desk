# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-02

First release. Every claim in the README is backed by a test, a measurement or a
live URL.

### Added

- **Ring buffer** over `Float64Array`s: fixed capacity, no allocation per write,
  drain by cursor, and a count of what it overwrote before the renderer read it.
- **Candle aggregation** handling the cases a live feed produces — a tick on an
  interval boundary, a gap with no trades, a tick arriving after its candle
  closed.
- **EMA, RSI and ATR**, every value tested against a number computed by hand.
- **`TickSource` interface** with two implementations: a deterministic replay of
  a recorded session (the default) and a live Binance adapter with backoff,
  jitter and stall detection.
- **Indicators in a Web Worker**, importing the same functions the unit tests
  exercise, with transferable buffers and stale-response rejection.
- **`useTickStream` and `useRafRenderer`** — subscribe without `setState` per
  tick, drain once per animation frame.
- **Performance overlay**: msgs/s, fps, buffer size, dropped ticks, worker
  latency, reconnects, time since the last message.
- **A benchmark** comparing this against the naive `setState`-per-tick
  implementation, asserting render counts in CI.
- 98 unit and component tests, 9 Playwright specs, three ADRs.

### Fixed during development

- **The chart's screen-reader live region never updated.** The component never
  re-renders by design, so it announced the first candle forever. It is now
  written imperatively from the same handle, throttled to two seconds — an
  accessibility defect the architecture itself caused.
- **Four ref-during-render violations** caught by `react-hooks/refs`, including
  the latest-callback pattern. Fixed rather than suppressed: callbacks move to
  effects, and the buffer and stats come from lazy state initialisers.
- **The chart looked broken with few bars**, rendering a sliver against the
  right edge. It fits content until there are enough bars to fill the pane.

### Notes

- An indicator value before its warm-up period is `null`, not a partial
  estimate; RSI on a perfectly flat price is `null`, not the conventional 50.
- The demo defaults to a recording rather than the live feed. A demo depending
  on somebody else's uptime, and on the market moving, eventually shows an empty
  screen.
- Orders, portfolio, authentication, alerts, strategies and backtesting are
  deliberately out of scope, and filed as an issue so the absence is on the
  record.
