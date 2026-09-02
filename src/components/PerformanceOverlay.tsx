import { useEffect, useState } from 'react';

import type { StreamStats, StreamStatsSnapshot } from '../core/streamStats';

// The panel that makes the architecture visible.
//
// Without it, "this UI does not re-render per tick" is a claim in a README. The
// overlay turns it into something a visitor can watch: messages per second in
// the hundreds while frames per second stays pinned at the display rate, and
// dropped ticks not moving.
//
// It updates on a timer rather than per frame — on purpose. A readout that
// changes sixty times a second is unreadable, and a component that re-rendered
// every frame to display the frame rate would be a small joke at the project's
// expense.

export interface PerformanceOverlayProps {
  stats: StreamStats;
  /** How often the numbers refresh. Twice a second is readable. */
  intervalMs?: number;
  className?: string;
}

interface Metric {
  key: keyof StreamStatsSnapshot;
  label: string;
  hint: string;
  format: (value: number | null) => string;
  /** Marks a value that indicates a problem, for the visual state. */
  warn?: (value: number | null) => boolean;
}

const integer = (value: number | null): string =>
  value === null ? '—' : String(Math.round(value));

const METRICS: Metric[] = [
  {
    key: 'messagesPerSecond',
    label: 'msgs/s',
    hint: 'Ticks arriving from the feed each second.',
    format: integer,
  },
  {
    key: 'framesPerSecond',
    label: 'fps',
    hint: 'Render frames per second. Should stay near the display rate however busy the feed is.',
    format: integer,
    warn: (value) => value !== null && value > 0 && value < 30,
  },
  {
    key: 'bufferSize',
    label: 'buffer',
    hint: 'Ticks currently held in the ring buffer.',
    format: integer,
  },
  {
    key: 'droppedTicks',
    label: 'dropped',
    hint: 'Ticks overwritten before the renderer could read them. Should stay at zero.',
    format: integer,
    warn: (value) => value !== null && value > 0,
  },
  {
    key: 'workerLatencyMs',
    label: 'worker',
    hint: 'Time for the last indicator round trip, in milliseconds.',
    format: (value) => (value === null ? '—' : `${value.toFixed(1)}ms`),
  },
  {
    key: 'reconnects',
    label: 'reconnects',
    hint: 'Connection drops since the page loaded.',
    format: integer,
    warn: (value) => value !== null && value > 0,
  },
  {
    key: 'msSinceLastMessage',
    label: 'last msg',
    hint: 'Time since the last tick. A still chart with a rising number here means the feed is dead, not that the market is quiet.',
    format: (value) => (value === null ? '—' : `${(value / 1000).toFixed(1)}s`),
    warn: (value) => value !== null && value > 5_000,
  },
];

export function PerformanceOverlay({
  stats,
  intervalMs = 500,
  className,
}: PerformanceOverlayProps) {
  const [snapshot, setSnapshot] = useState<StreamStatsSnapshot>(() =>
    stats.snapshot(performance.now()),
  );

  useEffect(() => {
    const handle = setInterval(() => {
      setSnapshot(stats.snapshot(performance.now()));
    }, intervalMs);
    return () => clearInterval(handle);
  }, [stats, intervalMs]);

  return (
    <dl
      className={className}
      data-part="overlay"
      aria-label="Stream performance"
    >
      {METRICS.map((metric) => {
        const value = snapshot[metric.key] as number | null;
        const warn = metric.warn?.(value) ?? false;

        return (
          <div
            key={metric.key}
            className="overlay-metric"
            data-warn={warn || undefined}
          >
            <dt title={metric.hint}>{metric.label}</dt>
            <dd className="mono">{metric.format(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}
