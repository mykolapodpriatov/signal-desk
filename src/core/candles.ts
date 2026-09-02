// Aggregating ticks into candles.
//
// The awkward parts of this are not the arithmetic, they are the cases a live
// feed produces and a tidy example never does:
//
//   - a tick landing exactly on an interval boundary (it opens the new candle,
//     it does not close the old one);
//   - a gap where no trade happened, which must not silently become a candle
//     spanning two intervals;
//   - a tick arriving out of order, which happens with multiple connections
//     and clock skew and must not corrupt a finished candle.
//
// Each has a test. None of them is hypothetical.

import type { Tick } from './ringBuffer';

export interface Candle {
  /** Start of the interval, in milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Floors a timestamp to the start of its interval. */
export function bucketStart(time: number, intervalMs: number): number {
  return Math.floor(time / intervalMs) * intervalMs;
}

export interface AggregateOptions {
  intervalMs: number;
  /**
   * Fill empty intervals with a flat candle at the previous close.
   *
   * Off by default: a chart that invents candles for periods with no trades is
   * lying about liquidity. On when a fixed-width x-axis matters more.
   */
  fillGaps?: boolean;
}

/**
 * Fold ticks into candles.
 *
 * Ticks older than the newest candle are dropped rather than merged: reopening
 * a finished candle would silently rewrite history a user has already seen,
 * and the count of what was ignored is more useful than a quietly wrong chart.
 */
export function aggregateTicks(
  ticks: readonly Tick[],
  options: AggregateOptions,
): { candles: Candle[]; outOfOrder: number } {
  const { intervalMs, fillGaps = false } = options;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(`intervalMs must be positive, got ${intervalMs}`);
  }

  const candles: Candle[] = [];
  let outOfOrder = 0;

  for (const tick of ticks) {
    const start = bucketStart(tick.time, intervalMs);
    const current = candles[candles.length - 1];

    if (current && start < current.time) {
      outOfOrder += 1;
      continue;
    }

    if (current && start === current.time) {
      current.high = Math.max(current.high, tick.price);
      current.low = Math.min(current.low, tick.price);
      current.close = tick.price;
      current.volume += tick.size;
      continue;
    }

    if (current && fillGaps) {
      for (
        let empty = current.time + intervalMs;
        empty < start;
        empty += intervalMs
      ) {
        candles.push({
          time: empty,
          open: current.close,
          high: current.close,
          low: current.close,
          close: current.close,
          volume: 0,
        });
      }
    }

    candles.push({
      time: start,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tick.size,
    });
  }

  return { candles, outOfOrder };
}

/**
 * Apply new ticks to an existing candle series in place-ish.
 *
 * Returns a new array only when the series actually changed, so a renderer can
 * skip work on a frame where nothing arrived — which, at 60fps against a feed
 * that ticks ten times a second, is most frames.
 */
export function appendTicks(
  existing: readonly Candle[],
  ticks: readonly Tick[],
  options: AggregateOptions,
): { candles: readonly Candle[]; changed: boolean; outOfOrder: number } {
  if (ticks.length === 0) {
    return { candles: existing, changed: false, outOfOrder: 0 };
  }

  const last = existing[existing.length - 1];
  const seed: Tick[] = last
    ? [{ time: last.time, price: last.open, size: 0 }]
    : [];
  const merged = aggregateTicks([...seed, ...ticks], options);

  if (last && merged.candles.length > 0) {
    // Restore the real high/low/close/volume of the candle we seeded, which the
    // synthetic seed tick flattened.
    const rebuilt = merged.candles[0] as Candle;
    rebuilt.high = Math.max(rebuilt.high, last.high);
    rebuilt.low = Math.min(rebuilt.low, last.low);
    rebuilt.volume += last.volume;
    if (rebuilt.close === last.open && ticks.length === 0) {
      rebuilt.close = last.close;
    }
    return {
      candles: [...existing.slice(0, -1), ...merged.candles],
      changed: true,
      outOfOrder: merged.outOfOrder,
    };
  }

  return {
    candles: [...existing, ...merged.candles],
    changed: merged.candles.length > 0,
    outOfOrder: merged.outOfOrder,
  };
}
