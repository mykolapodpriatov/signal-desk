# Contributing

```bash
pnpm install
pnpm dev      # http://localhost:5173, replaying a recorded session
pnpm test
pnpm bench    # the render-cost comparison
pnpm e2e
```

## What the layers are for

- `src/core/**` — the ring buffer, candle aggregation, indicators, back-pressure
  policy. Pure functions and plain classes. **No React**, enforced by ESLint: a
  ring buffer that needs a component to exist is a ring buffer nobody can test
  at a million ticks.
- `src/stream/**` — anything that knows about a specific feed. The core has
  never heard of Binance.
- `src/worker/**` — indicator computation off the main thread.
- `src/components/**`, `src/hooks/**` — the UI.

## The rule this project exists to demonstrate

**A tick must not cause a React render.** Ticks go into the ring buffer; the
renderer reads the buffer once per animation frame. If you find yourself
reaching for `setState` in a message handler, that is the bug this repository
is about.

The benchmark asserts it: `pnpm bench` fails if the render count starts scaling
with the tick count.

## Before opening a PR

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
