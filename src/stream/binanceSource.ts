// The live feed: Binance's public trade stream.
//
// Chosen because it needs no API key and no account, so the demo can be honest
// about being live without asking anybody for a credential.
//
// Three behaviours matter more than the parsing, and all three are about the
// connection being worse than the happy path assumes:
//
//   1. **Reconnect with backoff and jitter.** A tight reconnect loop against a
//      rate-limited endpoint gets the client banned, and every client
//      reconnecting on the same millisecond after an outage recreates it.
//   2. **Stall detection.** A socket that is open and silent looks identical to
//      a quiet market. A feed with no message for longer than expected is
//      treated as dead and reconnected, because a chart frozen for ten minutes
//      is worse than a brief reconnect.
//   3. **Malformed frames are skipped, not fatal.** One unparseable message
//      should cost one tick, not the connection.

import type { Tick } from '../core/ringBuffer';
import type { TickSource, TickSourceEvents } from './types';

export interface BinanceOptions {
  /** e.g. "btcusdt" — lower case, as the endpoint expects. */
  symbol: string;
  baseUrl?: string;
  /** Reconnect if no message arrives for this long. */
  stallTimeoutMs?: number;
  maxBackoffMs?: number;
  /** Injectable for tests; defaults to the global WebSocket. */
  socketFactory?: (url: string) => WebSocketLike;
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (handle: number) => void;
  };
  /** Injectable so the backoff is deterministic in tests. */
  random?: () => number;
}

/** The slice of WebSocket this adapter uses, so a test can supply a fake. */
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

const DEFAULT_BASE = 'wss://stream.binance.com:9443/ws';

interface TradeFrame {
  T?: number;
  p?: string;
  q?: string;
}

/** Extracts a tick from a trade frame, or null if the frame is not one. */
export function parseTradeFrame(raw: unknown): Tick | null {
  if (typeof raw !== 'string') return null;

  let frame: TradeFrame;
  try {
    frame = JSON.parse(raw) as TradeFrame;
  } catch {
    return null;
  }

  const price = Number(frame.p);
  const size = Number(frame.q);
  const time = frame.T;

  if (
    typeof time !== 'number' ||
    !Number.isFinite(price) ||
    !Number.isFinite(size)
  ) {
    return null;
  }

  return { time, price, size };
}

const realScheduler = {
  setTimeout: (fn: () => void, ms: number) =>
    globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
};

export function createBinanceSource(options: BinanceOptions): TickSource {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const url = `${baseUrl}/${options.symbol.toLowerCase()}@trade`;
  const stallTimeoutMs = options.stallTimeoutMs ?? 20_000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const scheduler = options.scheduler ?? realScheduler;
  const random = options.random ?? Math.random;
  const makeSocket =
    options.socketFactory ??
    ((target: string) => new WebSocket(target) as unknown as WebSocketLike);

  let socket: WebSocketLike | null = null;
  let attempt = 0;
  let stopped = true;
  let reconnectHandle: number | null = null;
  let stallHandle: number | null = null;

  return {
    name: `Binance ${options.symbol.toUpperCase()}`,
    isLive: true,

    start(events: TickSourceEvents) {
      stopped = false;

      const clearStall = (): void => {
        if (stallHandle !== null) {
          scheduler.clearTimeout(stallHandle);
          stallHandle = null;
        }
      };

      const armStall = (): void => {
        clearStall();
        stallHandle = scheduler.setTimeout(() => {
          // Open and silent is indistinguishable from a quiet market, so treat
          // silence past the timeout as a dead connection.
          events.onState('stalled');
          socket?.close();
        }, stallTimeoutMs);
      };

      const scheduleReconnect = (): void => {
        if (stopped) return;
        events.onState('reconnecting');
        events.onReconnect?.();

        const exponential = Math.min(maxBackoffMs, 500 * 2 ** attempt);
        // Subtractive jitter: the delay never overshoots the ceiling, and two
        // clients that failed together do not retry together.
        const delay = Math.round(exponential - random() * exponential * 0.5);
        attempt += 1;
        reconnectHandle = scheduler.setTimeout(connect, delay);
      };

      const connect = (): void => {
        if (stopped) return;
        events.onState('connecting');

        const next = makeSocket(url);
        socket = next;

        next.onopen = () => {
          attempt = 0;
          events.onState('open');
          armStall();
        };

        next.onmessage = (event) => {
          armStall();
          const tick = parseTradeFrame(event.data);
          // One unparseable frame costs one tick, not the connection.
          if (tick) events.onTick(tick);
        };

        next.onerror = (error) => {
          events.onError?.(error);
        };

        next.onclose = () => {
          clearStall();
          if (!stopped) scheduleReconnect();
        };
      };

      connect();
    },

    stop() {
      stopped = true;
      if (reconnectHandle !== null) scheduler.clearTimeout(reconnectHandle);
      if (stallHandle !== null) scheduler.clearTimeout(stallHandle);
      reconnectHandle = null;
      stallHandle = null;
      socket?.close();
      socket = null;
    },
  };
}
