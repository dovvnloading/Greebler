# Greebler implementation plan

This is the working plan for taking Greebler from the current prototype to a production-grade procedural material tool. It is intentionally ordered by dependency and risk, not by calendar estimates.

## How we will work

- Ship one coherent batch at a time.
- Keep every merged batch runnable locally and on GitHub Pages.
- Prefer vertical slices that can be seen and tested over large invisible rewrites.
- Define acceptance checks before changing an engine subsystem.
- Keep recipes and saved projects versioned from the moment they exist.
- Update this document when a batch changes the architecture or priority order.
- Do not preserve prototype internals merely to avoid replacing them.

## Product definition

Greebler is an art-directable procedural sci-fi surface and PBR material generator for real-time engines and digital-content tools.

The primary product is a 2.5D material generator. True geometry generation is a later independent mode built on the same semantic layout, motif, and material data.

The production bar is:

- Intentional macro, meso, and micro composition.
- Exact tileability with visible seam analysis.
- Deterministic and stage-lockable generation.
- Connected, semantically coherent technical systems.
- Physically meaningful material channels.
- Responsive preview and bounded high-resolution export.
- Projects, presets, inspection, comparison, and pipeline-ready exports.
- A style system that does not require editing the engine core.

## Batch 0 — Pages and delivery foundation

Goal: every following batch has an online build that can be tested immediately.

- [x] Add a repository-aware Vite base path.
- [x] Add pull-request validation for install, typecheck, and production build.
- [x] Add the GitHub Pages build and deployment workflow.
- [x] Remove the client-side API-key injection from the Vite build.
- [x] Restore project README and correct site metadata.
- [x] Add this working implementation plan.
- [ ] Enable GitHub Pages for the repository.
- [ ] Confirm the first live deployment at `https://dovvnloading.github.io/Greebler/`.

Acceptance:

- Local development continues to work at `/`.
- A production build works from `/Greebler/` with no missing assets.
- Pull requests receive a green validation workflow.
- A main-branch deployment produces a working public project URL.

## Batch 1 — Repository and runtime hygiene

Goal: shrink the surface area before rewriting the engine.

- Remove unused Google GenAI, Express, SQLite, dotenv, motion, uuid, clsx, and merge-helper dependencies.
- Separate runtime and development dependencies correctly.
- Rename the package and establish the supported Node/npm versions.
- Upgrade the remaining dependency set as a tested unit.
- Reach zero known high or critical findings in shipped dependencies.
- Enable strict TypeScript and replace `any` at public boundaries.
- Add ESLint and formatting checks.
- Add unit-test and browser-test harnesses.
- Add an error boundary and actionable generation errors.
- Stop suppressing Three.js warnings globally.

Acceptance:

- Clean install, typecheck, lint, tests, build, and Pages validation pass.
- No client secret or server-only package can enter the browser bundle.
- The production dependency graph contains only packages used by shipped code.

## Batch 2 — Correct the current material pipeline

Goal: make the existing generator honest and testable before replacing its layout algorithm.

- Fix the electrical albedo overwrite.
- Separate material identity from height.
- Generate and expose base color, height, normal, roughness, and metalness consistently.
- Add AO, emissive, and material-ID placeholders to the channel contract.
- Make sRGB versus linear data explicit.
- Add OpenGL and DirectX normal orientation.
- Replace data URLs with owned Blob/ImageBitmap resources.
- Dispose replaced Three.js textures, materials, and geometries.
- Remove or disable unsafe 8K generation until export is tiled.

Acceptance:

- Every visible feature has deliberate channel behavior.
- Electrical materials retain their authored colors.
- One hundred regenerations do not produce material GPU-resource growth.
- Exported channel values pass automated range and color-space checks.

## Batch 3 — Versioned recipe and deterministic engine shell

Goal: detach generation from React and the DOM.

- Define a versioned `GenerationSpec` with runtime validation.
- Add migration functions for future recipe versions.
- Replace `sin(seed++)` with a documented integer PRNG.
- Add hierarchical seed streams for layout, motifs, networks, materials, and microdetail.
- Define stable IDs for generated regions and features.
- Extract engine modules that do not import React or assume `document` exists.
- Add a small CPU reference render path for deterministic tests.
- Save and load canonical `.greeble.json` recipes.

Acceptance:

- Same recipe, engine version, and reference backend produce the same hash.
- Material changes do not change locked layout IDs.
- Adding a new microdetail stage does not scramble existing stages.
- Invalid recipes fail with specific validation errors.

## Batch 4 — Periodic multiscale layout

Goal: replace random recursive collage with an art-directable composition model.

- Build a layout graph with parent/child hierarchy and adjacency.
- Work in normalized coordinates independent of export resolution.
- Treat tileable space as a torus for placement, distance, splitting, and rasterization.
- Allocate focal regions, quiet hull regions, protected areas, and routing corridors.
- Add target distributions for macro, meso, and micro scale.
- Add alignment, repetition, symmetry, direction fields, and anisotropy.
- Replace density-as-stop-probability with coverage and scale controls that behave monotonically.
- Add a 3×3 repeat preview and seam value/derivative metrics.

Acceptance:

- Tile edges match exactly in value and within the defined derivative tolerance.
- Coverage and scale controls are statistically monotonic across the seed corpus.
- Layout fuzzing produces no invalid bounds, overlap-policy violations, or unbounded recursion.
- Default compositions show deliberate negative space and hierarchy.

## Batch 5 — Motif registry and connected systems

Goal: make generated detail look designed and functional.

- Define data-driven motif contracts: compatible regions, size/aspect range, sockets, materials, height profile, collision bounds, exclusions, and variation inputs.
- Port useful current motifs into the registry.
- Add hull panels, framed hatches, vents, ribs, perforations, bolts, clamps, labels, indicators, pipes, ducts, wires, traces, terminals, junction boxes, heat sinks, chips, and capacitor banks.
- Generate pipes, wires, and traces as global networks rather than local decorations.
- Route between compatible sockets while respecting obstacles and reserved corridors.
- Add intentional terminals, supports, bends, junctions, and route hierarchy.
- Detect orphaned endpoints, clipped motifs, and features too small for the output resolution.

Acceptance:

- Required sockets are connected or explicitly terminated.
- No motif crosses an exclusion region or silently clips outside its host.
- A style can alter motif weights and parameters without changing layout code.

## Batch 6 — Analytic/SDF surface synthesis

Goal: replace fragile immediate-mode drawing with resolution-independent shapes.

- Represent panels, chamfers, grooves, holes, fasteners, cylinders, routed lines, and masks as analytic or signed-distance primitives.
- Add union, subtraction, intersection, bevel, smooth operations, and reusable profile curves.
- Generate antialiased height and masks from the same semantic geometry.
- Derive stable normals using physical height scale and texel size.
- Add height clipping analysis and physical units.
- Produce AO, curvature, edge, cavity, material-ID, and feature-ID masks from the shared representation.

Acceptance:

- Bevel and groove dimensions remain consistent across preview and export resolutions.
- Height stays within declared ranges without accidental saturation.
- Normal output is valid, normalized, and convention-correct.
- CPU reference images provide stable golden tests.

## Batch 7 — Interactive renderer and bounded export

Goal: keep editing responsive while supporting honest high resolution.

- Add an asynchronous worker protocol with progress, cancellation, and stale-result rejection.
- Use WebGPU for production preview/render passes where available.
- Keep a worker-based CPU/OffscreenCanvas fallback.
- Render an immediate low-resolution preview, followed by settled preview quality.
- Separate interactive preview from final export jobs.
- Tile high-resolution rendering and encoding to cap memory.
- Handle graphics-device loss, worker failure, encoder failure, and cancellation.
- Track stage timing and retained-resource counts in development builds.

Acceptance:

- The editor remains interactive during generation.
- Cancelled or superseded jobs never publish stale maps.
- 4K and 8K exports stay within explicit memory budgets.
- Preview and export use the same recipe and semantic scene.

## Batch 8 — Production channel and export system

Goal: eliminate manual repacking after export.

- Export 8/16-bit PNG where appropriate and float EXR for height when requested.
- Add generic, glTF, Unreal, Unity, Godot, and Blender profiles.
- Support OpenGL/DirectX normals and configurable packed-channel layouts.
- Add KTX2/Basis output for runtime delivery.
- Export a ZIP with images, manifest, recipe, engine version, seed, physical dimensions, color spaces, normal convention, packing, checksums, and thumbnail.
- Validate exported files by decoding and inspecting them in tests.
- Add filename templates and explicit overwrite behavior.

Acceptance:

- Every preset has a documented, tested channel contract.
- Round-trip fixtures reproduce the expected values and orientation.
- Exports contain enough metadata to diagnose and reproduce a result.

## Batch 9 — Professional 2D and 3D workspace

Goal: turn the generator into an efficient authoring tool.

- Rework the layout around a large central preview, library/layers, and context inspector.
- Add pan, zoom, fit, 1:1, pixel inspection, histograms, component solo, false-color warnings, physical ruler, and texel-density overlay.
- Add 1×1/3×3 tiling and seam heat-map views.
- Add plane, rounded cube, sphere, cylinder, and imported glTF/GLB previews.
- Add UV tiling, displacement/parallax/normal toggles, physical displacement, environment controls, tone mapping, camera presets, wireframe, and screenshots.
- Add undo/redo, A/B comparison, seed locks, variant history, project autosave, and preset thumbnails.
- Complete keyboard, focus, semantic-control, reduced-motion, and contrast behavior.

Acceptance:

- The complete authoring/export path works without hidden controls or manual file surgery.
- The primary workflow is keyboard-operable.
- Viewers expose every production channel and its interpretation.

## Batch 10 — Style authoring

Goal: make visual expansion data-driven.

- Define style packs containing layout rules, motif weights, material libraries, defaults, parameter metadata, and preview recipes.
- Support validated SVG/SDF/height stamps and masks.
- Add local protect/include/exclude masks for art direction.
- Add batch variants and contact sheets.
- Version style packs against compatible recipe and engine versions.
- Build an authoring/validation workflow for technical artists.

Acceptance:

- A new style can be created and packaged without engine-code changes.
- Style packs validate automatically and fail clearly when incompatible.
- Existing project recipes retain their declared style behavior.

## Batch 11 — Optional intelligence and geometry

Goal: add differentiators without weakening the deterministic core.

- Add an optional natural-language recipe assistant that edits validated parameters and shows its proposed changes.
- Keep the complete generator functional offline and without an API key.
- Explore reference-to-recipe analysis without making opaque pixel generation the source of truth.
- Build true geometry output from semantic panels and motifs as a separate renderer.
- Add glTF/GLB mesh export, instancing, LODs, and material assignments.
- Evaluate a node editor only after recipe, motif, and render-graph APIs are stable.

Acceptance:

- Intelligence features are optional, reversible, and recipe-based.
- Geometry and material renderers consume the same semantic scene.
- No network-dependent feature can break deterministic local generation.

## Batch 12 — Release hardening

Goal: make sustained public use boring and predictable.

- Expand cross-browser, WebGPU/fallback, accessibility, and responsive matrices.
- Add long-session leak tests, repeated-generation soak tests, and seed-corpus visual regression.
- Add dependency automation, audit policy, CSP, production headers, and an SBOM.
- Add concepts, quick start, channel semantics, export recipes, troubleshooting, style authoring, and schema documentation.
- Establish semantic versioning, migrations, release notes, rollback, and issue templates.
- Add opt-in diagnostics with an explicit privacy contract.

Acceptance:

- No known P0/P1 defects.
- All determinism, tileability, PBR, memory, export, accessibility, and soak-test gates pass.
- Releases are reproducible and reversible.

## Explicit non-goals for early batches

- Do not keep expanding the current monolithic generator with more immediate canvas methods.
- Do not start with a free-form node editor.
- Do not use AI-generated pixels as the material source of truth.
- Do not add accounts, a database, or cloud sync before local projects and exports are excellent.
- Do not advertise 8K until rendering and encoding are tiled and memory-gated.
- Do not confuse more random detail with better procedural design.
