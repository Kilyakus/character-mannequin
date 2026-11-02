#!/usr/bin/env python3
"""Build a neutral, segmented capsule character on anime-base-tall.fbx's ORIGINAL rig.

Run in Blender 4.0+ (Blender 4.3 was used to create the supplied deliverables):

    blender --background --python build_capsule_character.py -- \
        --input anime-base-tall.fbx --output-dir .

The script creates a .blend file, an animation-ready skinned FBX, and three PNGs.
Pass --no-render to skip the PNGs; --samples N controls Cycles render quality.
It uses only Blender's bundled Python libraries, and never alters the input FBX.
All shape dimensions are relative to anatomical landmarks of the source rest pose;
the source's 85 bone names and hierarchy are retained unchanged.
"""

import argparse
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    script_dir = Path(__file__).resolve().parent if '__file__' in globals() else Path.cwd()
    parser = argparse.ArgumentParser(description='Build a skinned capsule mannequin from the original FBX rig')
    parser.add_argument('--input', type=Path, default=script_dir / 'anime-base-tall.fbx',
                        help='Input FBX; .fbx.txt works too when it contains binary FBX data')
    parser.add_argument('--output-dir', type=Path, default=script_dir, help='Where to write deliverables')
    parser.add_argument('--no-render', action='store_true', help='Build .blend and .fbx but skip studio renders')
    parser.add_argument('--samples', type=int, default=64, help='Cycles samples for studio images (default: 64)')
    return parser.parse_args(argv)


def move_to_collection(obj, collection):
    for current in tuple(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def material(name, rgb, roughness=0.42, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


class CapsuleMesh:
    """One export-friendly mesh of disjoint shells, with rigid per-bone skin weights."""

    def __init__(self, rig, mats):
        self.rig = rig
        self.inv = rig.matrix_world.inverted()
        self.mats = mats
        self.material_index = {name: i for i, name in enumerate(mats)}
        self.vertices = []
        self.faces = []
        self.face_materials = []
        self.weights = defaultdict(list)
        self.parts = []

    def vert(self, world_position, bone):
        i = len(self.vertices)
        self.vertices.append(tuple(self.inv @ Vector(world_position)))
        self.weights[bone].append(i)
        return i

    def face(self, indices, mat):
        self.faces.append(tuple(indices))
        self.face_materials.append(self.material_index[mat])

    def capsule(self, label, bone, p0, p1, radii_start, radii_end=None,
                mat='porcelain', ref=X, cap=None, bulge=0.0, sides=28):
        """Elliptical, smoothly tapered pill between TWO REST-POSE POINTS.

        ref indicates the cross-section's first axis. For standing body parts it
        is world X; for horizontal arms and fingers it is world Z.
        """
        p0, p1 = Vector(p0), Vector(p1)
        vec = p1 - p0
        length = vec.length
        if length <= 1e-6:
            raise ValueError('Zero-length segment: ' + label)
        axis = vec / length
        u = Vector(ref) - axis * Vector(ref).dot(axis)
        if u.length < 1e-5:
            u = X - axis * X.dot(axis)
        if u.length < 1e-5:
            u = Y - axis * Y.dot(axis)
        u.normalize()
        v = axis.cross(u).normalized()
        r0 = tuple(radii_start)
        r1 = tuple(radii_end or radii_start)
        if cap is None:
            cap = max(0.115, min(0.47, 0.90 * max(*r0, *r1) / length))
        cap = max(0.06, min(0.49, cap))
        # Sample the curved end-caps more finely than the fairly straight center.
        cap_steps = (0.014, 0.06, 0.14, 0.25, 0.39, 0.55, 0.72, 0.87, 1.0)
        values = sorted(set([cap * f for f in cap_steps]
                            + [cap + (1 - 2 * cap) * f for f in (0.2, 0.4, 0.6, 0.8)]
                            + [1 - cap * f for f in cap_steps]))
        bottom = self.vert(p0, bone)
        rings = []
        for t in values:
            if t < cap:
                s = t / cap
                round_factor = math.sqrt(max(0, 1 - (1 - s) ** 2))
            elif t > 1 - cap:
                s = (1 - t) / cap
                round_factor = math.sqrt(max(0, 1 - (1 - s) ** 2))
            else:
                round_factor = 1.0
            organic = 1.0 + bulge * math.sin(math.pi * t)
            r_u = (r0[0] * (1 - t) + r1[0] * t) * round_factor * organic
            r_v = (r0[1] * (1 - t) + r1[1] * t) * round_factor * organic
            center = p0 + vec * t
            ring = [self.vert(center + r_u * math.cos(2 * math.pi * j / sides) * u
                              + r_v * math.sin(2 * math.pi * j / sides) * v, bone)
                    for j in range(sides)]
            rings.append(ring)
        top = self.vert(p1, bone)
        for j in range(sides):
            k = (j + 1) % sides
            self.face((bottom, rings[0][k], rings[0][j]), mat)
        for a, b in zip(rings[:-1], rings[1:]):
            for j in range(sides):
                k = (j + 1) % sides
                self.face((a[j], a[k], b[k], b[j]), mat)
        for j in range(sides):
            k = (j + 1) % sides
            self.face((top, rings[-1][j], rings[-1][k]), mat)
        self.parts.append((label, bone, mat))

    def ball(self, label, bone, center, radii, mat='joint', sides=24):
        rx, ry, rz = radii
        self.capsule(label, bone, Vector(center) - Z * rz, Vector(center) + Z * rz,
                     (rx, ry), (rx, ry), mat=mat, ref=X, cap=0.5, sides=sides)

    def build(self, collection):
        mesh = bpy.data.meshes.new('Capsule Character · disconnected shells')
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update(calc_edges=True)
        for mat in self.mats.values():
            mesh.materials.append(mat)
        for face, mat_idx in zip(mesh.polygons, self.face_materials):
            face.material_index = mat_idx
            face.use_smooth = True
        obj = bpy.data.objects.new('Capsule_Character', mesh)
        collection.objects.link(obj)
        obj.matrix_world = self.rig.matrix_world.copy()
        for bone_name, indices in self.weights.items():
            if bone_name not in self.rig.data.bones:
                raise ValueError(f'Unknown bone for generated mesh: {bone_name}')
            group = obj.vertex_groups.new(name=bone_name)
            # Separate calls in batches are faster and avoid excessive argument sizes.
            for i in range(0, len(indices), 10000):
                group.add(indices[i:i+10000], 1.0, 'REPLACE')
        modifier = obj.modifiers.new('Skin · original FBX bones', 'ARMATURE')
        modifier.object = self.rig
        modifier.use_deform_preserve_volume = True
        obj['Description'] = 'Rigid capsule shells; Edit Mode > L selects one component.'
        obj['Generator'] = 'build_capsule_character.py'
        obj['Rest_pose_source'] = 'anime-base-tall.fbx / original skeleton'
        print(f'CAPSULE_MESH: {len(self.parts)} shells, {len(mesh.vertices)} vertices, '
              f'{len(mesh.polygons)} faces, {len(self.weights)} weighted bones')
        return obj


def build_character(rig, collection, mats):
    bones = rig.data.bones
    required = ('Hips', 'spine', 'Lowerchest', 'upper chest', 'neck', 'Head', 'Jaw',
                'Eye L', 'Eye R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R',
                'foot.L', 'foot.R', 'shoulder.L', 'shoulder.R', 'upper_arm.L',
                'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R')
    missing = [name for name in required if name not in bones]
    if missing:
        raise RuntimeError('Source rig does not match anime-base-tall.fbx; missing bones: '
                           + ', '.join(missing))

    def h(name):
        return rig.matrix_world @ bones[name].head_local

    def t(name):
        return rig.matrix_world @ bones[name].tail_local

    s = (t('thigh.L') - h('thigh.L')).length / 2.0881
    def p(x=0, y=0, z=0):
        return Vector((x*s, y*s, z*s))

    m = CapsuleMesh(rig, mats)
    hips, spine, lower, chest = (h(n) for n in ('Hips', 'spine', 'Lowerchest', 'upper chest'))

    # Dark, inset connectors make the separated, soft-edged torso shells legible
    # and cover their mechanical joints at larger changes in pose.
    m.capsule('Pelvis/spine inset', 'Hips', hips + p(0, 0, .31), hips + p(0, 0, .53),
              (.56*s, .31*s), mat='joint', ref=X, cap=.22)
    m.capsule('Lower back inset', 'spine', t('spine') + p(0, 0, -.085),
              t('spine') + p(0, 0, .105), (.56*s, .31*s),
              mat='joint', ref=X, cap=.19)
    m.capsule('Rib/sternum inset', 'Lowerchest', t('Lowerchest') + p(0, 0, -.085),
              t('Lowerchest') + p(0, 0, .13), (.67*s, .35*s),
              mat='joint', ref=X, cap=.19)

    m.capsule('Pelvis', 'Hips', hips + p(0, -.01, -.24), hips + p(0, -.01, .46),
              (.72*s, .40*s), (.78*s, .44*s), mat='porcelain', ref=X, cap=.27)
    m.capsule('Waist', 'spine', spine + p(0, -.015, .10), t('spine') + p(0, 0, -.005),
              (.62*s, .34*s), (.65*s, .37*s), mat='secondary', ref=X, cap=.20)
    m.capsule('Rib cage', 'Lowerchest', lower + p(0, 0, .02), t('Lowerchest') + p(0, 0, .005),
              (.67*s, .39*s), (.78*s, .45*s), mat='porcelain', ref=X, cap=.18)
    m.capsule('Upper chest', 'upper chest', chest + p(0, 0, .04), t('upper chest') + p(0, 0, .025),
              (.77*s, .45*s), (.99*s, .53*s), mat='porcelain', ref=X, cap=.15, bulge=.05)
    # Tiny understated chest hallmark; its position follows the chest bone.
    mark = h('upper chest').lerp(t('upper chest'), .58)
    m.capsule('Chest hallmark', 'upper chest', mark + p(-.115, -.555, 0),
              mark + p(.115, -.555, 0), (.022*s, .019*s),
              mat='accent', ref=Z, cap=.37, sides=20)

    neck_base = h('neck')
    m.capsule('Inner neck', 'neck', neck_base + p(0, 0, -.14), t('neck') + p(0, 0, .10),
              (.225*s, .22*s), mat='joint', ref=X, cap=.30)
    m.capsule('Neck shell', 'neck', neck_base + p(0, 0, .035),
              t('neck') + p(0, 0, -.06), (.235*s, .225*s),
              mat='secondary', ref=X, cap=.27)

    head_base = h('Head')
    m.capsule('Head', 'Head', head_base + p(0, 0, -.17), t('Head') + p(0, 0, .89),
              (.50*s, .455*s), (.59*s, .49*s),
              mat='porcelain', ref=X, cap=.36, bulge=.025, sides=40)
    for name in ('Eye L', 'Eye R'):
        eye = h(name)
        m.ball('Eye dot ' + name, name, eye + p(0, -.390, .12),
               (.052*s, .027*s, .078*s), mat='face', sides=20)
    # Very small neutral mouth, weighted to the original jaw bone.
    jaw = h('Jaw')
    m.capsule('Neutral mouth', 'Jaw', jaw + p(-.112, -.502, -.025),
              jaw + p(.112, -.502, -.025), (.014*s, .015*s),
              mat='face', ref=Z, cap=.38, sides=16)

    for side in ('L', 'R'):
        suf = '.' + side
        shoulder = 'shoulder' + suf
        upper = 'upper_arm' + suf
        forearm = 'forearm' + suf
        hand = 'hand' + suf
        udir = (t(upper) - h(upper)).normalized()
        fdir = (t(forearm) - h(forearm)).normalized()
        hdir = (t(hand) - h(hand)).normalized()

        m.capsule('Shoulder cap ' + side, shoulder,
                  h(shoulder) + udir * (.055*s), t(shoulder) - udir * (.014*s),
                  (.275*s, .282*s), (.295*s, .295*s),
                  mat='porcelain', ref=Z, cap=.40, sides=28)
        m.ball('Shoulder joint ' + side, upper, h(upper),
               (.285*s, .245*s, .268*s), mat='joint')
        m.capsule('Upper arm ' + side, upper,
                  h(upper) + udir * (.17*s), t(upper) - udir * (.115*s),
                  (.265*s, .242*s), (.213*s, .20*s),
                  mat='porcelain', ref=Z, cap=.27, bulge=.05)
        m.ball('Elbow ' + side, forearm, h(forearm),
               (.198*s, .188*s, .198*s), mat='joint')
        m.capsule('Forearm ' + side, forearm,
                  h(forearm) + fdir * (.125*s), t(forearm) - fdir * (.11*s),
                  (.213*s, .194*s), (.158*s, .151*s),
                  mat='secondary', ref=Z, cap=.19, bulge=.06)
        twist = 'Wrist Twist ' + side
        m.capsule('Wrist bearing ' + side, twist,
                  h(twist) - fdir * (.025*s), t(twist) + fdir * (.012*s),
                  (.135*s, .138*s), (.134*s, .136*s),
                  mat='joint', ref=Z, cap=.27, sides=24)
        m.capsule('Palm ' + side, hand,
                  h(hand) + hdir * (.018*s), t(hand) + hdir * (.092*s),
                  (.155*s, .205*s), (.119*s, .229*s),
                  mat='porcelain', ref=Z, cap=.28, sides=28)

        # Four independent fingers; phalanges are weighted to their *own*
        # existing bones. The distal terminal shell includes the source _end
        # length while remaining controlled by phalanx 3.
        names = [
            ('point 1 ' + side, 'point 2 ' + side, 'point 3 ' + side),
            ('Mid 1 ' + side, 'Mid 2 ' + side, 'Mid 3 ' + side),
            ('ring 1 ' + side, 'ring 2 ' + side, 'ring 3 ' + side),
            ('Pink 1 ' + side, 'Pink 2 ' + side, 'pink 3 ' + side),
        ]
        end_bones = ('point 3 ' + side + '_end', 'Mid 3 ' + side + '_end',
                     'ring 3 ' + side + '_end', 'pink 3 ' + side + '_end')
        for finger_idx, (chain, end_name) in enumerate(zip(names, end_bones)):
            for phalanx_idx, name in enumerate(chain):
                start, finish = h(name), t(name)
                direction = (finish - start).normalized()
                if phalanx_idx == 0:
                    start -= direction * (.022*s)
                if phalanx_idx == 2:
                    finish = t(end_name) - direction * (.018*s)
                size = (1.0 - .07*finger_idx) * (1.0 - .13*phalanx_idx)
                radius = (.045*s*size, .045*s*size)
                m.capsule(f'Finger {finger_idx+1}.{phalanx_idx+1} {side}',
                          name, start, finish, radius, (radius[0]*.84, radius[1]*.85),
                          mat='porcelain', ref=Z, cap=.33, sides=12)
        for i in (1, 2, 3):
            name = 'thumb ' + str(i) + ' ' + side
            start, finish = h(name), t(name)
            direction = (finish - start).normalized()
            if i == 1:
                start += direction * (.027*s)
            if i == 3:
                finish = t('thumb 3 ' + side + '_end') - direction*(.015*s)
            r = (.088 - .016*(i-1)) * s
            m.capsule(f'Thumb {i} {side}', name, start, finish,
                      (r, r*.91), (r*.83, r*.76),
                      mat='secondary', ref=Z, cap=.36, sides=16)

        thigh, shin, foot, toes = ('thigh' + suf, 'shin' + suf,
                                  'foot' + suf, 'Toes ' + side)
        hip = h(thigh)
        m.ball('Hip joint ' + side, thigh, hip, (.29*s, .28*s, .30*s), mat='joint')
        m.capsule('Thigh ' + side, thigh,
                  h(thigh).lerp(t(thigh), .095), h(thigh).lerp(t(thigh), .92),
                  (.346*s, .321*s), (.266*s, .241*s),
                  mat='porcelain', ref=X, cap=.155, bulge=.04)
        knee = h(shin)
        m.ball('Knee joint ' + side, shin, knee, (.254*s, .247*s, .265*s), mat='joint')
        m.capsule('Shin ' + side, shin,
                  h(shin).lerp(t(shin), .075), h(shin).lerp(t(shin), .927),
                  (.264*s, .244*s), (.160*s, .162*s),
                  mat='secondary', ref=X, cap=.14, bulge=.12)
        # A soft kneecap echoes the larger ivory shells without rigid spikes.
        m.ball('Kneecap ' + side, shin, knee + p(0, -.19, .005),
               (.165*s, .066*s, .142*s), mat='porcelain', sides=24)
        ankle = h(foot)
        m.ball('Ankle joint ' + side, foot, ankle,
               (.177*s, .177*s, .178*s), mat='joint', sides=24)
        # -Y is forward in this source rig. These are two separate, articulated
        # toe/foot shells, with low-profile soles planted near rest-pose Z=0.
        m.capsule('Foot ' + side, foot,
                  ankle + p(0, .195, -.275),
                  t(foot) + p(0, -.085, .075),
                  (.255*s, .205*s), (.295*s, .169*s),
                  mat='porcelain', ref=X, cap=.30, sides=28)
        m.capsule('Sole ' + side, foot,
                  ankle + p(0, .135, -.493),
                  t(foot) + p(0, -.075, -.051),
                  (.24*s, .033*s), (.275*s, .037*s),
                  mat='joint', ref=X, cap=.25, sides=24)
        m.capsule('Toe ' + side, toes,
                  h(toes) + p(0, .015, .073),
                  t(toes + '_end') + p(0, .012, .096),
                  (.290*s, .162*s), (.255*s, .134*s),
                  mat='porcelain', ref=X, cap=.35, sides=28)
        m.capsule('Toe sole ' + side, toes,
                  h(toes) + p(0, .015, -.073),
                  t(toes + '_end') + p(0, .035, -.001),
                  (.265*s, .028*s), (.235*s, .028*s),
                  mat='joint', ref=X, cap=.30, sides=20)

    return m.build(collection)


def area_light(name, location, target, power, color, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def studio_camera(name, location, target, ortho):
    data = bpy.data.cameras.new(name)
    data.type = 'ORTHO'
    data.ortho_scale = ortho
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def create_studio():
    scene = bpy.context.scene
    studio = bpy.data.collections.new('90 · Studio (not exported)')
    scene.collection.children.link(studio)
    ground_mat = material('Studio · smoke graphite', (.115, .134, .15), roughness=.83)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.06))
    ground = bpy.context.object
    ground.name = 'Studio floor · render only'
    ground.data.materials.append(ground_mat)
    move_to_collection(ground, studio)
    ground.hide_set(True)  # Hide only in the viewport; keep floor for render shadows.
    lights = [
        area_light('Soft key / warm', (-8.5, -9, 14), (0, 0, 5), 3150, (1.0, .91, .82), 8),
        area_light('Front fill / neutral', (7.5, -7, 8.5), (0, 0, 5), 1750, (.88, .94, 1.0), 9),
        area_light('Rim / cool', (5.0, 8, 12), (0, 0, 5), 3700, (.77, .88, 1.0), 6),
        area_light('Head bounce', (-1.0, -5, 12), (0, 0, 8), 550, (1.0, 1.0, 1.0), 4),
    ]
    hero = studio_camera('Portrait · three-quarter', (9.5, -24, 11.4), (0, -.02, 4.86), 11.7)
    front = studio_camera('Reference · straight front', (0, -26, 8.7), (0, -.05, 4.83), 11.7)
    for ob in (*lights, hero, front):
        move_to_collection(ob, studio)
        ob.hide_set(True)  # Studio is out of the way while modelling.
    scene.camera = hero
    world = bpy.data.worlds.new('Soft slate ambience')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (.19, .225, .26, 1)
    bg.inputs['Strength'].default_value = .38
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.max_bounces = 6
    # Some Linux Blender packages are built WITHOUT OpenImageDenoise. Leave it
    # off in both Cycles and the view layer so this standalone script works on
    # stock builds everywhere; increase --samples for cleaner final renders.
    scene.cycles.use_denoising = False
    bpy.context.view_layer.cycles.use_denoising = False
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    return hero, front


def set_viewport(camera):
    # Save a useful framing instead of Blender's origin-centered default view.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                view = area.spaces.active
                view.region_3d.view_location = (0, 0, 4.85)
                view.region_3d.view_distance = 16.5
                view.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
                view.shading.type = 'MATERIAL'
                view.overlay.show_floor = False
                view.overlay.show_axis_x = False
                view.overlay.show_axis_y = False


def apply_preview_pose(rig):
    """A deliberately mild A-pose to show that the original rig deforms the mesh."""
    rotations = {
        'upper_arm.L': ('Z', -43), 'upper_arm.R': ('Z', 32),
        'forearm.L': ('X', 25), 'forearm.R': ('X', 34),
        'hand.L': ('X', -8), 'hand.R': ('X', -10),
    }
    for name, (axis, degrees) in rotations.items():
        bone = rig.pose.bones[name]
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler['XYZ'.index(axis)] = math.radians(degrees)
    bpy.context.view_layer.update()


def clear_preview_pose(rig):
    for name in ('upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R',
                 'hand.L', 'hand.R'):
        rig.pose.bones[name].rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()


def export_character(path, rig, character):
    bpy.ops.object.select_all(action='DESELECT')
    rig.hide_set(False)
    rig.select_set(True)
    character.select_set(True)
    bpy.context.view_layer.objects.active = character
    bpy.ops.export_scene.fbx(
        filepath=str(path), use_selection=True,
        object_types={'ARMATURE', 'MESH'},
        global_scale=1.0, apply_unit_scale=True,
        axis_forward='-Z', axis_up='Y',
        add_leaf_bones=False, bake_anim=False,
        use_mesh_modifiers=True, mesh_smooth_type='FACE',
        path_mode='AUTO',
    )
    print('FBX_WRITTEN:', path, path.stat().st_size, 'bytes')


def main():
    args = arguments()
    source = args.input.expanduser().resolve()
    dest = args.output_dir.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f'Input FBX does not exist: {source}')
    dest.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
    scene = bpy.context.scene
    rigs = [o for o in scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError(f'Expected one source skeleton, found {len(rigs)}')
    rig = rigs[0]
    original_names = {b.name for b in rig.data.bones}
    source_collection = bpy.data.collections.new('99 · Original Body and Head (hidden reference)')
    scene.collection.children.link(source_collection)
    for obj in list(scene.objects):
        if obj.type == 'MESH':
            move_to_collection(obj, source_collection)
            obj.hide_set(True)
            obj.hide_render = True
            obj.display_type = 'WIRE'
    rig_collection = bpy.data.collections.new('01 · Capsule character and ORIGINAL armature')
    scene.collection.children.link(rig_collection)
    move_to_collection(rig, rig_collection)
    rig.data.display_type = 'STICK'
    rig.show_in_front = False
    rig['Source'] = source.name
    rig['Preserved bone names and hierarchy'] = 'YES'

    mats = {
        'porcelain': material('01 · warm porcelain', (.78, .785, .77), roughness=.36, metallic=.08),
        'secondary': material('02 · mist / secondary shell', (.59, .625, .635), roughness=.44, metallic=.10),
        'joint': material('03 · soft charcoal / articulated joints', (.092, .127, .146), roughness=.47, metallic=.19),
        'accent': material('04 · brushed nickel / discreet mark', (.71, .75, .75), roughness=.32, metallic=.58),
        'face': material('05 · graphite / minimal face', (.070, .105, .120), roughness=.38, metallic=.08),
    }
    character = build_character(rig, rig_collection, mats)
    assert {b.name for b in rig.data.bones} == original_names, 'Bone names changed unexpectedly'
    print(f'ORIGINAL_RIG: {len(rig.data.bones)} bones unchanged; '
          f'{len(list(source_collection.objects))} source reference meshes hidden')
    hero, front = create_studio()
    scene.cycles.samples = max(1, args.samples)
    set_viewport(hero)
    bpy.ops.object.select_all(action='DESELECT')
    character.select_set(True)
    bpy.context.view_layer.objects.active = character
    blend = dest / 'capsule_mannequin.blend'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    print('BLEND_WRITTEN:', blend, blend.stat().st_size, 'bytes')
    fbx = dest / 'capsule_mannequin.fbx'
    export_character(fbx, rig, character)
    if not args.no_render:
        def render_image(camera, filename, resolution):
            scene.camera = camera
            scene.render.resolution_x = resolution
            scene.render.resolution_y = resolution
            scene.render.filepath = str(dest / filename)
            bpy.ops.render.render(write_still=True)
            print('PREVIEW_WRITTEN:', scene.render.filepath)

        render_image(hero, 'preview_hero.png', 1400)
        render_image(front, 'preview_front.png', 1100)
        apply_preview_pose(rig)
        render_image(hero, 'preview_pose.png', 1400)
        clear_preview_pose(rig)
        scene.camera = hero
    print('SUCCESS: Source FBX unchanged. Character mesh is skinned to the ORIGINAL armature.')


if __name__ == '__main__':
    main()
