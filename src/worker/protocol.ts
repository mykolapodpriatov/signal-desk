// The worker protocol.
//
// Kept in its own file so both sides import the same types and cannot drift —
// a worker whose message shape disagrees with its client fails at runtime, in
// production, with a message about `undefined`.
//
// Closes are sent as a transferable Float64Array rather than a plain array.
// Structured-clone copies an array of ten thousand numbers; a transfer moves
// the buffer and costs nothing. At a few hundred bars the difference is
// academic; at the sizes this UI is built for it is the difference between
// indicator computation being off the critical path and being the critical
// path.

export interface IndicatorRequest {
  /** Echoed back, so a stale response can be discarded. */
  id: number;
  closes: Float64Array;
  highs: Float64Array;
  lows: Float64Array;
  emaPeriod: number;
  rsiPeriod: number;
  atrPeriod: number;
}

export interface IndicatorResponse {
  id: number;
  /** `null` inside a series means "not defined yet", never a filler value. */
  ema: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
  /** How long the worker spent, so the overlay can show it. */
  computeMs: number;
}
