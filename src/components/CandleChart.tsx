import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import type { Candle } from '../core/candles';

// The chart.
//
// Two things about this component are deliberate and unusual:
//
//   1. **It never re-renders to draw.** React mounts it once; after that the
//      imperative handle is fed directly from the animation frame. A component
//      that re-rendered to update a canvas would put the whole point of this
//      project behind a `useState`.
//   2. **A canvas is invisible to a screen reader**, so the current values are
//      also rendered as text in a live region. Not a consolation prize — for
//      someone reading with a screen reader it is the entire chart, and it also
//      makes the E2E suite able to assert on values rather than pixels.

export interface CandleChartProps {
  /**
   * Imperative handle for the rAF loop, called instead of re-rendering.
   *
   * There are deliberately no data props: a chart that took its candles as
   * props would have to re-render to draw, which is the thing this project
   * exists to avoid. It starts empty and is fed through this handle.
   */
  onReady?: (handle: CandleChartHandle) => void;
  className?: string;
}

export interface CandleChartHandle {
  update: (candles: readonly Candle[], ema: readonly (number | null)[]) => void;
}

export function CandleChart({ onReady, className }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: read('--muted', '#98a1b0'),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: read('--border', 'rgba(255,255,255,0.1)') },
        horzLines: { color: read('--border', 'rgba(255,255,255,0.1)') },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        // Keep the newest bar in view as data arrives, with a little room to
        // its right so the last candle is not glued to the price scale.
        rightOffset: 4,
        barSpacing: 6,
        shiftVisibleRangeOnNewBar: true,
      },
    });
    chartRef.current = chart;

    const up = read('--up', '#2ebd85');
    const down = read('--down', '#f6465d');

    const candleSeries: ISeriesApi<'Candlestick'> = chart.addSeries(
      CandlestickSeries,
      {
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      },
    );

    const volumeSeries: ISeriesApi<'Histogram'> = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      },
    );
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const emaLine: ISeriesApi<'Line'> = chart.addSeries(LineSeries, {
      color: read('--accent', '#5b9cff'),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Until there are enough bars to fill the pane, fit them to it. Without
    // this the first few candles render as a sliver against the right edge and
    // the chart looks broken rather than empty.
    const FIT_UNTIL_BARS = 60;

    // The architecture that keeps the canvas fast has a cost: this component
    // never re-renders, so the live region below would announce the first
    // candle forever. It is written imperatively instead — and throttled,
    // because a live region that changes sixty times a second is not an
    // accessible chart, it is a denial of service on a screen reader.
    const SUMMARY_INTERVAL_MS = 2_000;
    let lastSummaryAt = 0;

    const toChartData = (
      series: readonly Candle[],
      ema: readonly (number | null)[],
    ): void => {
      // lightweight-charts wants seconds, and rejects an out-of-order series —
      // which is why the aggregator guarantees ordering upstream.
      candleSeries.setData(
        series.map((candle) => ({
          time: (candle.time / 1000) as never,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
      volumeSeries.setData(
        series.map((candle) => ({
          time: (candle.time / 1000) as never,
          value: candle.volume,
          color: candle.close >= candle.open ? up : down,
        })),
      );
      emaLine.setData(
        series
          .map((candle, index) => ({
            time: (candle.time / 1000) as never,
            value: ema[index],
          }))
          // A null EMA is a gap, not a zero: charting zero would draw a line
          // plunging to the bottom of the pane during every warm-up.
          .filter(
            (point): point is { time: never; value: number } =>
              point.value !== null && point.value !== undefined,
          ),
      );

      if (series.length > 0 && series.length < FIT_UNTIL_BARS) {
        chart.timeScale().fitContent();
      }

      const now = performance.now();
      if (summaryRef.current && now - lastSummaryAt >= SUMMARY_INTERVAL_MS) {
        lastSummaryAt = now;
        summaryRef.current.textContent = describe(series, ema);
      }
    };

    readyRef.current?.({ update: toChartData });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // Mounted once on purpose: updates go through the imperative handle so a
    // tick never causes a React render.
  }, []);

  return (
    <div className={className}>
      <div ref={containerRef} className="chart-canvas" />

      {/* The canvas is invisible to a screen reader; this paragraph is the
          chart, for anyone reading it that way. Polite, not assertive: an
          assertive region updating every couple of seconds would interrupt the
          reader mid-sentence, every time. */}
      <p
        ref={summaryRef}
        className="sr-only"
        role="status"
        aria-live="polite"
        data-part="chart-summary"
      >
        Waiting for the first candle.
      </p>
    </div>
  );
}

/** The chart, in words. Also what the E2E suite asserts on, instead of pixels. */
function describe(
  candles: readonly Candle[],
  emaSeries: readonly (number | null)[],
): string {
  const last = candles[candles.length - 1];
  if (!last) return 'Waiting for the first candle.';

  const lastEma = [...emaSeries].reverse().find((value) => value !== null);
  return (
    `Latest candle at ${new Date(last.time).toLocaleTimeString()}: ` +
    `open ${last.open.toFixed(2)}, high ${last.high.toFixed(2)}, ` +
    `low ${last.low.toFixed(2)}, close ${last.close.toFixed(2)}, ` +
    `volume ${last.volume.toFixed(4)}` +
    (typeof lastEma === 'number'
      ? `. EMA ${lastEma.toFixed(2)}.`
      : '. EMA not yet defined.')
  );
}
