"""Export only the rigged capsule character from the editable .blend to a web-ready GLB.

blender -b /path/to/capsule_mannequin.blend --python tools/export_glb.py -- \
  --output public/model/capsule_character.glb

No reference Body/Head, ground, lights or cameras are exported.
"""
import argparse
import sys
from pathlib import Path
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args(argv)
path = args.output.expanduser().resolve()
path.parent.mkdir(parents=True, exist_ok=True)

arm = bpy.data.objects.get('Armature')
mesh = bpy.data.objects.get('Capsule_Character')
assert arm is not None and arm.type == 'ARMATURE'
assert mesh is not None and mesh.type == 'MESH'
# glTF expects the armature to parent its skinned mesh. This changes only the
# in-memory export copy; the saved .blend remains untouched.
original_world = mesh.matrix_world.copy()
mesh.parent = arm
mesh.matrix_world = original_world
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
arm.hide_set(False)
mesh.hide_set(False)
arm.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=str(path),
    export_format='GLB',
    use_selection=True,
    export_animations=False,
    export_skins=True,
    export_materials='EXPORT',
    export_lights=False,
    export_cameras=False,
    export_yup=True,
    export_apply=False,
)
print('WEB_GLB_WRITTEN:', path, path.stat().st_size, 'bytes')
