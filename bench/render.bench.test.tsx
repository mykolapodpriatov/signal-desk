// The benchmark, run as a test so CI keeps it honest.
//
// It measures the one number this project is about: **how many times React
// renders while N ticks arrive.** That number is deterministic, so it can be
// asserted; a regression that reintroduces setState-per-tick fails here rather
// than being noticed by a user whose laptop fan starts up.
//
// Ticks are delivered one act() at a time, not batched. Wrapping a thousand
// ticks in a single act() lets React coalesce them into one render, which
// reports a tenth of the real cost and flatters the naive version most —
// batching is exactly what hides its problem. A socket delivers each message on
// its own task, and that is what is simulated here.

import { act, render } from '@testing-library/react';
import { afterAll, describe, expect, it } from 'vitest';

import type { Tick } from '../src/core/ringBuffer';
import { BufferedDesk, NaiveDesk } from './naive';

const SCENARIOS = [100, 500, 2_000];
/** Ticks per simulated animation frame, roughly a busy feed at 60fps. */
const TICKS_PER_FRAME = 8;

const tick = (i: number): Tick => ({ time: i, price: 100 + i * 0.01, size: 1 });

function measureNaive(count: number): { renders: number; ms: number } {
  let renders = 0;
  let push!: (tick: Tick) => void;

  render(
    <NaiveDesk
      onRender={() => {
        renders += 1;
      }}
      register={(fn) => {
        push = fn;
      }}
    />,
  );

  const mounted = renders;
  const started = performance.now();
  for (let i = 0; i < count; i += 1) {
    act(() => {
      push(tick(i));
    });
  }
  return { renders: renders - mounted, ms: performance.now() - started };
}

function measureBuffered(count: number): { renders: number; ms: number } {
  let renders = 0;
  let push!: (tick: Tick) => void;
  let flush!: () => void;

  render(
    <BufferedDesk
      onRender={() => {
        renders += 1;
      }}
      register={(pushFn, flushFn) => {
        push = pushFn;
        flush = flushFn;
      }}
    />,
  );

  const mounted = renders;
  const started = performance.now();
  for (let i = 0; i < count; i += 1) {
    push(tick(i));
    // A frame boundary every TICKS_PER_FRAME ticks, which is what the rAF loop
    // does in the real app.
    if (i % TICKS_PER_FRAME === TICKS_PER_FRAME - 1) flush();
  }
  flush();
  return { renders: renders - mounted, ms: performance.now() - started };
}

describe('render cost under a tick stream', () => {
  const rows: string[] = [];

  for (const count of SCENARIOS) {
    it(`${count} ticks`, () => {
      const naive = measureNaive(count);
      const buffered = measureBuffered(count);

      rows.push(
        `| ${count.toLocaleString('en-US')} | ${naive.renders.toLocaleString('en-US')} | ` +
          `${buffered.renders} | ${naive.ms.toFixed(0)} ms | ${buffered.ms.toFixed(0)} ms |`,
      );

      // The structural claim: the naive version renders once per tick.
      expect(naive.renders).toBe(count);

      // And this one does not render at all after mount, however many ticks
      // arrive. Not "fewer" — zero. The DOM is updated imperatively.
      expect(buffered.renders).toBe(0);
    });
  }

  it('render count is independent of the tick rate', () => {
    // The property that matters: a feed that gets ten times busier must not make
    // the UI ten times more expensive.
    const small = measureBuffered(100);
    const large = measureBuffered(2_000);

    expect(large.renders).toBe(small.renders);
    expect(measureNaive(2_000).renders).toBe(measureNaive(100).renders * 20);
  });

  afterAll(() => {
    if (process.env.BENCH_TABLE !== '1') return;
    process.stdout.write(
      '\n| Ticks | React renders (naive) | React renders (this) | Naive | This |\n' +
        '|---:|---:|---:|---:|---:|\n' +
        rows.join('\n') +
        '\n\n',
    );
  });
});
