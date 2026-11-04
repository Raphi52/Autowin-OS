#!/usr/bin/env node
// Rend une scène Blender sous trois angles (face, trois-quarts, profil) puis assemble une planche
// unique à montrer dans le fil (conv-1563, lot 2 du plan conv-1558 « tanukis magnifiques »).
// Blender tourne en --background : aucune fenêtre, rien sur l'écran de l'utilisateur.
// La planche est assemblée DANS Blender (numpy embarqué) : aucune dépendance d'image côté Node.
//
// Usage :
//   node scripts/blender-rendu-vues.mjs --blend <scene.blend> [--fil conv-NNN] [--reference <image.png>]
//   node scripts/blender-rendu-vues.mjs --mcp [--port 9876] ...   (scène ouverte dans le Blender du MCP)
// Options : --taille 512 (côté d'une vue, px) · --moteur workbench|eevee|cycles · --sortie <dossier>
//           --blender <blender.exe>
// Sortie : .autowin-tmp/<fil>/{face,trois-quarts,profil,planche}.png ; une ligne JSON sur stdout.
// Codes : 0 planche écrite · 1 erreur inattendue · 2 arguments invalides
//         3 Blender a échoué ou n'a pas écrit les images · 4 scène du MCP injoignable
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = path.dirname(fileURLToPath(import.meta.url))
export const BLENDER_DEFAUT = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
export const VUES = [
  // azimut en degrés autour de l'axe Z, 0 = vue de face Blender (caméra en -Y, regard vers +Y)
  { nom: 'face', azimut: 0 },
  { nom: 'trois-quarts', azimut: 45 },
  { nom: 'profil', azimut: 90 }
]
const MOTEURS = { workbench: 'BLENDER_WORKBENCH', eevee: 'BLENDER_EEVEE', cycles: 'CYCLES' }

export class ErreurRendu extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

export function lireArguments(argv) {
  const opts = { taille: 512, moteur: 'workbench', port: 9876, mcp: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const valeur = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--'))
        throw new ErreurRendu(`valeur manquante après ${a}`, 2)
      return v
    }
    if (a === '--mcp') opts.mcp = true
    else if (a === '--blend') opts.blend = valeur()
    else if (a === '--fil') opts.fil = valeur()
    else if (a === '--reference') opts.reference = valeur()
    else if (a === '--sortie') opts.sortie = valeur()
    else if (a === '--blender') opts.blender = valeur()
    else if (a === '--moteur') opts.moteur = valeur()
    else if (a === '--taille') opts.taille = Number(valeur())
    else if (a === '--port') opts.port = Number(valeur())
    else throw new ErreurRendu(`argument inconnu : ${a}`, 2)
  }
  if (!opts.mcp && !opts.blend) throw new ErreurRendu('il faut --blend <fichier> ou --mcp', 2)
  if (opts.mcp && opts.blend) throw new ErreurRendu('--blend et --mcp sont exclusifs', 2)
  if (!MOTEURS[opts.moteur]) throw new ErreurRendu(`moteur inconnu : ${opts.moteur}`, 2)
  if (!Number.isInteger(opts.taille) || opts.taille < 64 || opts.taille > 4096)
    throw new ErreurRendu('--taille doit être un entier entre 64 et 4096', 2)
  opts.fil = opts.fil || process.env.AUTOWIN_CONVERSATION_ID || 'blender-rendu-vues'
  if (!/^[\w.-]+$/.test(opts.fil)) throw new ErreurRendu(`nom de fil invalide : ${opts.fil}`, 2)
  return opts
}

/** Script Python joué par Blender : 3 caméras orthographiques cadrées sur l'encombrement, puis planche. */
export function scriptPython({ dossier, taille, moteur, reference }) {
  const params = JSON.stringify({
    dossier,
    taille,
    moteur: MOTEURS[moteur],
    reference: reference || null,
    vues: VUES
  })
  return `import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
P = json.loads(${JSON.stringify(params)})
scene = bpy.context.scene
objets = [o for o in scene.objects if o.type in {'MESH','CURVE','SURFACE','META','FONT'} and not o.hide_render]
if not objets:
    print('AUCUN_OBJET'); sys.exit(3)
deps = bpy.context.evaluated_depsgraph_get()
pts = [o.matrix_world @ Vector(c) for o in objets for c in o.evaluated_get(deps).bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (mn + mx) / 2
rayon = max((mx - mn).length / 2, 1e-3)
scene.render.engine = P['moteur']
scene.render.resolution_x = scene.render.resolution_y = P['taille']
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
if P['moteur'] == 'BLENDER_WORKBENCH':
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
if scene.world is None:
    scene.world = bpy.data.worlds.new('MondeRendu')
cam_data = bpy.data.cameras.new('CameraVues')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = rayon * 2.2
cam_data.clip_start = 0.01
cam_data.clip_end = rayon * 20
cam = bpy.data.objects.new('CameraVues', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
elevation = math.radians(10)
chemins = []
for v in P['vues']:
    az = math.radians(v['azimut'])
    direction = Vector((math.sin(az) * math.cos(elevation), -math.cos(az) * math.cos(elevation), math.sin(elevation)))
    cam.location = centre + direction * rayon * 5
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    chemin = os.path.join(P['dossier'], v['nom'] + '.png')
    scene.render.filepath = chemin
    bpy.ops.render.render(write_still=True)
    chemins.append(chemin)

def pixels(chemin):
    img = bpy.data.images.load(chemin)
    l, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, l, 4)
    bpy.data.images.remove(img)
    return a

def a_hauteur(a, h):
    # rééchantillonnage au plus proche : suffisant pour une image de référence d'appoint
    hs, ls = a.shape[:2]
    l = max(1, round(ls * h / hs))
    ys = (np.arange(h) * hs / h).astype(int)
    xs = (np.arange(l) * ls / l).astype(int)
    return a[ys][:, xs]

T = P['taille']
images = [pixels(c) for c in chemins]
if P['reference']:
    images.insert(0, a_hauteur(pixels(P['reference']), T))
marge = max(4, T // 64)
largeur = sum(i.shape[1] for i in images) + marge * (len(images) + 1)
hauteur = T + 2 * marge
planche = np.ones((hauteur, largeur, 4), dtype=np.float32)
planche[..., :3] = 0.12
x = marge
for i in images:
    planche[marge:marge + T, x:x + i.shape[1]] = i
    planche[marge:marge + T, x:x + i.shape[1], 3] = 1.0
    x += i.shape[1] + marge
sortie = bpy.data.images.new('Planche', largeur, hauteur, alpha=True)
sortie.pixels.foreach_set(planche.ravel())
sortie.filepath_raw = os.path.join(P['dossier'], 'planche.png')
sortie.file_format = 'PNG'
sortie.save()
print('PLANCHE_OK ' + json.dumps({'largeur': largeur, 'hauteur': hauteur, 'images': len(images)}))
`
}

/** Demande au Blender du MCP (add-on, port 9876) d'enregistrer une COPIE de sa scène. */
export function copierSceneMcp(port, cible, delaiMs = 15000) {
  const code = `import bpy\nbpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(cible)}, copy=True)`
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    let recu = ''
    const fin = (err) => {
      sock.destroy()
      err ? reject(new ErreurRendu(err, 4)) : resolve(cible)
    }
    sock.setTimeout(delaiMs, () => fin(`le Blender du MCP ne répond pas sur le port ${port}`))
    sock.on('error', (e) => fin(`scène du MCP injoignable (port ${port}) : ${e.message}`))
    sock.on('connect', () => sock.write(JSON.stringify({ type: 'execute_code', params: { code } })))
    sock.on('data', (d) => {
      recu += d
      try {
        const r = JSON.parse(recu)
        if (r.status === 'error') return fin(`le MCP a refusé la copie : ${r.message}`)
        if (!existsSync(cible)) return fin('le MCP n’a pas écrit la copie de la scène')
        fin()
      } catch {
        /* réponse incomplète : on attend la suite */
      }
    })
  })
}

export async function rendreVues(opts) {
  const blender = opts.blender || BLENDER_DEFAUT
  if (!existsSync(blender)) throw new ErreurRendu(`Blender introuvable : ${blender}`, 3)
  const dossier = path.resolve(opts.sortie || path.join(ici, '..', '.autowin-tmp', opts.fil))
  mkdirSync(dossier, { recursive: true })
  let blend = opts.blend && path.resolve(opts.blend)
  if (opts.mcp) blend = await copierSceneMcp(opts.port, path.join(dossier, 'scene-mcp.blend'))
  if (!existsSync(blend)) throw new ErreurRendu(`fichier .blend introuvable : ${blend}`, 2)
  const reference = opts.reference && path.resolve(opts.reference)
  if (reference && !existsSync(reference))
    throw new ErreurRendu(`image de référence introuvable : ${reference}`, 2)
  const py = path.join(dossier, 'rendu-vues.py')
  writeFileSync(py, scriptPython({ dossier, taille: opts.taille, moteur: opts.moteur, reference }))
  const r = spawnSync(
    blender,
    ['--background', blend, '--factory-startup', '--python-exit-code', '3', '--python', py],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024
    }
  )
  const sortieBlender = `${r.stdout || ''}${r.stderr || ''}`
  const fichiers = Object.fromEntries(
    [...VUES.map((v) => v.nom), 'planche'].map((n) => [n, path.join(dossier, `${n}.png`)])
  )
  const manquants = Object.values(fichiers).filter((f) => !existsSync(f) || statSync(f).size === 0)
  if (r.status !== 0 || manquants.length || !sortieBlender.includes('PLANCHE_OK')) {
    throw new ErreurRendu(
      `Blender a échoué (code ${r.status ?? r.error?.message}) ; manquants : ${manquants.join(', ') || 'aucun'}\n${sortieBlender.slice(-2000)}`,
      3
    )
  }
  const infos = JSON.parse(sortieBlender.split('PLANCHE_OK ')[1].split(/\r?\n/)[0])
  return { ok: true, dossier, fichiers, planche: fichiers.planche, ...infos }
}

const lanceDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (lanceDirect) {
  try {
    const res = await rendreVues(lireArguments(process.argv.slice(2)))
    console.log(JSON.stringify(res))
  } catch (e) {
    console.error(JSON.stringify({ ok: false, erreur: e.message }))
    process.exit(e instanceof ErreurRendu ? e.code : 1)
  }
}
