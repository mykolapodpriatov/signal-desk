import { describe, expect, it } from 'vitest';

import {
  aggregateTicks,
  appendTicks,
  bucketStart,
  reaggregateFromBuffer,
} from './candles';
import { TickRingBuffer, type Tick } from './ringBuffer';

const MINUTE = 60_000;
const tick = (time: number, price: number, size = 1): Tick => ({
  time,
  price,
  size,
});

describe('bucketStart', () => {
  it('floors a timestamp to its interval', () => {
    expect(bucketStart(90_000, MINUTE)).toBe(60_000);
  });

  it('leaves a timestamp already on a boundary alone', () => {
    expect(bucketStart(120_000, MINUTE)).toBe(120_000);
  });
});

describe('aggregateTicks', () => {
  it('rejects a non-positive interval instead of dividing by zero', () => {
    expect(() => aggregateTicks([], { intervalMs: 0 })).toThrow(RangeError);
  });

  it('builds one candle from ticks in the same interval', () => {
    const { candles } = aggregateTicks(
      [tick(0, 100), tick(1_000, 105), tick(2_000, 98), tick(3_000, 102)],
      { intervalMs: MINUTE },
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      time: 0,
      open: 100,
      high: 105,
      low: 98,
      close: 102,
      volume: 4,
    });
  });

  it('opens a new candle for a tick exactly on the boundary', () => {
    // 60_000 belongs to the second minute, not the first. Getting this wrong
    // by one millisecond shifts every candle on the chart.
    const { candles } = aggregateTicks([tick(59_999, 100), tick(60_000, 101)], {
      intervalMs: MINUTE,
    });

    expect(candles.map((candle) => candle.time)).toEqual([0, 60_000]);
  });

  it('leaves a gap where no trade happened, by default', () => {
    // Inventing a candle for a period with no trades misrepresents liquidity.
    const { candles } = aggregateTicks([tick(0, 100), tick(3 * MINUTE, 110)], {
      intervalMs: MINUTE,
    });

    expect(candles.map((candle) => candle.time)).toEqual([0, 3 * MINUTE]);
  });

  it('fills gaps with flat candles when asked', () => {
    const { candles } = aggregateTicks([tick(0, 100), tick(3 * MINUTE, 110)], {
      intervalMs: MINUTE,
      fillGaps: true,
    });

    expect(candles.map((candle) => candle.time)).toEqual([
      0,
      MINUTE,
      2 * MINUTE,
      3 * MINUTE,
    ]);
    expect(candles[1]).toMatchObject({ open: 100, close: 100, volume: 0 });
  });

  it('ignores a tick that arrives after its candle has closed', () => {
    // Clock skew and reconnects produce these. Reopening a finished candle
    // would silently rewrite history the user has already looked at.
    const { candles, outOfOrder } = aggregateTicks(
      [tick(0, 100), tick(MINUTE, 110), tick(30_000, 999)],
      { intervalMs: MINUTE },
    );

    expect(outOfOrder).toBe(1);
    expect(candles).toHaveLength(2);
    expect(candles[0]?.high).toBe(100);
  });

  it('accumulates volume rather than replacing it', () => {
    const { candles } = aggregateTicks(
      [tick(0, 100, 1.5), tick(1_000, 100, 2.5)],
      { intervalMs: MINUTE },
    );

    expect(candles[0]?.volume).toBe(4);
  });

  it('handles a zero-size tick, which some feeds legitimately send', () => {
    const { candles } = aggregateTicks([tick(0, 100, 0)], {
      intervalMs: MINUTE,
    });

    expect(candles[0]?.volume).toBe(0);
    expect(candles[0]?.close).toBe(100);
  });

  it('returns nothing for no ticks', () => {
    expect(aggregateTicks([], { intervalMs: MINUTE }).candles).toEqual([]);
  });
});

describe('appendTicks', () => {
  it('reports no change when nothing arrived', () => {
    // The renderer runs at 60fps against a feed that ticks ten times a second,
    // so most frames have nothing to do and should say so.
    const existing = aggregateTicks([tick(0, 100)], {
      intervalMs: MINUTE,
    }).candles;

    const result = appendTicks(existing, [], { intervalMs: MINUTE });

    expect(result.changed).toBe(false);
    expect(result.candles).toBe(existing);
  });

  it('updates the open candle in place', () => {
    const existing = aggregateTicks([tick(0, 100)], {
      intervalMs: MINUTE,
    }).candles;

    const result = appendTicks(existing, [tick(30_000, 120)], {
      intervalMs: MINUTE,
    });

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]).toMatchObject({
      open: 100,
      high: 120,
      close: 120,
    });
  });

  it('keeps the running low when a later tick is higher', () => {
    const existing = aggregateTicks([tick(0, 100), tick(1_000, 90)], {
      intervalMs: MINUTE,
    }).candles;

    const result = appendTicks(existing, [tick(2_000, 105)], {
      intervalMs: MINUTE,
    });

    expect(result.candles[0]?.low).toBe(90);
    expect(result.candles[0]?.high).toBe(105);
  });

  it('carries volume across an update', () => {
    const existing = aggregateTicks([tick(0, 100, 3)], {
      intervalMs: MINUTE,
    }).candles;

    const result = appendTicks(existing, [tick(1_000, 100, 2)], {
      intervalMs: MINUTE,
    });

    expect(result.candles[0]?.volume).toBe(5);
  });

  it('opens a new candle when the interval rolls over', () => {
    const existing = aggregateTicks([tick(0, 100)], {
      intervalMs: MINUTE,
    }).candles;

    const result = appendTicks(existing, [tick(MINUTE + 1, 110)], {
      intervalMs: MINUTE,
    });

    expect(result.candles).toHaveLength(2);
    expect(result.candles[1]).toMatchObject({ time: MINUTE, open: 110 });
  });

  it('starts a series from nothing', () => {
    const result = appendTicks([], [tick(0, 100)], { intervalMs: MINUTE });

    expect(result.changed).toBe(true);
    expect(result.candles).toHaveLength(1);
  });
});

describe('reaggregateFromBuffer', () => {
  it('rebuilds candles at a new interval from the buffer, not from empty', () => {
    const buffer = new TickRingBuffer(16);
    buffer.push(tick(0, 100));
    buffer.push(tick(30_000, 110));
    buffer.push(tick(60_000, 90));
    buffer.push(tick(90_000, 95));

    // At one-minute candles this is two bars; changing the interval should
    // fold the same raw ticks differently, not lose them.
    const perMinute = reaggregateFromBuffer(buffer, { intervalMs: MINUTE });
    expect(perMinute.candles.map((candle) => candle.time)).toEqual([0, MINUTE]);

    const perHalfMinute = reaggregateFromBuffer(buffer, {
      intervalMs: 30_000,
    });
    expect(perHalfMinute.candles.map((candle) => candle.time)).toEqual([
      0, 30_000, 60_000, 90_000,
    ]);
  });

  it('reads the buffer without consuming it, so it can run repeatedly', () => {
    // A human can change the interval control more than once in a session;
    // each change has to see the same raw history, not whatever is left
    // after the previous change already read it.
    const buffer = new TickRingBuffer(16);
    buffer.push(tick(0, 100));
    buffer.push(tick(1_000, 105));

    const first = reaggregateFromBuffer(buffer, { intervalMs: MINUTE });
    const second = reaggregateFromBuffer(buffer, { intervalMs: MINUTE });

    expect(second.candles).toEqual(first.candles);
  });

  it('shows only what the bounded window still holds once it has wrapped', () => {
    // This is the design tradeoff from the issue: the ring buffer is a fixed
    // number of ticks, not a fixed span of time, so a wider interval can
    // legitimately show less history than a narrower one did.
    const buffer = new TickRingBuffer(2);
    buffer.push(tick(0, 100));
    buffer.push(tick(60_000, 90));
    buffer.push(tick(120_000, 95)); // overwrites the tick at time 0

    const result = reaggregateFromBuffer(buffer, { intervalMs: MINUTE });

    expect(result.candles.map((candle) => candle.time)).toEqual([
      60_000, 120_000,
    ]);
  });

  it('returns nothing for an empty buffer', () => {
    const buffer = new TickRingBuffer(4);

    const result = reaggregateFromBuffer(buffer, { intervalMs: MINUTE });

    expect(result.candles).toEqual([]);
    expect(result.outOfOrder).toBe(0);
  });

  it('honours a `since` cursor, so an earlier session is not stitched back in', () => {
    // The ring buffer is not cleared when the human switches source (replay
    // to live, say), so reaggregating from the very start would fold the old
    // source's ticks into what is supposed to be a fresh series. A caller
    // that knows where the new source began passes that write count.
    const buffer = new TickRingBuffer(16);
    buffer.push(tick(0, 100)); // belongs to a session that has "ended"
    const since = buffer.totalWritten;
    buffer.push(tick(60_000, 200));
    buffer.push(tick(90_000, 210));

    const result = reaggregateFromBuffer(buffer, { intervalMs: MINUTE }, since);

    expect(result.candles.map((candle) => candle.time)).toEqual([60_000]);
    expect(result.candles[0]?.open).toBe(200);
  });
});
