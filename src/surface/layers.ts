export const MAX_SURFACE_LAYERS = 16;
export const surfaceShapes = ['panel', 'ellipse', 'ring', 'slots', 'rivets'] as const;
export type SurfaceShape = (typeof surfaceShapes)[number];
export type SurfaceOperation = 'add' | 'subtract' | 'replace';

export interface SurfaceLayerMaterial {
  readonly color: string;
  readonly roughness: number;
  readonly metalness: number;
}

/** Portable analytic stamp. XY are tile coordinates, measured from the upper left.
 * Width/height are fractions of one array cell; amount is a fraction of the
 * material's full displacement range. Arrays wrap at the tile boundary. */
export interface SurfaceLayer {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly shape: SurfaceShape;
  readonly operation: SurfaceOperation;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly feather: number;
  readonly opacity: number;
  readonly amount: number;
  readonly repeatX: number;
  readonly repeatY: number;
  readonly material?: SurfaceLayerMaterial;
}

export const surfaceShapeLabels: Record<SurfaceShape, string> = {
  panel: 'Chamfered panel',
  ellipse: 'Round boss',
  ring: 'Retaining ring',
  slots: 'Vent slots',
  rivets: 'Rivet quartet',
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const range = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function isSurfaceLayer(value: unknown): value is SurfaceLayer {
  if (!record(value)) return false;
  const material = value.material;
  return (
    typeof value.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,48}$/.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 64 &&
    typeof value.enabled === 'boolean' &&
    surfaceShapes.some((shape) => shape === value.shape) &&
    ['add', 'subtract', 'replace'].some((operation) => operation === value.operation) &&
    range(value.x, 0, 1) &&
    range(value.y, 0, 1) &&
    range(value.width, 0.01, 1) &&
    range(value.height, 0.01, 1) &&
    range(value.rotation, -180, 180) &&
    range(value.feather, 0, 0.5) &&
    range(value.opacity, 0, 1) &&
    range(value.amount, 0, 1) &&
    Number.isInteger(value.repeatX) &&
    range(value.repeatX, 1, 8) &&
    Number.isInteger(value.repeatY) &&
    range(value.repeatY, 1, 8) &&
    (material === undefined ||
      (record(material) &&
        typeof material.color === 'string' &&
        /^#[\da-f]{6}$/i.test(material.color) &&
        range(material.roughness, 0, 1) &&
        range(material.metalness, 0, 1)))
  );
}

export function validSurfaceLayers(value: unknown): value is readonly SurfaceLayer[] | undefined {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.length <= MAX_SURFACE_LAYERS &&
    value.every(isSurfaceLayer) &&
    new Set(value.map((layer) => layer.id)).size === value.length
  );
}

/** Canonical key order and a deep copy keep history and recipe hashes independent
 * of caller mutation or property insertion order. */
export function cloneSurfaceLayer(layer: SurfaceLayer): SurfaceLayer {
  return {
    id: layer.id,
    name: layer.name,
    enabled: layer.enabled,
    shape: layer.shape,
    operation: layer.operation,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    feather: layer.feather,
    opacity: layer.opacity,
    amount: layer.amount,
    repeatX: layer.repeatX,
    repeatY: layer.repeatY,
    ...(layer.material && {
      material: {
        color: layer.material.color,
        roughness: layer.material.roughness,
        metalness: layer.material.metalness,
      },
    }),
  };
}

export function createSurfaceLayer(shape: SurfaceShape, id: string): SurfaceLayer {
  return {
    id,
    name: surfaceShapeLabels[shape],
    enabled: true,
    shape,
    operation: shape === 'slots' ? 'subtract' : 'add',
    x: 0.5,
    y: 0.5,
    width: shape === 'rivets' ? 0.7 : shape === 'slots' ? 0.48 : 0.38,
    height: shape === 'slots' ? 0.36 : shape === 'rivets' ? 0.7 : 0.38,
    rotation: 0,
    feather: shape === 'slots' ? 0.08 : 0.12,
    opacity: 1,
    amount: shape === 'slots' ? 0.18 : 0.22,
    repeatX: 1,
    repeatY: 1,
  };
}
