// The seam between the app and any particular feed.
//
// Same shape as the transport interfaces in the sibling repositories, for the
// same reason: the core has never heard of Binance, so the demo can run on a
// recorded session, the tests need no network, and a team with their own feed
// writes an adapter rather than a fork.
//
// A source pushes; it does not return a stream. That is the opposite of the
// choice made for LLM streaming, and deliberately so — a market feed has no
// end, back-pressure is handled by the ring buffer rather than by pausing the
// socket (you cannot ask an exchange to slow down), and a callback keeps the
// hot path free of promise machinery.

import type { Tick } from '../core/ringBuffer';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  /** The socket is up but has sent nothing for longer than expected. */
  | 'stalled'
  | 'reconnecting'
  | 'closed';

export interface TickSourceEvents {
  onTick: (tick: Tick) => void;
  onState: (state: ConnectionState) => void;
  /** Fired each time a reconnect is attempted, so the overlay can count them. */
  onReconnect?: () => void;
  onError?: (error: unknown) => void;
}

export interface TickSource {
  /** Shown in the UI, so nobody mistakes a replay for a live feed. */
  readonly name: string;
  readonly isLive: boolean;
  start(events: TickSourceEvents): void;
  stop(): void;
}
