# ADR 002 — A fixed ring buffer, and what happens when the consumer falls behind

**Status:** accepted · **Date:** 2026-09-02

## Context

Between the socket and the renderer something has to hold ticks. The choice of
_what_ determines what happens on a bad day — a burst of volume, a background
tab, a laptop that just started a backup.

An unbounded array is the default answer and the wrong one: a consumer that
cannot keep up turns it into a memory leak with extra steps, and the tab dies
some minutes later for reasons that look unrelated.

There is a second, quieter constraint. At hundreds of ticks a second, allocating
an object per tick means the garbage collector runs **during rendering**, which
is exactly when the application cannot afford it. The pause shows up as a
dropped frame and looks like a rendering problem.

## Decision

A fixed-capacity ring buffer over `Float64Array`s.

- **Capacity is fixed** (4,096 ticks by default, about two minutes of a busy
  feed). When full, the oldest tick is overwritten. In a live feed the newest
  data is the data anyone cares about; dropping the future to preserve the past
  would be the wrong trade.
- **A write is three assignments** into typed arrays. No object, no allocation,
  nothing for the collector to do.
- **The consumer drains by cursor** — "what happened since I last looked?" —
  rather than being pushed to. That is what lets one animation frame absorb
  fifty ticks.
- **Overwritten ticks are counted and surfaced** in the performance overlay.

That last point is the one worth arguing for. Silent data loss in a trading UI
is worse than visible data loss: a chart missing ticks looks exactly like a
chart with nothing to show, and the user has no way to tell. A `dropped` counter
that is normally zero and starts climbing is a fact the user can act on.

## Consequences

**Good.** Memory is bounded by construction, not by hope. The buffer absorbs a
hundred thousand ticks in a test without growing. Back-pressure has a defined
behaviour and a visible signal instead of an emergent one.

**Cost.** A slow consumer genuinely loses data. That is the correct trade here —
you cannot ask an exchange to slow down, and a UI is not a system of record —
but it would be wrong for anything that must not miss a message. A repository
doing order entry would need a different structure and probably a different
answer.

**Capacity is a tuning decision**, not a constant of nature. Bigger absorbs
longer stalls at the cost of memory; smaller detects a falling-behind consumer
sooner. 4,096 is chosen so a five-second stall at 300 ticks/second is survivable.

## Alternatives considered

**An unbounded array with periodic truncation.** Simple, and it works until it
does not. The failure mode is a slow memory climb that manifests as a browser
tab crash, minutes after the burst that caused it.

**A bounded queue that drops the _newest_ tick when full.** Preserves history,
which is right for an audit log and wrong for a chart: it would freeze the
display at the moment the market got busy.

**`SharedArrayBuffer` and a worker that owns the socket.** The genuinely
scalable answer, and it removes the main thread from the ingest path entirely.
Rejected for v1 because it requires cross-origin isolation headers, which
GitHub Pages does not serve — and a demo nobody can open is worth less than an
architecture one step short of ideal. Tracked as an issue.
