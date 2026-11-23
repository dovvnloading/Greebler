import { RELIEF_RANGE_PER_TILE } from '../engine/relief.ts';
import type { ExportTarget } from './materialMaps.ts';

export function engineProfile(target: Exclude<ExportTarget, 'gltf'>, size: number) {
  if (target === 'unreal') {
    return {
      source: 'normal' as const,
      derivedFile: 'unreal/normal-dx.png',
      importSettings: {
        shader: 'Default Lit',
        blendMode: 'Opaque',
        tangentSpaceNormal: true,
        addressX: 'Wrap',
        addressY: 'Wrap',
        textures: {
          baseColor: {
            file: 'maps/albedo.png',
            sRGB: true,
            compressionSettings: 'Default',
            inputs: { RGB: 'Base Color' },
          },
          normal: {
            file: 'unreal/normal-dx.png',
            sRGB: false,
            compressionSettings: 'Normalmap',
            normalEncoding: 'tangent-space-directx-negative-y',
            flipGreenChannel: false,
            inputs: { RGB: 'Normal' },
          },
          masks: {
            file: 'maps/orm.png',
            sRGB: false,
            compressionSettings: 'Masks',
            inputs: { R: 'Ambient Occlusion', G: 'Roughness', B: 'Metallic' },
          },
        },
      },
      guide: `# Unreal Engine material import

1. Import \`maps/albedo.png\`, \`unreal/normal-dx.png\` and \`maps/orm.png\` into the Content Browser.
2. Use Default compression with sRGB enabled for albedo. Use Normalmap compression for the DirectX normal and leave Flip Green Channel off. Use Masks compression with sRGB disabled for ORM.
3. Create an opaque Default Lit material with Tangent Space Normal enabled. Connect albedo RGB to Base Color and the DirectX normal RGB to Normal. Connect ORM red to Ambient Occlusion, green to Roughness and blue to Metallic. Use wrapping on both axes.
4. The optional 16-bit \`maps/height.png\` contains relative relief. At unit normal strength, the full height range spans ${RELIEF_RANGE_PER_TILE * 1000} mm on a one-meter tile. Scale displacement to your mesh and art direction.

[Texture masks](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-texture-masks-in-unreal-engine) · [Texture Asset Editor](https://dev.epicgames.com/documentation/en-us/unreal-engine/texture-asset-editor-in-unreal-engine)
`,
    };
  }
  const maxTextureSize = Math.max(32, 2 ** Math.ceil(Math.log2(size)));
  return {
    source: 'orm' as const,
    derivedFile: 'unity-hdrp/mask.png',
    importSettings: {
      shader: 'HDRP/Lit',
      materialType: 'Standard',
      surfaceType: 'Opaque',
      normalMapSpace: 'TangentSpace',
      wrapMode: 'Repeat',
      maxTextureSize,
      npotScale: 'None',
      metallicRemap: [0, 1],
      ambientOcclusionRemap: [0, 1],
      smoothnessRemap: [0, 1],
      textures: {
        baseColor: { file: 'maps/albedo.png', textureType: 'Default', sRGB: true, property: '_BaseColorMap' },
        normal: {
          file: 'maps/normal.png',
          textureType: 'NormalMap',
          normalEncoding: 'tangent-space-opengl-positive-y',
          flipGreenChannel: false,
          property: '_NormalMap',
        },
        mask: {
          file: 'unity-hdrp/mask.png',
          textureType: 'Default',
          sRGB: false,
          alphaSource: 'FromInput',
          alphaIsTransparency: false,
          channels: { R: 'metallic', G: 'ambientOcclusion', B: 'detailMask', A: 'perceptualSmoothness' },
          detailMask: 1,
          property: '_MaskMap',
        },
      },
    },
    guide: `# Unity HDRP material import

1. Copy \`maps/albedo.png\`, \`maps/normal.png\` and \`unity-hdrp/mask.png\` into the project's Assets folder. Set Wrap Mode to Repeat. Set Max Size to ${maxTextureSize} and Non Power of 2 to None to retain the bake resolution.
2. Import albedo as Default with sRGB enabled. Import the normal as Normal map with Create from Grayscale and Flip Green Channel off.
3. Import the mask as Default, disable sRGB, select Input Texture Alpha as Alpha Source, and disable Alpha Is Transparency. Retain an RGBA format when applying platform overrides.
4. Create a material using HDRP/Lit, Standard material type and Opaque surface. Assign Base Map, tangent-space Normal Map and Mask Map. Use white for base color and full 0–1 remap ranges for metallic, occlusion and smoothness.

Mask RGBA contains metallic, ambient occlusion, detail coverage and smoothness. Coverage is white throughout so an optional detail texture applies everywhere. Smoothness is the exact 8-bit inverse of roughness. At unit normal strength, the optional 16-bit height map spans ${RELIEF_RANGE_PER_TILE * 1000} mm across its full range on a one-meter tile. Scale displacement independently as needed.

[HDRP mask maps](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Mask-Map-and-Detail-Map.html) · [Normal map settings](https://docs.unity3d.com/6000.0/Documentation/Manual/texture-type-normal-map.html)
`,
  };
}
