import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CandleChart, type CandleChartHandle } from './components/CandleChart';
import { PerformanceOverlay } from './components/PerformanceOverlay';
import { appendTicks, type Candle } from './core/candles';
import type { Tick } from './core/ringBuffer';
import { useRafRenderer } from './hooks/useRafRenderer';
import { useTickStream } from './hooks/useTickStream';
import { createBinanceSource } from './stream/binanceSource';
import { createReplaySource } from './stream/replaySource';
import type { TickSource } from './stream/types';
import { createIndicatorClient } from './worker/client';

// The desk.
//
// The shape to notice: candles and indicators live in refs, not in state. The
// animation frame mutates them and pushes the result straight into the chart's
// imperative handle. Nothing here calls setState in response to a tick — the
// only state is what a human changes (speed, source) and the connection status,
// which changes a handful of times a session.

const INTERVAL_MS = 1_000;
const EMA_PERIOD = 12;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
/** Recompute indicators at most this often; the maths does not need 60Hz. */
const INDICATOR_INTERVAL_MS = 250;

type SourceKind = 'replay' | 'live';

interface RecordedSession {
  symbol: string;
  ticks: Tick[];
}

export function App() {
  const [sourceKind, setSourceKind] = useState<SourceKind>('replay');
  const [speed, setSpeed] = useState(1);
  const [session, setSession] = useState<RecordedSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}sessions/btcusdt.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<RecordedSession>;
      })
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Unknown failure',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuilt only when the human changes something, never per tick.
  const source: TickSource | null = useMemo(() => {
    if (sourceKind === 'live') {
      return createBinanceSource({ symbol: 'btcusdt' });
    }
    if (!session) return null;
    return createReplaySource({ ticks: session.ticks, speed, loop: true });
  }, [sourceKind, session, speed]);

  const fallbackSource = useMemo<TickSource>(
    () => ({
      name: 'Loading…',
      isLive: false,
      start: () => undefined,
      stop: () => undefined,
    }),
    [],
  );

  const { buffer, stats, connection, restart } = useTickStream({
    source: source ?? fallbackSource,
    enabled: source !== null,
  });

  const candlesRef = useRef<readonly Candle[]>([]);
  const emaRef = useRef<readonly (number | null)[]>([]);
  const chartRef = useRef<CandleChartHandle | null>(null);
  const indicatorClient = useMemo(() => createIndicatorClient(), []);
  const lastIndicatorRun = useRef(0);

  useEffect(() => () => indicatorClient.terminate(), [indicatorClient]);

  // Reset the series when the human switches source, so a replay does not get
  // stitched onto live data.
  useEffect(() => {
    candlesRef.current = [];
    emaRef.current = [];
    chartRef.current?.update([], []);
  }, [sourceKind, speed, session]);

  const onFrame = useCallback(
    (ticks: Tick[]) => {
      const result = appendTicks(candlesRef.current, ticks, {
        intervalMs: INTERVAL_MS,
      });
      if (!result.changed) return;

      candlesRef.current = result.candles;
      chartRef.current?.update(result.candles, emaRef.current);

      const now = performance.now();
      if (now - lastIndicatorRun.current < INDICATOR_INTERVAL_MS) return;
      lastIndicatorRun.current = now;

      const closes = result.candles.map((candle) => candle.close);
      void indicatorClient
        .compute({
          closes,
          highs: result.candles.map((candle) => candle.high),
          lows: result.candles.map((candle) => candle.low),
          emaPeriod: EMA_PERIOD,
          rsiPeriod: RSI_PERIOD,
          atrPeriod: ATR_PERIOD,
        })
        .then((indicators) => {
          emaRef.current = indicators.ema;
          stats.recordWorkerLatency(indicators.computeMs);
          chartRef.current?.update(candlesRef.current, indicators.ema);
        });
    },
    [indicatorClient, stats],
  );

  const handleChartReady = useCallback((handle: CandleChartHandle) => {
    chartRef.current = handle;
  }, []);

  useRafRenderer({ buffer, stats, onFrame, enabled: source !== null });

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <strong>signal-desk</strong>
          <span className="muted">
            {' '}
            — realtime React without the re-renders
          </span>
        </div>

        <div className="controls">
          <div className="field">
            <label htmlFor="source-select">Source</label>
            <select
              id="source-select"
              value={sourceKind}
              onChange={(event) =>
                setSourceKind(event.target.value as SourceKind)
              }
            >
              <option value="replay">Recorded session</option>
              <option value="live">Live Binance</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="speed-select">Speed</label>
            <select
              id="speed-select"
              value={speed}
              disabled={sourceKind === 'live'}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              <option value={1}>1×</option>
              <option value={10}>10×</option>
              <option value={100}>100×</option>
            </select>
          </div>

          <button type="button" onClick={restart} className="button">
            Reconnect
          </button>
        </div>

        <span className="connection" data-state={connection}>
          <span aria-hidden className="dot" />
          {connection}
        </span>
      </header>

      {loadError ? (
        <p role="alert" className="notice">
          Could not load the recorded session ({loadError}). Switch to the live
          feed, or check that public/sessions/btcusdt.json was deployed.
        </p>
      ) : null}

      <PerformanceOverlay stats={stats} className="overlay" />

      <CandleChart onReady={handleChartReady} className="chart" />

      <footer className="app-footer muted">
        Ticks go into a ring buffer; the chart is updated once per animation
        frame from an imperative handle. Watch <code>msgs/s</code> climb while{' '}
        <code>fps</code> stays put — that is the whole idea.
      </footer>
    </div>
  );
}
