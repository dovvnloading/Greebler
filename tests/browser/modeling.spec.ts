import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { type Download, expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { type AssetProject, createPart, parseAssetProject, serializeAssetProject } from '../../src/modeling/project';
import { createGenerationRecipe, getGenerationRecipeId } from '../../src/recipes';

const { validateBytes } = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(
    bytes: Uint8Array,
    options: { uri: string },
  ): Promise<{ issues: { messages: unknown[]; numErrors: number; numWarnings: number } }>;
};

function fixture(): AssetProject {
  return {
    document: {
      version: 1,
      name: 'Pipeline fixture',
      tileWidthM: 0.5,
      parts: [
        {
          ...createPart('box', 'fixture-chassis'),
          name: 'Fixture chassis',
          size: [0.8, 0.2, 0.6],
          position: [0, 0.1, 0],
          bevel: 0.01,
        },
        {
          ...createPart('ring', 'fixture-collar'),
          name: 'Fixture collar',
          size: [0.25, 0.06, 0.25],
          position: [0.15, 0.23, 0],
          wall: 0.035,
          bevel: 0.005,
          segments: 16,
        },
      ],
    },
    recipe: createGenerationRecipe({
      style: 'tech',
      resolution: 128,
      seed: 69217,
      largeDensity: 0.4,
      mediumDensity: 0.5,
      smallDensity: 0.3,
      gapSize: 2,
      complexity: 3,
      palette: ['#242f38', '#64727e', '#bd7a34'],
      reliefProfile: 'formed',
    }),
  };
}

async function downloadBytes(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error('The asset download did not create a file.');
  return readFile(path);
}

async function saveProject(page: Page): Promise<AssetProject> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  return parseAssetProject((await downloadBytes(await pending)).toString('utf8'));
}

async function openProject(page: Page, project: AssetProject) {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await (await choosing).setFiles({
    name: 'pipeline-fixture.greebler.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeAssetProject(project.document, project.recipe)),
  });
  await expect(page.getByRole('region', { name: 'Assembly parts', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Assembly parts', exact: true })
      .getByRole('button', { name: 'Fixture chassis', exact: true }),
  ).toBeVisible();
}

async function expectRenderedModel(page: Page, canvas: Locator) {
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const bounds = await canvas.boundingBox();
        if (!bounds) return false;
        const shot = await page.screenshot({
          clip: {
            x: bounds.x + bounds.width * 0.35,
            y: bounds.y + bounds.height * 0.35,
            width: bounds.width * 0.3,
            height: bounds.height * 0.3,
          },
        });
        return page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const sample = document.createElement('canvas');
          sample.width = image.width;
          sample.height = image.height;
          const context = sample.getContext('2d');
          if (!context) throw new Error('Unable to inspect the rendered asset.');
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          let sum = 0;
          let squares = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
            sum += value;
            squares += value * value;
          }
          const count = pixels.length / 4;
          const mean = sum / count;
          return mean > 20 && squares / count - mean * mean > 45;
        }, shot.toString('base64'));
      },
      {
        timeout: 30_000,
        message: 'A lit, framed assembly must contain visible shading, not a blank or black viewport',
      },
    )
    .toBe(true);
}

async function studioScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('keeps the studio header and modeling controls usable at phone and tablet widths', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  for (const width of [390, 680, 810]) {
    await page.setViewportSize({ width, height: 900 });
    for (const workspace of ['Surface workspace', 'Model workspace']) {
      await page.getByRole('button', { name: workspace, exact: true }).click();
      await expect(page.locator('.app-bar')).toBeVisible();
      expect(
        await page.locator('.app-bar').evaluate((header) => ({
          headerOverflow: header.scrollWidth - header.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        })),
        `${workspace} must fit at ${width}px`,
      ).toEqual({ headerOverflow: 0, pageOverflow: 0 });
      await expect(page.getByRole('button', { name: 'Model workspace', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Surface workspace', exact: true })).toBeInViewport();
    }
    for (const name of ['Open project', 'Save project', 'Export asset', 'Frame asset', 'Show part inspector']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport();
    }
    if (width <= 760) await page.getByRole('button', { name: 'Show assembly', exact: true }).click();
    const parts = page.getByRole('region', { name: 'Assembly parts', exact: true });
    await expect(parts).toBeVisible();
    await parts.getByRole('button', { name: 'Main chassis', exact: true }).click();
    await page.getByRole('button', { name: 'Show part inspector', exact: true }).click();
    const inspector = page.getByRole('dialog', { name: 'Part inspector', exact: true });
    await expect(inspector.getByLabel('Part name', { exact: true })).toHaveValue('Main chassis');
    await expect(inspector.getByLabel('Width (m)', { exact: true })).toBeEditable();
    await inspector.getByRole('button', { name: 'Close part inspector', exact: true }).click();
    await expect(inspector).toBeHidden();
    if (width === 390) {
      await expect(page.locator('.model-texture-state')).toBeHidden({ timeout: 30_000 });
      await expectRenderedModel(
        page,
        page.getByRole('region', { name: 'Asset viewport', exact: true }).locator('canvas'),
      );
      await studioScreenshot(page, testInfo, 'modeling-mobile.png');
    }
  }
});

test('authors exact geometry and preserves source through project save, open, undo and recovery', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Model workspace', exact: true }).click();
  const source = fixture();
  await openProject(page, source);
  const parts = page.getByRole('region', { name: 'Assembly parts', exact: true });
  await parts.getByRole('button', { name: 'Fixture chassis', exact: true }).click();

  for (const [label, value] of [
    ['Width (m)', '1.125'],
    ['Height (m)', '0.24'],
    ['Depth (m)', '0.8'],
    ['Bevel (m)', '0.012'],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await field.press('Enter');
  }
  const name = page.getByLabel('Part name', { exact: true });
  await name.fill('Fixture chassis revised');
  await name.press('Enter');
  const edited = await saveProject(page);
  expect(edited.document.parts[0]).toMatchObject({
    id: 'fixture-chassis',
    name: 'Fixture chassis revised',
    size: [1.125, 0.24, 0.8],
    bevel: 0.012,
  });
  expect(edited.recipe).toEqual(source.recipe);

  await page.getByRole('button', { name: 'Duplicate part', exact: true }).click();
  const duplicated = await saveProject(page);
  expect(duplicated.document.parts).toHaveLength(3);
  expect(new Set(duplicated.document.parts.map((part) => part.id)).size).toBe(3);
  await page.getByRole('button', { name: 'Delete part', exact: true }).click();
  expect((await saveProject(page)).document).toEqual(edited.document);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saveProject(page)).document).toEqual(duplicated.document);

  // Reopening a portable project must restore geometry and its material source,
  // rather than retaining an unrelated current scene or seed.
  await openProject(page, source);
  expect(await saveProject(page)).toEqual(source);
  await parts.getByRole('button', { name: 'Fixture chassis', exact: true }).click();
  await page.getByRole('button', { name: 'Mirror part', exact: true }).click();
  const mirrored = await saveProject(page);
  expect(mirrored.document.parts[0].mirror).not.toBe('none');

  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await (await choosing).setFiles({
    name: 'invalid-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"greebler-asset","version":999}'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a Greebler asset project' })).toBeVisible();
  expect(await saveProject(page)).toEqual(mirrored);

  await page.getByRole('button', { name: 'Surface workspace', exact: true }).click();
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue(String(source.recipe.params.seed));
  await page.getByRole('button', { name: 'Model workspace', exact: true }).click();
  expect(await saveProject(page)).toEqual(mirrored);
});

test('primitive tools create editable source parts instead of only changing the preview', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Model workspace', exact: true }).click();
  await expect(page.locator('.model-material-strip code')).toContainText('512 px', { timeout: 30_000 });
  await expect(page.locator('.model-texture-state')).toBeHidden();
  await expectRenderedModel(page, page.getByRole('region', { name: 'Asset viewport' }).locator('canvas'));
  await studioScreenshot(page, testInfo, 'modeling-studio.png');
  await openProject(page, fixture());
  for (const kind of ['box', 'panel', 'cylinder', 'ring', 'wedge']) {
    await page.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
    const name = page.getByLabel('Part name', { exact: true });
    await name.fill(`Authored ${kind}`);
    await name.press('Enter');
  }
  const authored = await saveProject(page);
  expect(authored.document.parts).toHaveLength(7);
  for (const kind of ['box', 'panel', 'cylinder', 'ring', 'wedge']) {
    expect(authored.document.parts.find((part) => part.name === `Authored ${kind}`)?.kind).toBe(kind);
  }
  await page.getByRole('button', { name: 'Wireframe', exact: true }).click();
  await page.getByRole('button', { name: 'Frame asset', exact: true }).click();
  expect(await saveProject(page)).toEqual(authored);
  expect(errors).toEqual([]);
});

test('frames and illuminates large off-origin geometry without fixed-distance fog', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Model workspace', exact: true }).click();
  const source = fixture();
  source.document.name = 'Large off-origin assembly';
  source.document.parts[0] = {
    ...source.document.parts[0],
    size: [100, 40, 60],
    position: [400, 220, -380],
    bevel: 2,
  };
  source.document.parts[1] = {
    ...source.document.parts[1],
    size: [20, 12, 20],
    position: [400, 246, -380],
    wall: 3,
    bevel: 1,
  };
  await openProject(page, source);
  await page.getByRole('combobox', { name: 'Model shading', exact: true }).selectOption('clay');
  await page.getByRole('button', { name: 'Show grid', exact: true }).click();
  await page.getByRole('button', { name: 'Frame asset', exact: true }).click();
  await expectRenderedModel(page, page.getByRole('region', { name: 'Asset viewport' }).locator('canvas'));
  await studioScreenshot(page, testInfo, 'modeling-large-assembly.png');
  expect(await saveProject(page)).toEqual(source);
});

test('rejects a geometry budget overflow and commits a pending dimension before the keyboard bake', async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(original, canvas, args) {
        return args[0].startsWith('webgl') ? null : Reflect.apply(original, canvas, args);
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Model workspace', exact: true }).click();
  const source = fixture();
  for (let i = 0; i < source.document.parts.length; i++) {
    source.document.parts[i] = {
      ...source.document.parts[i],
      kind: 'ring',
      bevelSegments: 6,
      segments: i === 0 ? 32 : 64,
      mirror: 'x',
      repeat: { count: 32, spacing: 0.8, axis: 'z' },
    };
  }
  await openProject(page, source);
  const radial = page.getByLabel('Radial segments', { exact: true });
  await radial.fill('64');
  await radial.press('Enter');
  await expect(page.getByRole('alert')).toContainText('triangle budget');
  await expect(radial).toHaveValue('32');
  expect(await saveProject(page)).toEqual(source);
  const width = page.getByLabel('Width (m)', { exact: true });
  await width.fill('1.375');
  await width.press('Control+Enter');
  expect((await saveProject(page)).document.parts[0].size[0]).toBe(1.375);
});

test('exports the authored assembly as a valid GLB and a self-contained OBJ package', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Model workspace', exact: true }).click();
  const source = fixture();
  await openProject(page, source);
  await page.getByRole('button', { name: 'Export asset', exact: true }).click();
  const downloadGlb = page.getByRole('button', { name: 'Download GLB', exact: true });
  await expect(downloadGlb).toBeEnabled({ timeout: 30_000 });
  const glbEvent = page.waitForEvent('download');
  await downloadGlb.click();
  const glbDownload = await glbEvent;
  expect(glbDownload.suggestedFilename()).toMatch(/\.glb$/);
  const bytes = await downloadBytes(glbDownload);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
  const validation = await validateBytes(bytes, { uri: 'asset.glb' });
  expect(validation.issues.numErrors, JSON.stringify(validation.issues.messages)).toBe(0);
  expect(validation.issues.numWarnings, JSON.stringify(validation.issues.messages)).toBe(0);

  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const names = gltf.nodes.map((node: { name?: string }) => node.name ?? '').join('\n');
  expect(names).toContain('Fixture chassis');
  expect(names).toContain('Fixture collar');
  expect(gltf.meshes.length).toBeGreaterThanOrEqual(2);
  const assetMetadata = gltf.asset.extras.greebler;
  expect(assetMetadata.project).toEqual(source);
  expect(assetMetadata.recipeId).toBe(getGenerationRecipeId(source.recipe));
  expect(assetMetadata.units).toBe('meters');
  expect(assetMetadata.statistics.instances).toBe(2);
  expect(assetMetadata.bounds.min[0]).toBeCloseTo(-0.4, 6);
  expect(assetMetadata.bounds.max[0]).toBeCloseTo(0.4, 6);
  // The authored rounded primitives must export geometry, not the original
  // four-vertex material swatch offered by the surface-only exporter.
  const vertexCount = gltf.meshes.reduce(
    (sum: number, mesh: { primitives: { attributes: { POSITION: number } }[] }) =>
      sum +
      mesh.primitives.reduce((count, primitive) => count + gltf.accessors[primitive.attributes.POSITION].count, 0),
    0,
  );
  expect(vertexCount).toBeGreaterThan(24);
  expect(gltf.images.length).toBeGreaterThanOrEqual(3);
  for (const image of gltf.images) {
    expect(image.bufferView).toEqual(expect.any(Number));
    expect(image.uri).toBeUndefined();
  }

  const objEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download OBJ package', exact: true }).click();
  const objDownload = await objEvent;
  expect(objDownload.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzipSync(await downloadBytes(objDownload));
  for (const required of ['asset.obj', 'asset.mtl', 'project.json', 'recipe.json', 'manifest.json', 'IMPORT.md']) {
    expect(files[required], `Missing package entry ${required}`).toBeDefined();
  }
  const decode = (path: string) => new TextDecoder().decode(files[path]);
  const exported = parseAssetProject(decode('project.json'));
  expect(exported).toEqual(source);
  expect(JSON.parse(decode('recipe.json'))).toEqual(source.recipe);
  const manifest = JSON.parse(decode('manifest.json'));
  expect(manifest.recipeId).toBe(getGenerationRecipeId(source.recipe));
  const obj = decode('asset.obj');
  expect(obj).toContain('mtllib asset.mtl');
  expect(obj.match(/^v /gm)?.length ?? 0).toBeGreaterThan(24);
  expect(obj.match(/^vt /gm)?.length).toBe(obj.match(/^v /gm)?.length);
  expect(obj.match(/^vn /gm)?.length).toBe(obj.match(/^v /gm)?.length);
  expect(obj.match(/^f /gm)?.length ?? 0).toBeGreaterThan(12);
  expect(obj).not.toMatch(/\b(?:NaN|Infinity)\b/);
  expect(decode('asset.mtl')).toContain('newmtl');
  const binaryStart = 20 + jsonLength + 8;
  for (const image of gltf.images) {
    const view = gltf.bufferViews[image.bufferView];
    const embedded = bytes.subarray(binaryStart + view.byteOffset, binaryStart + view.byteOffset + view.byteLength);
    const packaged = files[`maps/${image.name}.png`];
    expect(createHash('sha256').update(embedded).digest('hex')).toBe(
      createHash('sha256').update(packaged).digest('hex'),
    );
  }
  for (const map of ['albedo', 'normal', 'height', 'roughness', 'metalness', 'ao', 'orm']) {
    const path = Object.keys(files).find((name) => name.startsWith('maps/') && name.endsWith(`${map}.png`));
    expect(path, `Missing source ${map} map`).toBeDefined();
    if (!path) throw new Error(`Missing ${map}.`);
    // Read the PNG IHDR instead of trusting a manifest's bit-depth label.
    const png = Buffer.from(files[path]);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    expect(png[24]).toBe(map === 'height' ? 16 : 8);
  }
});
