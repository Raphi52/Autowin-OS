# Rendu d'une case de l'agent planté avec le tanuki v3 (conv-1558) : sprite-v3.py + objets de conv-1446/renard/sprite5-plante.py.
# Usage : MODELE=v3 RES=600 ECH=48 python sprite-plante-v3.py pose.bin sortie.png yaw objet [phase]
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

# Les objets de l'agent planté (conv-1549). Tout est EXAGÉRÉ : à l'écran l'agent fait ~60 px, il faut lire
# « il pleure », « il fume », « il boit » d'un coup d'œil. Tout reste opaque : sous alpha .5, atlas-plus.py remplace
# la couleur par celle du bord le plus proche, une fumée translucide prendrait la couleur du kimono.
OBJET = sys.argv[4] if len(sys.argv) > 4 else ''
if OBJET:
    import json
    J = json.load(open(pose + '.json'))
    vers = lambda a: Vector((a[0], -a[2], a[1]))
    MD, MG, AD, AG = vers(J['D']['p']), vers(J['G']['p']), vers(J['D']['a']), vers(J['G']['a'])
    TE, DR, HA, AV = (vers(J['tete'][k]) for k in ('p', 'dr', 'ha', 'av'))
    YD, YG, BO = vers(J['yD']), vers(J['yG']), vers(J['bouche'])
    PH = J.get('ph') or {}
    PHASE = float(sys.argv[5]) if len(sys.argv) > 5 else J['phase']
    HAUT = Vector((0, 0, 1))

    def plat(v):
        # La composante horizontale d'un axe, normée : une larme ou une bouffée part sur le côté, pas dans le sol.
        w = Vector((v.x, v.y, 0))
        return w.normalized() if w.length > 1e-6 else Vector((1, 0, 0))

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

    def tige(p0, p1, r, ma, r2=None, faces=20):
        d = p1 - p0
        bpy.ops.mesh.primitive_cone_add(vertices=faces, radius1=r, radius2=r if r2 is None else r2, depth=d.length, location=(p0 + p1) / 2)
        o = bpy.context.active_object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return attache(o, ma)

    def boule(c, r, ma, ech=(1, 1, 1), axe=None):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=r, location=c)
        o = bpy.context.active_object
        o.scale = ech
        if axe is not None:
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axe.normalized())
        return attache(o, ma)

    # Le personnage est tourné de `yaw` : les objets, enfants de `ob`, sont dans son repère. Le haut reste le haut.
    if OBJET == 'larmes':
        # Deux fontaines de grosses larmes bleues qui giclent des yeux de part et d'autre de la tête et retombent en
        # flaques. Deux jets par boucle : PHASE·2 fait boucler la dernière image sur la première.
        eau = mat('larme', (.1, .45, 1.0), .05, 0., .8)
        flaque = mat('flaque', (.12, .42, .95), .08, 0., .5)
        s = PH.get('sanglot', 0.)
        for oe, y in ((-1, YD), (1, YG)):
            ext = plat(DR * oe + plat(AV) * .2)
            depart = y + DR * oe * .055 + AV * .035
            for i in range(6):
                u = (PHASE * 2 + i / 6) % 1
                # Un arc : la larme part vite vers l'extérieur et un peu vers le haut, puis tombe.
                p = depart + ext * (.03 + .1 * u) + HAUT * (.07 * math.sin(math.pi * min(u, .5)) - .42 * u * u)
                if p.z < .02:
                    continue
                r = (.034 - .008 * u) * (1 + .15 * s)
                boule(p, r, eau, (1, 1, 1.45), axe=Vector((ext.x * .8, ext.y * .8, .2 - 1.6 * u)))
            # Une coulée sur la joue, sous la main : la larme se voit même quand la main cache l'œil.
            tige(y + AV * .03 + DR * oe * .04, y + AV * .045 + DR * oe * .06 - HA * .09, .014, eau, .022)
            # La flaque où retombent les larmes.
            fin = depart + ext * .12
            boule(Vector((fin.x, fin.y, .006)), .07, flaque, (1.1, .8, .07))
    elif OBJET == 'cigarette':
        monte, aspire, souffle = PH.get('monte', 0.), PH.get('aspire', 0.), PH.get('souffle', 0.)
        papier = mat('papier', (.96, .95, .9), .6, 0., .25)
        filtre = mat('filtre', (.86, .52, .2), .55)
        # Trop forte, la braise sature en boule blanche puis jaune (témoins du 04/11) : elle doit rester rouge orangé.
        braise = mat('braise', (1.0, .16, .02), .4, 0., 1.4 + 2.2 * aspire)
        cendre = mat('cendre', (.42, .4, .38), .9)
        fumee = mat('fumee', (.56, .57, .6), .95, 0., .12)
        # La cigarette : placée par pose-plante.mjs (filtre f, axe d), dans la main ou aux lèvres.
        F, dc = vers(J['objets']['clope']['f']), vers(J['objets']['clope']['d'])
        L = .2
        tige(F, F + dc * .05, .021, filtre)
        tige(F + dc * .05, F + dc * (L - .026), .02, papier)
        tige(F + dc * (L - .026), F + dc * (L - .01), .021, cendre)
        bout = F + dc * L
        boule(bout - dc * .006, .026 * (1 + .45 * aspire), braise)
        # Un filet de fumée qui ondule en montant du bout, sans arrêt : une chaîne de petites boules grises dont
        # l'onde défile (deux fois par boucle).
        for i in range(9):
            a = i / 9
            p = bout + HAUT * (.025 + .2 * a) + DR * .028 * math.sin(2 * math.pi * (1.4 * a - 2 * PHASE))
            boule(p, .011 + .012 * a, fumee)
        # La grosse bouffée soufflée : des nuages gris qui sortent de la bouche et montent au-dessus de la tête, sur
        # le côté opposé à la main (ils se détachent sur le fond).
        # Elle monte vite : collée à la joue, elle ressemblait à une boule de coton (témoin du 04/11).
        for k in range(8):
            a = (PHASE - .58 - k * .03) % 1
            if a > .55:
                continue
            w = math.sqrt(a / .55)
            p = BO + AV * .05 + HAUT * (.06 + .46 * w) + plat(DR) * (.06 + .15 * w) + plat(AV) * .03 * math.sin(2.1 * k)
            # Elle s'éteint en entier : un reste de quelques pixels flottait seul au-dessus de la tête (image 4).
            r = (.034 + .062 * w) * (1 - max(0., w - .75) / .25)
            if r < .025:
                continue
            boule(p, r, fumee)
    elif OBJET == 'bouteille':
        monte, gorgee, tangue = PH.get('monte', 0.), PH.get('gorgee', 0.), PH.get('tangue', 0.)
        verre = mat('verre', (.05, .3, .1), .12, 0., .15)
        etiquette = mat('etiquette', (.96, .94, .86), .6, 0., .2)
        sceau = mat('sceau', (.86, .08, .06), .5, 0., .3)
        bouchon = mat('bouchon', (.9, .62, .12), .35, .6)
        rose = mat('joues', (1.0, .2, .22), .6, 0., 1.1)

        def bouteille(C, u, ech=1.):
            # Le grand flacon de saké (isshōbin) : verre vert, étiquette blanche au sceau rouge, capsule dorée.
            # C = milieu du corps, u = axe du fond vers le goulot.
            r = .052 * ech
            tige(C - u * .1 * ech, C + u * .055 * ech, r, verre, faces=24)
            tige(C + u * .055 * ech, C + u * .1 * ech, r, verre, .019 * ech, faces=24)
            tige(C + u * .1 * ech, C + u * .15 * ech, .019 * ech, verre)
            tige(C + u * .15 * ech, C + u * .17 * ech, .022 * ech, bouchon)
            tige(C - u * .045 * ech, C + u * .035 * ech, r * 1.06, etiquette, faces=24)
            tige(C - u * .02 * ech, C + u * .01 * ech, r * 1.1, sceau, faces=24)
        # Placée par pose-plante.mjs : debout dans la main sur le genou, ou le goulot vers la bouche.
        E = 1.2
        C, u = vers(J['objets']['bouteille']['c']), vers(J['objets']['bouteille']['u'])
        bouteille(C, u, E)
        # Une bouteille vide renversée par terre à côté de lui : il a déjà bu.
        bouteille(Vector((.2, -.17, .052)), Vector((.82, -.57, 0)).normalized(), .9)
        # Les joues rouges de l'ivresse.
        for oe, y in ((-1, YD), (1, YG)):
            boule(y - HA * .05 + DR * oe * .022 + AV * .012, .034, rose, (1, 1, .55), axe=AV)
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
