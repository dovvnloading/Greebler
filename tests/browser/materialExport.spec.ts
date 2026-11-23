import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readStudioPixels } from '../readStudioPixels';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

const { validateBytes } = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(
    bytes: Uint8Array,
    options: {
      uri: string;
      externalResourceFunction: (uri: string) => Promise<Uint8Array>;
    },
  ): Promise<{ issues: { messages: unknown[]; numErrors: number; numWarnings: number } }>;
};

test('inspects seven channels and exports the displayed bake for glTF, Unreal and HDRP', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        return args[0].startsWith('webgl') ? null : Reflect.apply(target, canvas, args);
      },
    });
  });
  await page.goto('/');
  const inspector = page.getByRole('region', { name: 'Map inspector' });
  const download = page.getByRole('button', { name: 'Download material ZIP' });
  await expect(download).toBeEnabled();
  await inspector.getByRole('button', { name: '2×2', exact: true }).click();
  await expect(inspector.locator('img')).toHaveCount(4);
  await inspector.getByRole('button', { name: '1:1', exact: true }).click();
  await expect(inspector.locator('img')).toHaveCount(1);

  const hashes: Record<string, string> = {};
  for (const [key, label] of Object.entries({
    albedo: 'Albedo',
    normal: 'Normal',
    height: 'Height',
    roughness: 'Roughness',
    metalness: 'Metalness',
    ao: 'AO',
    orm: 'ORM',
  })) {
    await inspector.getByRole('button', { name: label, exact: true }).click();
    hashes[key] = await inspector.getByRole('img', { name: `${key} map`, exact: true }).evaluate(async (img) => {
      const source = img.getAttribute('src');
      if (!source) throw new Error('Missing map image source.');
      const bytes = await (await fetch(source)).arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    });
  }
  const pending = page.waitForEvent('download');
  await download.click();
  const archive = await pending;
  expect(await archive.failure()).toBeNull();
  const path = await archive.path();
  if (!path) throw new Error('Download did not produce a file.');
  const files = unzipSync(await readFile(path));
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  expect(archive.suggestedFilename()).toContain(manifest.recipeId);
  for (const [key, hash] of Object.entries(hashes)) {
    expect(createHash('sha256').update(files[manifest.maps[key].file]).digest('hex')).toBe(hash);
  }
  expect(manifest.maps.height.bitDepth).toBe(16);
  const result = await validateBytes(files['material.gltf'], {
    uri: 'material.gltf',
    externalResourceFunction: async (uri) => {
      if (!files[uri]) throw new Error(`Missing archive entry ${uri}`);
      return files[uri];
    },
  });
  expect(result.issues.numErrors, JSON.stringify(result.issues.messages)).toBe(0);
  expect(result.issues.numWarnings, JSON.stringify(result.issues.messages)).toBe(0);

  for (const target of ['unreal', 'unity-hdrp'] as const) {
    await page.getByLabel('Export target').selectOption(target);
    const pendingProfile = page.waitForEvent('download');
    await download.click();
    const profileArchive = await pendingProfile;
    expect(await profileArchive.failure()).toBeNull();
    expect(profileArchive.suggestedFilename()).toContain(`-${target}.zip`);
    const profilePath = await profileArchive.path();
    if (!profilePath) throw new Error('Missing engine profile download.');
    const profileFiles = unzipSync(await readFile(profilePath));
    const profile = JSON.parse(new TextDecoder().decode(profileFiles['manifest.json']));
    expect(profile.target).toBe(target);
    expect(profile.recipeId).toBe(manifest.recipeId);
    for (const [key, hash] of Object.entries(hashes)) {
      expect(createHash('sha256').update(profileFiles[profile.maps[key].file]).digest('hex')).toBe(hash);
    }
    for (const texture of Object.values(profile.importSettings.textures) as { file: string }[]) {
      expect(profileFiles[texture.file]).toBeDefined();
    }
    const source = readStudioPixels(files[profile.derived.source], 3);
    const converted = readStudioPixels(profileFiles[profile.derived.file], target === 'unreal' ? 3 : 4);
    let expected: Buffer;
    if (target === 'unreal') {
      expect(profile.importSettings.textures.normal.flipGreenChannel).toBe(false);
      expect(profile.importSettings.textures.normal.normalEncoding).toBe('tangent-space-directx-negative-y');
      expected = Buffer.from(source);
      for (let i = 1; i < source.length; i += 3) expected[i] = 255 - source[i];
    } else {
      expect(profile.importSettings.textures.mask.sRGB).toBe(false);
      expect(profile.importSettings.textures.mask.alphaIsTransparency).toBe(false);
      expected = Buffer.alloc((source.length / 3) * 4);
      for (let i = 0, j = 0; i < source.length; i += 3) {
        expected[j++] = source[i + 2];
        expected[j++] = source[i];
        expected[j++] = 255;
        expected[j++] = 255 - source[i + 1];
      }
    }
    expect(Buffer.compare(converted, expected), `Every ${target} output channel matches its baked source`).toBe(0);
  }
});
