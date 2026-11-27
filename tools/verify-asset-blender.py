"""Verify a Greebler GLB through Blender's real importer, optionally rendering it.

Run with Blender 4.0 or newer --background --factory-startup --python-exit-code 1.
This checks an external application's interpretation, not another mesh generator.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Quaternion, Vector


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_glb(path):
    require(path.is_file() and path.stat().st_size <= 512 * 1024 * 1024,
            'Choose a GLB file smaller than 512 MiB.')
    raw = path.read_bytes()
    require(len(raw) >= 20, 'Truncated GLB header.')
    magic, version, length = struct.unpack_from('<III', raw)
    require((magic, version, length) == (0x46546C67, 2, len(raw)), 'Invalid GLB header or length.')
    document = None
    binary = None
    offset = 12
    while offset < len(raw):
        require(offset + 8 <= len(raw), 'Truncated GLB chunk header.')
        size, kind = struct.unpack_from('<II', raw, offset)
        offset += 8
        require(offset + size <= len(raw) and size % 4 == 0, 'Invalid GLB chunk size.')
        payload = raw[offset:offset + size]
        if kind == 0x4E4F534A:
            require(document is None and size <= 8 * 1024 * 1024, 'Invalid or oversized GLB JSON.')
            document = json.loads(payload)
        elif kind == 0x004E4942:
            require(binary is None, 'Multiple GLB binary chunks.')
            binary = payload
        offset += size
    require(document is not None and binary is not None, 'GLB requires JSON and binary chunks.')
    require(all('uri' not in item for item in document.get('buffers', [])), 'External buffers are not allowed.')
    require(all('uri' not in item for item in document.get('images', [])), 'External images are not allowed.')
    metadata = document.get('asset', {}).get('extras', {}).get('greebler', {})
    require(metadata.get('format') == 'greebler-asset' and metadata.get('version') == 1,
            'Missing Greebler source metadata.')
    require(metadata.get('units') == 'meters' and metadata.get('upAxis') == 'Y', 'Unexpected source coordinate system.')
    return document, binary, metadata, hashlib.sha256(raw).hexdigest()


def embedded_images(document, binary):
    result = []
    for image in document.get('images', []):
        require(image.get('mimeType') == 'image/png', 'Expected lossless embedded PNG textures.')
        view = document['bufferViews'][image['bufferView']]
        start, size = view.get('byteOffset', 0), view['byteLength']
        require(view.get('buffer') == 0 and 0 <= start < start + size <= len(binary), 'Invalid image buffer view.')
        data = binary[start:start + size]
        require(data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR', 'Invalid embedded PNG.')
        result.append({'name': image.get('name', ''), 'sha256': hashlib.sha256(data).hexdigest(),
                       'size': struct.unpack('>II', data[16:24]), 'bytes': len(data)})
    return result


def tree_images(tree, seen=None):
    seen = set() if seen is None else seen
    if tree is None or tree.as_pointer() in seen:
        return set()
    seen.add(tree.as_pointer())
    images = set()
    for node in tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            images.add(node.image)
        if node.type == 'GROUP':
            images.update(tree_images(node.node_tree, seen))
    return images


def upstream_images(socket, seen=None):
    """Follow the imported shader graph from a Principled input, not node names."""
    seen = set() if seen is None else seen
    images = set()
    for link in socket.links:
        node = link.from_node
        if node.as_pointer() in seen:
            continue
        seen.add(node.as_pointer())
        if node.type == 'TEX_IMAGE' and node.image:
            images.add(node.image)
        for node_input in node.inputs:
            images.update(upstream_images(node_input, seen))
        if node.type == 'GROUP':
            images.update(tree_images(node.node_tree))
    return images


def imported_image_hash(image):
    # Embedded glTF images are packed by Blender's importer. Check the actual source bytes.
    require(image.packed_file is not None, f'Image is not packed: {image.name}')
    digest = hashlib.sha256(bytes(image.packed_file.data)).hexdigest()
    require(len(image.pixels) >= 4, f'Image pixels are unavailable: {image.name}')
    require(all(math.isfinite(value) for value in image.pixels[:4]), f'Non-finite image pixels: {image.name}')
    return digest


def source_bounds(document, binary):
    """Read the exported vertex buffers and standard node transforms directly.

    Check metadata bounds against the actual file before comparing the DCC.
    Reference positions come from exported vertices, never regenerated parts.
    """
    low, high = [math.inf] * 3, [-math.inf] * 3
    for node in document['nodes']:
        if 'mesh' not in node:
            continue
        require(not node.get('children'), 'This verifier expects the flat Greebler node hierarchy.')
        if 'matrix' in node:
            values = node['matrix']
            transform = Matrix([values[i:i + 4] for i in range(0, 16, 4)]).transposed()
        else:
            q = node.get('rotation', [0, 0, 0, 1])
            transform = (Matrix.Translation(Vector(node.get('translation', [0, 0, 0])))
                         @ Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
                         @ Matrix.Diagonal(Vector([*node.get('scale', [1, 1, 1]), 1])))
        for primitive in document['meshes'][node['mesh']]['primitives']:
            accessor = document['accessors'][primitive['attributes']['POSITION']]
            require(accessor['componentType'] == 5126 and accessor['type'] == 'VEC3', 'Unexpected position encoding.')
            view = document['bufferViews'][accessor['bufferView']]
            start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            stride = view.get('byteStride', 12)
            require(accessor['count'] > 0 and stride >= 12 and start + (accessor['count'] - 1) * stride + 12 <= len(binary), 'Invalid position buffer view.')
            for i in range(accessor['count']):
                world = transform @ Vector(struct.unpack_from('<3f', binary, start + i * stride))
                point = (world.x, -world.z, world.y)
                for axis in range(3):
                    low[axis] = min(low[axis], point[axis])
                    high[axis] = max(high[axis], point[axis])
    return low, high


def verify_import(document, binary, metadata):
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    expected_nodes = [node for node in document['nodes'] if 'mesh' in node]
    require(len(objects) == metadata['statistics']['instances'] == len(expected_nodes), 'Imported instance count differs.')
    triangles = 0
    actual_min, actual_max = [math.inf] * 3, [-math.inf] * 3
    vertex_count = 0
    imported_identity = Counter()
    materials = set()
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        require(len(obj.data.uv_layers) > 0, f'Missing UVs: {obj.name}')
        require(len(obj.data.materials) == 1 and obj.data.materials[0] is not None, f'Missing or unexpected material slots: {obj.name}')
        material = obj.data.materials[0]
        materials.add(material)
        imported_identity[(obj.get('partId'), bool(obj.get('mirrored', False)), material.name)] += 1
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            require(all(math.isfinite(value) for value in point), f'Non-finite imported vertex: {obj.name}')
            vertex_count += 1
            for axis in range(3):
                actual_min[axis] = min(actual_min[axis], point[axis])
                actual_max[axis] = max(actual_max[axis], point[axis])
    expected_identity = Counter()
    source_triangles = 0
    for node in expected_nodes:
        primitives = document['meshes'][node['mesh']]['primitives']
        require(len(primitives) == 1, 'This verifier expects one material per Greebler part.')
        primitive = primitives[0]
        source_triangles += document['accessors'][primitive['indices']]['count'] // 3
        expected_identity[(node['extras']['partId'], bool(node['extras']['mirrored']),
                           document['materials'][primitive['material']]['name'])] += 1
    require(imported_identity == expected_identity, 'Part IDs, mirrored instances or material assignments changed on import.')
    require(triangles == source_triangles == metadata['statistics']['triangles'], 'Imported triangle count differs.')
    require(vertex_count > 0, 'No imported mesh vertices.')
    low, high = metadata['bounds']['min'], metadata['bounds']['max']
    # Blender's glTF importer converts (X,Y,Z) to Blender (X,-Z,Y).
    metadata_min = [low[0], -high[2], low[1]]
    metadata_max = [high[0], -low[2], high[1]]
    expected_min, expected_max = source_bounds(document, binary)
    tolerance = max(0.00001, max(high[i] - low[i] for i in range(3)) * 0.00001)
    metadata_error = max(abs(a - b) for a, b in zip(expected_min + expected_max, metadata_min + metadata_max))
    require(metadata_error <= tolerance, f'Exported vertex bounds differ from metadata by {metadata_error:g} m.')
    bound_error = max(abs(a - b) for a, b in zip(actual_min + actual_max, expected_min + expected_max))
    require(bound_error <= tolerance, f'Imported meter/axis bounds differ by {bound_error:g} m (tolerance {tolerance:g}).')
    expected_images = embedded_images(document, binary)
    imported_images = set().union(*(tree_images(material.node_tree) for material in materials))
    hashes = {image: imported_image_hash(image) for image in imported_images}
    require(set(hashes.values()) == {image['sha256'] for image in expected_images}, 'Imported texture bytes differ from embedded sources.')
    for image in imported_images:
        expected = next(item for item in expected_images if item['sha256'] == hashes[image])
        require(tuple(image.size) == tuple(expected['size']), f'Imported image dimensions differ: {image.name}')
        require(tuple(image.size) == (metadata['project']['recipe']['params']['resolution'],) * 2, 'Texture size differs from the source recipe.')
    by_name = {material.name: material for material in materials}
    for expected in document['materials']:
        material = by_name.get(expected['name'])
        require(material is not None and material.use_nodes, f'Missing imported node material: {expected["name"]}')
        principled = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
        require(principled is not None, f'Missing Principled shader: {material.name}')
        pbr = expected['pbrMetallicRoughness']
        if not pbr.get('baseColorTexture'):
            expected_color = pbr.get('baseColorFactor', [1, 1, 1, 1])
            actual_color = principled.inputs['Base Color'].default_value
            require(all(abs(actual_color[i] - expected_color[i]) < 0.0001 for i in range(3)),
                    f'{material.name}: solid linear base color changed.')
        bindings = [('Base Color', pbr.get('baseColorTexture'), False),
                    ('Roughness', pbr.get('metallicRoughnessTexture'), True),
                    ('Metallic', pbr.get('metallicRoughnessTexture'), True),
                    ('Normal', expected.get('normalTexture'), True)]
        for socket_name, binding, linear in bindings:
            if binding is None:
                continue
            source = document['textures'][binding['index']]['source']
            linked = upstream_images(principled.inputs[socket_name])
            require(any(hashes.get(image) == expected_images[source]['sha256'] for image in linked),
                    f'{material.name}: {socket_name} does not use its source texture.')
            for image in linked:
                require(image.colorspace_settings.name == ('Non-Color' if linear else 'sRGB'),
                        f'{material.name}: {socket_name} has the wrong color space.')
        if pbr.get('metallicRoughnessTexture'):
            for socket_name, accepted in [('Roughness', {'Green', 'G'}), ('Metallic', {'Blue', 'B'})]:
                links = principled.inputs[socket_name].links
                require(links and links[0].from_socket.name in accepted, f'{material.name}: ORM {socket_name} channel changed.')
        else:
            require(abs(principled.inputs['Metallic'].default_value - pbr['metallicFactor']) < 0.0001, 'Solid material metallic value changed.')
            require(abs(principled.inputs['Roughness'].default_value - pbr['roughnessFactor']) < 0.0001, 'Solid material roughness changed.')
    return {'instances': len(objects), 'triangles': triangles, 'importedVertices': vertex_count, 'materials': len(materials),
            'images': [{'name': image.name, 'sha256': hashes[image], 'size': list(image.size),
                        'colorSpace': image.colorspace_settings.name} for image in sorted(imported_images, key=lambda image: image.name)],
            'boundsBlenderM': {'min': actual_min, 'max': actual_max},
            'sourceVertexBoundsBlenderM': {'min': expected_min, 'max': expected_max},
            'sourceMetadataBoundsBlenderM': {'min': metadata_min, 'max': metadata_max},
            'maximumMetadataBoundsErrorM': metadata_error,
            'maximumBoundsErrorM': bound_error, 'boundsToleranceM': tolerance}


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def configure_cpu_denoising(scene):
    """Match Cycles' own build-capability check; distribution builds may omit OIDN.

    Blender's Cycles addon uses _cycles.with_openimagedenoise to populate the
    available denoiser enum. Rendering without that optional feature retains
    every import assertion and the same fixed-seed Cycles lighting proof.
    """
    try:
        import _cycles
        available = bool(getattr(_cycles, 'with_openimagedenoise', False))
    except ImportError:
        available = False
    scene.cycles.use_denoising = available
    if available:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
        if hasattr(scene.cycles, 'denoising_use_gpu'):
            scene.cycles.denoising_use_gpu = False
    else:
        print('Greebler verifier: OpenImageDenoise unavailable; using the fixed-seed Cycles CPU render without denoising.')


def prepare_render(bounds, width, samples):
    scene = bpy.context.scene
    low, high = Vector(bounds['min']), Vector(bounds['max'])
    center = (low + high) / 2
    span = max(high - low)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    configure_cpu_denoising(scene)
    scene.cycles.seed = 0
    scene.render.resolution_x = width
    scene.render.resolution_y = round(width * 0.75)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 0
    world = bpy.data.worlds.new('Greebler inspection studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.22, 0.26, 0.32, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    scene.world = world
    floor_material = bpy.data.materials.new('Inspection floor')
    floor_material.use_nodes = True
    floor_bsdf = floor_material.node_tree.nodes.get('Principled BSDF')
    floor_bsdf.inputs['Base Color'].default_value = (0.028, 0.039, 0.055, 1)
    floor_bsdf.inputs['Roughness'].default_value = 0.7
    bpy.ops.mesh.primitive_plane_add(size=span * 20, location=(center.x, center.y, low.z - span * 0.006))
    bpy.context.object.data.materials.append(floor_material)
    for name, position, power, color, size in [
        ('Key softbox', (2.1, -2.6, 3.2), 1000, (0.85, 0.92, 1), 2.1),
        ('Warm fill', (-2.7, -0.7, 1.4), 500, (1, 0.78, 0.57), 1.7),
        ('Rim softbox', (0.3, 2.6, 2.4), 1300, (0.72, 0.86, 1), 1.5),
    ]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy = power * span * span
        light.color = color
        light.shape = 'RECTANGLE'
        light.size = size * span
        light.size_y = size * span * 0.55
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(position) * span
        aim(obj, center)
    camera_data = bpy.data.cameras.new('Asset review camera')
    camera = bpy.data.objects.new('Asset review camera', camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((1.8, -2.5, 1.7)).normalized() * span * 4
    aim(camera, center)
    camera_data.type = 'ORTHO'
    camera_data.clip_start = max(0.0001, span / 1000)
    camera_data.clip_end = span * 100
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    corners = [inverse @ Vector((x, y, z)) for x in (low.x, high.x) for y in (low.y, high.y) for z in (low.z, high.z)]
    extent_x = max(p.x for p in corners) - min(p.x for p in corners)
    extent_y = max(p.y for p in corners) - min(p.y for p in corners)
    camera_data.ortho_scale = 1
    frame = camera_data.view_frame(scene=scene)
    frame_x = max(point.x for point in frame) - min(point.x for point in frame)
    frame_y = max(point.y for point in frame) - min(point.y for point in frame)
    camera_data.ortho_scale = max(extent_x / frame_x, extent_y / frame_y) * 1.28
    scene.camera = camera
    bpy.context.view_layer.update()
    for x in (low.x, high.x):
        for y in (low.y, high.y):
            for z in (low.z, high.z):
                projected = world_to_camera_view(scene, camera, Vector((x, y, z)))
                require(0.05 <= projected.x <= 0.95 and 0.05 <= projected.y <= 0.95 and projected.z > 0,
                        'Review camera would crop the asset.')


def publish(source, target, force):
    if force:
        os.replace(source, target)
    else:
        os.link(source, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Self-contained GLB exported by Greebler')
    parser.add_argument('--project', type=Path, help='Also compare exact source document and recipe with this portable project')
    parser.add_argument('--report', type=Path, help='JSON check report; defaults beside the GLB')
    parser.add_argument('--render', type=Path, help='Optional Cycles CPU studio PNG')
    parser.add_argument('--blend', type=Path, help='Optional packed .blend review scene')
    parser.add_argument('--samples', type=int, default=48)
    parser.add_argument('--width', type=int, default=1024)
    parser.add_argument('--force', action='store_true', help='Replace existing verification outputs')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    require(bpy.app.background and bpy.app.version >= (4, 0, 0), 'Run this verifier in background mode with Blender 4.x or newer.')
    require(1 <= args.samples <= 256 and 256 <= args.width <= 4096, 'Use 1–256 samples and a width from 256 to 4096.')
    source = args.source.resolve()
    report_path = (args.report or source.with_suffix('.blender.json')).absolute()
    outputs = [report_path] + [path.absolute() for path in (args.render, args.blend) if path]
    require(len(set(outputs)) == len(outputs), 'Verification output paths must be distinct.')
    for output in outputs:
        require(output.resolve() != source and (not args.project or output.resolve() != args.project.resolve()), 'An output would overwrite source data.')
        require(args.force or not output.exists(), f'Output exists: {output}. Use --force to replace it.')
        output.parent.mkdir(parents=True, exist_ok=True)
    require(not args.render or args.render.suffix.lower() == '.png', '--render must name a PNG.')
    require(not args.blend or args.blend.suffix.lower() == '.blend', '--blend must name a .blend file.')
    started = time.perf_counter()
    document, binary, metadata, source_hash = read_glb(source)
    if args.project:
        require(args.project.stat().st_size <= 1024 * 1024, 'Source project is too large.')
        project = json.loads(args.project.read_text(encoding='utf-8'))
        require(project.get('format') == 'greebler-asset' and project.get('version') == 1, 'Invalid source project.')
        require(metadata['project'] == {key: project[key] for key in ('document', 'recipe')}, 'GLB source differs from the selected portable project.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.length_unit = 'METERS'
    scene.unit_settings.scale_length = 1
    imported = time.perf_counter()
    result = bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True, merge_vertices=False, import_shading='NORMALS')
    require('FINISHED' in result, 'Blender did not finish importing the GLB.')
    bpy.context.view_layer.update()
    import_seconds = time.perf_counter() - imported
    checks = verify_import(document, binary, metadata)
    report = {'status': 'passed', 'blenderVersion': bpy.app.version_string, 'source': str(source),
              'sourceSha256': source_hash, 'recipeId': metadata['recipeId'], 'sourceProjectCompared': bool(args.project),
              'coordinateConversion': 'glTF (X,Y,Z) -> Blender (X,-Z,Y), meters',
              'checks': checks, 'importSeconds': round(import_seconds, 3)}
    if args.render or args.blend:
        prepare_render(checks['boundsBlenderM'], args.width, args.samples)
    if args.render:
        target = args.render.absolute()
        with TemporaryDirectory(dir=target.parent) as temp:
            png = Path(temp) / 'review.png'
            scene.render.filepath = str(png)
            render_started = time.perf_counter()
            require('FINISHED' in bpy.ops.render.render(write_still=True), 'Cycles did not complete the review render.')
            require(png.is_file() and png.stat().st_size > 1024, 'Cycles did not write a complete PNG.')
            publish(png, target, args.force)
            report['render'] = {'file': str(target), 'engine': 'Cycles CPU', 'samples': args.samples,
                                'width': args.width, 'height': round(args.width * 0.75),
                                'denoiser': 'OpenImageDenoise CPU' if scene.cycles.use_denoising else 'none',
                                'seconds': round(time.perf_counter() - render_started, 3)}
    if args.blend:
        target = args.blend.absolute()
        with TemporaryDirectory(dir=target.parent) as temp:
            blend = Path(temp) / 'review.blend'
            require('FINISHED' in bpy.ops.wm.save_as_mainfile(filepath=str(blend), relative_remap=False), 'Could not save the review scene.')
            publish(blend, target, args.force)
        report['blend'] = str(target)
    report['elapsedSeconds'] = round(time.perf_counter() - started, 3)
    with TemporaryDirectory(dir=report_path.parent) as temp:
        staged = Path(temp) / 'report.json'
        staged.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        publish(staged, report_path, args.force)
    print(json.dumps({'status': 'passed', 'report': str(report_path), 'triangles': checks['triangles'],
                      'instances': checks['instances'], 'elapsedSeconds': report['elapsedSeconds']}))


if __name__ == '__main__':
    main()
