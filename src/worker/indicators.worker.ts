/// <reference lib="webworker" />
//
// Indicator computation, off the main thread.
//
// The point is not that EMA is slow — it is not. The point is that the main
// thread has exactly one job during a burst of ticks, which is to render, and
// anything else competing for it shows up as a dropped frame. Moving the maths
// here means a burst of five hundred ticks cannot stall the chart, whatever the
// indicator set grows into.
//
// The worker imports from src/core, so it is provably the same code the unit
// tests exercise. A worker that reimplemented the formulas would eventually
// disagree with them, and nobody would notice until a number looked odd.

import { atr, ema, rsi } from '../core/indicators';
import type { IndicatorRequest, IndicatorResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<IndicatorRequest>) => {
  const started = performance.now();
  const { id, closes, highs, lows, emaPeriod, rsiPeriod, atrPeriod } =
    event.data;

  const closeValues = Array.from(closes);
  const bars = closeValues.map((close, index) => ({
    high: highs[index] ?? close,
    low: lows[index] ?? close,
    close,
  }));

  const response: IndicatorResponse = {
    id,
    ema: ema(closeValues, emaPeriod),
    rsi: rsi(closeValues, rsiPeriod),
    atr: atr(bars, atrPeriod),
    computeMs: performance.now() - started,
  };

  scope.postMessage(response);
};
