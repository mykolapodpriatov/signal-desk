#!/usr/bin/env node
//
// Captures the README media from the running app.
//
//   pnpm build && pnpm preview --port 4173 --strictPort &
//   node scripts/capture-demo.mjs
//
// A still screenshot cannot show a moving chart, so the primary artefact is a
// GIF of the replay running at 100x with the overlay visible — which is the
// whole argument in one image.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../docs/images');
const FRAMES = resolve(HERE, '../.frames');
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:4173';

const FRAME_COUNT = 40;
const FRAME_DELAY_MS = 160;

mkdirSync(OUT, { recursive: true });
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.selectOption('#speed-select', '100');
// Let the chart fill before recording; an animation that starts empty spends
// half its length on nothing.
await page.waitForTimeout(4_000);

for (let i = 0; i < FRAME_COUNT; i += 1) {
  await page.screenshot({
    path: join(FRAMES, `frame-${String(i).padStart(3, '0')}.png`),
  });
  await page.waitForTimeout(FRAME_DELAY_MS);
}

await page.screenshot({ path: join(OUT, 'desk.png') });

const light = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const lightPage = await light.newPage();
await lightPage.goto(BASE, { waitUntil: 'networkidle' });
await lightPage.selectOption('#speed-select', '100');
await lightPage.waitForTimeout(4_000);
await lightPage.screenshot({ path: join(OUT, 'desk-light.png') });

process.stdout.write(`✓ ${readdirSync(FRAMES).length} frames captured\n`);
await context.close();
await light.close();
await browser.close();

try {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      '8',
      '-pattern_type',
      'glob',
      '-i',
      join(FRAMES, '*.png'),
      '-vf',
      'scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop',
      '0',
      join(OUT, 'desk.gif'),
    ],
    { stdio: 'pipe' },
  );
  process.stdout.write('✓ docs/images/desk.gif\n');
} catch {
  process.stdout.write('! ffmpeg not available — wrote stills only\n');
} finally {
  rmSync(FRAMES, { recursive: true, force: true });
}
