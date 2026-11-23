import { RELIEF_RANGE_PER_TILE } from '../engine/relief.ts';
import type { MapChannel } from './materialMaps.ts';

const materialPath = '/Greebler/Material';

function texture(
  name: string,
  map: MapChannel,
  outputs: readonly ('r' | 'g' | 'b' | 'rgb')[],
  fallback: string,
  transform = '',
) {
  return `        def Shader "${name}"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @./maps/${map}.png@
            token inputs:sourceColorSpace = "${map === 'albedo' ? 'sRGB' : 'raw'}"
            float2 inputs:st.connect = <${materialPath}/UV.outputs:result>
            token inputs:wrapS = "repeat"
            token inputs:wrapT = "repeat"
            float4 inputs:fallback = ${fallback}${transform}
${outputs.map((out) => `            ${out === 'rgb' ? 'float3' : 'float'} outputs:${out}`).join('\n')}
        }`;
}

/** The default variant works in real-time delegates. Displacing renderers can
 * evaluate the source height instead of applying its baked slopes a second time. */
export function usdSwatch(recipeId: string, specularIntensity = 1) {
  // Preview Surface derives dielectric reflectance from IOR in metallic mode.
  const sqrtF0 = Math.sqrt(0.04 * specularIntensity);
  const ior = (1 + sqrtF0) / (1 - sqrtF0);
  const normalTransform = `
            float4 inputs:scale = (2, 2, 2, 1)
            float4 inputs:bias = (-1, -1, -1, 0)`;
  const heightTransform = `
            float4 inputs:scale = (${RELIEF_RANGE_PER_TILE}, 1, 1, 1)
            float4 inputs:bias = (${-0.5 * RELIEF_RANGE_PER_TILE}, 0, 0, 0)`;
  return `#usda 1.0
(
    defaultPrim = "Greebler"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Greebler" (
    displayName = "${recipeId}"
)
{
    def Mesh "Swatch" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        rel material:binding = <${materialPath}>
        uniform bool doubleSided = true
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points = [(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (1, 1), (0, 1)] (
            interpolation = "vertex"
        )
        uniform token subdivisionScheme = "bilinear"
    }

    def Material "Material" (
        prepend variantSets = "reliefMode"
        variants = {
            string reliefMode = "normal"
        }
    )
    {
        token outputs:surface.connect = <${materialPath}/Surface.outputs:surface>

        def Shader "Surface"
        {
            uniform token info:id = "UsdPreviewSurface"
            int inputs:useSpecularWorkflow = 0
            float inputs:ior = ${ior}
            color3f inputs:diffuseColor.connect = <${materialPath}/Albedo.outputs:rgb>
            float inputs:occlusion.connect = <${materialPath}/ORM.outputs:r>
            float inputs:roughness.connect = <${materialPath}/ORM.outputs:g>
            float inputs:metallic.connect = <${materialPath}/ORM.outputs:b>
            token outputs:surface
            token outputs:displacement
        }

        def Shader "UV"
        {
            uniform token info:id = "UsdPrimvarReader_float2"
            string inputs:varname = "st"
            float2 outputs:result
        }

${texture('Albedo', 'albedo', ['rgb'], '(0.18, 0.18, 0.18, 1)')}

${texture('ORM', 'orm', ['r', 'g', 'b'], '(1, 0.5, 0, 1)')}

${texture('Normal', 'normal', ['rgb'], '(0.5, 0.5, 1, 1)', normalTransform)}

${texture('Height', 'height', ['r'], '(0.5, 0.5, 0.5, 1)', heightTransform)}

        variantSet "reliefMode" = {
            "normal" {
                over "Surface"
                {
                    normal3f inputs:normal.connect = <${materialPath}/Normal.outputs:rgb>
                }
            }
            "displacement" {
                token outputs:displacement.connect = <${materialPath}/Surface.outputs:displacement>

                over "Surface"
                {
                    float inputs:displacement.connect = <${materialPath}/Height.outputs:r>
                }
            }
        }
    }
}
`;
}

export const usdImportGuide = `# OpenUSD material

1. Extract the ZIP and open \`material.usda\` in a USD-capable application. The default prim contains a one-meter square and its bound UsdPreviewSurface material. Keep the \`maps\` directory beside the layer so the relative asset paths resolve.
2. To apply the material to another mesh, reference \`/Greebler/Material\` and bind it to the mesh. Supply a UV primvar named \`st\`. Each UV unit repeats one tile. Albedo uses sRGB. The normal, packed ORM and height readers use raw values.
3. The material's \`reliefMode\` variant defaults to \`normal\`, which reads the baked +Y tangent-space normal. Select \`displacement\` in a renderer with true displacement and enable tessellation or dicing. This variant reads the 16-bit height and displaces around mid-gray. On the supplied swatch, the full range spans ${1000 * RELIEF_RANGE_PER_TILE} mm. Changing normal strength in Greebler affects the normal variant. For a different physical tile width or stage unit, adjust the red scale and bias on the Height texture to preserve the relief ratio and midpoint.

The shader uses the metallic workflow. An authored dielectric specular level maps to IOR at normal incidence. Render delegates determine support for displacement and occlusion.

[OpenUSD Preview Surface specification](https://openusd.org/release/spec_usdpreviewsurface.html)
`;
