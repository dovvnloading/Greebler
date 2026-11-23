/** Coordinates are in a 1024-unit material tile, independent of output resolution. */
export const TILE = 1024;

export interface Finish {
  color: string;
  roughness: number;
  metalness: number;
  paintedMetal?: boolean;
}

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'disc'; x: number; y: number; radius: number }
  | { kind: 'path'; points: number[]; width: number };

interface Mark {
  shape: Shape;
  height: number;
  finish?: Finish;
  dx: number;
  dy: number;
  top: number;
  bottom: number;
}

export type StudioLayout = readonly Mark[];

// Frames let a detail follow the long axis of its panel without separate horizontal and vertical drawing code.
export class SurfacePen {
  constructor(
    private marks: Mark[],
    private x = 0,
    private y = 0,
    private transpose = false,
  ) {}

  frame(x: number, y: number, transpose = false) {
    return new SurfacePen(
      this.marks,
      this.x + (this.transpose ? y : x),
      this.y + (this.transpose ? x : y),
      this.transpose !== transpose,
    );
  }

  private add(shape: Shape, x0: number, y0: number, x1: number, y1: number, height: number, finish?: Finish) {
    // Translate each primitive across whichever edges it actually crosses, including its stroked outline.
    // A subpixel halo accounts for the antialias filter at the smallest supported map size.
    const halo = 2;
    const left = x0 - halo;
    const right = x1 + halo;
    const top = y0 - halo;
    const bottom = y1 + halo;
    for (let row = Math.ceil(-bottom / TILE); row <= Math.floor((TILE - top) / TILE); row++) {
      for (let col = Math.ceil(-right / TILE); col <= Math.floor((TILE - left) / TILE); col++) {
        const dx = col * TILE;
        const dy = row * TILE;
        this.marks.push({ shape, height, finish, dx, dy, top: top + dy, bottom: bottom + dy });
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, height: number, finish?: Finish) {
    if (w <= 0 || h <= 0) return;
    const left = this.x + (this.transpose ? y : x);
    const top = this.y + (this.transpose ? x : y);
    const width = this.transpose ? h : w;
    const depth = this.transpose ? w : h;
    this.add(
      { kind: 'rect', x: left, y: top, w: width, h: depth },
      left,
      top,
      left + width,
      top + depth,
      height,
      finish,
    );
  }

  disc(x: number, y: number, radius: number, height: number, finish?: Finish) {
    const cx = this.x + (this.transpose ? y : x);
    const cy = this.y + (this.transpose ? x : y);
    this.add(
      { kind: 'disc', x: cx, y: cy, radius },
      cx - radius,
      cy - radius,
      cx + radius,
      cy + radius,
      height,
      finish,
    );
  }

  /** A closed filled contour, or a rounded open stroke when width is positive. */
  path(points: number[], height: number, finish?: Finish, width = 0) {
    const absolute: number[] = [];
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const x = this.x + (this.transpose ? points[i + 1] : points[i]);
      const y = this.y + (this.transpose ? points[i] : points[i + 1]);
      absolute.push(x, y);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    const radius = width / 2;
    this.add(
      { kind: 'path', points: absolute, width },
      left - radius,
      top - radius,
      right + radius,
      bottom + radius,
      height,
      finish,
    );
  }

  chamfer(x: number, y: number, w: number, h: number, cut: number, height: number, finish?: Finish) {
    const c = Math.min(cut, h / 2, w / 2);
    this.path(
      [x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c],
      height,
      finish,
    );
  }

  ring(x: number, y: number, radius: number, sides: number, height: number, finish?: Finish, rotation = 0) {
    const points: number[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + rotation;
      points.push(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
    }
    this.path(points, height, finish);
  }
}

type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface StudioContexts {
  height?: DrawingContext;
  materialAlbedo?: DrawingContext;
  roughness?: DrawingContext;
  metalness?: DrawingContext;
  packedMaterial?: DrawingContext;
}

const greys = Array.from({ length: 256 }, (_, value) => `rgb(${value},${value},${value})`);

function paintMark(ctx: DrawingContext, mark: Mark, color: string) {
  const { shape, dx, dy } = mark;
  if (shape.kind === 'rect') {
    ctx.fillStyle = color;
    ctx.fillRect(shape.x + dx, shape.y + dy, shape.w, shape.h);
    return;
  }
  ctx.beginPath();
  if (shape.kind === 'disc') {
    ctx.arc(shape.x + dx, shape.y + dy, shape.radius, 0, Math.PI * 2);
  } else {
    const { points } = shape;
    ctx.moveTo(points[0] + dx, points[1] + dy);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i] + dx, points[i + 1] + dy);
    if (shape.width > 0) {
      ctx.lineWidth = shape.width;
      ctx.strokeStyle = color;
      ctx.stroke();
      return;
    }
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill();
}

/** The caller can pre-translate each canvas in output pixels to render one horizontal strip. */
export function paintStudioLayout(
  contexts: StudioContexts,
  layout: StudioLayout,
  resolution: number,
  band = { top: 0, bottom: resolution },
) {
  const scale = resolution / TILE;
  const top = band.top / scale;
  const bottom = band.bottom / scale;
  const channels = Object.values(contexts).filter((ctx): ctx is DrawingContext => !!ctx);
  for (const ctx of channels) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }
  try {
    for (const mark of layout) {
      if (mark.bottom < top || mark.top > bottom) continue;
      if (contexts.height) paintMark(contexts.height, mark, greys[mark.height]);
      const finish = mark.finish;
      if (!finish) continue;
      if (contexts.materialAlbedo) paintMark(contexts.materialAlbedo, mark, finish.color);
      if (contexts.roughness) paintMark(contexts.roughness, mark, greys[finish.roughness]);
      if (contexts.metalness) paintMark(contexts.metalness, mark, greys[finish.metalness]);
      if (contexts.packedMaterial)
        paintMark(
          contexts.packedMaterial,
          mark,
          `rgb(${finish.paintedMetal ? 255 : 0},${finish.roughness},${finish.metalness})`,
        );
    }
  } finally {
    for (const ctx of channels) ctx.restore();
  }
}
