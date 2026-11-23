import { expect, test } from '@playwright/test';

for (const sourceSize of [17, 2051]) {
  test(`uploads aligned material channels and exact height mips from a ${sourceSize}px source`, async ({ page }) => {
    await page.route('**/height-mip-test', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Height texture</title>' }),
    );
    await page.goto('/height-mip-test');
    const result = await page.evaluate(async (size) => {
      const url = new URL('/tests/browser/fixtures/height-mips.ts', location.href);
      const { sampleHeightMips } = (await import(url.href)) as typeof import('./fixtures/height-mips');
      return sampleHeightMips(size);
    }, sourceSize);
    const size = Math.min(sourceSize, 2048);
    const widths = [];
    for (let w = size; w >= 1; w = Math.floor(w / 2)) widths.push(w);
    expect(result.error).toBe(0);
    expect(result.idMatches).toBe(true);
    expect(result.sizes).toEqual(Array(5).fill(size));
    expect(result.registrationErrors).toEqual([0, 0, 0]);
    expect(result.results.map((r) => r.width)).toEqual(widths);
    expect(result.results.map((r) => r.maxError)).toEqual(widths.map(() => 0));
  });
}
