# Rendu d'une case d'atlas avec le tanuki v3 (conv-1558, 2026-11-05) : matières, fourrure et lumière de sprite-v3.py,
# objets du Quartier (pancarte, encens, coussin, bol, râteau, arrosoir, sabre) de conv-1446/renard/sprite5.py, même caméra.
# Usage : MODELE=v3 RES=600 ECH=48 python sprite-atlas-v3.py pose.bin sortie.png yaw [objet] [phase]
import math, os, sys
import numpy as np
import bpy
from mathutils import Vector

pose, sortie, yaw = sys.argv[1], os.path.abspath(sys.argv[2]), float(sys.argv[3])
PITCH = 30.0
MOD = os.environ.get('MODELE', 'v3')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = int(os.environ.get('ECH', 96))
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 4
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = int(os.environ.get('RES', 600))
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = sortie
sc.view_settings.view_transform = 'Standard'
P = np.fromfile(pose, np.float32).reshape(-1, 3)
Co = np.fromfile(f"b3d/base-{MOD}.col.bin", np.float32).reshape(-1, 3)
Gl = np.fromfile(f"b3d/base-{MOD}.gl.bin", np.float32)
I = np.fromfile(f"b3d/base-{MOD}.idx.bin", np.uint32).reshape(-1, 3)
V = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
me = bpy.data.meshes.new('t')
me.vertices.add(len(V))
me.vertices.foreach_set('co', V.ravel())
me.loops.add(len(I) * 3)
me.loops.foreach_set('vertex_index', I.ravel().astype(np.int32))
me.polygons.add(len(I))
me.polygons.foreach_set('loop_start', np.arange(0, len(I) * 3, 3, dtype=np.int32))
me.update(calc_edges=True)
me.polygons.foreach_set('use_smooth', np.ones(len(I), bool))
me.update()
ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
CL = np.clip(Co[I.ravel()], 0, 1) ** (1 / 1.22)
ca.data.foreach_set('color', np.hstack([CL, np.ones((len(CL), 1))]).ravel())


def base(nom):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    pb = next(x for x in n if x.type == 'BSDF_PRINCIPLED')
    c = n.new('ShaderNodeVertexColor')
    c.layer_name = 'Col'
    l.new(c.outputs['Color'], pb.inputs['Base Color'])
    return m, n, l, pb


def relief(n, l, pb, echelle, force, distance, motif='bruit'):
    tc = n.new('ShaderNodeTexCoord')
    if motif == 'trame':
        # Une toile : deux séries de fils croisés, chaîne et trame.
        a = n.new('ShaderNodeTexWave'); a.wave_type = 'BANDS'; a.bands_direction = 'X'
        b = n.new('ShaderNodeTexWave'); b.wave_type = 'BANDS'; b.bands_direction = 'Z'
        for w in (a, b):
            w.inputs['Scale'].default_value = echelle
            w.inputs['Distortion'].default_value = 1.2
            w.inputs['Detail'].default_value = 1.0
            l.new(tc.outputs['Object'], w.inputs['Vector'])
        m = n.new('ShaderNodeMath'); m.operation = 'MULTIPLY'
        l.new(a.outputs['Fac'], m.inputs[0]); l.new(b.outputs['Fac'], m.inputs[1])
        h = m.outputs[0]
    else:
        t = n.new('ShaderNodeTexNoise')
        t.inputs['Scale'].default_value = echelle
        t.inputs['Detail'].default_value = 10
        t.inputs['Roughness'].default_value = .7
        l.new(tc.outputs['Object'], t.inputs['Vector'])
        h = t.outputs['Fac']
    bu = n.new('ShaderNodeBump')
    bu.inputs['Strength'].default_value = force
    bu.inputs['Distance'].default_value = distance
    l.new(h, bu.inputs['Height'])
    l.new(bu.outputs['Normal'], pb.inputs['Normal'])


# 0 : laine feutrée sous la fourrure (peau du tanuki)
ml, n, l, pb = base('laine')
_vc = next(x for x in n if x.type == 'VERTEX_COLOR')
_sous = n.new('ShaderNodeMix'); _sous.data_type = 'RGBA'; _sous.blend_type = 'MULTIPLY'
_sous.inputs['Factor'].default_value = 1; _sous.inputs['B'].default_value = (.7, .68, .66, 1)
l.new(_vc.outputs['Color'], _sous.inputs['A']); l.new(_sous.outputs['Result'], pb.inputs['Base Color'])
pb.inputs['Roughness'].default_value = .93
pb.inputs['Specular IOR Level'].default_value = .12
pb.inputs['Sheen Weight'].default_value = 1
pb.inputs['Sheen Roughness'].default_value = .55
pb.inputs['Subsurface Weight'].default_value = .18
pb.inputs['Subsurface Scale'].default_value = .012
relief(n, l, pb, 520, .35, .002)
# 1 : tissu — coton tissé, mat, un léger lustre de soie sur les arêtes, aucun poil
mt, n, l, pb = base('tissu')
pb.inputs['Roughness'].default_value = .78
pb.inputs['Specular IOR Level'].default_value = .2
pb.inputs['Sheen Weight'].default_value = .45
pb.inputs['Sheen Roughness'].default_value = .35
relief(n, l, pb, float(os.environ.get('TRAME', 380)), .18, .0012, 'trame')
# 2 : mat (traits, moustaches, sandales)
mm, n, l, pb = base('mat')
pb.inputs['Roughness'].default_value = .6
pb.inputs['Specular IOR Level'].default_value = .25
# 3 : perle (yeux, nez, reflets) à la couleur du sommet
mp, n, l, pb = base('perle')
pb.inputs['Roughness'].default_value = .04
pb.inputs['Coat Weight'].default_value = 1
# 4 : poil
mh = bpy.data.materials.new('poil')
mh.use_nodes = True
n, l = mh.node_tree.nodes, mh.node_tree.links
n.remove(next(x for x in n if x.type == 'BSDF_PRINCIPLED'))
h = n.new('ShaderNodeBsdfHairPrincipled')
h.parametrization = 'COLOR'
c = n.new('ShaderNodeVertexColor')
c.layer_name = 'Col'
# Racine sombre, pointe claire, et chaque mèche un peu différente : c'est ce qui fait lire un pelage.
hi = n.new('ShaderNodeHairInfo')
fonce = n.new('ShaderNodeMix'); fonce.data_type = 'RGBA'; fonce.blend_type = 'MULTIPLY'
fonce.inputs['Factor'].default_value = 1
l.new(c.outputs['Color'], fonce.inputs['A']); fonce.inputs['B'].default_value = (.62, .6, .6, 1)
# Pointe éclaircie en PROPORTION (×1,3) : un écran vers le blanc grisait les pattes noires et les anneaux de la queue.
clair = n.new('ShaderNodeMix'); clair.data_type = 'RGBA'; clair.blend_type = 'MULTIPLY'
clair.inputs['Factor'].default_value = 1
l.new(c.outputs['Color'], clair.inputs['A']); clair.inputs['B'].default_value = (1.32, 1.29, 1.25, 1)
rampe = n.new('ShaderNodeMix'); rampe.data_type = 'RGBA'
l.new(hi.outputs['Intercept'], rampe.inputs['Factor'])
l.new(fonce.outputs['Result'], rampe.inputs['A']); l.new(clair.outputs['Result'], rampe.inputs['B'])
alea = n.new('ShaderNodeMix'); alea.data_type = 'RGBA'; alea.blend_type = 'MULTIPLY'
mr = n.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = .86; mr.inputs['To Max'].default_value = 1.08
l.new(hi.outputs['Random'], mr.inputs['Value'])
cr = n.new('ShaderNodeCombineColor')
for k in ('Red', 'Green', 'Blue'):
    l.new(mr.outputs['Result'], cr.inputs[k])
alea.inputs['Factor'].default_value = 1
l.new(rampe.outputs['Result'], alea.inputs['A']); l.new(cr.outputs['Color'], alea.inputs['B'])
l.new(alea.outputs['Result'], h.inputs['Color'])
h.inputs['Roughness'].default_value = .62
h.inputs['Radial Roughness'].default_value = .75
h.inputs['Random Roughness'].default_value = .25
l.new(h.outputs[0], next(x for x in n if x.type == 'OUTPUT_MATERIAL').inputs['Surface'])
for m in (ml, mt, mm, mp, mh):
    me.materials.append(m)
g = Gl[I].min(1)
pa = np.zeros(len(I), np.int32)
pa[g > .15] = 1
pa[g > .4] = 2
pa[g > .75] = 3
me.polygons.foreach_set('material_index', pa)
me.update()
ob = bpy.data.objects.new('t', me)
sc.collection.objects.link(ob)
ob.rotation_euler = (0, 0, math.radians(yaw))
bpy.context.view_layer.objects.active = ob
poilu = np.where(Gl < .11)[0]
vg = ob.vertex_groups.new(name='poil')
vg.add(poilu.tolist(), 1.0, 'REPLACE')
vl = ob.vertex_groups.new(name='long')
# conv-1558 : le bout de la queue garde un poil court (queue-effilee.py), sinon sa touffe dépasse de la case de profil.
Lq = np.clip(1 - 8 * np.round(Gl[poilu] * 255) / 255, .15, 1)
fq = os.environ.get('QUEUE') or f"b3d/base-{MOD}.queue.bin"
if os.path.exists(fq):
    Lq = Lq * np.fromfile(fq, np.float32)[poilu]
Lq = np.round(Lq * 40) / 40
for v in np.unique(Lq):
    vl.add(poilu[Lq == v].tolist(), float(v), 'REPLACE')
md = ob.modifiers.new('p', 'PARTICLE_SYSTEM')
ps = md.particle_system
ps.vertex_group_density = 'poil'
ps.vertex_group_length = 'long'
q = ps.settings
q.type = 'HAIR'
q.count = int(os.environ.get('POILS', 45000))
q.hair_length = float(os.environ.get('LONGUEUR', .019))
q.hair_step = 5
q.material_slot = 'poil'
q.emit_from = 'FACE'
q.use_modifier_stack = True
q.use_advanced_hair = True
# La fourrure couche vers le bas et l'arrière, comme un pelage brossé, au lieu de se hérisser.
q.normal_factor = .012
q.object_align_factor = (0, .003, -.0085)
q.factor_random = .002
q.brownian_factor = .0012
# Blender multiplie l'épaisseur par radius_scale (0,01 par défaut) : les poils d'avant faisaient 10 µm, un simple voile.
q.radius_scale = 1
q.root_radius = float(os.environ.get('RACINE', .0009))
q.tip_radius = .00012
q.render_step = 4
q.effector_weights.gravity = 0
if int(os.environ.get('ENFANTS', 11)):
    q.child_type = 'INTERPOLATED'
    q.rendered_child_count = int(os.environ.get('ENFANTS', 11))
    q.child_percent = 1
    q.child_length = 1
    q.clump_factor = .42
    q.clump_shape = .25
    q.roughness_1 = .0028
    q.roughness_1_size = 1
    q.roughness_endpoint = .0035
    q.roughness_end_shape = 1.2

# --- Objets du Quartier (copiés de conv-1446/renard/sprite5.py) : leur propre base() de matière, sans couleur de sommet.
def base(nom):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links

# La pancarte : une vraie planche dorée au bout d'un manche, à l'endroit exact de la main, tournée comme le tanuki.
if len(sys.argv) > 4 and sys.argv[4] == 'pancarte':
    import json
    J = json.load(open(pose + '.json'))
    mx, my, mz = J['main']
    M0 = Vector((mx, -mz, my))
    def boite(nom, ex, ey, ez, c, mat):
        bpy.ops.mesh.primitive_cube_add(size=1, location=c)
        o = bpy.context.active_object
        o.scale = (ex, ey, ez)
        o.data.materials.append(mat)
        o.parent = ob
        return o
    mo, n, l = base('or')
    n['Principled BSDF'].inputs['Base Color'].default_value = (1.0, .70, .08, 1)
    n['Principled BSDF'].inputs['Emission Color'].default_value = (1.0, .66, .10, 1)
    n['Principled BSDF'].inputs['Emission Strength'].default_value = .55
    n['Principled BSDF'].inputs['Metallic'].default_value = .55
    n['Principled BSDF'].inputs['Roughness'].default_value = .38
    mb, n, l = base('manche')
    n['Principled BSDF'].inputs['Base Color'].default_value = (.36, .19, .07, 1)
    n['Principled BSDF'].inputs['Roughness'].default_value = .6
    me2, n, l = base('marque')
    n['Principled BSDF'].inputs['Base Color'].default_value = (.08, .04, .02, 1)
    H0 = M0.z + .16
    boite('manche', .022, .022, H0 - M0.z + .1, Vector((M0.x, M0.y, (H0 + M0.z - .1) / 2)), mb)
    boite('planche', .31, .022, .19, Vector((M0.x, M0.y, H0 + .09)), mo)
    boite('cadre', .335, .016, .215, Vector((M0.x, M0.y + .006, H0 + .09)), mb)
    # Un point d'exclamation : il se lit même à 50 px, et il dit qu'on attend quelqu'un.
    boite('barre', .036, .03, .092, Vector((M0.x, M0.y - .012, H0 + .107)), me2)
    boite('point', .036, .03, .032, Vector((M0.x, M0.y - .012, H0 + .027)), me2)
    bpy.context.view_layer.objects.active = ob
# Les objets du dojo et des pauses.
OBJET = sys.argv[4] if len(sys.argv) > 4 else ''
PHASE = float(sys.argv[5]) if len(sys.argv) > 5 else 0.
if OBJET and OBJET != 'pancarte':
    import json
    from mathutils import Quaternion
    J = json.load(open(pose + '.json'))
    vers = lambda a: Vector((a[0], -a[2], a[1]))
    MD, MG, AD, AG = vers(J['D']['p']), vers(J['G']['p']), vers(J['D']['a']), vers(J['G']['a'])

    def mat(nom, c, r=.5, m=0., e=0.):
        ma, n, l = base(nom)
        b = n['Principled BSDF']
        b.inputs['Base Color'].default_value = (*c, 1)
        b.inputs['Roughness'].default_value = r
        b.inputs['Metallic'].default_value = m
        if e:
            b.inputs['Emission Color'].default_value = (*c, 1)
            b.inputs['Emission Strength'].default_value = e
        return ma

    def attache(o, ma):
        o.data.materials.append(ma)
        o.parent = ob
        for f in o.data.polygons:
            f.use_smooth = True
        return o

    def tige(p0, p1, r, ma, r2=None, faces=16):
        d = p1 - p0
        bpy.ops.mesh.primitive_cone_add(vertices=faces, radius1=r, radius2=r if r2 is None else r2, depth=d.length, location=(p0 + p1) / 2)
        o = bpy.context.active_object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return attache(o, ma)

    def ordre_fixe(o):
        # conv-1558 : la sphère UV de Blender 5.0.1 a les mêmes points à chaque lancement, mais ses faces et leur
        # premier coin changent d'ordre (mesuré : 3 lancements, 3 empreintes de coins). Les quads se coupent alors sur
        # l'autre diagonale et la case diffère de 150 à 2 300 px. On la refait à l'identique, faces dans un ordre fixe.
        m = o.data
        faces = []
        for p in m.polygons:
            vs = list(p.vertices)
            k = vs.index(min(vs))
            faces.append(tuple(vs[k:] + vs[:k]))
        faces.sort()
        n = bpy.data.meshes.new(m.name)
        n.from_pydata([v.co.copy() for v in m.vertices], [], faces)
        n.update()
        o.data = n
        bpy.data.meshes.remove(m)

    def boule(c, r, ma, ech=(1, 1, 1)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=r, location=c)
        o = bpy.context.active_object
        ordre_fixe(o)
        o.scale = ech
        return attache(o, ma)

    def boite(c, e, ma, rz=0.):
        bpy.ops.mesh.primitive_cube_add(size=1, location=c, rotation=(0, 0, rz))
        o = bpy.context.active_object
        o.scale = e
        o.data.materials.append(ma)
        o.parent = ob
        return o

    BOIS = mat('bois', (.46, .25, .1), .55)
    if OBJET == 'encens':
        # Le brûle-encens du dojo : une cuve de bronze sur trois pieds, un couvercle ajouré, devant les marches.
        ob.hide_render = True
        ob.modifiers.remove(md)
        bz = mat('bronze', (.28, .2, .1), .32, .85)
        vb = mat('vert-de-gris', (.24, .36, .3), .55, .3)
        for k in range(3):
            a0 = 2 * math.pi * k / 3 + .5
            tige(Vector((math.cos(a0) * .1, math.sin(a0) * .1, 0)), Vector((math.cos(a0) * .085, math.sin(a0) * .085, .1)), .018, bz, .024)
        boule(Vector((0, 0, .16)), .14, bz, (1, 1, .62))
        tige(Vector((0, 0, .2)), Vector((0, 0, .235)), .15, vb, .145)
        boule(Vector((0, 0, .25)), .1, bz, (1, 1, .5))
        tige(Vector((0, 0, .28)), Vector((0, 0, .34)), .022, bz, .01)
        boule(Vector((0, 0, .345)), .025, bz)
    if OBJET == 'coussin':
        ob.hide_render = True
        ob.modifiers.remove(md)
        ind = mat('indigo', (.03, .03, .07), .8)
        fil = mat('lisere', (.72, .54, .18), .5)
        boite(Vector((0, 0, .012)), (.42, .36, .024), mat('zabuton', (.018, .02, .03), .95))
        for x in (-.21, .21):
            tige(Vector((x, -.18, .024)), Vector((x, .18, .024)), .005, fil)
        for y in (-.18, .18):
            tige(Vector((-.21, y, .024)), Vector((.21, y, .024)), .005, fil)
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=.17, depth=.075, location=(0, 0, .062))
        z = bpy.context.active_object
        b = z.modifiers.new('b', 'BEVEL')
        b.width = .03
        b.segments = 6
        attache(z, ind)
        bpy.ops.mesh.primitive_torus_add(major_radius=.17, minor_radius=.005, location=(0, 0, .062))
        attache(bpy.context.active_object, fil)
    CLAIR = mat('clair', (.8, .6, .34), .5)
    if OBJET == 'bol':
        # Le bol au creux des deux mains, et le plateau posé à côté de lui.
        cer = mat('ceramique', (.16, .32, .4), .22)
        cre = mat('creme', (.92, .86, .72), .35)
        c0 = (MD + MG) / 2 + Vector((0, -.012, .03))
        tige(c0 + Vector((0, 0, -.03)), c0 + Vector((0, 0, .035)), .036, cer, .047)
        boule(c0 + Vector((0, 0, .031)), .04, mat('the', (.42, .5, .12), .2), (1, 1, .08))
        boite(Vector((.235, -.2, .012)), (.25, .17, .022), BOIS, .12)
        boule(Vector((.2, -.205, .068)), .054, mat('theiere', (.32, .13, .06), .3), (1, 1, .86))
        tige(Vector((.245, -.21, .07)), Vector((.292, -.222, .1)), .014, mat('bec', (.32, .13, .06), .3), .009)
        boule(Vector((.2, -.205, .118)), .016, cre)
        tige(Vector((.3, -.17, .024)), Vector((.3, -.17, .06)), .024, cre, .03)
    elif OBJET == 'rateau':
        tete = Vector((0, -.4 - .08 * math.sin(2 * math.pi * PHASE), .022))
        m0 = (MD + MG) / 2
        d = (m0 - tete).normalized()
        tige(tete, m0 + d * .2, .0125, CLAIR)
        boite(tete, (.3, .03, .03), BOIS)
        for i in range(7):
            x = -.13 + i * .0433
            tige(Vector((x, tete.y, .02)), Vector((x, tete.y - .012, -.03)), .0085, BOIS, .004, 8)
    elif OBJET == 'arrosoir':
        met = mat('zinc', (.27, .46, .42), .34, .55)
        pen = .3 + .08 * math.sin(2 * math.pi * PHASE)
        axe = Vector((0, -math.sin(pen), math.cos(pen)))
        av = Vector((0, -math.cos(pen), -math.sin(pen)))
        c0 = MD + Vector((0, -.052, -.05))
        tige(c0 - axe * .05, c0 + axe * .05, .052, met)
        bec0 = c0 + av * .045 - axe * .03
        bec1 = bec0 + av * .13 + axe * .055
        tige(bec0, bec1, .0115, met, .017)
        boule(bec1 + av * .004, .021, met, (1, 1, .55))
        bpy.ops.mesh.primitive_torus_add(major_radius=.042, minor_radius=.0075, location=c0 + axe * .05, rotation=(0, math.pi / 2, 0))
        attache(bpy.context.active_object, met)
        eau = mat('eau', (.58, .86, .98), .08, 0., .55)
        for i in range(6):
            u = (PHASE * 2 + i / 6) % 1
            v0 = bec1 + av * .03
            boule(v0 + Vector((.012 * math.sin(i * 2.4), -.13 * u, -v0.z * u * u)), .0105 * (1 - .3 * u), eau, (1, 1, 1.5))
    elif OBJET == 'sabre':
        m0 = (MD + MG) / 2
        lisse = lambda x: x * x * (3 - 2 * x)
        bo = lambda x, a, b_: max(0., min(1., (x - a) / (b_ - a)))
        mo, fr, re = lisse(bo(PHASE, .12, .42)), bo(PHASE, .42, .56) ** 2, lisse(bo(PHASE, .7, 1))
        b_ = (mo - fr * 1.28) * (1 - re)
        an = math.radians(44 + 88 * b_)          # 0 = droit devant, 90 = vers le ciel
        d = Vector((0, -math.cos(an), math.sin(an)))
        tige(m0 - d * .09, m0 + d * .5, .02, CLAIR, .0135)
        tige(m0 + d * .035, m0 + d * .05, .046, BOIS)
cd = bpy.data.cameras.new('c')
cd.type = 'ORTHO'
tete = os.environ.get('CADRE') == 'tete'
cd.ortho_scale = .58 if tete else 1.32
cam = bpy.data.objects.new('c', cd)
sc.collection.objects.link(cam)
sc.camera = cam
pr = math.radians(PITCH if not tete else 12)
centre = Vector((0, 0, .76 if tete else .47))
cam.location = centre + Vector((0, -math.cos(pr), math.sin(pr))) * 12
cam.rotation_euler = (math.pi / 2 - pr, 0, 0)
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
bg = next(x for x in w.node_tree.nodes if x.type == 'BACKGROUND')
bg.inputs[0].default_value = (.92, .90, .86, 1)
bg.inputs[1].default_value = float(os.environ.get('CIEL', .42))


def soleil(nom, e, rx, rz, coul, ang):
    d = bpy.data.lights.new(nom, 'SUN')
    d.energy, d.color, d.angle = e, coul, math.radians(ang)
    o = bpy.data.objects.new(nom, d)
    sc.collection.objects.link(o)
    o.rotation_euler = (math.radians(rx), 0, math.radians(rz))


soleil('cle', float(os.environ.get('CLE', 2.6)), 50, -35, (1, .95, .86), 18)
soleil('debouchage', .55, 70, 55, (.86, .92, 1), 30)
soleil('contre', 3.2, -48, 28, (1, .93, .82), 12)
bpy.ops.render.render(write_still=True)
