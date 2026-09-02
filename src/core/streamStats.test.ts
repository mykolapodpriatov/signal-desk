import { describe, expect, it } from 'vitest';

import { RollingRate, StreamStats } from './streamStats';

describe('RollingRate', () => {
  it('is zero before anything happens', () => {
    expect(new RollingRate().rate(0)).toBe(0);
  });

  it('counts events inside the window', () => {
    const rate = new RollingRate(1_000);
    rate.mark(0, 10);

    expect(rate.rate(500)).toBe(10);
  });

  it('forgets events that fall out of the window', () => {
    // Without this the "per second" number would only ever grow, which is the
    // most common way a throughput display quietly becomes a lie.
    const rate = new RollingRate(1_000);
    rate.mark(0, 10);
    rate.mark(900, 5);

    expect(rate.rate(1_500)).toBe(5);
  });

  it('reaches zero when the feed stops', () => {
    const rate = new RollingRate(1_000);
    rate.mark(0, 100);

    expect(rate.rate(5_000)).toBe(0);
  });

  it('scales to a window other than a second', () => {
    const rate = new RollingRate(2_000);
    rate.mark(0, 10);

    // 10 events in a 2s window is 5 per second.
    expect(rate.rate(100)).toBe(5);
  });
});

describe('StreamStats', () => {
  it('reports an empty snapshot before anything happens', () => {
    expect(new StreamStats().snapshot(0)).toEqual({
      messagesPerSecond: 0,
      framesPerSecond: 0,
      bufferSize: 0,
      droppedTicks: 0,
      reconnects: 0,
      workerLatencyMs: null,
      msSinceLastMessage: null,
    });
  });

  it('reports message and frame rates separately', () => {
    // They are different questions: a feed can be busy while rendering stalls,
    // and that is precisely the failure this overlay is meant to expose.
    const stats = new StreamStats();
    stats.recordMessages(0, 120);
    stats.recordFrame(0);
    stats.recordFrame(10);

    const snapshot = stats.snapshot(100);

    expect(snapshot.messagesPerSecond).toBe(120);
    expect(snapshot.framesPerSecond).toBe(2);
  });

  it('accumulates dropped ticks rather than resetting them', () => {
    // The question is "has the consumer ever fallen behind", so a counter that
    // resets on read would answer a different, less useful question.
    const stats = new StreamStats();
    stats.recordDropped(3);
    stats.recordDropped(2);

    expect(stats.snapshot(0).droppedTicks).toBe(5);
  });

  it('counts reconnects', () => {
    const stats = new StreamStats();
    stats.recordReconnect();
    stats.recordReconnect();

    expect(stats.snapshot(0).reconnects).toBe(2);
  });

  it('tracks how long the feed has been silent', () => {
    // A chart that is not moving looks the same whether the market is quiet or
    // the socket died. This is how you tell.
    const stats = new StreamStats();
    stats.recordMessages(1_000);

    expect(stats.snapshot(4_000).msSinceLastMessage).toBe(3_000);
  });

  it('reports the latest worker latency', () => {
    const stats = new StreamStats();
    stats.recordWorkerLatency(12.5);

    expect(stats.snapshot(0).workerLatencyMs).toBe(12.5);
  });

  it('reports the current buffer occupancy', () => {
    const stats = new StreamStats();
    stats.setBufferSize(512);

    expect(stats.snapshot(0).bufferSize).toBe(512);
  });

  it('reset clears the cumulative counters', () => {
    const stats = new StreamStats();
    stats.recordDropped(5);
    stats.recordReconnect();

    stats.reset();

    const snapshot = stats.snapshot(0);
    expect(snapshot.droppedTicks).toBe(0);
    expect(snapshot.reconnects).toBe(0);
    expect(snapshot.msSinceLastMessage).toBeNull();
  });
});
