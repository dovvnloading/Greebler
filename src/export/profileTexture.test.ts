import { expect, it, vi } from 'vitest';
import { buildProfileTexture } from './profileTexture';
import { readStudioPixels } from '../../tests/readStudioPixels';

// Five rows of RGB8 bytes (77*i + 255 mod 256), encoded with filters 0 through 4.
const filters =
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAIAAAACDbGyAAAANUlEQVR4nGP47zPzmXHDWan0LYx+s1+YMjadl3mOBJiaUQFz25rLW023ghEIswDFwAoh5HMAHDoveQxYWfoAAAAASUVORK5CYII=';
const png = new Blob([Buffer.from(filters, 'base64')]);

it.each([true, false])('converts all five PNG filters with native inflate=%s', async (native) => {
  if (!native) vi.stubGlobal('DecompressionStream', undefined);
  try {
    const converted = await buildProfileTexture(png, 5, 'unity-hdrp');
    const actual = readStudioPixels(new Uint8Array(await converted.arrayBuffer()), 4);
    const source = Buffer.from(Array.from({ length: 75 }, (_, i) => (77 * i + 255) & 255));
    const expected = [];
    for (let i = 0; i < source.length; i += 3) expected.push(source[i + 2], source[i], 255, 255 - source[i + 1]);
    expect(actual).toEqual(Buffer.from(expected));
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects truncated images and unsupported dimensions before export', async () => {
  await expect(buildProfileTexture(png.slice(0, png.size - 12), 5, 'unreal')).rejects.toThrow('complete image data');
  await expect(buildProfileTexture(png, 8, 'unreal')).rejects.toThrow('RGB8');
});
