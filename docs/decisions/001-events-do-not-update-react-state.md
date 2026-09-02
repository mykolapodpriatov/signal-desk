# ADR 001 — WebSocket events do not update React state

**Status:** accepted · **Date:** 2026-09-02

## Context

The obvious way to put a live feed on screen is the one every tutorial shows:

```tsx
socket.onmessage = (event) => {
  setTicks((current) => [...current, parse(event.data)]);
};
```

It is correct. It is what a competent developer writes first. And it makes the
**render rate equal to the event rate** — which is a number owned by the
exchange, not by the application. A quiet market renders ten times a second; a
volatile one renders three hundred times a second, on the same laptop, at the
moment the user most needs the screen to be responsive.

The failure is also hard to attribute. Nothing throws. The chart just gets
sticky when the market gets interesting, which is the worst possible time and
the hardest condition to reproduce afterwards.

## Decision

```
WebSocket → ring buffer → requestAnimationFrame → renderer
```

A tick handler writes three numbers into typed arrays and returns. It does not
call `setState`, does not allocate, and schedules nothing. Once per animation
frame the renderer drains everything that arrived since the last frame and
updates the chart through an imperative handle.

The work done per second is therefore bounded by the display's refresh rate
rather than by the exchange's volume. A feed that triples in rate does not
triple the cost; it makes each frame's batch larger, which is nearly free.

What _does_ go through React state is what a human changes — the source, the
speed — and the connection status, which changes a handful of times per session
and needs to be rendered.

## Consequences

Measured with ticks delivered one flush at a time, the way a socket delivers
them (batching them in a single `act()` lets React coalesce them, which reports
a fraction of the real cost and flatters the naive version most, since batching
is precisely what hides its problem):

| Ticks | React renders (naive) | React renders (this) |
| ----: | --------------------: | -------------------: |
|   100 |                   100 |                **0** |
|   500 |                   500 |                **0** |
| 2,000 |                 2,000 |                **0** |

Not "fewer". Zero, after mount. In the browser, replaying at 100×, the overlay
reads **200 msgs/s at 121 fps with 0 dropped ticks**.

**What it costs.** More machinery than `useState`, and a rule contributors have
to know: a tick must not cause a render. The benchmark asserts it, so the rule
is enforced rather than remembered.

**It also cost an accessibility defect**, which is worth naming because it is
the kind of thing this pattern causes. The chart component never re-renders, so
its screen-reader live region announced the first candle and then never changed.
It is now updated imperatively from the same handle, throttled to two seconds —
a live region updating sixty times a second is not an accessible chart, it is a
denial of service on a screen reader.

**When it does not matter.** A feed that ticks once a second, or a UI that shows
a single number, will never notice. This is built for the case where it does.

## Alternatives considered

**`useState` with the ticks in a parent.** Simplest and correct. Rejected on the
numbers above.

**Throttling `setState` — batch ticks and set state every 16ms.** Much better
than the naive version and genuinely reasonable. Rejected because it still
re-renders the React tree sixty times a second to update a canvas that React
does not own, and because the frame boundary is the natural batching point:
`requestAnimationFrame` already knows when the browser is ready to paint,
whereas a `setInterval(16)` only guesses.

**A state manager with selective subscriptions** — the approach taken in the
sibling `ai-chat-kit`. Right when many components each need a slice of the data.
Here there is one consumer, a canvas, and it does not want React in the path at
all.
