import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { canvasBlob } from '../engine/canvas';

/** Snapshot the current camera and material at 2K, using the viewport's lighting and color pipeline. */
export function renderStill(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
  const context = renderer.getContext();
  if (context.isContextLost()) throw new Error('The graphics context was lost. Try again when the viewport returns.');
  const size = renderer.getSize(new Vector2());
  const ratio = renderer.getPixelRatio();
  const scale = 2048 / Math.max(1, size.x, size.y);
  try {
    renderer.setDrawingBufferSize(Math.max(1, Math.round(size.x * scale)), Math.max(1, Math.round(size.y * scale)), 1);
    renderer.render(scene, camera);
    // toBlob takes a snapshot synchronously, then encodes it while the artist can continue orbiting.
    return canvasBlob(renderer.domElement);
  } finally {
    renderer.setDrawingBufferSize(size.x, size.y, ratio);
    renderer.render(scene, camera);
  }
}
