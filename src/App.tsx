import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import { CandleChart, type CandleChartHandle } from './components/CandleChart';
import { PerformanceOverlay } from './components/PerformanceOverlay';
import {
  appendTicks,
  reaggregateFromBuffer,
  type Candle,
} from './core/candles';
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
// only state is what a human changes (speed, source, interval, periods) and
// the connection status, which changes a handful of times a session.

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_EMA_PERIOD = 12;
const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_ATR_PERIOD = 14;
/** Recompute indicators at most this often; the maths does not need 60Hz. */
const INDICATOR_INTERVAL_MS = 250;

const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1_000, label: '1s' },
  { value: 5_000, label: '5s' },
  { value: 15_000, label: '15s' },
  { value: 30_000, label: '30s' },
  { value: 60_000, label: '1m' },
  { value: 300_000, label: '5m' },
];

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

  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [emaPeriod, setEmaPeriod] = useState(DEFAULT_EMA_PERIOD);
  const [rsiPeriod, setRsiPeriod] = useState(DEFAULT_RSI_PERIOD);
  const [atrPeriod, setAtrPeriod] = useState(DEFAULT_ATR_PERIOD);

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

  // The buffer's write count at the moment the current source began. The
  // buffer itself is not cleared on a source switch, so re-aggregating from
  // its very start after switching source would fold the previous source's
  // ticks back in; this marks where "the current source" actually starts.
  const sourceStartRef = useRef(0);

  // Indicator periods, read by `runIndicators` instead of closed over. That
  // keeps `runIndicators` stable across period edits, which matters below: an
  // effect that depended on it directly would re-fire on every period change,
  // not only on the changes it actually cares about.
  const periodsRef = useRef({ emaPeriod, rsiPeriod, atrPeriod });
  useEffect(() => {
    periodsRef.current = { emaPeriod, rsiPeriod, atrPeriod };
  }, [emaPeriod, rsiPeriod, atrPeriod]);

  useEffect(() => () => indicatorClient.terminate(), [indicatorClient]);

  // Reset the series when the human switches source, so a replay does not get
  // stitched onto live data. The ring buffer itself is not cleared on a source
  // switch (see useTickStream), so this intentionally does not re-aggregate
  // from it: that would stitch the old source's ticks back in.
  useEffect(() => {
    sourceStartRef.current = buffer.totalWritten;
    candlesRef.current = [];
    emaRef.current = [];
    chartRef.current?.update([], []);
  }, [sourceKind, speed, session, buffer]);

  const runIndicators = useCallback(
    (candles: readonly Candle[]) => {
      const { emaPeriod, rsiPeriod, atrPeriod } = periodsRef.current;
      const closes = candles.map((candle) => candle.close);
      void indicatorClient
        .compute({
          closes,
          highs: candles.map((candle) => candle.high),
          lows: candles.map((candle) => candle.low),
          emaPeriod,
          rsiPeriod,
          atrPeriod,
        })
        .then((indicators) => {
          emaRef.current = indicators.ema;
          stats.recordWorkerLatency(indicators.computeMs);
          chartRef.current?.update(candlesRef.current, indicators.ema);
        });
    },
    [indicatorClient, stats],
  );

  // Re-aggregate the buffer's existing raw ticks into candles at the new
  // interval, rather than starting from empty. `reaggregateFromBuffer` reads
  // the buffer without consuming a cursor, so this does not disturb the
  // render loop's own draining.
  //
  // The previous EMA series is stale the moment the candle count changes, so
  // it is cleared immediately rather than left mismatched against the new
  // candles for one frame; `runIndicators` below replaces it as soon as the
  // worker responds.
  useEffect(() => {
    const result = reaggregateFromBuffer(
      buffer,
      { intervalMs },
      sourceStartRef.current,
    );
    candlesRef.current = result.candles;
    emaRef.current = [];
    chartRef.current?.update(result.candles, []);
    runIndicators(result.candles);
  }, [buffer, intervalMs, runIndicators]);

  // Recompute indicators immediately when a human edits a period, instead of
  // waiting for the next tick: with the stream paused there might not be one
  // for a while.
  useEffect(() => {
    runIndicators(candlesRef.current);
  }, [emaPeriod, rsiPeriod, atrPeriod, runIndicators]);

  const onFrame = useCallback(
    (ticks: Tick[]) => {
      const result = appendTicks(candlesRef.current, ticks, { intervalMs });
      if (!result.changed) return;

      candlesRef.current = result.candles;
      chartRef.current?.update(result.candles, emaRef.current);

      const now = performance.now();
      if (now - lastIndicatorRun.current < INDICATOR_INTERVAL_MS) return;
      lastIndicatorRun.current = now;

      runIndicators(result.candles);
    },
    [intervalMs, runIndicators],
  );

  const handleChartReady = useCallback((handle: CandleChartHandle) => {
    chartRef.current = handle;
  }, []);

  /**
   * Only commits a valid positive integer. Leaving an invalid or in-progress
   * value (empty, a bare minus sign) uncommitted lets a human clear the field
   * to type a new number without it snapping back on every keystroke.
   */
  const handlePeriodChange =
    (setPeriod: (value: number) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Math.trunc(event.target.valueAsNumber);
      if (Number.isFinite(parsed) && parsed > 0) {
        setPeriod(parsed);
      }
    };

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

          <div className="field">
            <label htmlFor="interval-select">Interval</label>
            <select
              id="interval-select"
              value={intervalMs}
              onChange={(event) => setIntervalMs(Number(event.target.value))}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ema-period-input">EMA period</label>
            <input
              id="ema-period-input"
              type="number"
              className="period-input"
              min={1}
              max={500}
              step={1}
              value={emaPeriod}
              onChange={handlePeriodChange(setEmaPeriod)}
            />
          </div>

          <div className="field">
            <label htmlFor="rsi-period-input">RSI period</label>
            <input
              id="rsi-period-input"
              type="number"
              className="period-input"
              min={1}
              max={500}
              step={1}
              value={rsiPeriod}
              onChange={handlePeriodChange(setRsiPeriod)}
            />
          </div>

          <div className="field">
            <label htmlFor="atr-period-input">ATR period</label>
            <input
              id="atr-period-input"
              type="number"
              className="period-input"
              min={1}
              max={500}
              step={1}
              value={atrPeriod}
              onChange={handlePeriodChange(setAtrPeriod)}
            />
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

      <p className="muted history-note" data-part="history-note">
        Candle history comes from the ring buffer, which holds a fixed number of
        ticks ({buffer.capacity.toLocaleString()}), not a fixed span of time
        (see ADR 002). Changing the interval re-aggregates whatever is currently
        in that window, so it can show less history than before, especially at a
        wider interval.
      </p>

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
