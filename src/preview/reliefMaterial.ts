import * as THREE from 'three';
import { RELIEF_RANGE_PER_TILE } from '../engine/relief';
import type { SwatchTextures } from './swatchTextures';

export type Shading = 'material' | 'clay' | 'height';

const heightUniforms = /* glsl */ `
uniform sampler2D swatchHeight;
uniform vec2 heightWeights;
uniform float reliefRange;
uniform float meshLod;
attribute float reliefWeight;
attribute vec2 uvWorldSize;
`;
const displacedVertex = /* glsl */ `
float meshHeight = dot(textureLod(swatchHeight, uv, meshLod).rg, heightWeights);
transformed += normalize(normal) * meshHeight * reliefRange * reliefWeight;
`;
const varyings = /* glsl */ `
varying vec4 vRelief; // Interpolated mesh height, displacement weight, world span of the two UV axes
`;
const fragment = /* glsl */ `
uniform sampler2D swatchHeight;
uniform vec2 heightWeights;
uniform float reliefRange;
uniform float tileWidth;
uniform float inspectGain;
uniform float texelSize;
uniform int shadingMode;
uniform bool bakedNormals;
uniform bool fastMotion;
float field(vec2 uv, vec2 dx, vec2 dy) {
  return dot(textureGrad(swatchHeight, uv, dx, dy).rg, heightWeights);
}
// Intersect the viewing ray with the height field relative to the already displaced
// triangle. The same hit UV drives all material channels, including the local shadow.
vec2 intersectRelief(vec2 uv, vec2 dx, vec2 dy, vec3 eye, vec2 metric) {
  if (fastMotion) return uv;
  vec2 travel = eye.xy / max(eye.z, 0.18) * metric;
  float pixels = length(travel) / max(texelSize, max(length(dx), length(dy)));
  if (pixels < 0.65) return uv;
  float layers = clamp(ceil(pixels * 0.75), 6.0, 28.0);
  float stepZ = 1.0 / layers;
  vec2 stepUv = travel * stepZ;
  vec2 hit = uv + travel * (1.0 - vRelief.x);
  float z = 1.0;
  float above = z - field(hit, dx, dy);
  for (int i = 0; i < 28; i++) {
    vec2 nextUv = hit - stepUv;
    z -= stepZ;
    float below = z - field(nextUv, dx, dy);
    if (below <= 0.0) return mix(hit, nextUv, clamp(above / max(above - below, 0.00001), 0.0, 1.0));
    hit = nextUv; above = below;
  }
  return hit;
}
float heightVisibility(vec2 uv, float h, vec3 lightTS, vec2 metric, vec2 dx, vec2 dy) {
  if (fastMotion || lightTS.z <= 0.02 || vRelief.y < 0.01) return 1.0;
  vec2 travel = lightTS.xy / max(lightTS.z, 0.12) * metric;
  float obstruction = 0.0;
  // Start near the surface to retain narrow recesses, then sample farther toward the light.
  for (int i = 1; i <= 8; i++) {
    float t = float(i) / 8.0;
    float rise = max(0.03, 1.0 - h) * t * t;
    float blocker = field(uv + travel * rise, dx, dy) - h - rise;
    obstruction = max(obstruction, smoothstep(0.018, 0.07 + 0.12 * rise, blocker));
  }
  return 1.0 - 0.83 * obstruction;
}
`;

export function createReliefMaterial(textures: SwatchTextures, tileWidth: number) {
  const uniforms = {
    swatchHeight: { value: textures.height },
    heightWeights: {
      value: textures.packedHeight ? new THREE.Vector2(256 / 257, 1 / 257) : new THREE.Vector2(1, 0),
    },
    tileWidth: { value: tileWidth },
    reliefRange: { value: tileWidth * RELIEF_RANGE_PER_TILE },
    inspectGain: { value: 1 },
    meshLod: { value: 0 },
    texelSize: { value: 1 / textures.size },
    shadingMode: { value: 0 },
    bakedNormals: { value: textures.packedHeight },
    fastMotion: { value: false },
  };
  const material = new THREE.MeshStandardMaterial({
    map: textures.albedo,
    normalMap: textures.normal,
    roughnessMap: textures.orm,
    metalnessMap: textures.orm,
    aoMap: textures.orm,
    roughness: 1,
    metalness: 1,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      heightUniforms +
      varyings +
      shader.vertexShader.replace(
        '#include <displacementmap_vertex>',
        `${displacedVertex}\nvRelief = vec4(meshHeight, reliefWeight, uvWorldSize);`,
      );
    shader.fragmentShader =
      varyings +
      shader.fragmentShader
        .replace('void main() {', `${fragment}\nvoid main() {`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
        vec2 dx = dFdx(vMapUv), dy = dFdy(vMapUv);
        mat3 surfaceBasis = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
        vec2 span = max(vRelief.zw, vec2(0.0001));
        vec2 metric = vec2(reliefRange * vRelief.y) / span;
        vec2 hitUv = intersectRelief(vMapUv, dx, dy, transpose(surfaceBasis) * normalize(vViewPosition), metric);
        vec3 swatchORM = textureGrad(roughnessMap, hitUv, dx, dy).rgb;
        float hitHeight = field(hitUv, dx, dy);
        diffuseColor.rgb *= shadingMode == 1 ? vec3(0.34) : textureGrad(map, hitUv, dx, dy).rgb;
      `,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = shadingMode == 1 ? 0.48 : swatchORM.g;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = shadingMode == 1 ? 0.0 : swatchORM.b;')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
        vec3 mapN = textureGrad(normalMap, hitUv, dx, dy).xyz * 2.0 - 1.0;
        if (!bakedNormals) {
          vec2 e = vec2(texelSize, 0.0);
          vec2 slope = vec2(field(hitUv - e.xy, dx, dy) - field(hitUv + e.xy, dx, dy),
                            field(hitUv - e.yx, dx, dy) - field(hitUv + e.yx, dx, dy));
          mapN = vec3(slope * reliefRange / (2.0 * texelSize * inspectGain * tileWidth), 1.0);
        }
        // Baked normals are authored on a square tile. Correct its physical UV metric
        // on curved meshes and scale the slope with the displaced silhouette.
        mapN.xy *= inspectGain * vRelief.y * tileWidth / span;
        // The sealed rim bends even under constant height. For displacement H*W
        // its missing slope is H*grad(W), expressed in the original UV frame.
        vec2 dw = vec2(dFdx(vRelief.y), dFdy(vRelief.y));
        float det = dx.x * dy.y - dx.y * dy.x;
        if (abs(det) > 1e-15) {
          vec2 gradWeight = vec2(dw.x * dy.y - dw.y * dx.y, dx.x * dw.y - dy.x * dw.x) / det;
          mapN.xy -= mapN.z * reliefRange * hitHeight * gradWeight / span;
        }
        normal = normalize(tbn * normalize(mapN));
      `,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `
        #include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float visibility = heightVisibility(hitUv, hitHeight, transpose(surfaceBasis) * directionalLights[0].direction, metric, dx, dy);
          reflectedLight.directDiffuse *= visibility;
          reflectedLight.directSpecular *= visibility;
        #endif
      `,
        )
        .replace(
          '#include <aomap_fragment>',
          THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'swatchORM.r'),
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
        if (shadingMode == 2) gl_FragColor = vec4(vec3(hitHeight), 1.0);`,
        );
  };
  // The light's depth pass sees the same vertices as the camera, even at 6× inspection gain.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      heightUniforms + shader.vertexShader.replace('#include <displacementmap_vertex>', displacedVertex);
  };
  return {
    material,
    depth,
    update(shading: Shading, gain: number, gridSegments: number, fastMotion: boolean) {
      uniforms.meshLod.value = Math.max(0, Math.log2(textures.size / gridSegments));
      uniforms.fastMotion.value = fastMotion;
      uniforms.inspectGain.value = gain;
      uniforms.reliefRange.value = gain * tileWidth * RELIEF_RANGE_PER_TILE;
      uniforms.shadingMode.value = shading === 'clay' ? 1 : shading === 'height' ? 2 : 0;
    },
    dispose() {
      material.dispose();
      depth.dispose();
    },
  };
}
