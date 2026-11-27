# Production pipeline contract

Greebler is a procedural hard-surface assembly and material authoring tool. Its portable source is the editable project; its delivery files are geometry and PBR maps. The [studio roadmap](studio-roadmap.md) describes the product direction. This document defines what an artist can rely on during a handoff, what still needs downstream validation, and the standards behind those decisions.

## Supported workflows and their boundaries

| Workflow | Output and intended use | Boundary |
| --- | --- | --- |
| Procedural material authoring | Tileable PBR maps, a canonical recipe, and an import manifest; use on UV-mapped geometry in a DCC or engine | A height field represents one height per surface coordinate. It cannot describe overhangs, detached cables, or arbitrary volumetric geometry. |
| Parametric assembly authoring | Named, transformed primitive parts with normals and UVs; export the authored assembly as GLB or OBJ/MTL | Parts are separate solids and may intersect. Their assembly is not automatically a welded, watertight, printable solid. General Boolean modeling and automatic retopology are later work. |
| Authored surface detail | Ordered, editable surface operations combined with the procedural base before map derivation | Surface cuts are height operations. They do not cut through an assembly's mesh or change its silhouette. |
| DCC continuation | Import GLB in Blender or another compatible DCC; use OBJ for geometry interchange; keep the project for future revisions | Importers vary in support for PBR extensions, tangent handling, material names, and MTL properties. Inspect the imported asset before integrating it into a production library. |
| Game-engine material delivery | Unreal and Unity HDRP texture packages with target-specific maps and import instructions | A texture profile does not create engine assets, collisions, LODs, lightmap UVs, or custom shaders automatically. |
| Displacement geometry delivery | A uniformly sampled relief mesh in an OBJ/MTL ZIP, with optional closed backing and the original seven maps | This is an approximation of a single height field, with an explicit grid budget. It is independent of the adaptive viewport mesh; no adaptive error bound or undercut support is implied. |

The baseline material pipeline already exports glTF and OpenUSD material swatches, supports a Blender material importer, and runs batch material bakes. These swatches are material examples; the assembly export is the actual authored model. A successful file download or structural validator result establishes file correctness, not complete visual parity in every target renderer.

## Geometry, dimensions, and UVs

### Units and orientation

Model dimensions are authored in meters. Keep small detail values explicit: a 0.002 m bevel is 2 mm. Standard glTF geometry uses meters and a right-handed coordinate system with +Y up. Preserve the exporter's declared orientation and dimensions in the handoff; do not apply an additional unit conversion simply because a target application's viewport displays different units.

Unreal defaults to centimeters, while Unity's physics and lighting conventions expect one meter per world unit. Import settings or a deliberate conversion must bridge those conventions. For OBJ, which does not provide a reliable standard unit declaration, the accompanying manifest and import notes are part of the asset contract. [glTF coordinate system and units][gltf] · [Unreal units][unreal-units] · [Unity model import settings][unity-model]

### Topology and shading

The preview and export must use the same parametric geometry builders. Exports should retain named parts, exact transforms, explicitly triangulated surfaces, finite positions, normalized normals, and UVs. Report the resulting triangle count rather than deriving a count from the UI alone.

Validate each closed primitive independently from the full assembly. Separate overlapping parts do not prove a single manifold surface. Reject invalid imported dimensions, duplicate identifiers, excessive part/repetition counts, and geometry budgets before allocating large buffers. Check degenerate triangles, winding, bounds, tangent orthogonality where tangents are present, and positional edge incidence.

The exported UVs support applying the generated repeating material. They are not a packed unique-UV atlas or a dedicated lightmap channel. If the next stage is unique-texture painting or high-to-low baking, unwrap and pack in the DCC, preserve the triangulation used by the bake, and provide suitable island padding. Unreal's static-mesh pipeline explicitly supports multiple UV sets and recommends controlling triangulation before import. [Epic static-mesh pipeline][unreal-mesh] · [Blender UV mapping][blender-uv]

### Tangent-space normal maps

The normal map convention and tangent basis must agree between baking and rendering. glTF defines tangent-space normals in linear RGB and recommends MikkTSpace when an implementation computes missing tangents. DirectX and OpenGL normal maps have opposite Y directions; converting between them requires inverting the green channel. A normal-map image alone cannot compensate for a changed tangent basis or different triangulation. [glTF materials and tangents][gltf] · [Adobe normal conventions][normal-conventions]

Do not apply the same relief twice. The existing height-derived normal describes the complete height-field slope. A genuinely displaced mesh already carries that slope in its geometry normals. Such an export must either omit the full-height normal map or compute a residual normal relative to the exported tangent frame. The current parametric assembly geometry is not a mesh of the texture height field; its generated material detail remains normal-mapped surface detail.

### Relief mesh delivery

In the Surface workspace, open **Export maps → Relief mesh** to turn a completed Studio v2 height field into geometry. This is separate from the Model workspace's parametric assembly exporter.

| Setting or output | Current behavior |
| --- | --- |
| Format | OBJ/MTL ZIP with `relief.obj`, `relief.mtl`, `recipe.json`, `manifest.json`, `IMPORT.md`, and all seven original PNGs in `maps/` |
| Sampling grid | 32, 64, 128, or 256 segments per tile edge; uniformly spaced vertices, periodic bilinear height sampling at texel-centered coordinates |
| Source precision | Genuine 16-bit height; sources larger than 2048² are area-filtered as complete 16-bit samples to at most 2048² for geometry sampling |
| Original maps | Retained at their completed bake resolution and precision; sampling reduction does not replace source PNGs in the package |
| Physical tile width | 0.01–100 m |
| Relief range | 0–10,000 mm from full black to full white, centered on height 0.5 |
| Backing | Zero produces an open surface. A positive backing of at least 0.001 mm extends below the lowest sampled top vertex; the exporter rejects thickness lost to numeric precision. |
| Normals | Periodic top geometry normals; hard side and bottom normals. The material does not bind the full-height normal or height again. |
| Maximum grid cost | At 256 segments: 131,072 top triangles; 134,144 total with closed backing |
| Manifest | Source and sampling resolutions, sampling reduction, physical settings, bounds, sampled top-height range, triangle counts, and the lower-left OBJ UV convention |

Use this mesh as an inspectable relief asset or as a high-poly source for a downstream bake. A coarse grid can miss narrow grooves or soften a steep step even if the accompanying source map contains that detail. Increase the grid density when necessary and inspect the geometry under raking light. The adaptive viewport is a different tessellation method, so its edge layout and triangle count are not an export prediction.

Closed backing makes this tile topologically closed; it does not turn height-field authoring into arbitrary solid modeling. Imported engine normal-map behavior, low-poly bake quality, and printability of any final combined assembly still require the relevant downstream checks.

## Texture contract

The following table describes Studio v2 materials. Legacy v1 recipes remain loadable with their original output: their height is eight-bit, and their gradient image is retained as a source map rather than bound as a standard tangent-space normal in asset exports.

| Source map | Storage | Interpretation |
| --- | --- | --- |
| Albedo | 8-bit RGB PNG | sRGB base color, without view lighting baked in |
| Normal | 8-bit RGB PNG | Linear tangent-space +Y source; target conversion may supply −Y |
| Height | 16-bit grayscale PNG | Linear relative relief, black low and white high; use the manifest's displacement scale and midpoint |
| Roughness | 8-bit grayscale PNG | Linear perceptual roughness |
| Metalness | 8-bit grayscale PNG | Linear metallic factor |
| AO | 8-bit grayscale PNG | Linear occlusion estimated from the height field; not a ray-traced bake of the full assembly |
| ORM | 8-bit RGB PNG | R = occlusion, G = roughness, B = metalness; linear |

Height and normal maps describe the same completed evaluated surface. Authored surface operations must run before derivative normals and height-field AO are calculated. Packed-channel values must exactly match their source scalar maps. The unlayered generator path retains backward-compatible output.

### Displacement precision and physical meaning

Preserve the original 16-bit height data through export. Do not recover height from an 8-bit preview or scale an 8-bit image into a 16-bit container. Blender recommends higher-precision displacement maps because eight-bit data can reveal stepping; it also requires non-color sampling for height and normal data. The current integer PNG height contract is distinct from a 16- or 32-bit floating-point EXR workflow. [Blender displacement][blender-displacement] · [Blender image color spaces][blender-images]

For the established one-meter material tile at unit normal strength, the existing full relief range is 9.765625 mm. That is a material-source convention, not the thickness of an assembly part. Export manifests and the Blender importer preserve the relief mapping. Changing a model's dimensions does not make its faces physically displaced by that amount. Use the source recipe and manifest to reproduce the material and choose a downstream displacement setup deliberately.

### Target profiles

| Target | Normal convention | Packed data and import requirements |
| --- | --- | --- |
| glTF material swatch / GLB material | +Y tangent space | Roughness from G and metallic from B. The same texture can supply occlusion from R. Base color is sRGB; the packed texture is linear. Height is not a standard core glTF displacement material input. |
| Unreal Engine texture package | Converted −Y / DirectX | ORM: R AO, G roughness, B metallic. Use Masks compression with sRGB disabled. Do not also flip green when using the already converted normal. |
| Unity HDRP texture package | +Y | Mask RGBA = metallic, occlusion, full detail coverage, smoothness. Smoothness is `1 − roughness`. Preserve alpha; sample the mask as linear data. |
| Blender material package/importer | +Y, Non-Color | Base color in sRGB; normal, height, roughness, metallic, and AO in Non-Color. Scale displacement to the intended physical tile width. |
| OpenUSD material swatch | As declared by the supplied shading network | Default normal and optional displacement variants are separate choices. A render delegate must support the selected material and displacement behavior. |

The glTF spec explicitly defines the metallic/roughness channel layout and transfer functions. Unity HDRP's mask map uses its own RGBA layout. Unreal's masks and normal-map compression modes are distinct from ordinary sRGB color textures. [glTF materials][gltf] · [Unity HDRP masks][hdrp-mask] · [Unreal texture compression][unreal-compression]

OBJ/MTL is useful as a geometry bridge, but its material import behavior is less consistent than glTF's defined PBR material model. Keep the PBR source maps and manifest with the OBJ package. Reconnect shader inputs in the target DCC when its MTL importer does not support the supplied properties.

## Tiling, local edits, and material identity

Use a consistent periodic coordinate system for generator detail, authored operations, normals, and height-field AO. A shape crossing an edge must continue across the opposite edge, not merely receive a post-process seam correction. A mesh sampled at UV 0 and UV 1 must evaluate the same periodic field; opposite texel centers are not interchangeable with identical boundary coordinates.

Preserve independent layout, detail, and finish seeds. Stable authored-operation identifiers, canonical serialization, undo/redo, and portable source are part of the creative workflow. A completed bake must retain its own recipe identity and resolution. Exporting an earlier completed bake should identify that source; it must not silently combine its maps with the current unbaked document's metadata.

Use the 2×2 map view to examine transitions and the native texel probe to inspect actual stored values. A seam-free albedo does not establish seam-free normals or geometry: inspect height, normal derivatives, masks, and shading under raking light as well.

## Handoff checks

### Material delivery

1. Save the source recipe or complete studio project and give it a useful name.
2. Choose the final bake size and finish the bake. Confirm the export identifies that completed recipe and resolution.
3. Inspect the 2×2 height/normal views and sample a known asymmetric feature to confirm orientation.
4. Export the intended engine package. Keep maps, manifest, source, and import notes together.
5. In the target application, confirm color-space settings, normal convention, packed channels, and displacement midpoint/range.

### Assembly delivery

1. Name the assembly and its meaningful parts. Check dimensions, part placement, repeated geometry, and the visible silhouette.
2. Inspect wireframe and triangle count. A repeated high-segment part multiplies its cost across the assembly.
3. Save the portable project, then export GLB or OBJ/MTL using a completed material source.
4. Reimport in the target DCC. Check units, bounds, pivot, orientation, UV repetition, material assignments, and hard-edge shading.
5. Add downstream requirements such as unique UVs, lightmap UVs, collision, LODs, welds, or a high-to-low bake where the project needs them.

For relief delivery, choose the grid, tile width, full relief range, and backing in the separate **Relief mesh** section. Compare the reported sampling resolution with the original map resolution, inspect the resulting triangulation in the receiving DCC, and retain the manifest's midpoint and physical range.

This procedure is deliberately testable. An automated Khronos validation pass covers structural glTF validity; a DCC render catches differences in importer interpretation and shading. Neither replaces the other.

## Validation and evidence

| Gate | What it establishes | What it does not establish |
| --- | --- | --- |
| Recipe/project unit tests | Canonical identity, validation, compatibility, and round trips | Browser recovery or target-DCC behavior |
| Geometry unit tests | Primitive topology, bounds, winding, transforms, UVs, budgets, finite data | An assembly being a single printable solid |
| Surface tests | Ordered composition, periodicity, unchanged legacy results, coherent PBR outputs | Arbitrary-mesh baking or physically exact occlusion |
| Browser workflow tests | Real editing, project save/open, dialogs, downloads, error recovery | Every hardware driver or screen size |
| Khronos glTF validator | File structure, accessor/material correctness, supported extension declarations | Visual parity or engine-specific asset setup |
| Actual DCC/engine import | Scale, texture orientation, shading, and workflow compatibility in the tested version | Every future version and all studio conventions |
| Recorded performance run | Timing, memory, and responsiveness for a declared scene and machine | Universal interactive or GPU performance |

The existing repository documents material-package checks including Blender 4.3.2 import/reopen and OpenUSD validation. Those results apply to the tested material pipeline. New assembly exports need their own application import evidence; the older swatch checks must not be presented as proof for the new model workflow. See [material authoring and delivery](material-authoring.md) and the repository test suite for the actual checks. When a local environment cannot run browser or DCC tests, report that gap and use the corresponding CI or target-application gate before claiming validation.

## Planned capabilities, not current guarantees

- **General Boolean modeling:** a robust manifold kernel, topology handling, surface identification, and reliable post-Boolean bevels need separate implementation and tests. Manifold provides a WASM-capable solid mesh kernel but requires valid inputs and does not automatically solve UVs or material transfer. [Manifold documentation][manifold]
- **Arbitrary high-to-low mesh baking:** production baking needs cage/ray-distance control, skew correction, tangent agreement, island padding, and bake groups. Height-to-normal generation is not this workflow. [Marmoset projection tools][bake-projection] · [Marmoset baking attributes][bake-attributes]
- **Adaptive relief mesh export:** the current delivery mesh uses a uniform grid. Use the adaptive preview research as a starting point for a later exporter, then prove error bounds, seam closure, cancellation, material alignment, and the residual-normal strategy.
- **Trim sheets and decal atlases:** require explicit rectangular/region layouts, padding, masks, and downstream metadata; repeating a material on a primitive is not an atlas workflow.
- **UDIM authoring:** requires a tile-aware document and export model. Unreal uses the UDIM filename convention to group tiles into a virtual texture; this differs from exporting one repeating tile. [Epic UDIM documentation][udim]
- **Engine asset automation:** collisions, LODs, lightmap UVs, importer scripts, and project-specific naming need actual engine integration tests.

## Primary references

These are technical references for the decisions above. They are not claims that Greebler implements every capability described by the source.

[gltf]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
[unreal-units]: https://dev.epicgames.com/documentation/en-us/unreal-engine/units-of-measurement-in-unreal-engine
[unity-model]: https://docs.unity.com/en-us/engine/6000.0/manual/assets-and-media/asset-types/models/importing/fbximporter-model
[unreal-mesh]: https://dev.epicgames.com/documentation/en-us/unreal-engine/fbx-static-mesh-pipeline-in-unreal-engine
[blender-uv]: https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/uv.html
[normal-conventions]: https://experienceleague.adobe.com/en/docs/substance-3d/bakers/common-questions/what-is-the-difference-between-the-opengl-and-directx-normal-format
[blender-displacement]: https://docs.blender.org/manual/en/latest/render/materials/components/displacement.html
[blender-images]: https://docs.blender.org/manual/en/latest/editors/image/image_settings.html
[hdrp-mask]: https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Mask-Map-and-Detail-Map.html
[unreal-compression]: https://dev.epicgames.com/documentation/unreal-engine/texture-compression-settings?application_version=4.27
[manifold]: https://manifoldcad.org/docs/jsapi/modules/manifold.html
[bake-projection]: https://docs.marmoset.co/docs/projection-tools/
[bake-attributes]: https://docs.marmoset.co/docs/baking-attributes/
[udim]: https://dev.epicgames.com/documentation/unreal-engine/streaming-virtual-texturing-in-unreal-engine

- [Khronos glTF 2.0 specification][gltf]
- [Epic: units][unreal-units], [static mesh pipeline][unreal-mesh], [texture compression][unreal-compression], [virtual textures and UDIM][udim]
- [Unity: model import settings][unity-model], [HDRP mask maps][hdrp-mask]
- [Blender: displacement][blender-displacement], [image color spaces][blender-images], [UV mapping][blender-uv]
- [Adobe: DirectX and OpenGL normal conventions][normal-conventions]
- [Marmoset: projection controls][bake-projection], [baking attributes][bake-attributes]
- [Manifold WASM API][manifold]
