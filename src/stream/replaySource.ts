// Replaying a recorded session.
//
// This is the default source, not a fallback. A demo whose content depends on
// somebody else's uptime — and on whether the market happens to be moving at
// the moment a recruiter opens the link — is a demo that will eventually show
// an empty screen. A recording plays the same way every time, works offline,
// and makes the E2E suite deterministic.
//
// Timing is simulated rather than instant, because a UI built against an
// instant firehose never has to cope with the thing it exists to cope with:
// events arriving between frames, at an uneven rate.

import type { Tick } from '../core/ringBuffer';
import type { TickSource, TickSourceEvents } from './types';

export interface ReplayOptions {
  ticks: readonly Tick[];
  /** 1 = original pace, 10 = ten times faster. */
  speed?: number;
  /** Restart from the beginning when the recording runs out. */
  loop?: boolean;
  /** Injectable so tests do not spend real seconds waiting. */
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (handle: number) => void;
  };
}

const realScheduler = {
  setTimeout: (fn: () => void, ms: number) =>
    globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
};

export function createReplaySource(options: ReplayOptions): TickSource {
  const speed = options.speed && options.speed > 0 ? options.speed : 1;
  const scheduler = options.scheduler ?? realScheduler;
  const ticks = options.ticks;

  let handle: number | null = null;
  let index = 0;
  let stopped = true;

  return {
    name: `Replay ×${speed}`,
    isLive: false,

    start(events: TickSourceEvents) {
      stopped = false;
      index = 0;
      events.onState('connecting');

      if (ticks.length === 0) {
        events.onState('closed');
        return;
      }

      events.onState('open');

      const step = (): void => {
        if (stopped) return;

        const tick = ticks[index];
        if (!tick) {
          if (options.loop) {
            index = 0;
            handle = scheduler.setTimeout(step, 0);
            return;
          }
          events.onState('closed');
          return;
        }

        events.onTick(tick);
        index += 1;

        const next = ticks[index];
        if (!next) {
          // One more turn so the loop/close decision happens in `step` rather
          // than being duplicated here.
          handle = scheduler.setTimeout(step, 0);
          return;
        }

        // Gaps in the recording are preserved, divided by the speed. A recording
        // played back with even spacing would hide exactly the burstiness that
        // makes realtime rendering hard.
        const delay = Math.max(0, (next.time - tick.time) / speed);
        handle = scheduler.setTimeout(step, delay);
      };

      handle = scheduler.setTimeout(step, 0);
    },

    stop() {
      stopped = true;
      if (handle !== null) {
        scheduler.clearTimeout(handle);
        handle = null;
      }
    },
  };
}
