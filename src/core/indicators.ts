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

  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i] as number;
  let previous = sum / period;
  out[period - 1] = previous;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] as number) * k + previous * (1 - k);
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

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  out[period] = toRsi(averageGain, averageLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    out[i] = toRsi(averageGain, averageLoss);
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
export function atr(bars: readonly Bar[], period = 14): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }

  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period) return out;

  const trueRanges: number[] = [];
  for (const [index, bar] of bars.entries()) {
    const previous = bars[index - 1];
    trueRanges.push(
      previous
        ? Math.max(
            bar.high - bar.low,
            Math.abs(bar.high - previous.close),
            Math.abs(bar.low - previous.close),
          )
        : bar.high - bar.low,
    );
  }

  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += trueRanges[i] as number;
  let previous = sum / period;
  out[period - 1] = previous;

  for (let i = period; i < bars.length; i += 1) {
    previous = (previous * (period - 1) + (trueRanges[i] as number)) / period;
    out[i] = previous;
  }

  return out;
}
