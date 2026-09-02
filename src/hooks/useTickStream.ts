import { useCallback, useEffect, useState } from 'react';

import { TickRingBuffer } from '../core/ringBuffer';
import { StreamStats } from '../core/streamStats';
import type { ConnectionState, TickSource } from '../stream/types';

// Subscribing to a feed **without** calling setState per tick.
//
// This hook is the whole thesis of the repository in thirty lines. A tick
// handler that calls setState turns a 300-per-second feed into 300 renders per
// second, and React will dutifully attempt all of them. Here the handler writes
// to a ring buffer — three assignments into a typed array — and nothing
// re-renders. The renderer reads the buffer once per animation frame, which is
// at most 60 times a second no matter how fast the feed runs.
//
// The one thing that *does* go through React state is the connection state,
// which changes a handful of times in a session and needs to be rendered.

export interface UseTickStreamOptions {
  source: TickSource;
  /** Ring capacity. Bigger absorbs longer stalls; smaller uses less memory. */
  capacity?: number;
  /** Started automatically unless this is false. */
  enabled?: boolean;
}

export interface UseTickStreamResult {
  buffer: TickRingBuffer;
  stats: StreamStats;
  connection: ConnectionState;
  /** Force a fresh connection — used by the "reconnect" control. */
  restart: () => void;
}

export function useTickStream({
  source,
  capacity = 4_096,
  enabled = true,
}: UseTickStreamOptions): UseTickStreamResult {
  // Held in state initialisers rather than refs, which looks backwards for
  // objects that must never trigger a render — but the setter is never called,
  // so they never do. The point is that a lazy state initialiser runs exactly
  // once and the value is safe to read during render, whereas writing to a ref
  // during render is not safe under concurrent rendering.
  //
  // The mutation still happens outside React entirely: pushing a tick mutates
  // the buffer in place and schedules nothing.
  const [buffer] = useState(() => new TickRingBuffer(capacity));
  const [stats] = useState(() => new StreamStats());

  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [generation, setGeneration] = useState(0);

  const restart = useCallback(() => setGeneration((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;

    source.start({
      onTick: (tick) => {
        // The hot path. No setState, no allocation beyond the tick object the
        // source already made.
        buffer.push(tick);
        stats.recordMessages(performance.now());
        stats.setBufferSize(buffer.size);
      },
      onState: setConnection,
      onReconnect: () => stats.recordReconnect(),
    });

    return () => {
      source.stop();
    };
    // `generation` is in the dependency list so `restart()` tears the source
    // down and brings it back up.
  }, [source, enabled, generation, buffer, stats]);

  return { buffer, stats, connection, restart };
}
