import { describe, expect, it } from 'vitest';

import type { Tick } from '../core/ringBuffer';
import {
  createBinanceSource,
  parseTradeFrame,
  type WebSocketLike,
} from './binanceSource';
import { createReplaySource } from './replaySource';
import type { ConnectionState, TickSourceEvents } from './types';

/** A scheduler that runs callbacks immediately and records the delays asked for. */
function immediateScheduler() {
  const delays: number[] = [];
  const pending = new Map<number, () => void>();
  let next = 1;

  return {
    delays,
    scheduler: {
      setTimeout(fn: () => void, ms: number) {
        delays.push(ms);
        const handle = next++;
        pending.set(handle, fn);
        // Run on a microtask so a caller can assign `handle` before the
        // callback re-enters — mirroring how a real timer behaves.
        queueMicrotask(() => {
          if (pending.delete(handle)) fn();
        });
        return handle;
      },
      clearTimeout(handle: number) {
        pending.delete(handle);
      },
    },
  };
}

function collector(): TickSourceEvents & {
  ticks: Tick[];
  states: ConnectionState[];
  reconnects: number;
} {
  const ticks: Tick[] = [];
  const states: ConnectionState[] = [];
  let reconnects = 0;
  return {
    ticks,
    states,
    get reconnects() {
      return reconnects;
    },
    onTick: (tick) => ticks.push(tick),
    onState: (state) => states.push(state),
    onReconnect: () => {
      reconnects += 1;
    },
  };
}

const tick = (time: number, price = 100): Tick => ({ time, price, size: 1 });

describe('replay source', () => {
  it('emits every recorded tick in order', async () => {
    const { scheduler } = immediateScheduler();
    const events = collector();
    const source = createReplaySource({
      ticks: [tick(0), tick(100), tick(250)],
      scheduler,
    });

    source.start(events);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.ticks.map((t) => t.time)).toEqual([0, 100, 250]);
  });

  it('preserves the gaps between ticks, divided by the speed', async () => {
    // Replaying with even spacing would hide exactly the burstiness that makes
    // realtime rendering hard.
    const { delays, scheduler } = immediateScheduler();
    const source = createReplaySource({
      ticks: [tick(0), tick(100), tick(400)],
      speed: 2,
      scheduler,
    });

    source.start(collector());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 100ms and 300ms gaps at 2x → 50 and 150.
    expect(delays).toContain(50);
    expect(delays).toContain(150);
  });

  it('reports itself as a replay, so nobody mistakes it for live', () => {
    const source = createReplaySource({ ticks: [], speed: 10 });

    expect(source.isLive).toBe(false);
    expect(source.name).toContain('×10');
  });

  it('closes when the recording runs out', async () => {
    const { scheduler } = immediateScheduler();
    const events = collector();

    createReplaySource({ ticks: [tick(0)], scheduler }).start(events);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.states).toContain('closed');
  });

  it('closes immediately on an empty recording', () => {
    const events = collector();

    createReplaySource({ ticks: [] }).start(events);

    expect(events.states).toEqual(['connecting', 'closed']);
  });

  it('emits nothing after stop', async () => {
    const { scheduler } = immediateScheduler();
    const events = collector();
    const source = createReplaySource({
      ticks: [tick(0), tick(1), tick(2)],
      scheduler,
    });

    source.start(events);
    source.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.ticks.length).toBeLessThanOrEqual(1);
  });

  it('treats a non-positive speed as normal pace rather than dividing by zero', () => {
    const source = createReplaySource({ ticks: [tick(0)], speed: 0 });

    expect(source.name).toContain('×1');
  });
});

describe('parseTradeFrame', () => {
  it('reads a well-formed trade frame', () => {
    const frame = JSON.stringify({ T: 1700, p: '42123.45', q: '0.017' });

    expect(parseTradeFrame(frame)).toEqual({
      time: 1700,
      price: 42123.45,
      size: 0.017,
    });
  });

  it('returns null for a non-JSON payload', () => {
    // One unparseable frame should cost one tick, not the connection.
    expect(parseTradeFrame('<html>rate limited</html>')).toBeNull();
  });

  it('returns null for a frame that is not a trade', () => {
    expect(parseTradeFrame(JSON.stringify({ result: null, id: 1 }))).toBeNull();
  });

  it('returns null when the price is not a number', () => {
    expect(
      parseTradeFrame(JSON.stringify({ T: 1, p: 'n/a', q: '1' })),
    ).toBeNull();
  });

  it('returns null for a binary payload', () => {
    expect(parseTradeFrame(new ArrayBuffer(8))).toBeNull();
  });

  it('accepts a zero size, which some trades legitimately have', () => {
    expect(parseTradeFrame(JSON.stringify({ T: 1, p: '10', q: '0' }))).toEqual({
      time: 1,
      price: 10,
      size: 0,
    });
  });
});

describe('binance source', () => {
  function fakeSocket() {
    const socket: WebSocketLike & { closed: boolean } = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      closed: false,
      close() {
        this.closed = true;
        this.onclose?.({});
      },
    };
    return socket;
  }

  it('connects to the trade stream for the symbol', () => {
    const urls: string[] = [];
    const source = createBinanceSource({
      symbol: 'BTCUSDT',
      socketFactory: (url) => {
        urls.push(url);
        return fakeSocket();
      },
    });

    source.start(collector());

    expect(urls[0]).toBe('wss://stream.binance.com:9443/ws/btcusdt@trade');
  });

  it('emits ticks parsed from trade frames', () => {
    const socket = fakeSocket();
    const events = collector();
    createBinanceSource({
      symbol: 'btcusdt',
      socketFactory: () => socket,
    }).start(events);

    socket.onopen?.({});
    socket.onmessage?.({ data: JSON.stringify({ T: 5, p: '10', q: '2' }) });

    expect(events.ticks).toEqual([{ time: 5, price: 10, size: 2 }]);
  });

  it('skips a malformed frame without dropping the connection', () => {
    const socket = fakeSocket();
    const events = collector();
    createBinanceSource({
      symbol: 'btcusdt',
      socketFactory: () => socket,
    }).start(events);

    socket.onopen?.({});
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: JSON.stringify({ T: 6, p: '11', q: '1' }) });

    expect(events.ticks).toHaveLength(1);
    expect(events.states).not.toContain('closed');
  });

  it('reconnects after an unexpected close, and counts it', async () => {
    const { scheduler } = immediateScheduler();
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const events = collector();

    createBinanceSource({
      symbol: 'btcusdt',
      scheduler,
      random: () => 0,
      socketFactory: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
    }).start(events);

    sockets[0]?.onopen?.({});
    sockets[0]?.onclose?.({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.reconnects).toBe(1);
    expect(sockets.length).toBeGreaterThan(1);
  });

  it('backs off further on each successive failure', async () => {
    // A tight reconnect loop against a rate-limited endpoint gets the client
    // banned, which turns a blip into an outage.
    const { delays, scheduler } = immediateScheduler();
    const sockets: ReturnType<typeof fakeSocket>[] = [];

    createBinanceSource({
      symbol: 'btcusdt',
      scheduler,
      random: () => 0,
      socketFactory: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
    }).start(collector());

    for (let i = 0; i < 3; i += 1) {
      sockets[sockets.length - 1]?.onclose?.({});
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const reconnectDelays = delays.filter((delay) => delay > 0);
    expect(reconnectDelays[1]).toBeGreaterThan(reconnectDelays[0] as number);
  });

  it('treats a silent socket as dead', async () => {
    // Open and silent is indistinguishable from a quiet market; a chart frozen
    // for ten minutes is worse than a brief reconnect.
    const { scheduler } = immediateScheduler();
    const socket = fakeSocket();
    const events = collector();

    createBinanceSource({
      symbol: 'btcusdt',
      scheduler,
      stallTimeoutMs: 5,
      socketFactory: () => socket,
    }).start(events);

    socket.onopen?.({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.states).toContain('stalled');
  });

  it('stops reconnecting once stopped', async () => {
    const { scheduler } = immediateScheduler();
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const source = createBinanceSource({
      symbol: 'btcusdt',
      scheduler,
      socketFactory: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    source.start(collector());
    const created = sockets.length;
    source.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sockets.length).toBe(created);
  });

  it('announces itself as live', () => {
    const source = createBinanceSource({ symbol: 'ethusdt' });

    expect(source.isLive).toBe(true);
    expect(source.name).toContain('ETHUSDT');
  });
});
