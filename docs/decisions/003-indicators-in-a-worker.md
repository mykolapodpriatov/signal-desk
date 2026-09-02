# ADR 003 — Indicators run in a Web Worker

**Status:** accepted · **Date:** 2026-09-02

## Context

EMA, RSI and ATR over a few hundred bars take well under a millisecond. Moving
them to a worker for speed alone would be premature.

The reason is not speed, it is **contention**. During a burst the main thread
has one job — paint — and anything else competing for it becomes a dropped
frame. A millisecond of indicator maths landing in the same frame as a
sixty-tick batch is the difference between 60fps and a visible stutter, and the
cost grows with every indicator anyone adds later.

## Decision

Indicators run in a dedicated worker.

Three details matter more than the move itself:

**The worker imports `src/core/indicators`.** It does not reimplement anything.
A worker with its own copy of the formulas would eventually disagree with the
tested ones, and the divergence would surface as a number that looks slightly
wrong on a chart — which is close to undebuggable.

**Closes are transferred, not copied.** `Float64Array` buffers are passed as
transferables, so `postMessage` moves them instead of structured-cloning them.
At a few hundred bars the difference is academic; at the sizes this is built for
it is the difference between the worker being off the critical path and being
the critical path.

**Stale responses are discarded.** Ticks arrive faster than a round trip
completes, so requests overlap. Rendering the answer to a question asked three
bursts ago would make indicators visibly lag the price, and the bug would look
like a maths error rather than a scheduling one. Each request carries an id and
only the newest is honoured.

There is also a fallback: if the worker cannot start — an old browser, a strict
CSP — computation happens on the main thread. A chart with slightly worse frame
pacing beats no chart.

## Consequences

**Good.** Indicator cost cannot become frame cost, however the indicator set
grows. The worker round trip is visible in the overlay (`worker`, typically
0.2–0.4 ms), so the claim is checkable rather than asserted.

**Cost.** A message boundary to reason about, an ordering problem that had to be
solved explicitly, and a build that has to bundle a worker — Vite handles this,
but it is one more thing that can break in a deployment.

**A limit worth stating.** The worker computes indicators; it does not own the
socket. Ingest still happens on the main thread, so an extreme feed could
saturate it before indicators ever became the problem. Moving ingest into the
worker is the natural next step and is blocked on `SharedArrayBuffer` needing
cross-origin isolation — see [ADR 002](002-ring-buffer-and-backpressure.md).

## Alternatives considered

**Compute inline, on the main thread.** Correct today, at this indicator set. It
puts a growing cost on the one thread that must not have one, and the failure
would appear gradually as a chart that is a bit less smooth than it used to be.

**Compute on the server and stream the results.** Right for an indicator set too
heavy for a browser. Wrong here: it triples the message volume, adds latency to
a number derived from data the client already has, and requires a server the
demo does not have.

**`requestIdleCallback`.** Cheap and appealing. Rejected because "idle" during a
burst is precisely never, which is when the indicators are most wanted.
