# Greebler

Greebler is a procedural hard-surface material editor. Build repeating service panels and circuit assemblies, inspect their relief under studio or raking light, and export the same material from an artist workstation or a build job. [Open the editor](https://dovvnloading.github.io/Greebler/)

![Service deck and relay board rendered in Blender Cycles, with tiled albedo and matching height, normal and ORM details](docs/materials.webp)

Both swatches were rendered from the included 2048 px recipes. The upper row shows the materials on displaced slabs in Blender Cycles. The lower row shows the albedo repeated across tile boundaries and corresponding map details. [Service deck recipe](examples/service-deck.json) · [Relay board recipe](examples/relay-board.json)

## Author a material

1. Choose a material preset or edit the default Tech material. Large Panels, Medium Details and Small Greebles control the population of the assembly. The main seed sets the layout. Open **Variation seeds** to change the fitted components or the machining finish independently.
2. Adjust the palette, gap size, edge wear, normal strength and occlusion. Undo and redo are available from the toolbar or with Ctrl/⌘ Z and Ctrl/⌘ Shift Z. The editor restores the last accepted recipe on reload. **Save recipe** writes a portable JSON file.
3. Inspect the seven channels individually. **2×2** shows joins across neighboring tiles. **1:1** shows the completed bake at native resolution. Use the 3D view for shape, raking light, exaggerated displacement and turntable inspection.
4. Edits generate a preview up to 512 px. Choose a resolution and press **Bake** for a full-size material. Large bakes retain a smaller GPU preview. **Export maps** shows the dimensions and recipe ID of the last completed result. Canceling or failing a bake preserves that result.
5. Choose an export target and download the ZIP. Individual PNGs are also available. Version 1 recipes keep their original five maps and recipe IDs. Their package includes derived occlusion and ORM, and the glTF swatch leaves the legacy gradient normal unbound.

## Material data and import

| Source PNG | Encoding | Use |
| --- | --- | --- |
| Albedo | 8-bit RGB, sRGB | Base color |
| Normal | 8-bit RGB, linear | Tangent-space +Y from periodic height derivatives |
| Height | 16-bit grayscale, linear | Relative relief, black low and white high |
| Roughness | 8-bit grayscale, linear | Perceptual roughness |
| Metalness | 8-bit grayscale, linear | Metallic factor |
| AO | 8-bit grayscale, linear | Height-field occlusion sampled at two radii |
| ORM | 8-bit RGB, linear | Red occlusion, green roughness, blue metallic |

The table describes Studio v2. Height includes sub-8-bit machining relief. At unit normal strength the full displacement range corresponds to 9.765625 mm for a one-meter tile. Occlusion estimates local relief within the repeating tile. Lighting and shadows from surrounding scene geometry belong to the target renderer.

| Package target | What to import |
| --- | --- |
| glTF 2.0 | Extract the archive and open `material.gltf` alongside `maps/`. It binds base color, tangent-space normals and packed metallic/roughness/occlusion on a UV swatch. Height is supplied separately. |
| Unreal Engine | Use the included DirectX normal with green flip disabled. Import ORM as Masks with sRGB disabled. Wire red to Ambient Occlusion, green to Roughness and blue to Metallic. |
| Unity HDRP | Assign base color, the +Y normal and the HDRP Mask Map to an HDRP/Lit material. Mask RGBA carries metallic, occlusion, full detail coverage and inverse roughness. Preserve the input alpha and use linear sampling. |

Every ZIP includes the source PNGs, a canonical recipe and a manifest recording pixel format, bit depth, channel bindings, relief scale and recipe ID. The engine-specific packages also include the converted texture and import instructions. [Khronos glTF material reference](https://github.com/KhronosGroup/glTF/tree/main/specification/2.0#materials) · [Unreal texture masks](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-texture-masks-in-unreal-engine) · [Unity HDRP mask maps](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Mask-Map-and-Detail-Map.html)

## Bake from the command line

Use Node.js 24, npm 11 or newer, and the pinned Playwright Chromium. The CLI runs the same renderer as the editor through a local loopback server. A batch validates every input and output name before starting. Completed files are published individually, so earlier bakes survive a later failure.

```bash
npm ci
npx playwright install chromium
npm run bake -- --out bakes examples/service-deck.json examples/relay-board.json
npm run bake -- --target unity-hdrp --metrics --out bakes examples/relay-board.json
npm run bake -- --target unreal --out bakes examples/service-deck.json
```

Use `--force` to replace existing outputs. Set `GREEBLER_CHROMIUM_EXECUTABLE` to use a locally installed Chromium. For repeatable pixel comparisons across machines, pin the browser and raster environment alongside the recipe. `--metrics` reports bake time, the longest gap in a 16 ms browser timer during the bake, package time, ZIP bytes and total time through disk write.

## Build and verify

```bash
npm run dev
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:browser
npm run build
```

The development server runs on port 3000. GitHub Actions validates pull requests and builds the Pages deployment on changes to `main`. Browser tests exercise worker cancellation, error recovery, GPU preview, cached edit equivalence, actual package downloads and Khronos validation with the exported textures. Unit tests cover recipe compatibility, tile topology, PNG encoding, real 16-bit relief and packed-channel agreement.
