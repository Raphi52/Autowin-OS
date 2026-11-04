#!/usr/bin/env node
// Aperçu animé en boucle d'un .blend (conv-1564, lot 4 du plan conv-1558 « tanukis magnifiques »).
// Pourquoi : juger un tanuki sur une image fixe ne dit rien de son clignement, de ses oreilles ou
// de sa queue. Ce script rend une courte boucle avec Blender SANS fenêtre (`--background`, donc
// rien sur l'écran de l'utilisateur) et l'assemble en GIF animé dans .autowin-tmp/<fil>/.
// - Si des objets du .blend portent une action : on parcourt la plage de ces actions (celles dont
//   le nom évoque clignement / oreilles / queue sont citées à part dans le rapport).
// - Sinon : la caméra fait un tour complet autour de la scène (rotation).
// Le GIF est encodé dans le Python de Blender (numpy y est fourni) : le poste n'a ni ffmpeg ni
// ImageMagick, et aucune dépendance npm n'est ajoutée.
//
// Usage : node scripts/blender-apercu-anime.mjs --blend <fichier.blend> [--fil <conv>]
//         [--sortie <fichier.gif>] [--images 24] [--taille 256] [--moteur BLENDER_WORKBENCH]
//         [--delai 80] [--blender <blender.exe>]
// Sortie : une ligne JSON (chemin, mode, actions, images, imagesDistinctes, octets).
// Codes : 0 GIF écrit et animé · 1 erreur inattendue · 2 arguments invalides ou Blender absent
//         3 Blender a échoué · 4 GIF absent, invalide ou immobile
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = path.dirname(fileURLToPath(import.meta.url))
const racine = path.resolve(ici, '..')
export const BLENDER_DEFAUT = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const MARQUEUR = 'AUTOWIN_APERCU_JSON:'

const PYTHON = String.raw`
import bpy, json, math, os, sys, hashlib, tempfile
import numpy as np
from mathutils import Vector

p = json.loads(sys.argv[sys.argv.index("--") + 1])
scene = bpy.context.scene
if p["moteur"]:
    scene.render.engine = p["moteur"]
scene.render.resolution_x = p["taille"]
scene.render.resolution_y = p["taille"]
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"

MOTS = ("clign", "blink", "oreill", "ear", "queue", "tail")
animes = [o for o in scene.objects if o.animation_data and o.animation_data.action]
actions = sorted({o.animation_data.action.name for o in animes})
parlantes = [a for a in actions if any(m in a.lower() for m in MOTS)]

meshes = [o for o in scene.objects if o.type == "MESH"]
if meshes:
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mini = Vector([min(v[i] for v in pts) for i in range(3)])
    maxi = Vector([max(v[i] for v in pts) for i in range(3)])
else:
    mini, maxi = Vector((-1, -1, -1)), Vector((1, 1, 1))
centre = (mini + maxi) / 2
rayon = max((maxi - mini).length / 2, 0.1)

if not any(o.type == "LIGHT" for o in scene.objects):
    ld = bpy.data.lights.new("apercu_soleil", "SUN")
    ld.energy = 3
    lo = bpy.data.objects.new("apercu_soleil", ld)
    lo.rotation_euler = (0.8, 0.2, 0.6)
    scene.collection.objects.link(lo)

mode = "actions" if animes else "rotation"
pivot = None
if mode == "rotation" or scene.camera is None:
    cd = bpy.data.cameras.new("apercu_camera")
    cam = bpy.data.objects.new("apercu_camera", cd)
    scene.collection.objects.link(cam)
    pivot = bpy.data.objects.new("apercu_pivot", None)
    scene.collection.objects.link(pivot)
    pivot.location = centre
    cam.parent = pivot
    d = rayon * 3.2
    cam.location = (0, -d, d * 0.35)
    cam.rotation_euler = (math.radians(90) - math.atan2(0.35, 1), 0, 0)
    scene.camera = cam
    # en mode actions, la caméra ajoutée reste fixe : seul l'objet doit bouger
    tourner = mode == "rotation"
    # vue de trois quarts : de face pile, une queue (dans le dos) est cachée par le corps —
    # mesuré le 05/11 (conv-1564), le GIF sortait immobile
    if not tourner:
        pivot.rotation_euler = (0, 0, math.radians(60))
else:
    tourner = False

n = p["images"]
if mode == "actions":
    debut = min(o.animation_data.action.frame_range[0] for o in animes)
    fin = max(o.animation_data.action.frame_range[1] for o in animes)
    # boucle : la dernière image de la plage égale en général la première, on ne la rejoue pas
    images = [debut + (fin - debut) * i / n for i in range(n)]
else:
    images = [scene.frame_start] * n

def quantifier(rgb):
    q = np.clip(np.rint(rgb * 5), 0, 5).astype(np.int32)
    return (q[..., 0] * 36 + q[..., 1] * 6 + q[..., 2]).astype(np.uint8)

def lzw(indices):
    clear, eoi = 256, 257
    sortie = bytearray()
    etat = [0, 0]
    def emettre(code, largeur):
        etat[0] |= code << etat[1]
        etat[1] += largeur
        while etat[1] >= 8:
            sortie.append(etat[0] & 255)
            etat[0] >>= 8
            etat[1] -= 8
    table = {}
    prochain = 258
    largeur = 9
    emettre(clear, largeur)
    prefixe = indices[0]
    for k in indices[1:]:
        cle = (prefixe << 8) | k
        code = table.get(cle)
        if code is not None:
            prefixe = code
            continue
        emettre(prefixe, largeur)
        if prochain < 4096:
            table[cle] = prochain
            prochain += 1
            if prochain > (1 << largeur) and largeur < 12:
                largeur += 1
        else:
            emettre(clear, largeur)
            table = {}
            prochain = 258
            largeur = 9
        prefixe = k
    emettre(prefixe, largeur)
    emettre(eoi, largeur)
    if etat[1]:
        sortie.append(etat[0] & 255)
    blocs = bytearray([8])
    for i in range(0, len(sortie), 255):
        morceau = sortie[i:i + 255]
        blocs.append(len(morceau))
        blocs += morceau
    blocs.append(0)
    return bytes(blocs)

w = h = p["taille"]
palette = bytearray()
for r in range(6):
    for g in range(6):
        for b in range(6):
            palette += bytes((r * 51, g * 51, b * 51))
palette += bytes(3 * (256 - 216))

gif = bytearray(b"GIF89a")
gif += w.to_bytes(2, "little") + h.to_bytes(2, "little") + bytes((0xF7, 0, 0)) + palette
gif += b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00"
delai = max(2, round(p["delai"] / 10))
tmp = tempfile.mkdtemp(prefix="apercu-")
empreintes = set()
for i, f in enumerate(images):
    if tourner:
        pivot.rotation_euler = (0, 0, 2 * math.pi * i / n)
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    fichier = os.path.join(tmp, "img%03d.png" % i)
    scene.render.filepath = fichier
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(fichier)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    os.remove(fichier)
    rgb = px.reshape(h, w, 4)[::-1, :, :3]  # Blender range les lignes de bas en haut
    brut = quantifier(rgb).tobytes()
    empreintes.add(hashlib.sha1(brut).hexdigest())
    gif += b"\x21\xF9\x04\x00" + delai.to_bytes(2, "little") + b"\x00\x00"
    gif += b"\x2C\x00\x00\x00\x00" + w.to_bytes(2, "little") + h.to_bytes(2, "little") + b"\x00"
    gif += lzw(brut)
gif += b"\x3B"
os.rmdir(tmp)
os.makedirs(os.path.dirname(p["sortie"]), exist_ok=True)
with open(p["sortie"], "wb") as fh:
    fh.write(gif)
print("${MARQUEUR}" + json.dumps({"chemin": p["sortie"], "mode": mode, "actions": actions,
      "actionsParlantes": parlantes, "images": n, "imagesDistinctes": len(empreintes)}), flush=True)
`

/** Compte les images d'un GIF en parcourant ses blocs ; null si le fichier n'est pas un GIF valide. */
export function compterImagesGif(buf) {
  if (buf.length < 13 || buf.subarray(0, 6).toString('latin1') !== 'GIF89a') return null
  let i = 13
  if (buf[10] & 0x80) i += 3 * (1 << ((buf[10] & 7) + 1))
  const sauterBlocs = () => {
    while (i < buf.length && buf[i] !== 0) i += buf[i] + 1
    i += 1
  }
  let images = 0
  while (i < buf.length) {
    const b = buf[i]
    if (b === 0x3b) return images
    if (b === 0x21) {
      i += 2
      sauterBlocs()
    } else if (b === 0x2c) {
      const drapeaux = buf[i + 9]
      i += 10
      if (drapeaux & 0x80) i += 3 * (1 << ((drapeaux & 7) + 1))
      i += 1 // taille minimale du code LZW
      sauterBlocs()
      images += 1
    } else return null
  }
  return null // pas de marque de fin : GIF tronqué
}

function lireArguments(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      throw new Error(`argument inattendu : ${argv[i]}`)
    }
    o[argv[i].slice(2)] = argv[i + 1]
  }
  return o
}

function main() {
  let a
  try {
    a = lireArguments(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    return 2
  }
  const blender = a.blender || BLENDER_DEFAUT
  const blend = a.blend && path.resolve(a.blend)
  if (!blend || !existsSync(blend)) {
    console.error(`--blend manquant ou introuvable : ${a.blend ?? '(aucun)'}`)
    return 2
  }
  if (!existsSync(blender)) {
    console.error(`Blender introuvable : ${blender}`)
    return 2
  }
  const images = Number(a.images ?? 24)
  const taille = Number(a.taille ?? 256)
  const delai = Number(a.delai ?? 80)
  if (!(images >= 2 && images <= 240 && taille >= 16 && taille <= 1024 && delai >= 20)) {
    console.error('--images 2..240, --taille 16..1024, --delai >= 20 (ms)')
    return 2
  }
  const fil = (a.fil || process.env.AUTOWIN_CONVERSATION_ID || 'sans-fil').replace(/[^\w.-]/g, '_')
  const nom = path.basename(blend, '.blend') + '-apercu.gif'
  const sortie = path.resolve(a.sortie || path.join(racine, '.autowin-tmp', fil, nom))
  const py = path.join(tmpdir(), `blender-apercu-${process.pid}-${Date.now()}.py`)
  writeFileSync(py, PYTHON, 'utf8')
  rmSync(sortie, { force: true })
  const param = JSON.stringify({ sortie, images, taille, delai, moteur: a.moteur || '' })
  const r = spawnSync(
    blender,
    ['--background', blend, '--python-exit-code', '1', '--python', py, '--', param],
    { encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }
  )
  rmSync(py, { force: true })
  const ligne = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith(MARQUEUR))
  if (r.status !== 0 || !ligne) {
    console.error(
      `Blender a échoué (code ${r.status}) :\n${(r.stdout || '').slice(-2000)}\n${(r.stderr || '').slice(-2000)}`
    )
    return 3
  }
  const rapport = JSON.parse(ligne.slice(MARQUEUR.length))
  const nb = existsSync(sortie) ? compterImagesGif(readFileSync(sortie)) : null
  if (nb !== images || rapport.imagesDistinctes < 2) {
    console.error(
      `GIF invalide ou immobile : ${nb} image(s) lue(s), ${rapport.imagesDistinctes} distincte(s)`
    )
    return 4
  }
  console.log(JSON.stringify({ ...rapport, octets: statSync(sortie).size }))
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
}
