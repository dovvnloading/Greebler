import type { BakedMaterial, ExportTarget } from './materialMaps.ts';
import { buildMaterialPackage } from './materialPackage.ts';

export type PackageRequest = { material: BakedMaterial; target: ExportTarget };
export type PackageResponse = { archive: Blob } | { error: string };

self.onmessage = async ({ data }: MessageEvent<PackageRequest>) => {
  try {
    const archive = await buildMaterialPackage(data.material, undefined, data.target);
    self.postMessage({ archive } satisfies PackageResponse);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Material export failed.',
    } satisfies PackageResponse);
  }
};
