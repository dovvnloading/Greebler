# Hard-surface asset authoring

Greebler's **Model** workspace builds editable assemblies from real parametric geometry. The **Surface** workspace authors their procedural PBR material. A portable project combines the assembly with its material recipe, so the browser editor and a batch build produce the same geometry and source maps.

## Start with an assembly

Switch to **Model**, then choose a starting point or open one of the portable example projects:

| Project | Geometry and material | Recorded bake |
| --- | --- | ---: |
| [Service module](../examples/assets/service-module.greebler.json) | Beveled chassis, service covers, mirrored couplings, cooling-fin array and the formed Service deck material. | 1024² |
| [Reactor core](../examples/assets/reactor-core.greebler.json) | Pressure vessel, through-rings, structural collars, posts and the Mechanical bay material. | 1024² |
| [Ventilation cassette](../examples/assets/ventilation-cassette.greebler.json) | Open intake frame, pitched louvers and mounting tabs. Its Thermal plant material includes editable recessed-slot and rivet surface layers. | 512² |
| [Modular wall panel](../examples/assets/modular-wall-panel.greebler.json) | Two-meter wall module, service sockets, frame rails and the Displacement material. | 1024² |

The preset buttons create geometry using the current material. Opening an example project also restores its saved material recipe. Project import starts a fresh model history, so undo cannot silently combine a previous assembly with the newly imported material.

Select a part in the viewport or assembly list. The inspector edits its exact dimensions, position, rotation, bevel, material, array and mirror. Numeric edits commit with Enter or on leaving the field. Use Duplicate to create an independent part. Visibility controls both the preview and asset export; locking protects a part from geometry and transform edits.

**Move** and **Rotate** expose a viewport gizmo. Transform snapping uses one-centimeter translation increments and 15-degree rotation increments. **Frame asset** fits the assembly, and the X/Y/Z view buttons align the camera. **Clay**, **Wireframe** and the grid make geometry easier to inspect. **Save asset render** captures the current view as a 2K PNG.

| Model command | Shortcut |
| --- | --- |
| Select tool | V |
| Move tool | G |
| Rotate tool | R |
| Frame asset | F |
| Duplicate selected part | Ctrl/⌘ D |
| Delete selected unlocked part | Delete or Backspace |
| Undo / redo model edit | Ctrl/⌘ Z / Ctrl/⌘ Shift Z |
| Open / save project | Ctrl/⌘ O / Ctrl/⌘ S |

The browser remembers the assembly locally. **Save project** creates a portable JSON file with the complete document and material recipe; use that file for source control, team handoff and reproducible builds.

## Geometry and coordinates

All source dimensions and positions are **meters**. The coordinate frame is right-handed, with **Y up**. Parts are centered on their local origins; a newly added part sits on the ground by default. Document rotations use XYZ Euler angles in degrees. Preview instances and exports use the equivalent rotations.

| Primitive | Controls and behavior |
| --- | --- |
| Beveled block | Width X, height Y, depth Z and rounded edges. |
| Surface panel | The same closed geometry with a thin, horizontal default proportion. Rotate or resize it for wall plates and covers. |
| Cylinder | Height along local Y; X and Z set elliptical diameters. Radial subdivisions control the polygon count. |
| Through ring | An open cylindrical or elliptical passage with a continuous inner wall, end annuli and beveled edges. Height is local Y, so rotate it to point a port along X or Z. |
| Wedge | Closed triangular prism extruded along local Z, with optional beveled edges. |

Low-sided cylinders and rings are inscribed polygons: their stated X/Z dimensions describe the underlying ellipse, while their actual mesh bounds depend on the segment count. The geometry budget reports the generated assembly, including array and mirror instances.

Bevel radii are limited by the dimensions; ring bevels are also limited by wall thickness. Excessive ring wall values retain a nonzero through-hole. Vanishing bevels below the geometry's representable precision become sharp edges, avoiding zero-area triangles. The authored values remain in the document so later resizing and undo retain the artist's intent.

### Arrays and mirrors

A linear array starts with the source part and adds copies in the positive direction of the selected **world** axis. Spacing measures center to center. Rotating the part changes each copy's orientation without rotating the array axis.

A mirror reflects the complete array across the selected world-origin plane. For example, X mirror maps `(x, y, z)` to `(-x, y, z)`. Mirrored geometry receives corrected winding, normals and tangent handedness; exported nodes keep positive scale. Placing a source part directly on the mirror plane can create overlapping copies, so use mirror when the source is offset from that plane.

Arrays share geometry in GLB. OBJ expands the instances into separately named objects with their transforms applied.

### Topology and limits

Every primitive is an individually closed solid. Parts may overlap as separate shells. A ring's hole passes through the ring itself; it does not cut through an intersecting backing plate. Use a DCC Boolean operation when a physical opening must extend through another part.

The current allocation limits are 64 authored parts, 512 expanded instances and 400,000 triangles. Each array allows 32 copies, radial geometry supports 3–64 segments, and bevels support 1–6 segments. Hidden parts count toward the document's allocation budget so visibility changes cannot bypass it. Invalid or over-budget projects are rejected before geometry allocation.

## One material at a physical scale

Each part chooses one of three material slots:

- **Authored material** uses the current completed surface bake: sRGB base color, a linear OpenGL tangent normal, and linear packed ORM.
- **Machined metal** uses the part's color with metallic 1 and roughness 0.28.
- **Solid paint** uses the part's color with metallic 0 and roughness 0.48.

**Material tile width** controls the physical width of one texture repetition across the assembly. A one-meter tile repeats twice across a two-meter planar face. Rounded edges use a surface-length mapping to reduce stretching. Cylindrical sides wrap around their perimeter, while end faces use planar UVs. The same UVs and explicit tangent frames feed the viewport and GLB.

These UVs intentionally repeat and overlap. They are not a unique atlas or a lightmap UV set. An assembly currently has one authored procedural material, plus per-part solid colors. Separate procedural materials per object, automatic lightmap unwraps, LODs and collision generation are future pipeline work.

### Surface layers and displacement

Return to **Surface** to author the material, including its ordered panel, ring, slot, ellipse and rivet layers. Model parts using the authored material update when the preview completes. Bake at the target resolution before production export. The export dialog identifies the completed material's resolution and blocks exports whose completed bake belongs to an older set of source controls.

Asset geometry is **parametric and undisplaced**. Surface relief appears through the baked normal map; its 16-bit source height is retained in the OBJ package. The adaptive sub-polygon material swatch belongs to surface inspection and is not silently substituted for the authored model.

To add true displacement in a DCC, use `height.png` as linear data with midpoint `0.5`. The full height range at unit normal strength is:

```text
full range in meters = material tile width in meters × (10 / 1024)
signed offset = (height sample − 0.5) × full range
```

The manifest records this range, midpoint and the normal map's baked strength. Remove the full height-derived normal when applying the same relief as geometric displacement, or replace it with a residual detail normal. Applying both without that adjustment would count the same relief twice. Height alone cannot represent undercuts or general volumetric geometry.

## Production exports

### Self-contained GLB

**Download GLB** produces the actual authored geometry with:

- Named nodes and shared source meshes for array copies.
- Physical meter scale, Y up, normals, UVs and explicit tangents.
- Embedded base color, normal and ORM PNGs, kept byte for byte.
- Solid part materials and authored specular metadata when supported.
- The source document, exact completed recipe, recipe ID, dimensions and statistics under `asset.extras.greebler`.

The GLB uses upper-left image V coordinates and explicit tangent handedness to preserve the normal-map convention. Keep these tangents when importing. Legacy v1 gradient normals are kept out of the shader.

GLB is the preferred PBR handoff. The asset metadata contains source data for pipeline inspection; keep the separately saved project JSON as the direct editor input.

### OBJ and complete source package

**Download OBJ package** creates a ZIP containing:

| File | Purpose |
| --- | --- |
| `asset.obj` | Actual named objects with transforms applied; meter scale and Y up. |
| `asset.mtl` | Material names, solid colors and PBR texture references where supported. |
| `maps/*.png` | All seven original maps, including 16-bit height for Studio v2. |
| `project.json` | Portable editable assembly and material recipe. |
| `recipe.json` | The completed material recipe, usable independently. |
| `manifest.json` | Geometry statistics, units, bounds, UV convention, texture encodings and relief scale. |
| `IMPORT.md` | Import conventions and the geometry/displacement limits. |

OBJ UVs use the conventional lower-left origin. OBJ has no standard PBR shader or tangent storage. Some importers support the MTL `map_Pr`, `map_Pm` and `norm` extensions; otherwise assign roughness, metallic and the tangent normal manually. Do not import the RGB normal texture as a grayscale bump map. GLB avoids that ambiguity.

## Build assets in a pipeline

Use Node.js 24, npm 11 or newer and the pinned Playwright Chromium, as with the material CLI:

```bash
npm ci
npx playwright install chromium

# Build one self-contained game-art asset.
npm run build:assets -- --out bakes/assets examples/assets/service-module.greebler.json

# Build several assets from their complete portable sources.
npm run build:assets -- --metrics --out bakes/assets \
  examples/assets/reactor-core.greebler.json \
  examples/assets/ventilation-cassette.greebler.json

# Export editable OBJ packages with every full-resolution source map.
npm run build:assets -- --format obj --out bakes/obj \
  examples/assets/modular-wall-panel.greebler.json
```

The default format is `glb`; the default output directory is `bakes/assets`. Names derive from the saved asset name, normalized to safe filenames. For example, **Service module** produces `service-module.glb`, or `service-module.zip` with `--format obj`.

The CLI validates every input, source recipe, allocation budget and output name before creating the output directory or launching Chromium. Duplicate output names are errors even with `--force`. Existing output files are preserved unless `--force` is supplied, and a source project can never be replaced by its own output.

Each job bakes the recipe at its recorded resolution, invokes the same mesh exporter as the editor, streams the completed Blob over loopback and verifies its byte count. Publication uses a temporary file in the destination directory, then an atomic link or replacement rename. Earlier completed jobs remain available if a later build fails. Failures return a nonzero exit code.

The browser runtime serves only the local repository, blocks external HTTP(S) requests and disables service workers. `GREEBLER_CHROMIUM_EXECUTABLE` selects an already-installed Chromium for offline workstations or CI. Pin the browser and raster environment for repeatable pixel comparisons across machines.

`--metrics` writes one JSON record per completed output with asset name, recipe ID, bake resolution, format, bake time, longest bake timer interval, export time, final bytes, instances, triangles, vertices, total elapsed time and absolute output path. The timer interval measures browser responsiveness during baking; it is not a GPU viewport benchmark.

## Verification

The modeling unit suite checks document validation, exact source round trips, finite attributes, closed topology, nonzero triangle area, outward winding, physical UV scale, explicit normal-map orientation, mirrored transform equivalence and allocation budgets. All four preset GLBs are checked with the Khronos validator. Export tests compare preview/export triangle counts and verify source PNG bytes remain unchanged.

CLI preflight tests run without Chromium and prove invalid batches never reach browser launch. Browser integration tests build two real GLBs, validate them, exercise safe replacement and inspect an OBJ package's actual 16-bit height map and editable source.

```bash
npm test
npm run test:browser -- tests/browser/modeling.spec.ts tests/browser/assetBatch.spec.ts
npm run typecheck
npm run lint
npm run build
```

The implementation makes useful parametric kit creation and material handoff possible. It does not establish studio deployment qualification, DCC-by-DCC import certification or hardware GPU performance; those require testing on the target production pipeline.
