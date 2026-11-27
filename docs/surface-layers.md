# Surface layers

Surface layers add deliberate art direction to the seeded material. A layer is an editable analytic stamp that can change the 16-bit height field, a local PBR finish, or both. The complete stack is stored in the material recipe and travels through the existing library, undo history, command-line baker, and material packages.

## Authoring

Open **Properties → Surface layers** in Studio v2. Choose **Panel**, **Boss**, **Ring**, **Vents**, or **Rivets** to add a stamp over the procedural base. The top entry in the stack is applied last. Select a layer to edit it; use its eye icon to hide it. The four small actions raise, lower, duplicate, or remove the selected layer. A duplicate moves six percent in X and Y so its placement is immediately visible.

The placement guide shows the latest material beneath analytic outlines. Drag the guide to move the selected stamp. With the guide focused, the arrow keys move one percent of the tile; Shift+arrow moves ten percent. The selected layer remains available through exact numeric controls. Draft numeric and name fields commit on blur or Enter; Escape restores the previous value. Saving or baking with the keyboard commits the focused field first.

### Transform and shape controls

| Control | Meaning |
| --- | --- |
| Position X, Y | Stamp center as a percentage of the tile. X runs left to right and Y runs top to bottom. Zero and 100% identify the same periodic seam. |
| Width, Height | Coverage within one array cell, from 1% to 100%. With a one-by-one array this is the fraction of the full tile. |
| Layer rotation | Clockwise degrees in image coordinates, from −180° to 180°. |
| Edge falloff | Smooth height and material transition measured as a fraction of the smaller half-extent of the stamp. A small sampling filter remains at zero to avoid unstable coverage at texel edges. |
| Layer opacity | Blending strength for both relief and material. Zero is an exact no-op. |
| Tile array | One to eight columns and rows. Copies are evenly spaced across the tile; width and height scale with their cells. The center controls the shared phase of the array. |

The panel uses chamfered corners. The boss is an ellipse. The retaining ring has an open center and a fixed inner radius of 66% of its outer radius. Vents contain seven round-ended slots. Rivets place four circular heads near the corners of the layer's bounding region. Those pattern proportions are currently fixed; placement, size, array, and relief remain editable.

Every shape wraps across the horizontal and vertical tile seams, including rotated shapes and arrays. Copies belonging to one layer are combined with maximum coverage before blending, so crossing a seam does not apply the same height twice.

### Height operations

| Height blend | Result |
| --- | --- |
| Raise / add | Adds the relief amount multiplied by the mask and opacity to the source height. |
| Engrave / subtract | Subtracts that amount from the source height. Vent stamps start with this operation. |
| Set height / replace | Blends toward the selected absolute normalized height. Zero sets fully covered pixels to the bottom of the height range; it is an active height edit. |

Height values are clamped to the representable 0–65535 range after each layer. Order therefore matters, including for large additive and subtractive edits that reach the limits. Use a lower amount or opacity to preserve headroom. **Raise with zero relief** creates a material-only layer when a material override is enabled.

The stack is composed before normal and occlusion generation. Normals, AO, cavity response, and the exported height are derived from that completed field. There is no separate normal-only approximation for these shapes. Height and edge falloff are sampled continuously in tile coordinates, retaining detail below an 8-bit height step in the 16-bit export.

### Material overrides

Enable **Override surface material** to set a local color, perceptual roughness, and metalness. These values blend through the same stamp mask and opacity, after the global substrate finish controls. This lets a coated or metallic fitting retain its finish while the base material changes.

Fractional color coverage is blended in linear reflectance and encoded back to sRGB. Roughness and metalness are data values. The compositor repacks ORM after the local finish is applied, so the separate roughness and metalness PNGs remain in exact agreement with ORM. AO remains the height-derived value; a color-only stamp does not add artificial occlusion.

## Physical scale

Layer amounts are fractions of the same full height range used by the existing Studio renderer. At unit normal strength, that range is **10/1024 of a tile width**, or **9.765625 mm for a one-meter tile**. For example, a 20% additive layer contributes up to 1.953125 mm at that tile width before opacity, edge falloff, and clamping. A half-meter tile halves those distances.

The PNG remains normalized black-low/white-high data. It does not encode meters by itself. The material package's relief metadata and the Blender importer establish its physical interpretation. Blender uses a midlevel of 0.5 and a displacement scale of `tile_width_m × 10/1024`. Changing **Normal strength** adjusts baked normal slopes; it does not change the source height pixels or automatically multiply the Blender displacement scale. Use unit normal strength when matching the baked normal and true displacement slope.

Model assemblies use **Material tile width** for the world scale of their UV repetition. Surface layers are included in the material mapped to those parts. The current parametric model export carries the material normals and provides source height separately; the stamp stack does not add silhouettes or through-holes to the assembly mesh. Use the material displacement workflow in a renderer with tessellation when that geometry is required.

For a standalone tile with relief already in its vertices, choose **Export → Relief mesh**. Set the tile width, full black-to-white relief in millimeters, backing thickness, and a 32, 64, 128, or 256 segment grid. A positive backing closes the tile below its lowest sampled surface; zero exports an open surface. This OBJ package samples the completed 16-bit height with a maximum 2048px sampling field and preserves every original full-resolution source map. Its uniform grid is an approximation independent of the adaptive preview. Geometric normals shade the displaced mesh; the source normal and height remain unbound to avoid applying the same relief twice. The manifest records the sampled resolution, physical settings, triangle counts, and actual bounds.

## Persistence and reproducibility

The optional `surfaceLayers` field lives in a Studio v2 recipe. Up to 16 layers are allowed, each with a stable unique ID, bounded controls, and an optional three-channel material override. Field ordering is canonical and layer ordering is preserved. Cloning a recipe copies each layer and its material, isolating undo snapshots from later edits. Existing recipes with no layers retain their exact canonical representation and identity. An empty stack is omitted. Converting to Legacy v1 removes the Studio-only stack as it removes other v2-only controls.

The recipe parser retains its 64 KiB limit. Invalid shapes, operations, IDs, duplicate IDs, nonfinite numbers, invalid colors, out-of-range controls, and oversized stacks are rejected before raster allocation. The new stack is entirely analytic: there are no external image URLs, hidden browser-only stamp files, or nondeterministic random sampling in a layer.

The warm preview worker includes the full stack in its structural cache key. Moving, reordering, hiding, recoloring, or otherwise editing a layer rebuilds the source field. Global normal/AO/roughness/metalness/dust edits can use the existing finish cache, which reapplies local material overrides from the unchanged source before repacking ORM. Saving a recipe is sufficient to reproduce its stack through `npm run bake`.

## Memory and evaluation cost

The compositor allocates one floating-point mask for a horizontal strip and reuses it for every layer. The existing full-resolution `Uint16Array` height field remains the only full-tile field introduced into this stage. A normal 8K bake uses 16-row strips, so layer-mask scratch storage is approximately **0.5 MiB**, independent of layer count. Prepared instance bounds are small arrays. Repeat counts and total layers are bounded before baking.

Work increases with active layers, array coverage, rotations, shape complexity, and local material overrides. A stamp covering a small region only evaluates its shape inside clipped instance bounds. A 45° full-cell array can cover nearly the whole tile, so many such layers are a deliberate stress case. Hiding a layer skips its work. Ordinary edits use the existing 512px draft preview; full-resolution baking remains explicit.

A bounded-memory stress run on the development Linux host with Node 24 used all 16 layers, cycled through the five shapes, set every layer to an 8×8 array with full-cell width/height and 45° rotation, enabled every material override, and processed an 8192² field in 16-row strips. Each layer used 2% height, 60% opacity, and a phase offset of `i/16`. This measures the new compositor alone; it excludes procedural base rasterization, PNG encoding, browser overhead, and GPU preview.

| Stress measurement | Observed value |
| --- | ---: |
| Height composition | 66.59 seconds |
| Material composition | 69.82 seconds |
| Combined compositor time | 136.41 seconds |
| Peak sampled process RSS | 195 MiB |
| Final typed-array backing storage | 129.77 MiB |

This is a maximum-coverage CPU stress fixture, not a typical editing or full-bake performance claim. The retained height array accounts for 128 MiB. The result establishes that the layer stack does not allocate a full-resolution mask per layer; throughput still depends on the number and coverage of active layers and the host CPU.

The unit tests cover periodic seams, overlapping periodic copies, arrays, strip equivalence, ordering and clamping, source preservation, analytic pattern openings, 16-bit relief, height-derived normals/AO, linear color blending, ORM parity, bounded validation, recipe cloning, and legacy identities. Browser regressions additionally exercise cache-versus-fresh bake equivalence and the actual author/move/reorder/hide/save/undo workflow. Run them with the pinned Playwright Chromium installed.
