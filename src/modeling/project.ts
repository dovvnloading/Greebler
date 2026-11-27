import { cloneGenerationRecipe, type GenerationRecipe, isGenerationRecipe } from '../recipes.ts';

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';
export type PartKind = 'box' | 'panel' | 'cylinder' | 'ring' | 'wedge';
export type MaterialSlot = 'surface' | 'steel' | 'paint';
export const partKinds: readonly PartKind[] = ['box', 'panel', 'cylinder', 'ring', 'wedge'];
export const materialSlots: readonly MaterialSlot[] = ['surface', 'steel', 'paint'];
export const ASSET_LIMITS = {
  parts: 64,
  instances: 512,
  triangles: 400_000,
  arrayCount: 32,
  radialSegments: 64,
  bevelSegments: 6,
  fileBytes: 1_048_576,
} as const;

export interface AssetPart {
  id: string;
  name: string;
  kind: PartKind;
  /** Width X, height Y and depth Z, in meters. Cylinders and rings use elliptical X/Z diameters. */
  size: Vec3;
  position: Vec3;
  /** Euler XYZ, in degrees. */
  rotation: Vec3;
  bevel: number;
  bevelSegments: number;
  segments: number;
  /** Wall thickness in meters, used only by rings. */
  wall: number;
  material: MaterialSlot;
  /** sRGB base color for solid steel and paint slots. */
  color: string;
  visible: boolean;
  locked: boolean;
  /** Linear copies along a world axis, measured center to center. */
  repeat: { count: number; axis: Axis; spacing: number };
  /** Reflect the complete linear array across the world origin. */
  mirror: 'none' | Axis;
}

export interface AssetDocument {
  version: 1;
  name: string;
  /** Width of one repetition of the authored material, in meters. */
  tileWidthM: number;
  parts: AssetPart[];
}

export interface AssetProject {
  document: AssetDocument;
  recipe: GenerationRecipe;
}

export function assetFileName(document: AssetDocument, extension: 'glb' | 'zip' | 'json') {
  const slug =
    document.name
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 72) || 'greebler-asset';
  return `${slug.toLowerCase()}.${extension}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  return value === 0 ? 0 : value;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  const result = finite(value, min, max, label);
  if (!Number.isInteger(result)) throw new Error(`${label} must be a whole number.`);
  return result;
}

function vector(value: unknown, min: number, max: number, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} requires three coordinates.`);
  return value.map((entry) => finite(entry, min, max, label)) as Vec3;
}

function text(value: unknown, max: number, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error(`${label} must contain 1 to ${max} printable characters.`);
  return value;
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`Unknown ${label}.`);
  return value as T;
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

/** Conservative allocation estimate, checked before creating any geometry. */
export function estimatePartTriangles(part: AssetPart): number {
  if (part.kind === 'box' || part.kind === 'panel') return part.bevel > 0 ? 12 * (part.bevelSegments * 2 + 1) ** 2 : 12;
  if (part.kind === 'cylinder' || part.kind === 'ring') {
    const bands = part.bevel > 0 ? part.bevelSegments * 2 + 1 : 1;
    return part.segments * (part.kind === 'ring' ? bands * 4 + 4 : bands * 2 + 2);
  }
  return part.bevel > 0 ? 24 + part.bevelSegments * 24 : 8;
}

export function validateAssetDocument(value: unknown): AssetDocument {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.parts))
    throw new Error('Choose a Greebler asset document with version 1 and a parts array.');
  if (value.parts.length > ASSET_LIMITS.parts)
    throw new Error(`An asset supports at most ${ASSET_LIMITS.parts} parts.`);
  const name = text(value.name, 100, 'Asset name');
  const tileWidthM = finite(value.tileWidthM, 0.01, 100, 'Material tile width');
  const ids = new Set<string>();
  let instances = 0;
  let triangles = 0;
  const parts = value.parts.map((input, i): AssetPart => {
    if (!record(input) || !record(input.repeat)) throw new Error(`Part ${i + 1} is incomplete.`);
    const id = text(input.id, 80, 'Part ID');
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id))
      throw new Error('Part IDs must be unique letters, numbers, dashes or underscores.');
    ids.add(id);
    const kind = choice(input.kind, partKinds, 'part shape');
    const size = vector(input.size, 0.001, 100, 'Part dimensions');
    const bevel = finite(input.bevel, 0, 50, 'Bevel radius');
    // Clamp the effective bevel in the geometry builder when dimensions are edited.
    // Keeping the authored value makes an undo or a later size increase lossless.
    const wall = finite(input.wall, 0.0001, 50, 'Ring wall');
    const color = text(input.color, 7, 'Part color');
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Part color must be a six-digit hex color.');
    const part: AssetPart = {
      id,
      name: text(input.name, 80, 'Part name'),
      kind,
      size,
      position: vector(input.position, -1000, 1000, 'Part position'),
      rotation: vector(input.rotation, -3600, 3600, 'Part rotation'),
      bevel,
      bevelSegments: integer(input.bevelSegments, 1, ASSET_LIMITS.bevelSegments, 'Bevel segments'),
      segments: integer(input.segments, 3, ASSET_LIMITS.radialSegments, 'Radial segments'),
      wall,
      material: choice(input.material, materialSlots, 'material slot'),
      color: color.toLowerCase(),
      visible: flag(input.visible, 'Visibility'),
      locked: flag(input.locked, 'Lock'),
      repeat: {
        count: integer(input.repeat.count, 1, ASSET_LIMITS.arrayCount, 'Array count'),
        axis: choice(input.repeat.axis, ['x', 'y', 'z'], 'array axis'),
        spacing: finite(input.repeat.spacing, 0.001, 100, 'Array spacing'),
      },
      mirror: choice(input.mirror, ['none', 'x', 'y', 'z'], 'mirror axis'),
    };
    const count = part.repeat.count * (part.mirror === 'none' ? 1 : 2);
    // Hidden parts are counted too: making a part visible must never bypass the budget.
    instances += count;
    triangles += count * estimatePartTriangles(part);
    return part;
  });
  if (instances > ASSET_LIMITS.instances)
    throw new Error(`This asset exceeds the ${ASSET_LIMITS.instances}-instance budget.`);
  if (triangles > ASSET_LIMITS.triangles)
    throw new Error(
      `This asset exceeds the ${ASSET_LIMITS.triangles.toLocaleString()}-triangle budget. Reduce arrays or subdivisions.`,
    );
  return { version: 1, name, tileWidthM, parts };
}

export function createPart(kind: PartKind, id = `part-${crypto.randomUUID()}`): AssetPart {
  const names: Record<PartKind, string> = {
    box: 'Beveled block',
    panel: 'Surface panel',
    cylinder: 'Cylinder',
    ring: 'Through ring',
    wedge: 'Wedge',
  };
  const size: Vec3 = kind === 'panel' ? [1, 0.06, 1] : kind === 'ring' ? [0.5, 0.12, 0.5] : [0.5, 0.5, 0.5];
  return {
    id,
    name: names[kind],
    kind,
    size,
    position: [0, size[1] / 2, 0],
    rotation: [0, 0, 0],
    bevel: kind === 'panel' ? 0.008 : 0.02,
    bevelSegments: 3,
    segments: 32,
    wall: 0.06,
    material: kind === 'panel' || kind === 'box' ? 'surface' : 'steel',
    color: '#8795a3',
    visible: true,
    locked: false,
    repeat: { count: 1, axis: 'x', spacing: 0.6 },
    mirror: 'none',
  };
}

export function createAssetDocument(): AssetDocument {
  return { version: 1, name: 'Untitled assembly', tileWidthM: 1, parts: [createPart('panel', 'base-panel')] };
}

export function serializeAssetProject(document: AssetDocument, recipe: GenerationRecipe): string {
  return `${JSON.stringify({ format: 'greebler-asset', version: 1, document: validateAssetDocument(document), recipe: cloneGenerationRecipe(recipe) }, null, 2)}\n`;
}

export function parseAssetProject(source: string): AssetProject {
  if (new TextEncoder().encode(source).length > ASSET_LIMITS.fileBytes)
    throw new Error('An asset project must be smaller than 1 MiB.');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Invalid asset JSON. Choose a saved Greebler project.');
  }
  if (!record(value) || value.format !== 'greebler-asset' || value.version !== 1 || !isGenerationRecipe(value.recipe))
    throw new Error('Choose a Greebler asset project containing its source material recipe.');
  return { document: validateAssetDocument(value.document), recipe: cloneGenerationRecipe(value.recipe) };
}
