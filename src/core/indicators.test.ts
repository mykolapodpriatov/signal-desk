import { describe, expect, it } from 'vitest';

import { atr, ema, rsi, type Bar } from './indicators';

// Expected values are computed by hand in the comments. Checking an indicator
// against another implementation of the same formula proves only that two
// things agree, including when both are wrong.

describe('ema', () => {
  it('rejects a nonsensical period', () => {
    expect(() => ema([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => ema([1, 2, 3], 2.5)).toThrow(RangeError);
  });

  it('is null everywhere until the period is filled', () => {
    // A partial EMA is a number that looks like an EMA and is not one.
    const out = ema([1, 2, 3, 4, 5], 3);

    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).not.toBeNull();
  });

  it('seeds with the simple average of the first period', () => {
    // (1 + 2 + 3) / 3 = 2
    expect(ema([1, 2, 3], 3)[2]).toBeCloseTo(2, 10);
  });

  it('applies the smoothing constant to later values', () => {
    // seed = 2, k = 2/(3+1) = 0.5
    // next  = 4 * 0.5 + 2 * 0.5 = 3
    // next  = 5 * 0.5 + 3 * 0.5 = 4
    const out = ema([1, 2, 3, 4, 5], 3);

    expect(out[3]).toBeCloseTo(3, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it('returns all nulls when there is not enough data', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });

  it('is flat for a flat series', () => {
    const out = ema([7, 7, 7, 7, 7], 3);

    expect(out[4]).toBeCloseTo(7, 10);
  });

  it('handles a period of 1 as the series itself', () => {
    expect(ema([3, 9, 4], 1)).toEqual([3, 9, 4]);
  });

  it('drops a non-finite tick instead of poisoning the rest of the series', () => {
    // seed of [1, 2, 3] is 2, then NaN resets, then [4, 5, 6] seeds at 5.
    const out = ema([1, 2, 3, Number.NaN, 4, 5, 6], 3);

    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeNull();
    expect(out[4]).toBeNull();
    expect(out[5]).toBeNull();
    expect(out[6]).toBeCloseTo(5, 10);
    expect(out.every((value) => value === null || Number.isFinite(value))).toBe(
      true,
    );
  });
});

describe('rsi', () => {
  it('is null until period + 1 values exist', () => {
    const out = rsi([1, 2, 3], 3);

    expect(out).toEqual([null, null, null]);
  });

  it('is 100 when every change is a gain', () => {
    // Average loss is zero and average gain is positive: a genuine 100, not an
    // undefined value.
    const out = rsi([1, 2, 3, 4, 5], 2);

    expect(out[4]).toBe(100);
  });

  it('is 0 when every change is a loss', () => {
    const out = rsi([5, 4, 3, 2, 1], 2);

    expect(out[4]).toBeCloseTo(0, 10);
  });

  it('is null, not 50, for a perfectly flat price', () => {
    // 0/0. The conventional 50 reads as "neutral momentum" when the honest
    // answer is "there is no momentum to measure".
    const out = rsi([10, 10, 10, 10, 10], 2);

    expect(out[4]).toBeNull();
  });

  it('computes the seed value from the first period', () => {
    // changes over period 2: +2 then -1
    // average gain = 1, average loss = 0.5, RS = 2
    // RSI = 100 - 100/3 = 66.6667
    const out = rsi([10, 12, 11], 2);

    expect(out[2]).toBeCloseTo(66.66666666666667, 8);
  });

  it("applies Wilder's smoothing to later values", () => {
    // continuing the series above with 14 (a +3 change)
    // averageGain = (1 * 1 + 3) / 2 = 2
    // averageLoss = (0.5 * 1 + 0) / 2 = 0.25
    // RS = 8, RSI = 100 - 100/9 = 88.8889
    const out = rsi([10, 12, 11, 14], 2);

    expect(out[3]).toBeCloseTo(88.88888888888889, 8);
  });

  it('does not turn the rest of the series into NaN after one bad price', () => {
    const out = rsi([10, 12, 11, Number.NaN, 10, 12, 11], 2);

    expect(out[2]).toBeCloseTo(66.66666666666667, 8);
    expect(out[3]).toBeNull();
    expect(out[6]).toBeCloseTo(66.66666666666667, 8);
    expect(out.every((value) => value === null || Number.isFinite(value))).toBe(
      true,
    );
  });

  it('stays within 0 and 100 across a noisy series', () => {
    const values = Array.from(
      { length: 200 },
      (_, i) => 100 + Math.sin(i / 3) * 10 + (i % 7),
    );

    for (const value of rsi(values, 14)) {
      if (value === null) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('atr', () => {
  const bar = (high: number, low: number, close: number): Bar => ({
    high,
    low,
    close,
  });

  it('is null until the period is filled', () => {
    const out = atr([bar(10, 8, 9), bar(11, 9, 10)], 3);

    expect(out).toEqual([null, null]);
  });

  it('uses plain high minus low for the first bar', () => {
    // TRs: 2, then max(2, |11-9|, |9-9|) = 2, then max(2, |12-10|, |10-10|) = 2
    // ATR over 3 = 2
    const out = atr([bar(10, 8, 9), bar(11, 9, 10), bar(12, 10, 11)], 3);

    expect(out[2]).toBeCloseTo(2, 10);
  });

  it('accounts for a gap between bars', () => {
    // Second bar gaps up: high 20, low 18, previous close 9.
    // TR = max(20-18, |20-9|, |18-9|) = 11, not 2.
    const out = atr([bar(10, 8, 9), bar(20, 18, 19)], 2);

    // (2 + 11) / 2 = 6.5
    expect(out[1]).toBeCloseTo(6.5, 10);
  });

  it('is zero for bars that never move', () => {
    // A legitimate zero, not a division problem: the range really is nothing.
    const out = atr([bar(5, 5, 5), bar(5, 5, 5), bar(5, 5, 5)], 3);

    expect(out[2]).toBe(0);
  });

  it("applies Wilder's smoothing after the seed", () => {
    // seed ATR over 2 = (2 + 2) / 2 = 2
    // next TR = max(14-10, |14-11|, |10-11|) = 4
    // ATR = (2 * 1 + 4) / 2 = 3
    const out = atr([bar(10, 8, 9), bar(11, 9, 11), bar(14, 10, 12)], 2);

    expect(out[2]).toBeCloseTo(3, 10);
  });

  it('rejects a nonsensical period', () => {
    expect(() => atr([], 0)).toThrow(RangeError);
  });

  it('restarts after a bar with a non-finite price', () => {
    const out = atr(
      [
        bar(10, 8, 9),
        bar(11, 9, 10),
        bar(Number.NaN, 9, 10),
        bar(12, 10, 11),
        bar(13, 11, 12),
      ],
      2,
    );

    expect(out[1]).toBeCloseTo(2, 10);
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
    // The two bars after the gap: TR 2, then TR 2, ATR 2.
    expect(out[4]).toBeCloseTo(2, 10);
  });
});
