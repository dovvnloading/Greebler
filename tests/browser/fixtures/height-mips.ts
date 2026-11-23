import * as THREE from 'three';
import example from '../../../examples/service-deck.json';
import { StripPng } from '../../../src/engine/png';
import { unpackStudioHeight } from '../../../src/preview/heightTexture';
import { loadSwatchTextures } from '../../../src/preview/swatchTextures';
import { getGenerationRecipeId, parseGenerationRecipe } from '../../../src/recipes';

export async function sampleHeightMips(size = 17) {
  const raw = Uint8Array.from({ length: size * size * 2 }, (_, i) => (i * 71 + 39) & 255);
  const png = new StripPng(size, size, 'gray16');
  await png.write(raw, size);
  const height = png.blob();
  const expected = unpackStudioHeight(new Uint8Array(await height.arrayBuffer()));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create fixture image');
  const mask = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // The encoded PNGs all share the asymmetric, top-down height source.
    mask.data[i * 4] = i % size > size * 0.31 && Math.floor(i / size) < size * 0.73 ? 255 : 0;
    mask.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(mask, 0, 0);
  const image = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Missing PNG')))),
  );
  const recipe = parseGenerationRecipe(JSON.stringify({ ...example, params: { ...example.params, resolution: size } }));
  const textures = await loadSwatchTextures(
    {
      recipe,
      blobs: { albedo: image, ao: image, height, metalness: image, normal: image, orm: image, roughness: image },
      urls: { albedo: '', ao: '', height: '', metalness: '', normal: '', orm: '', roughness: '' },
    },
    1,
    new AbortController().signal,
  );
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const shader = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { source: { value: textures.height }, level: { value: 0 }, size: { value: 0 } },
    vertexShader: 'in vec3 position; void main() { gl_Position = vec4(position, 1.0); }',
    fragmentShader:
      'precision highp float; uniform sampler2D source; uniform float level; uniform float size; out vec4 result; void main() { result = vec4(textureLod(source, gl_FragCoord.xy / size, level).rg, 0., 1.); }',
  });
  const scene = new THREE.Scene();
  const plane = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(plane, shader);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const gl = renderer.getContext();
  const camera = new THREE.Camera();
  function sample(source: THREE.Texture, width: number, level = 0) {
    renderer.setSize(width, width, false);
    shader.uniforms.source.value = source;
    shader.uniforms.size.value = width;
    shader.uniforms.level.value = level;
    renderer.render(scene, camera);
    const rgba = new Uint8Array(width * width * 4);
    gl.readPixels(0, 0, width, width, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return rgba;
  }
  try {
    const results = expected.mipmaps.map(({ width, height, data }, level) => {
      const rgba = sample(textures.height, width, level);
      let maxError = 0;
      for (let i = 0; i < width * height; i++) {
        maxError = Math.max(maxError, Math.abs(rgba[4 * i] - data[2 * i]), Math.abs(rgba[4 * i + 1] - data[2 * i + 1]));
      }
      return { width, maxError };
    });
    const registrationErrors = [textures.albedo, textures.normal, textures.orm].map((texture) => {
      const width = expected.width;
      const pixels = sample(texture, width);
      let maxError = 0;
      for (let i = 0; i < width * width; i++) {
        const x = (((i % width) + 0.5) * size) / width - 0.5;
        const y = ((width - 1 - Math.floor(i / width) + 0.5) * size) / width - 0.5;
        // A resized bitmap filters across the mask boundary.
        if (width !== size && (Math.abs(x - size * 0.31) < 5 || Math.abs(y - size * 0.73) < 5)) continue;
        const mask = x > size * 0.31 && y < size * 0.73 ? 255 : 0;
        maxError = Math.max(maxError, Math.abs(pixels[i * 4] - mask));
      }
      return maxError;
    });
    return {
      results,
      registrationErrors,
      error: gl.getError(),
      sizes: [
        textures.size,
        ...[textures.albedo, textures.normal, textures.orm, textures.height].map(
          (t) => (t.image as { width: number }).width,
        ),
      ],
      idMatches: textures.id === getGenerationRecipeId(recipe),
    };
  } finally {
    textures.dispose();
    shader.dispose();
    plane.dispose();
    renderer.dispose();
  }
}
