import { expect, test } from '@playwright/test';

// Replaced by the journey specs once there are screens; still asserts something
// real in the meantime — the built app boots and mounts.
test('the built app mounts', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#root')).not.toBeEmpty();
});
