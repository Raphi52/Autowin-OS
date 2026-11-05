# Contrôle qualité d'une scène Blender : la recette de skills/blender/SKILL.md vérifiée par du code,
# pas à l'œil (conv-1570, 2026-11-05 — « HDRI, vrais matériaux, biseaux, 85 mm, profondeur de champ,
# AgX, Cycles + débruitage »). Sept points de scène, plus la mesure d'exposition d'une image rendue.
#
# Deux usages :
#   - dans le Blender du MCP (scène ouverte) :
#       exec(open(r"D:\AutoWinOS\scripts\blender_qualite.py", encoding="utf-8").read())
#   - en arrière-plan (scripts/blender-rendu-final.mjs le fait) :
#       blender.exe -b scene.blend --python scripts/blender_qualite.py -- \
#         [--rendre out.png] [--image out.png] [--jpeg out.jpg] [--samples N] [--json out.json]
# Sortie : une ligne « QUALITE_JSON: {...} » — { ok, points: [{id, ok, detail, correction}], image?, rendu? }.
import bpy
import bmesh
import json
import math
import sys
import time

# Au-delà de 75°, une arête sans biseau (le coin à 90° d'une primitive) renvoie un reflet en lame de rasoir :
# c'est elle qui fait « 3D par défaut ». Pas 50° : le pied du vase Poly Haven antique_ceramic_vase_01 porte
# 96 arêtes à 59° et 71°, un ressaut voulu par son auteur, pas un défaut (mesuré conv-1570).
SEUIL_ARETE_VIVE = math.radians(75)
# Au-delà, le maillage est un scan ou un modèle importé déjà détaillé : on ne lui demande pas de biseau.
FACES_MAX_POUR_BISEAU = 20000
OBJECTIF_MIN, OBJECTIF_MAX = 70.0, 105.0
OUVERTURE_MAX = 5.6
ECHANTILLONS_MIN = 32


def point(ident, ok, detail, correction="", mesure=None):
    """`detail` et `correction` s'adressent à l'agent (français) ; `mesure` porte les valeurs brutes,
    que la page du fil met en mots dans la langue de l'utilisateur (blender-rendu-final.mjs)."""
    p = {"id": ident, "ok": bool(ok), "detail": detail, "correction": "" if ok else correction}
    if mesure is not None:
        p["mesure"] = mesure
    return p


def maillages_visibles(scene):
    rendus = []
    for o in scene.objects:
        if o.type != "MESH" or o.hide_render:
            continue
        try:
            if not o.visible_get():
                continue
        except RuntimeError:
            pass
        rendus.append(o)
    return rendus


def controle_hdri(scene):
    w = scene.world
    if not w or not w.node_tree:
        return point("hdri", False, "aucun monde à nœuds",
                     "search_assets(source='polyhaven', asset_type='hdris') puis import_asset(asset_type='hdris')")
    env = [n for n in w.node_tree.nodes
           if n.type == "TEX_ENVIRONMENT" and n.image and any(l for s in n.outputs for l in s.links)]
    if not env:
        return point("hdri", False, "le monde n'a pas d'image d'environnement branchée",
                     "importer un HDRI Poly Haven (import_asset asset_type='hdris', resolution='2k')")
    return point("hdri", True, env[0].image.name, mesure={"image": env[0].image.name})


def _entree(noeud, identifiant):
    return next((s for s in noeud.inputs if s.identifier == identifiant), None)


def materiau_par_defaut(mat):
    """Vrai si le matériau est le gris de départ : aucun choix de couleur, de rugosité ni de texture."""
    if mat is None or not mat.node_tree:
        return True
    noeuds = mat.node_tree.nodes
    principled = [n for n in noeuds if n.type == "BSDF_PRINCIPLED"]
    if not principled:
        # Verre, émission, mélange… : un shader choisi exprès.
        return not any(n.type.startswith("BSDF") or n.type in ("EMISSION", "MIX_SHADER", "GROUP") for n in noeuds)
    p = principled[0]
    if any(s.is_linked for s in p.inputs):
        return False
    couleur = _entree(p, "Base Color")
    rugosite = _entree(p, "Roughness")
    metal = _entree(p, "Metallic")
    gris = couleur is not None and all(abs(c - 0.8) < 0.02 for c in couleur.default_value[:3])
    rug_defaut = rugosite is not None and abs(rugosite.default_value - 0.5) < 0.01
    metal_defaut = metal is None or metal.default_value < 0.01
    return gris and rug_defaut and metal_defaut


def controle_materiaux(objets):
    fautifs = []
    for o in objets:
        mats = [s.material for s in o.material_slots]
        if not mats or all(materiau_par_defaut(m) for m in mats):
            fautifs.append(o.name)
    if fautifs:
        return point("materiaux", False, "matériau absent ou gris par défaut : " + ", ".join(fautifs[:6]),
                     "texture PBR Poly Haven (import_asset asset_type='textures', apply_to=[...]) "
                     "ou Principled réglé : couleur, rugosité 0,2–0,7, bump")
    return point("materiaux", True, f"{len(objets)} objet(s) habillé(s)", mesure={"objets": len(objets)})


def aretes_vives(o, depsgraph):
    """Nombre d'arêtes vives du maillage ÉVALUÉ (modificateurs compris) ; None si trop détaillé pour compter."""
    oe = o.evaluated_get(depsgraph)
    me = oe.to_mesh()
    try:
        if len(me.polygons) > FACES_MAX_POUR_BISEAU:
            return None
        bm = bmesh.new()
        bm.from_mesh(me)
        n = sum(1 for e in bm.edges if e.is_manifold and e.calc_face_angle(0.0) > SEUIL_ARETE_VIVE)
        bm.free()
        return n
    finally:
        oe.to_mesh_clear()


def biseau_par_shader(o):
    return any(s.material and s.material.node_tree and any(n.type == "BEVEL" for n in s.material.node_tree.nodes)
               for s in o.material_slots)


def controle_biseaux(objets, depsgraph):
    fautifs = []
    for o in objets:
        if biseau_par_shader(o):
            continue
        n = aretes_vives(o, depsgraph)
        if n:
            fautifs.append(f"{o.name} ({n})")
    if fautifs:
        return point("biseaux", False, "arêtes vives sans biseau : " + ", ".join(fautifs[:6]),
                     "modificateur Bevel (largeur 1–3 mm à l'échelle réelle, 3 segments, limite d'angle 30°) "
                     "+ ombrage lisse")
    return point("biseaux", True, "aucune arête vive à plus de 75°",
                 mesure={"seuil": round(math.degrees(SEUIL_ARETE_VIVE))})


def controle_objectif(scene):
    cam = scene.camera
    if not cam or cam.type != "CAMERA":
        return point("objectif", False, "aucune caméra de scène", "ajouter une caméra et la définir comme caméra de scène")
    d = cam.data
    if d.type != "PERSP":
        return point("objectif", False, f"caméra {d.type}", "caméra en perspective, focale 85 mm")
    ok = OBJECTIF_MIN <= d.lens <= OBJECTIF_MAX
    return point("objectif", ok, f"{d.lens:.0f} mm", "focale 85 mm (cam.data.lens = 85), puis recadrer en reculant",
                 mesure={"mm": round(d.lens)})


def controle_profondeur(scene):
    cam = scene.camera
    if not cam or cam.type != "CAMERA":
        return point("profondeur", False, "aucune caméra", "ajouter une caméra")
    dof = cam.data.dof
    cible = dof.focus_object
    if not dof.use_dof:
        return point("profondeur", False, "profondeur de champ coupée",
                     "dof.use_dof = True, dof.focus_object = <sujet>, dof.aperture_fstop = 2.8")
    if cible is None:
        return point("profondeur", False, f"mise au point à distance fixe ({dof.focus_distance:.2f} m), sans sujet",
                     "dof.focus_object = <sujet> : la netteté suit le sujet quand on recadre")
    if dof.aperture_fstop > OUVERTURE_MAX:
        return point("profondeur", False, f"f/{dof.aperture_fstop:.1f} : flou invisible",
                     "dof.aperture_fstop entre 2.0 et 4.0")
    return point("profondeur", True, f"net sur {cible.name}, f/{dof.aperture_fstop:.1f}",
                 mesure={"sujet": cible.name, "f": round(dof.aperture_fstop, 1)})


def controle_agx(scene):
    vt = scene.view_settings.view_transform
    return point("agx", vt.startswith("AgX"), vt, "scene.view_settings.view_transform = 'AgX'", mesure={"vue": vt})


def controle_cycles(scene):
    if scene.render.engine != "CYCLES":
        return point("cycles", False, f"moteur {scene.render.engine}",
                     "scene.render.engine = 'CYCLES' (dans un try/except TypeError)")
    c = scene.cycles
    if not c.use_denoising:
        return point("cycles", False, "débruitage coupé", "scene.cycles.use_denoising = True")
    if c.samples < ECHANTILLONS_MIN:
        return point("cycles", False, f"{c.samples} échantillons", f"au moins {ECHANTILLONS_MIN} (128 en aperçu)")
    return point("cycles", True, f"{c.samples} échantillons, débruité", mesure={"echantillons": c.samples})


def controler_scene(scene):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objets = maillages_visibles(scene)
    return [
        controle_hdri(scene),
        controle_materiaux(objets),
        controle_biseaux(objets, depsgraph),
        controle_objectif(scene),
        controle_profondeur(scene),
        controle_agx(scene),
        controle_cycles(scene),
    ]


def mesurer_image(chemin):
    """Exposition lue sur les pixels affichés (PNG 8 bits : valeurs déjà encodées sRGB, 0..1)."""
    import numpy as np
    img = bpy.data.images.load(chemin, check_existing=False)
    try:
        largeur, hauteur = img.size
        px = np.empty(largeur * hauteur * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(-1, 4)[:, :3]
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        p5, p95 = (float(v) for v in np.percentile(lum, [5, 95]))
        mesure = {
            "largeur": largeur, "hauteur": hauteur,
            "moyenne": round(float(lum.mean()), 3),
            "ecretees": round(float((rgb.max(axis=1) >= 0.995).mean()), 4),
            "bouchees": round(float((lum <= 0.01).mean()), 4),
            "contraste": round(p95 - p5, 3),
        }
    finally:
        bpy.data.images.remove(img)
    defauts = []
    if mesure["ecretees"] > 0.02:
        defauts.append("hautes lumières brûlées : view_settings.exposure −0,5 ou fond du monde moins fort")
    if mesure["bouchees"] > 0.10:
        defauts.append("ombres bouchées : lampe d'appoint ou exposition +0,5")
    if not 0.10 <= mesure["moyenne"] <= 0.85:
        defauts.append("image trop sombre ou trop claire : régler view_settings.exposure")
    if mesure["contraste"] < 0.25:
        defauts.append("image plate : look AgX plus contrasté, HDRI plus directionnel ou lampe d'appoint")
    detail = (f"moyenne {mesure['moyenne']}, brûlé {mesure['ecretees'] * 100:.1f} %, "
              f"bouché {mesure['bouchees'] * 100:.1f} %, contraste {mesure['contraste']}")
    return mesure, point("exposition", not defauts, detail, " ; ".join(defauts), mesure=mesure)


def rendre(scene, chemin, samples):
    if samples:
        scene.cycles.samples = samples
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = chemin
    debut = time.time()
    bpy.ops.render.render(write_still=True)
    return round(time.time() - debut, 1)


def ecrire_jpeg(png, jpg, largeur_max=1600, qualite=86):
    """Copie légère pour le fil : la page html-render porte l'image en base64, plafond ~1 Mo."""
    img = bpy.data.images.load(png, check_existing=False)
    try:
        l, h = img.size
        if l > largeur_max:
            img.scale(largeur_max, max(1, round(h * largeur_max / l)))
        img.file_format = "JPEG"
        img.save(filepath=jpg, quality=qualite)
    finally:
        bpy.data.images.remove(img)


def lire_options(argv):
    opts = {}
    if "--" not in argv:
        return opts
    reste = argv[argv.index("--") + 1:]
    i = 0
    while i < len(reste):
        cle = reste[i].lstrip("-")
        opts[cle] = reste[i + 1] if i + 1 < len(reste) else ""
        i += 2
    return opts


def principal():
    scene = bpy.context.scene
    opts = lire_options(sys.argv)
    resultat = {"points": controler_scene(scene)}
    if opts.get("rendre"):
        resultat["rendu"] = {
            "secondes": rendre(scene, opts["rendre"], int(opts["samples"]) if opts.get("samples") else 0),
            "echantillons": scene.cycles.samples,
            "resolution": [round(scene.render.resolution_x * scene.render.resolution_percentage / 100),
                           round(scene.render.resolution_y * scene.render.resolution_percentage / 100)],
        }
    image = opts.get("image") or opts.get("rendre")
    if image:
        mesure, p = mesurer_image(image)
        resultat["image"] = mesure
        resultat["points"].append(p)
        if opts.get("jpeg"):
            ecrire_jpeg(image, opts["jpeg"])
    resultat["ok"] = all(p["ok"] for p in resultat["points"])
    texte = json.dumps(resultat, ensure_ascii=False)
    if opts.get("json"):
        with open(opts["json"], "w", encoding="utf-8") as f:
            f.write(texte)
    print("QUALITE_JSON: " + texte)
    return resultat


principal()
