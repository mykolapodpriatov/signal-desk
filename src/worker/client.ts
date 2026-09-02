// A typed client for the indicator worker.
//
// Two behaviours matter:
//
//   1. **Stale responses are discarded.** Ticks arrive faster than a round trip
//      completes, so requests overlap. Rendering the answer to a question asked
//      three bursts ago would make indicators lag the price visibly, and the
//      bug would look like a maths error rather than a scheduling one.
//   2. **Failure degrades rather than breaks.** If the worker cannot start —
//      an old browser, a strict CSP — the caller falls back to computing on the
//      main thread. A chart with slightly worse frame pacing beats no chart.

import { atr, ema, rsi } from '../core/indicators';
import type { IndicatorRequest, IndicatorResponse } from './protocol';

export interface IndicatorInput {
  closes: number[];
  highs: number[];
  lows: number[];
  emaPeriod: number;
  rsiPeriod: number;
  atrPeriod: number;
}

export interface IndicatorResult {
  ema: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
  computeMs: number;
  /** True when the worker was unavailable and this ran on the main thread. */
  fellBack: boolean;
}

export interface IndicatorClient {
  compute(input: IndicatorInput): Promise<IndicatorResult>;
  terminate(): void;
}

/** Computes on the calling thread. Used as the fallback, and by the tests. */
export function computeInline(input: IndicatorInput): IndicatorResult {
  const started = performance.now();
  const bars = input.closes.map((close, index) => ({
    high: input.highs[index] ?? close,
    low: input.lows[index] ?? close,
    close,
  }));

  return {
    ema: ema(input.closes, input.emaPeriod),
    rsi: rsi(input.closes, input.rsiPeriod),
    atr: atr(bars, input.atrPeriod),
    computeMs: performance.now() - started,
    fellBack: true,
  };
}

export function createIndicatorClient(): IndicatorClient {
  let worker: Worker | null = null;
  let nextId = 1;
  let latestId = 0;
  const pending = new Map<number, (result: IndicatorResult) => void>();

  try {
    worker = new Worker(new URL('./indicators.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<IndicatorResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      // A response older than the newest request is answering a question nobody
      // is asking any more.
      if (!resolve || event.data.id !== latestId) return;
      resolve({
        ema: event.data.ema,
        rsi: event.data.rsi,
        atr: event.data.atr,
        computeMs: event.data.computeMs,
        fellBack: false,
      });
    };
  } catch {
    worker = null;
  }

  return {
    async compute(input) {
      const active = worker;
      if (!active) return computeInline(input);

      const id = nextId++;
      latestId = id;

      const closes = Float64Array.from(input.closes);
      const highs = Float64Array.from(input.highs);
      const lows = Float64Array.from(input.lows);

      const request: IndicatorRequest = {
        id,
        closes,
        highs,
        lows,
        emaPeriod: input.emaPeriod,
        rsiPeriod: input.rsiPeriod,
        atrPeriod: input.atrPeriod,
      };

      return new Promise<IndicatorResult>((resolve) => {
        pending.set(id, resolve);
        // Transfer the buffers rather than copying them.
        active.postMessage(request, [closes.buffer, highs.buffer, lows.buffer]);
      });
    },

    terminate() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
