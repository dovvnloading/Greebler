import { describe, expect, it } from 'vitest';
import { FormedHeightRaster } from './formedHeight';
import { FormedFinish, ReliefField, SurfaceFinish } from './surfaceBake';
import { type StudioLayout, SurfacePen, TILE } from './surfacePrimitives';

function fixture(draw: (pen: SurfacePen) => void, size = 512, band = size) {
  const marks: StudioLayout[number][] = [];
  const pen = new SurfacePen(marks, 0, 0, false, true);
  pen.rect(0, 0, TILE, TILE, 20);
  draw(pen);
  const field = new Uint16Array(size * size);
  const raster = new FormedHeightRaster(marks, size);
  for (let top = 0; top < size; top += band) raster.paint(field, top, Math.min(band, size - top));
  return field;
}

describe('formed mechanical relief', () => {
  it('gives a tube a continuous crown with opposed slopes and a flat mounting surface', () => {
    const draw = (p: SurfacePen) => p.path([-50, 512, 1074, 512], 64, undefined, 160, { kind: 'tube', rise: 34 });
    const h = fixture(draw);
    const cross = Array.from({ length: 40 }, (_, i) => h[(216 + i) * 512 + 128]);
    expect(new Set(cross).size).toBe(40);
    expect(cross).toEqual([...cross].sort((a, b) => a - b));
    expect(h[255 * 512 + 128]).toBe(h[256 * 512 + 128]);
    expect(h[206 * 512 + 128]).toBe(20 * 257);
    const normals = new ReliefField(h, 512, true).normals(226, 60, 1);
    expect(normals[128 * 3 + 1]).toBeGreaterThan(127);
    expect(normals[(59 * 512 + 128) * 3 + 1]).toBeLessThan(128);
  });

  it('keeps a louver pitched in one direction and cuts a return lip near its rim', () => {
    const draw = (p: SurfacePen) => p.path([60, 512, 960, 512], 50, undefined, 128, { kind: 'louver', rise: 34 });
    const h = fixture(draw);
    const samples = Array.from({ length: 64 }, (_, i) => h[(224 + i) * 512 + 256]);
    const vertical = fixture((p) => draw(p.frame(0, 0, true)));
    expect(Array.from(vertical.subarray(256 * 512 + 224, 256 * 512 + 288))).toEqual(samples);
    const crest = samples.indexOf(Math.max(...samples));
    expect(crest).toBeGreaterThan(44);
    expect(crest).toBeLessThan(55);
    expect(samples[15]).toBeLessThan(samples[30]);
    expect(samples[30]).toBeLessThan(samples[44]);
    expect(samples[63]).toBeLessThan(samples[crest]);
  });

  it('rounds a plate inside its footprint and keeps its shoulder width in tile units', () => {
    const draw = (p: SurfacePen) => p.rect(256, 32, 512, 960, 220);
    const angularWidth = (size: number) => {
      const field = fixture(draw, size);
      const row = field.subarray(size * Math.floor(size / 2));
      const left = size / 4;
      expect(row[left - 1]).toBe(20 * 257);
      expect(row[left]).toBeLessThan(220 * 257);
      expect(row[left + Math.ceil((4 * size) / TILE)]).toBe(220 * 257);
      const transition = row.subarray(left, left + Math.ceil((3.2 * size) / TILE));
      expect([...transition]).toEqual([...transition].sort((a, b) => a - b));
      expect(transition.some((v) => v % 257 !== 0)).toBe(true);
      return (transition.length * TILE) / size;
    };
    expect(Math.abs(angularWidth(512) - angularWidth(1024))).toBeLessThanOrEqual(1);
  });

  it('reproduces all wrapped contour and junction pixels independent of paint band boundaries', () => {
    const draw = (p: SurfacePen) => {
      p.path([950, -60, 1130, 20, 1060, 120, 980, 98], 188);
      p.path([1001, 36, 1038, 51, 1052, 56], 77, undefined, 15, { kind: 'tube', rise: 30 });
      p.disc(1024, 1024, 14, 131);
    };
    const n = 129;
    const first = fixture(draw, n);
    const shifted = fixture((p) => draw(p.frame(-TILE, TILE)), n, 5);
    expect(Buffer.compare(Buffer.from(first.buffer), Buffer.from(shifted.buffer))).toBe(0);
    expect(first[0]).toBeGreaterThan(20 * 257);
    expect(first[n - 1]).toBeGreaterThan(20 * 257);
  });

  it('continues a full-period channel, hose and their subpixel edges across the authored join', () => {
    const size = 257;
    const h = fixture(
      (surface) => {
        // Adding one period to this origin rounds the endpoint down by one ulp.
        const pen = surface.frame(542.8482490272373, 290.35);
        pen.rect(0, 0, TILE, 83, 53);
        pen.path([0, 41, 400, 41, 800, 41, TILE, 41], 60, undefined, 25, { kind: 'tube', rise: 77 });
      },
      size,
      13,
    );
    for (let y = 0; y < size; y++) {
      const row = h.subarray(y * size, (y + 1) * size);
      expect(row.every((value) => value === row[0])).toBe(true);
    }
    expect(h[Math.floor((331.35 / TILE) * size) * size]).toBeGreaterThan(120 * 257);
  });

  it('retains the physical direction of a planar ramp and samples diagonal occluders', () => {
    const size = 64;
    const h = Uint16Array.from(
      { length: size * size },
      (_, i) => 25000 + (i % size) * 120 + Math.floor(i / size) * 300,
    );
    const source = new ReliefField(h, size, true);
    const color = source.normals(32, 1, 1);
    expect(color[96]).toBeLessThan(128);
    expect(color[97]).toBeGreaterThan(127);
    const hole = 32 * size + 32;
    h.fill(1000);
    h[hole - size + 1] = 65535;
    expect(source.occlusion(32, source.rowOffsets(32), 1)).toBeLessThan(255);
    expect(source.occlusion(32, source.rowOffsets(32), 0)).toBe(255);
  });

  it('keeps powder coat and exposed-metal finish in distinct height fields', () => {
    const base = new SurfaceFinish(1024, 37);
    const finish = new FormedFinish(1024, 37, base);
    const paint = Array.from({ length: 64 }, (_, x) => finish.height(30000, x, 41, 255, 0));
    const metal = Array.from({ length: 64 }, (_, x) => finish.height(30000, x, 41, 0, 255));
    expect(metal).not.toEqual(paint);
    expect(Math.max(...metal, ...paint) - Math.min(...metal, ...paint)).toBeGreaterThan(100);
    expect(Math.max(...metal, ...paint) - Math.min(...metal, ...paint)).toBeLessThan(800);
  });
});
