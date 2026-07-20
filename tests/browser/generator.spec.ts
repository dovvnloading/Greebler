import { expect, test } from '@playwright/test';

test('renders generated maps and responds to core controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'GREEBLE' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'albedo map' })).toBeVisible({ timeout: 30_000 });

  const seedInput = page.locator('#seed-input');
  const originalSeed = await seedInput.inputValue();
  await page.getByRole('button', { name: 'Randomize Seed' }).click();
  await expect(seedInput).not.toHaveValue(originalSeed);

  await page.locator('#style-select').click();
  const electricalOption = page.getByRole('button', { name: 'Electrical' });
  await expect(electricalOption).toBeVisible({ timeout: 30_000 });
  await electricalOption.click({ force: true });
  await expect(page.locator('#style-select')).toContainText('Electrical');

  await page.getByRole('button', { name: 'Generate Maps' }).click();
  await expect(page.getByRole('img', { name: 'albedo map' })).toBeVisible({ timeout: 30_000 });
});
