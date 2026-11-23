import type { StudioMaps } from '../TextureGenerator';

export type BakeProgress = (fraction: number, stage: string) => void;
export type BakeMessage =
  | { type: 'ready'; supported: boolean }
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'result'; maps: StudioMaps<Blob> }
  | { type: 'error'; message: string };
