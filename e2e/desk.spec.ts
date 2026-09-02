import { expect, test } from '@playwright/test';

// The journey, against the production build and the committed recording.
//
// These assert on the accessible summary and the overlay rather than on pixels:
// a canvas has nothing to assert against, and a screenshot comparison would be
// a rendering test, not a behaviour test.

test.describe('the desk', () => {
  test('boots on the recorded session and connects', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByLabel('Source')).toHaveValue('replay');
    await expect(page.locator('.connection')).toContainText('open');
  });

  test('shows the performance overlay', async ({ page }) => {
    await page.goto('/');

    const overlay = page.getByLabel('Stream performance');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('msgs/s');
    await expect(overlay).toContainText('fps');
    await expect(overlay).toContainText('dropped');
  });

  test('renders candles from the recording', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#speed-select', '100');

    // The accessible summary is the chart in words — and the only part of a
    // canvas a test can meaningfully assert on.
    await expect(page.locator('[data-part="chart-summary"]')).toContainText(
      /Latest candle at .*close \d/,
      { timeout: 15_000 },
    );
  });

  test('the feed runs fast while the frame rate holds', async ({ page }) => {
    // The whole thesis, asserted: a busy feed must not cost frames.
    await page.goto('/');
    await page.selectOption('#speed-select', '100');
    await page.waitForTimeout(4_000);

    const overlay = page.getByLabel('Stream performance');
    const text = await overlay.innerText();
    const numbers = text.split('\n').filter((line) => /^[\d.]+/.test(line));

    const messagesPerSecond = Number(numbers[0]);
    const framesPerSecond = Number(numbers[1]);

    expect(messagesPerSecond).toBeGreaterThan(50);
    expect(framesPerSecond).toBeGreaterThan(20);
  });

  test('does not drop ticks at replay speed', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3_000);

    const dropped = page.locator('.overlay-metric[data-warn]');
    await expect(dropped).toHaveCount(0);
  });

  test('the speed control changes the pace', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1_500);
    const slow = await page.getByLabel('Stream performance').innerText();

    await page.selectOption('#speed-select', '100');
    await page.waitForTimeout(2_500);
    const fast = await page.getByLabel('Stream performance').innerText();

    const rateOf = (text: string) =>
      Number(text.split('\n').filter((line) => /^[\d.]+/.test(line))[0]);

    expect(rateOf(fast)).toBeGreaterThan(rateOf(slow));
  });

  test('speed is disabled for the live feed, which has one pace', async ({
    page,
  }) => {
    await page.goto('/');

    await page.selectOption('#source-select', 'live');

    await expect(page.getByLabel('Speed')).toBeDisabled();
  });

  test('reconnect restarts the stream', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1_000);

    await page.getByRole('button', { name: 'Reconnect' }).click();

    await expect(page.locator('.connection')).toContainText(/open|connecting/);
  });

  test('every control has a label', async ({ page }) => {
    // A select whose accessible name includes its own value is a real defect,
    // and one an earlier sibling repository shipped before an E2E run caught it.
    await page.goto('/');

    await expect(page.getByLabel('Source')).toHaveCount(1);
    await expect(page.getByLabel('Speed')).toHaveCount(1);
  });
});
