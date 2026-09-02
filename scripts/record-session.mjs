#!/usr/bin/env node
//
// Records a live Binance trade stream into a replay fixture.
//
//   node scripts/record-session.mjs btcusdt 60
//
// The recording is what the demo plays. It is committed rather than fetched at
// runtime, because a demo whose content depends on somebody else's uptime — and
// on whether the market happens to be moving when a visitor opens the link —
// will eventually show an empty screen.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const symbol = (process.argv[2] ?? 'btcusdt').toLowerCase();
const seconds = Number(process.argv[3] ?? 60);
const out = resolve(HERE, `../public/sessions/${symbol}.json`);

const ticks = [];
const socket = new WebSocket(
  `wss://stream.binance.com:9443/ws/${symbol}@trade`,
);

socket.addEventListener('message', (event) => {
  try {
    const frame = JSON.parse(String(event.data));
    const price = Number(frame.p);
    const size = Number(frame.q);
    if (typeof frame.T === 'number' && Number.isFinite(price)) {
      ticks.push({ time: frame.T, price, size });
    }
  } catch {
    // A malformed frame costs one tick, not the recording.
  }
});

socket.addEventListener('error', (error) => {
  console.error('socket error:', error);
  process.exit(1);
});

process.stdout.write(`recording ${symbol} for ${seconds}s…\n`);

setTimeout(() => {
  socket.close();
  if (ticks.length === 0) {
    console.error(
      'no ticks recorded — is the market open and the host reachable?',
    );
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        symbol: symbol.toUpperCase(),
        recordedAt: new Date(ticks[0].time).toISOString(),
        durationMs: ticks[ticks.length - 1].time - ticks[0].time,
        ticks,
      },
      null,
      0,
    ) + '\n',
  );
  process.stdout.write(
    `✓ ${out} — ${ticks.length} ticks over ${((ticks.at(-1).time - ticks[0].time) / 1000).toFixed(1)}s\n`,
  );
  process.exit(0);
}, seconds * 1000);
