// EMA, RSI and ATR.
//
// These are textbook formulas, which is exactly why they are worth writing
// carefully: everyone assumes they are right, so a subtle error survives for a
// long time. Two rules apply throughout:
//
//   - **A value before the warm-up period is `null`, not a partial estimate.**
//     An RSI computed from three of its fourteen periods is a number that looks
//     like an RSI and is not one. Charting it would be worse than a gap.
//   - **Undefined is `null`, not a plausible default.** RSI on a perfectly flat
//     price has 0/0 in it. The convention of returning 50 makes a chart that
//     reads "neutral" when the truth is "no information".
//
// Every value is checked against a hand-computed number in the tests.

/**
 * Exponential moving average.
 *
 * Seeded with a simple average of the first `period` values, which is the
 * standard treatment — seeding with the first value alone gives an EMA that
 * takes several periods to stop lying about the trend.
 */
export function ema(
  values: readonly number[],
  period: number,
): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }

  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  // A non-finite tick must not be folded into the average. NaN would make
  // every later value NaN, and the chart would go blank until reload.
  // The run resets and warms up again on the next finite stretch.
  const seed: number[] = [];
  let previous: number | null = null;
  const k = 2 / (period + 1);

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (!Number.isFinite(value)) {
      seed.length = 0;
      previous = null;
      continue;
    }
    if (previous === null) {
      seed.push(value);
      if (seed.length === period) {
        let sum = 0;
        for (const sample of seed) sum += sample;
        previous = sum / period;
        out[i] = previous;
        seed.length = 0;
      }
      continue;
    }
    previous = value * k + previous * (1 - k);
    out[i] = previous;
  }

  return out;
}

/**
 * Relative strength index, Wilder's smoothing.
 *
 * Returns `null` where it is undefined:
 *
 *   - before `period + 1` values exist;
 *   - when average loss is zero **and** average gain is zero, i.e. the price
 *     has not moved at all. (Average loss zero with a positive gain is a
 *     genuine 100, not an undefined.)
 */
export function rsi(values: readonly number[], period = 14): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }

  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  const window: number[] = [];
  let averageGain: number | null = null;
  let averageLoss: number | null = null;
  let previous: number | null = null;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (!Number.isFinite(value)) {
      window.length = 0;
      averageGain = null;
      averageLoss = null;
      previous = null;
      continue;
    }

    if (averageGain === null || averageLoss === null || previous === null) {
      window.push(value);
      if (window.length === period + 1) {
        let gainSum = 0;
        let lossSum = 0;
        for (let j = 1; j < window.length; j += 1) {
          const change = (window[j] as number) - (window[j - 1] as number);
          if (change >= 0) gainSum += change;
          else lossSum -= change;
        }
        averageGain = gainSum / period;
        averageLoss = lossSum / period;
        out[i] = toRsi(averageGain, averageLoss);
        previous = value;
        window.length = 0;
      }
      continue;
    }

    const change = value - previous;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    out[i] = toRsi(averageGain, averageLoss);
    previous = value;
  }

  return out;
}

function toRsi(averageGain: number, averageLoss: number): number | null {
  if (averageLoss === 0) {
    // Flat price: no gains and no losses means the ratio is 0/0. Returning the
    // conventional 50 would read as "neutral momentum" when the honest answer
    // is "there is no momentum to measure".
    return averageGain === 0 ? null : 100;
  }
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

export interface Bar {
  high: number;
  low: number;
  close: number;
}

/**
 * Average true range, Wilder's smoothing.
 *
 * True range for the first bar has no previous close, so it is the plain
 * high−low; every later bar takes the largest of the three standard candidates.
 */
function trueRange(bar: Bar, previous: Bar | undefined): number {
  if (!previous) return bar.high - bar.low;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previous.close),
    Math.abs(bar.low - previous.close),
  );
}

function barIsFinite(bar: Bar): boolean {
  return (
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close)
  );
}

export function atr(bars: readonly Bar[], period = 14): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }

  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period) return out;

  const window: Bar[] = [];
  let smoothed: number | null = null;
  let previousBar: Bar | null = null;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i] as Bar;
    if (!barIsFinite(bar)) {
      window.length = 0;
      smoothed = null;
      previousBar = null;
      continue;
    }

    if (smoothed === null || previousBar === null) {
      window.push(bar);
      if (window.length === period) {
        let sum = 0;
        for (let j = 0; j < window.length; j += 1) {
          sum += trueRange(
            window[j] as Bar,
            j === 0 ? undefined : window[j - 1],
          );
        }
        smoothed = sum / period;
        out[i] = smoothed;
        previousBar = bar;
        window.length = 0;
      }
      continue;
    }

    smoothed = (smoothed * (period - 1) + trueRange(bar, previousBar)) / period;
    out[i] = smoothed;
    previousBar = bar;
  }

  return out;
}
