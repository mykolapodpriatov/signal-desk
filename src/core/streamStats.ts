// The numbers behind the performance overlay.
//
// Every one of these exists because it answers a question you cannot answer by
// looking at the chart:
//
//   - **msgs/sec** — is the feed alive, or is the chart just not moving because
//     nothing is trading?
//   - **dropped** — is the consumer keeping up? A rising count is the
//     back-pressure story made visible instead of silent.
//   - **render FPS** — is the rAF loop actually running at frame rate, or is
//     something on the main thread starving it?
//   - **worker latency** — is indicator computation off the critical path, or
//     has it become the critical path?
//   - **reconnects** — has the connection been flapping while you were away?
//
// A dashboard that claims to be realtime without showing these is asking to be
// taken on faith.

/** A rolling count over a time window, used for per-second rates. */
export class RollingRate {
  private readonly stamps: number[] = [];

  constructor(private readonly windowMs = 1_000) {}

  mark(now: number, count = 1): void {
    for (let i = 0; i < count; i += 1) this.stamps.push(now);
    this.trim(now);
  }

  /** Events per second over the window. */
  rate(now: number): number {
    this.trim(now);
    return (this.stamps.length / this.windowMs) * 1_000;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    // The stamps are pushed in order, so dropping from the front is enough.
    let drop = 0;
    while (
      drop < this.stamps.length &&
      (this.stamps[drop] as number) < cutoff
    ) {
      drop += 1;
    }
    if (drop > 0) this.stamps.splice(0, drop);
  }
}

export interface StreamStatsSnapshot {
  messagesPerSecond: number;
  framesPerSecond: number;
  bufferSize: number;
  droppedTicks: number;
  reconnects: number;
  /** Milliseconds for the most recent worker round trip, or null if none yet. */
  workerLatencyMs: number | null;
  /** Milliseconds since the last message arrived, or null before the first. */
  msSinceLastMessage: number | null;
}

export class StreamStats {
  private readonly messages = new RollingRate();
  private readonly frames = new RollingRate();

  private dropped = 0;
  private reconnects = 0;
  private bufferSize = 0;
  private workerLatency: number | null = null;
  private lastMessageAt: number | null = null;

  recordMessages(now: number, count = 1): void {
    this.messages.mark(now, count);
    this.lastMessageAt = now;
  }

  recordFrame(now: number): void {
    this.frames.mark(now);
  }

  recordDropped(count: number): void {
    // Cumulative, never reset by a drain: the question is "has this happened",
    // and a counter that resets answers "is it happening right now" instead.
    this.dropped += count;
  }

  recordReconnect(): void {
    this.reconnects += 1;
  }

  setBufferSize(size: number): void {
    this.bufferSize = size;
  }

  recordWorkerLatency(ms: number): void {
    this.workerLatency = ms;
  }

  snapshot(now: number): StreamStatsSnapshot {
    return {
      messagesPerSecond: Math.round(this.messages.rate(now)),
      framesPerSecond: Math.round(this.frames.rate(now)),
      bufferSize: this.bufferSize,
      droppedTicks: this.dropped,
      reconnects: this.reconnects,
      workerLatencyMs: this.workerLatency,
      msSinceLastMessage:
        this.lastMessageAt === null ? null : now - this.lastMessageAt,
    };
  }

  reset(): void {
    this.dropped = 0;
    this.reconnects = 0;
    this.workerLatency = null;
    this.lastMessageAt = null;
  }
}
