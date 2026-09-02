// A fixed-capacity ring buffer for ticks.
//
// This is where incoming events go instead of into React state. Three
// properties matter, and each one exists because of something that goes wrong
// without it:
//
//   1. **Fixed capacity.** An unbounded queue behind a consumer that cannot
//      keep up is a memory leak with extra steps. When the buffer is full the
//      oldest tick is overwritten, because in a live feed the newest data is
//      the data anyone cares about.
//   2. **No allocation per write.** Ticks arrive at hundreds per second; an
//      object per tick means the garbage collector runs during rendering,
//      which is exactly when you cannot afford it. Values live in typed arrays
//      and a write is three assignments.
//   3. **Drain by cursor.** The renderer asks "what happened since I last
//      looked?" rather than being pushed to. That is what lets one animation
//      frame absorb fifty ticks.

export interface Tick {
  /** Milliseconds since the epoch. */
  time: number;
  price: number;
  /** Traded size. Zero is legitimate for some feeds, so it is not a sentinel. */
  size: number;
}

export interface DrainResult {
  ticks: Tick[];
  /**
   * How many ticks were overwritten before the consumer could read them.
   *
   * Surfaced rather than swallowed: silent data loss in a trading UI is worse
   * than visible data loss, and the performance overlay shows this number.
   */
  dropped: number;
  /** Cursor to pass to the next drain. */
  cursor: number;
}

export class TickRingBuffer {
  readonly capacity: number;

  private readonly times: Float64Array;
  private readonly prices: Float64Array;
  private readonly sizes: Float64Array;

  /** Monotonic count of everything ever written; never wraps in practice. */
  private written = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        `capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
    this.times = new Float64Array(capacity);
    this.prices = new Float64Array(capacity);
    this.sizes = new Float64Array(capacity);
  }

  /** Total ticks ever written, including those since overwritten. */
  get totalWritten(): number {
    return this.written;
  }

  /** How many ticks are currently retrievable. */
  get size(): number {
    return Math.min(this.written, this.capacity);
  }

  push(tick: Tick): void {
    const index = this.written % this.capacity;
    this.times[index] = tick.time;
    this.prices[index] = tick.price;
    this.sizes[index] = tick.size;
    this.written += 1;
  }

  /**
   * Everything written since `cursor`.
   *
   * A cursor older than the buffer's window cannot be honoured — those ticks
   * are gone — so the result reports how many were lost and resumes from the
   * oldest tick still held.
   */
  drainSince(cursor: number): DrainResult {
    const oldest = Math.max(0, this.written - this.capacity);
    const from = Math.max(cursor, oldest);
    const dropped = Math.max(0, oldest - cursor);

    const ticks: Tick[] = [];
    for (let position = from; position < this.written; position += 1) {
      const index = position % this.capacity;
      ticks.push({
        time: this.times[index] as number,
        price: this.prices[index] as number,
        size: this.sizes[index] as number,
      });
    }

    return { ticks, dropped, cursor: this.written };
  }

  /** The most recent tick, or null when nothing has been written. */
  last(): Tick | null {
    if (this.written === 0) return null;
    const index = (this.written - 1) % this.capacity;
    return {
      time: this.times[index] as number,
      price: this.prices[index] as number,
      size: this.sizes[index] as number,
    };
  }

  clear(): void {
    this.written = 0;
  }
}
