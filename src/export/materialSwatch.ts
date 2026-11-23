// A one-metre square with explicit tangent handedness. The glTF normal map
// convention is +Y up; image V increases downwards on this front-facing quad.
function quadBuffer(): string {
  const positions = [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 0],
    [0.5, 0.5, 0],
    [-0.5, 0.5, 0],
  ];
  const uv = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  const bytes = new Uint8Array(204);
  const data = new DataView(bytes.buffer);
  let offset = 0;
  positions.forEach((point, i) => {
    // OpenGL's +green points toward the top of the image, opposite increasing V.
    // cross(+Z, +X) is +Y on this swatch, so tangent.w must be +1.
    for (const value of [...point, 0, 0, 1, 1, 0, 0, 1, ...uv[i]]) {
      data.setFloat32(offset, value, true);
      offset += 4;
    }
  });
  for (const index of [0, 1, 2, 0, 2, 3]) {
    data.setUint16(offset, index, true);
    offset += 2;
  }
  return `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;
}

export function materialSwatch(name: string, standardNormals: boolean) {
  const images = ['maps/albedo.png', 'maps/orm.png'];
  if (standardNormals) images.push('maps/normal.png');
  const accessors = [
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: 4,
      type: 'VEC3',
      min: [-0.5, -0.5, 0],
      max: [0.5, 0.5, 0],
    },
    { bufferView: 0, byteOffset: 12, componentType: 5126, count: 4, type: 'VEC3' },
    { bufferView: 0, byteOffset: 40, componentType: 5126, count: 4, type: 'VEC2' },
    { bufferView: 1, byteOffset: 0, componentType: 5123, count: 6, type: 'SCALAR' },
  ];
  if (standardNormals) accessors.push({ bufferView: 0, byteOffset: 24, componentType: 5126, count: 4, type: 'VEC4' });
  return {
    asset: { version: '2.0', generator: 'Greebler' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, ...(standardNormals ? { TANGENT: 4 } : {}) },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    buffers: [{ uri: quadBuffer(), byteLength: 204 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 192, byteStride: 48, target: 34962 },
      { buffer: 0, byteOffset: 192, byteLength: 12, target: 34963 },
    ],
    accessors,
    images: images.map((uri) => ({ uri })),
    textures: images.map((_, source) => ({ source, sampler: 0 })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    materials: [
      {
        name,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
        occlusionTexture: { index: 1 },
        ...(standardNormals ? { normalTexture: { index: 2 } } : {}),
        doubleSided: true,
      },
    ],
  };
}
