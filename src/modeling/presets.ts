import { type AssetDocument, type AssetPart, createPart, type PartKind, validateAssetDocument } from './project.ts';

function part(id: string, kind: PartKind, overrides: Partial<AssetPart>): AssetPart {
  return { ...createPart(kind, id), ...overrides };
}

function document(name: string, tileWidthM: number, parts: AssetPart[]): AssetDocument {
  return validateAssetDocument({ version: 1, name, tileWidthM, parts });
}

function serviceModule() {
  return document('Service module', 1.2, [
    part('chassis', 'box', { name: 'Main chassis', size: [1.6, 0.62, 1], position: [0, 0.39, 0], bevel: 0.045 }),
    part('base', 'box', {
      name: 'Mounting base',
      size: [1.82, 0.12, 1.18],
      position: [0, 0.06, 0],
      material: 'steel',
      color: '#444d58',
      bevel: 0.025,
    }),
    part('lid', 'panel', {
      name: 'Replaceable top plate',
      size: [1.44, 0.045, 0.84],
      position: [0, 0.72, 0],
      bevel: 0.012,
    }),
    part('rail', 'box', {
      name: 'Protective rails',
      size: [1.72, 0.095, 0.06],
      position: [0, 0.69, 0.5],
      material: 'steel',
      mirror: 'z',
      bevel: 0.015,
    }),
    part('front-insert', 'box', {
      name: 'Front service cover',
      size: [1.18, 0.36, 0.035],
      position: [0, 0.4, 0.514],
      bevel: 0.012,
    }),
    part('corners', 'wedge', {
      name: 'Corner braces',
      size: [0.18, 0.24, 0.16],
      position: [0.76, 0.21, -0.46],
      material: 'paint',
      color: '#d6a94c',
      bevel: 0.008,
      mirror: 'x',
      repeat: { axis: 'z', count: 2, spacing: 0.92 },
    }),
    part('side-port', 'ring', {
      name: 'Coupling collars',
      size: [0.28, 0.08, 0.28],
      position: [0.837, 0.4, -0.24],
      rotation: [0, 0, 90],
      material: 'steel',
      color: '#a2a9af',
      wall: 0.045,
      bevel: 0.012,
      mirror: 'x',
      repeat: { axis: 'z', count: 2, spacing: 0.48 },
    }),
    part('top-fasteners', 'cylinder', {
      name: 'Lid fasteners',
      size: [0.055, 0.028, 0.055],
      position: [0.63, 0.753, -0.34],
      material: 'steel',
      bevel: 0.005,
      segments: 6,
      mirror: 'x',
      repeat: { axis: 'z', count: 2, spacing: 0.68 },
    }),
    part('back-fins', 'box', {
      name: 'Cooling fins',
      size: [0.07, 0.38, 0.11],
      position: [-0.54, 0.4, -0.54],
      material: 'steel',
      color: '#343e49',
      bevel: 0.006,
      repeat: { axis: 'x', count: 10, spacing: 0.12 },
    }),
    part('top-stripe', 'panel', {
      name: 'Identification stripe',
      size: [0.08, 0.005, 0.68],
      position: [0.52, 0.746, 0],
      material: 'paint',
      color: '#dbb95b',
      bevel: 0.001,
    }),
  ]);
}

function reactorCore() {
  return document('Reactor core', 0.8, [
    part('base', 'cylinder', {
      name: 'Octagonal foundation',
      size: [1.2, 0.15, 1.2],
      position: [0, 0.075, 0],
      segments: 8,
      bevel: 0.025,
      material: 'steel',
      color: '#3d4752',
    }),
    part('barrel', 'cylinder', {
      name: 'Central pressure vessel',
      size: [0.7, 1.12, 0.7],
      position: [0, 0.71, 0],
      material: 'surface',
      bevel: 0.045,
    }),
    part('collars', 'ring', {
      name: 'Structural collars',
      size: [0.88, 0.09, 0.88],
      position: [0, 0.3, 0],
      wall: 0.07,
      bevel: 0.013,
      material: 'steel',
      repeat: { axis: 'y', count: 3, spacing: 0.39 },
    }),
    part('cap', 'cylinder', {
      name: 'Top service cap',
      size: [0.86, 0.13, 0.86],
      position: [0, 1.31, 0],
      segments: 12,
      material: 'surface',
      bevel: 0.025,
    }),
    part('top-port', 'ring', {
      name: 'Vent aperture',
      size: [0.37, 0.09, 0.37],
      position: [0, 1.405, 0],
      wall: 0.06,
      bevel: 0.012,
    }),
    part('posts', 'box', {
      name: 'External support posts',
      size: [0.08, 1.05, 0.08],
      position: [-0.42, 0.675, -0.42],
      material: 'paint',
      color: '#e0a247',
      bevel: 0.015,
      mirror: 'x',
      repeat: { axis: 'z', count: 2, spacing: 0.84 },
    }),
    part('feed', 'ring', {
      name: 'Feed conduit',
      size: [0.11, 0.9, 0.11],
      position: [0.49, 0.69, 0],
      wall: 0.018,
      bevel: 0.006,
      color: '#a07047',
      mirror: 'x',
    }),
    part('feet', 'box', {
      name: 'Mounting feet',
      size: [0.24, 0.06, 0.22],
      position: [0.43, 0.03, -0.43],
      material: 'steel',
      bevel: 0.012,
      mirror: 'x',
      repeat: { axis: 'z', count: 2, spacing: 0.86 },
    }),
  ]);
}

function ventArray() {
  return document('Ventilation cassette', 1, [
    part('frame', 'ring', {
      name: 'Cast intake frame',
      size: [1.6, 0.18, 1.05],
      position: [0, 0.6, 0],
      rotation: [90, 0, 0],
      wall: 0.1,
      bevel: 0.025,
      segments: 8,
      color: '#53616c',
    }),
    part('back', 'box', {
      name: 'Recessed backplate',
      size: [1.26, 0.7, 0.055],
      position: [0, 0.6, -0.14],
      bevel: 0.03,
      material: 'surface',
    }),
    part('louvers', 'box', {
      name: 'Tilted louver bank',
      size: [1.26, 0.045, 0.13],
      position: [0, 0.28, 0.01],
      rotation: [28, 0, 0],
      material: 'steel',
      color: '#a0a9ad',
      bevel: 0.008,
      repeat: { axis: 'y', count: 7, spacing: 0.108 },
    }),
    part('spine', 'box', {
      name: 'Central reinforcement',
      size: [0.05, 0.84, 0.055],
      position: [0, 0.6, 0.1],
      material: 'paint',
      color: '#d4b451',
      bevel: 0.009,
    }),
    part('mounts', 'box', {
      name: 'Mounting tabs',
      size: [0.2, 0.25, 0.06],
      position: [0.75, 0.3, -0.04],
      bevel: 0.025,
      material: 'steel',
      mirror: 'x',
      repeat: { axis: 'y', count: 2, spacing: 0.6 },
    }),
    part('bolts', 'ring', {
      name: 'Mounting bores',
      size: [0.07, 0.025, 0.07],
      position: [0.75, 0.3, 0.005],
      rotation: [90, 0, 0],
      segments: 12,
      wall: 0.018,
      bevel: 0.004,
      color: '#b7bec5',
      mirror: 'x',
      repeat: { axis: 'y', count: 2, spacing: 0.6 },
    }),
    part('feet', 'box', {
      name: 'Bench feet',
      size: [0.18, 0.08, 0.35],
      position: [0.58, 0.04, 0],
      material: 'steel',
      bevel: 0.012,
      mirror: 'x',
    }),
  ]);
}

function wallPanel() {
  return document('Modular wall panel', 1, [
    part('wall', 'box', {
      name: 'Structural tile',
      size: [2, 2, 0.16],
      position: [0, 1, 0],
      bevel: 0.035,
      material: 'surface',
    }),
    part('frame-uprights', 'box', {
      name: 'Vertical rails',
      size: [0.1, 2.04, 0.1],
      position: [0.95, 1.02, 0.105],
      mirror: 'x',
      material: 'steel',
      color: '#394653',
      bevel: 0.012,
    }),
    part('frame-horizontal', 'box', {
      name: 'Horizontal rails',
      size: [1.8, 0.1, 0.1],
      position: [0, 0.05, 0.105],
      material: 'steel',
      color: '#394653',
      bevel: 0.012,
      repeat: { axis: 'y', count: 2, spacing: 1.9 },
    }),
    part('bay', 'box', {
      name: 'Access panel',
      size: [1.44, 0.84, 0.06],
      position: [0, 1.32, 0.1],
      material: 'surface',
      bevel: 0.025,
    }),
    part('sill', 'wedge', {
      name: 'Service sill',
      size: [1.55, 0.14, 0.24],
      position: [0, 0.8, 0.15],
      rotation: [0, 0, 180],
      material: 'steel',
      bevel: 0.009,
    }),
    part('lower-ports', 'ring', {
      name: 'Lower service sockets',
      size: [0.24, 0.07, 0.24],
      position: [-0.54, 0.42, 0.13],
      rotation: [90, 0, 0],
      material: 'steel',
      wall: 0.045,
      bevel: 0.01,
      repeat: { axis: 'x', count: 4, spacing: 0.36 },
    }),
    part('fasteners', 'cylinder', {
      name: 'Panel fasteners',
      size: [0.055, 0.035, 0.055],
      position: [0.64, 0.98, 0.148],
      rotation: [90, 0, 0],
      segments: 6,
      bevel: 0.004,
      mirror: 'x',
      repeat: { axis: 'y', count: 2, spacing: 0.68 },
    }),
    part('signal', 'box', {
      name: 'Signal stripe',
      size: [0.055, 0.56, 0.009],
      position: [0.56, 1.34, 0.135],
      material: 'paint',
      color: '#d9aa4d',
      bevel: 0.003,
    }),
  ]);
}

export const assetPresets = [
  {
    id: 'service-module',
    name: 'Service module',
    description: 'Layered chassis, cooling fins and service couplings.',
    create: serviceModule,
  },
  {
    id: 'reactor-core',
    name: 'Reactor core',
    description: 'Pressure vessel, support frame and open pipe connections.',
    create: reactorCore,
  },
  {
    id: 'vent-array',
    name: 'Ventilation cassette',
    description: 'Through-frame, pitched louvers and mounting details.',
    create: ventArray,
  },
  {
    id: 'wall-panel',
    name: 'Modular wall panel',
    description: 'Two-meter wall module with replaceable panels and sockets.',
    create: wallPanel,
  },
] as const;
