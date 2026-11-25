export async function drawThumbnail(canvas: HTMLCanvasElement, source: Blob, signal: AbortSignal) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source, {
        resizeWidth: canvas.width,
        resizeHeight: canvas.height,
        resizeQuality: 'high',
      });
      try {
        if (!signal.aborted) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
      return;
    } catch {
      // Some browsers implement ImageBitmap without resize options.
    }
  }
  if (signal.aborted) return;
  const image = new Image();
  const url = URL.createObjectURL(source);
  try {
    image.src = url;
    await image.decode();
    if (!signal.aborted) context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
