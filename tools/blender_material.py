"""Build a portable Blender material library from an exported Greebler bake."""
import argparse
from contextlib import ExitStack
import json
import math
import os
from pathlib import Path, PurePosixPath
import struct
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile

import bpy


CHANNELS = ('albedo', 'normal', 'height', 'roughness', 'metalness', 'ao', 'orm')


def asset_path(name):
    path = PurePosixPath(name)
    if not path.parts or path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        raise ValueError(f'Invalid package path: {name}')
    return path


def read_json(open_file, name):
    with open_file(name) as stream:
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError(f'Oversize metadata: {name}')
    return json.loads(raw)


def load_bake(source, staging):
    """Read only the named manifest, recipe and source PNGs from either package form."""
    with ExitStack() as stack:
        if source.suffix.lower() == '.zip' and source.is_file():
            archive = stack.enter_context(ZipFile(source))

            def open_file(name):
                return archive.open(str(asset_path(name)))
            manifest_name = 'manifest.json'
        else:
            root = (source if source.is_dir() else source.parent).resolve()

            def open_file(name):
                file = (root / asset_path(name)).resolve()
                if not file.is_relative_to(root):
                    raise ValueError(f'Package path leaves its directory: {name}')
                return file.open('rb')
            manifest_name = 'manifest.json' if source.is_dir() else source.name

        manifest = read_json(open_file, manifest_name)
        if manifest['schemaVersion'] != 1:
            raise ValueError('Unsupported material manifest version.')
        recipe = read_json(open_file, manifest['recipe'])
        size = recipe['params']['resolution']
        if recipe['version'] not in (1, 2) or not isinstance(size, int) or not 1 <= size <= 8192:
            raise ValueError('Unsupported recipe version or image resolution.')
        want_normal = 'greebler-v1-gradient' if recipe['version'] == 1 else 'tangent-space-opengl-positive-y'
        if manifest['normalEncoding'] != want_normal:
            raise ValueError('Unknown normal encoding for this recipe.')

        paths = {}
        for key in CHANNELS:
            entry = manifest['maps'][key]
            path = staging / f'{key}.png'
            # RGBA16 without compression is eight bytes per pixel. Allow room for PNG framing.
            limit = size * size * 8 + 1024 * 1024
            with open_file(entry['file']) as stream, path.open('wb') as dest:
                header = stream.read(29)
                if (len(header) != 29 or header[:8] != b'\x89PNG\r\n\x1a\n'
                        or header[12:16] != b'IHDR' or struct.unpack('>II', header[16:24]) != (size, size)):
                    raise ValueError(f'Invalid {key} PNG or mismatched recipe dimensions.')
                dest.write(header)
                while data := stream.read(1024 * 1024):
                    if dest.tell() + len(data) > limit:
                        raise ValueError(f'Oversize PNG: {key}')
                    dest.write(data)
            if path.stat().st_size != entry['byteLength']:
                raise ValueError(f'{key} does not match its manifest byte length.')
            paths[key] = path
    return manifest, recipe, paths


def create_material(manifest, recipe, paths, tile_width):
    recipe_id = manifest['recipeId']
    material = bpy.data.materials.new(f"Greebler {recipe['params']['style'].title()} {recipe_id}")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    link = material.node_tree.links.new
    nodes.clear()

    def node(kind, label, x, y):
        item = nodes.new(kind)
        item.label = label
        item.location = (x, y)
        return item

    images = {}
    for key, path in paths.items():
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = f'{recipe_id} {key}'
        image.colorspace_settings.name = 'sRGB' if key == 'albedo' else 'Non-Color'
        image.pack()
        image.filepath = f'//maps/{key}.png'
        image.packed_files[0].filepath = image.filepath
        image.use_fake_user = True  # Keep the separate height and mask sources available to artists.
        images[key] = image

    def texture(key, y):
        item = node('ShaderNodeTexImage', key.title(), -700, y)
        item.image = images[key]
        item.extension = 'REPEAT'
        return item.outputs['Color']

    bsdf = node('ShaderNodeBsdfPrincipled', 'Metallic / Roughness', 0, 380)
    if 'specularIntensity' in manifest:
        bsdf.inputs['Specular IOR Level'].default_value = 0.5 * manifest['specularIntensity']
    output = node('ShaderNodeOutputMaterial', 'Material Output', 360, 380)
    link(bsdf.outputs['BSDF'], output.inputs['Surface'])
    link(texture('albedo', 600), bsdf.inputs['Base Color'])
    orm = node('ShaderNodeSeparateColor', 'Occlusion / Roughness / Metallic', -360, 240)
    orm.mode = 'RGB'
    link(texture('orm', 260), orm.inputs['Color'])
    link(orm.outputs['Green'], bsdf.inputs['Roughness'])
    link(orm.outputs['Blue'], bsdf.inputs['Metallic'])

    # Blender's glTF exporter recognizes this group as the occlusion input.
    # Cycles computes occlusion during light transport, independently of base color.
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    ao = node('ShaderNodeGroup', 'glTF baked occlusion', 0, -150)
    ao.node_tree = group
    link(orm.outputs['Red'], ao.inputs['Occlusion'])

    if recipe['version'] == 2:
        normal = node('ShaderNodeNormalMap', 'Tangent-space +Y', -360, -70)
        normal.space = 'TANGENT'
        link(texture('normal', -90), normal.inputs['Color'])
        link(normal.outputs['Normal'], bsdf.inputs['Normal'])
        relief = manifest['relief']['heightRangePerTileWidthAtUnitNormalStrength']
        if not math.isfinite(relief) or relief <= 0:
            raise ValueError('Invalid displacement range.')
        displacement = node('ShaderNodeDisplacement', 'Physical relief', -360, -420)
        displacement.space = 'WORLD'
        displacement.inputs['Midlevel'].default_value = 0.5
        displacement.inputs['Scale'].default_value = tile_width * relief
        link(texture('height', -440), displacement.inputs['Height'])
        link(displacement.outputs['Displacement'], output.inputs['Displacement'])
        # The tangent map already contains baked slope. True displacement avoids adding a second bump.
        material.displacement_method = 'DISPLACEMENT'
        material['greebler_tile_width_m'] = tile_width

    for name, obj in [('manifest', manifest), ('recipe', recipe)]:
        block = bpy.data.texts.new(f'{recipe_id} {name}.json')
        block.write(json.dumps(obj, indent=2))
        block.use_fake_user = True
    material['greebler_recipe_id'] = recipe_id
    material.asset_mark()
    material.asset_data.description = f"{recipe['params']['resolution']} px Greebler material, seed {recipe['params']['seed']}"
    for tag in ('Greebler', 'PBR', recipe['params']['style']):
        material.asset_data.tags.new(tag)
    with bpy.context.temp_override(id=material):
        bpy.ops.ed.lib_id_load_custom_preview(filepath=str(paths['albedo']))
    return material


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Material ZIP, extracted directory or manifest.json')
    parser.add_argument('--out', required=True, type=Path, help='Output .blend material library')
    parser.add_argument('--tile-width-m', default=1.0, type=float, help='Physical width of one UV tile in meters')
    parser.add_argument('--force', action='store_true', help='Replace an existing output after a successful save')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not bpy.app.background:
        parser.error('Run this standalone library builder with blender --background.')
    if not math.isfinite(args.tile_width_m) or args.tile_width_m <= 0:
        parser.error('--tile-width-m must be a positive finite number.')
    output = args.out.absolute()
    if output.suffix.lower() != '.blend':
        parser.error('--out must name a .blend file.')
    if output.exists() and not args.force:
        parser.error(f'{output} already exists. Use --force to replace it.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as temp:
        stage = Path(temp)
        manifest, recipe, paths = load_bake(args.source, stage)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        material = create_material(manifest, recipe, paths, args.tile_width_m)
        saved = stage / 'material.blend'
        if 'FINISHED' not in bpy.ops.wm.save_as_mainfile(filepath=str(saved), relative_remap=False):
            raise RuntimeError('Blender could not save the material library.')
        if args.force:
            os.replace(saved, output)
        else:
            os.link(saved, output)  # Publish without racing another artist or batch process.
        print(f'Saved "{material.name}" in {output}')


if __name__ == '__main__':
    main()
