// The implementation this project argues against, written fairly.
//
// It is what a competent developer writes first, it is correct, and it is what
// every "realtime with React" tutorial shows: the socket handler calls setState,
// the component renders the data. The problem is structural — the render rate
// becomes the event rate, and the event rate belongs to the exchange.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Tick } from '../src/core/ringBuffer';

export interface NaiveDeskProps {
  onRender: () => void;
  register: (push: (tick: Tick) => void) => void;
}

export function NaiveDesk({ onRender, register }: NaiveDeskProps) {
  const [last, setLast] = useState<Tick | null>(null);
  onRender();

  const push = useCallback((tick: Tick) => {
    setLast(tick);
  }, []);

  useEffect(() => {
    register(push);
  }, [register, push]);

  return <output>{last ? last.price.toFixed(2) : '—'}</output>;
}

export interface BufferedDeskProps {
  onRender: () => void;
  register: (push: (tick: Tick) => void, flush: () => void) => void;
}

/**
 * The shape this project ships: ticks go into a ref, and the display is updated
 * imperatively when a frame comes round.
 */
export function BufferedDesk({ onRender, register }: BufferedDeskProps) {
  const outputRef = useRef<HTMLOutputElement>(null);
  const pending = useRef<Tick | null>(null);
  onRender();

  const push = useCallback((tick: Tick) => {
    pending.current = tick;
  }, []);

  const flush = useCallback(() => {
    if (outputRef.current && pending.current) {
      outputRef.current.textContent = pending.current.price.toFixed(2);
    }
  }, []);

  useEffect(() => {
    register(push, flush);
  }, [register, push, flush]);

  return <output ref={outputRef}>—</output>;
}
