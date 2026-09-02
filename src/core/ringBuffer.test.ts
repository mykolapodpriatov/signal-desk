import { describe, expect, it } from 'vitest';

import { TickRingBuffer, type Tick } from './ringBuffer';

const tick = (time: number, price = 100, size = 1): Tick => ({
  time,
  price,
  size,
});

describe('TickRingBuffer', () => {
  it('rejects a nonsensical capacity rather than misbehaving later', () => {
    expect(() => new TickRingBuffer(0)).toThrow(RangeError);
    expect(() => new TickRingBuffer(-1)).toThrow(RangeError);
    expect(() => new TickRingBuffer(1.5)).toThrow(RangeError);
  });

  it('starts empty', () => {
    const buffer = new TickRingBuffer(4);

    expect(buffer.size).toBe(0);
    expect(buffer.last()).toBeNull();
    expect(buffer.drainSince(0).ticks).toEqual([]);
  });

  it('returns everything written while under capacity', () => {
    const buffer = new TickRingBuffer(4);
    buffer.push(tick(1));
    buffer.push(tick(2));

    const drained = buffer.drainSince(0);

    expect(drained.ticks.map((t) => t.time)).toEqual([1, 2]);
    expect(drained.dropped).toBe(0);
    expect(drained.cursor).toBe(2);
  });

  it('preserves values, not just counts', () => {
    const buffer = new TickRingBuffer(2);
    buffer.push({ time: 7, price: 123.456, size: 0.25 });

    expect(buffer.last()).toEqual({ time: 7, price: 123.456, size: 0.25 });
  });

  it('overwrites the oldest tick when full', () => {
    // A full buffer keeps the newest data, because in a live feed that is the
    // data anyone cares about.
    const buffer = new TickRingBuffer(3);
    for (const time of [1, 2, 3, 4, 5]) buffer.push(tick(time));

    expect(buffer.size).toBe(3);
    expect(buffer.drainSince(0).ticks.map((t) => t.time)).toEqual([3, 4, 5]);
  });

  it('reads in order across the wrap point', () => {
    // The index arithmetic is the whole implementation; a wrap that reorders
    // ticks would corrupt every candle downstream.
    const buffer = new TickRingBuffer(3);
    for (const time of [1, 2, 3, 4]) buffer.push(tick(time));

    expect(buffer.drainSince(0).ticks.map((t) => t.time)).toEqual([2, 3, 4]);
  });

  it('reports how many ticks a slow consumer missed', () => {
    // Silent data loss in a trading UI is worse than visible data loss.
    const buffer = new TickRingBuffer(3);
    for (const time of [1, 2, 3, 4, 5]) buffer.push(tick(time));

    const drained = buffer.drainSince(0);

    expect(drained.dropped).toBe(2);
    expect(drained.ticks.map((t) => t.time)).toEqual([3, 4, 5]);
  });

  it('drains nothing when the consumer is already current', () => {
    const buffer = new TickRingBuffer(4);
    buffer.push(tick(1));
    const first = buffer.drainSince(0);

    const second = buffer.drainSince(first.cursor);

    expect(second.ticks).toEqual([]);
    expect(second.dropped).toBe(0);
    expect(second.cursor).toBe(first.cursor);
  });

  it('drains only what arrived since the last cursor', () => {
    const buffer = new TickRingBuffer(8);
    buffer.push(tick(1));
    const first = buffer.drainSince(0);
    buffer.push(tick(2));
    buffer.push(tick(3));

    const second = buffer.drainSince(first.cursor);

    expect(second.ticks.map((t) => t.time)).toEqual([2, 3]);
  });

  it('keeps a cursor meaningful across many wraps', () => {
    const buffer = new TickRingBuffer(4);
    for (let i = 0; i < 100; i += 1) buffer.push(tick(i));

    const drained = buffer.drainSince(96);

    expect(drained.ticks.map((t) => t.time)).toEqual([96, 97, 98, 99]);
    expect(drained.dropped).toBe(0);
  });

  it('counts every write, including overwritten ones', () => {
    const buffer = new TickRingBuffer(2);
    for (let i = 0; i < 10; i += 1) buffer.push(tick(i));

    expect(buffer.totalWritten).toBe(10);
    expect(buffer.size).toBe(2);
  });

  it('clear resets the window without reallocating', () => {
    const buffer = new TickRingBuffer(4);
    buffer.push(tick(1));

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.last()).toBeNull();
  });

  it('absorbs a hundred thousand ticks without slowing down', () => {
    // Not a timing assertion — those are noise on a shared runner. This asserts
    // the buffer stays bounded, which is the property that keeps it fast.
    const buffer = new TickRingBuffer(1_000);
    for (let i = 0; i < 100_000; i += 1) buffer.push(tick(i));

    expect(buffer.size).toBe(1_000);
    expect(buffer.last()?.time).toBe(99_999);
  });
});
