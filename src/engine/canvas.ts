export type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(width: number, height: number): RasterCanvas {
  if (typeof document === 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function context2D(canvas: RasterCanvas): RasterContext {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as RasterContext | null;
  if (!ctx) throw new Error('Could not allocate the 2D rendering surface. Try a smaller resolution.');
  return ctx;
}

export async function canvasBlob(canvas: RasterCanvas, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  signal?.throwIfAborted();
  if (!blob) throw new Error('Could not encode the texture as a PNG. Try a smaller resolution.');
  return blob;
}

export function releaseCanvas(canvas: RasterCanvas) {
  // Resizing releases the native backing store without waiting for JavaScript garbage collection.
  canvas.width = 0;
  canvas.height = 0;
}
