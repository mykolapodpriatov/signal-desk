import { useEffect, useRef } from 'react';

import type { TickRingBuffer } from '../core/ringBuffer';
import type { StreamStats } from '../core/streamStats';
import type { Tick } from '../core/ringBuffer';

// The other half of the thesis: draining once per animation frame.
//
// The callback receives everything that arrived since the previous frame, which
// during a burst might be fifty ticks and during a quiet second might be none.
// Batching by frame rather than by tick means the work done per second is
// bounded by the display's refresh rate instead of by the exchange's volume —
// and it is the reason a feed that triples in rate does not triple the cost.
//
// The callback is held in a ref so a consumer passing an inline arrow does not
// restart the loop on every render. Restarting a rAF loop per render is a
// subtle way to end up with two loops, and then four.

export interface UseRafRendererOptions {
  buffer: TickRingBuffer;
  stats: StreamStats;
  /** Called once per frame with everything that arrived since the last one. */
  onFrame: (ticks: Tick[], dropped: number) => void;
  enabled?: boolean;
}

export function useRafRenderer({
  buffer,
  stats,
  onFrame,
  enabled = true,
}: UseRafRendererOptions): void {
  const callback = useRef(onFrame);
  // Assigned in an effect rather than during render: touching a ref while
  // rendering is unsafe under concurrent rendering, where a render can be
  // thrown away and replayed.
  useEffect(() => {
    callback.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!enabled) return;

    let handle = 0;
    let cursor = 0;
    let cancelled = false;

    const frame = (): void => {
      if (cancelled) return;

      const drained = buffer.drainSince(cursor);
      cursor = drained.cursor;

      const now = performance.now();
      stats.recordFrame(now);
      if (drained.dropped > 0) stats.recordDropped(drained.dropped);

      // Skipping the callback on an empty frame is not just an optimisation:
      // it is what lets a consumer treat "called" as "something changed".
      if (drained.ticks.length > 0 || drained.dropped > 0) {
        callback.current(drained.ticks, drained.dropped);
      }

      handle = requestAnimationFrame(frame);
    };

    handle = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [buffer, stats, enabled]);
}
