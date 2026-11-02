// Refait le film d'accueil d'un fil vide (conv-1401) : images, puis vidéos dans src/renderer/src/assets/teaser.
// Rendu au processeur, sous la priorité normale : une bonne heure, sans gêner le poste. Reprend là où il s'est
// arrêté. Avant de bouger la caméra, relire teaser-accueil-calcul.ts : la phrase s'y place sur le cercle.
//
// Usage : FFMPEG=<chemin de ffmpeg.exe> node --experimental-strip-types scripts/teaser-accueil/film.mjs <dossier des images>
// ffmpeg s'installe hors du dépôt (paquet npm ffmpeg-static), jamais dans son node_modules.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glypheDuHalo } from '../../src/shared/glyphe-du-halo.ts'

const ici = fileURLToPath(new URL('.', import.meta.url))
const racine = resolve(ici, '../..')
const assets = join(racine, 'src/renderer/src/assets/teaser')
const dossier = resolve(process.argv[2] ?? 'film-images')
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const electron = createRequire(import.meta.url)('electron')
const { IMAGES_INTRO, IMAGES_BOUCLE, IMAGES_PAR_SECONDE, DUREE_INTRO } = createRequire(
  import.meta.url
)('./timeline.cjs')

const lancer = (commande, args) => {
  const r = spawnSync(commande, args, { stdio: 'inherit', cwd: racine })
  if (r.status !== 0) throw new Error(`${commande} : code ${r.status}`)
}
const suite = (de, n) => Array.from({ length: n }, (_, i) => de + i)

mkdirSync(dossier, { recursive: true })
mkdirSync(assets, { recursive: true })
const glyphe = join(dossier, 'glyphe.svg.txt')
writeFileSync(glyphe, glypheDuHalo())

// 2 passes par image ; les plans rapides en demandent plus (`passes` dans timeline.cjs).
const base = { sortie: dossier, glyphe, prefixe: 'i', largeur: 1280, hauteur: 720, reprendre: true }
for (const [nom, echantillons, images] of [
  ['boucle', 2, suite(IMAGES_INTRO, IMAGES_BOUCLE)],
  ['intro', 3, suite(0, IMAGES_INTRO)]
]) {
  const cfg = join(dossier, `cfg-${nom}.json`)
  writeFileSync(cfg, JSON.stringify({ ...base, echantillons, images }))
  lancer(electron, [join(ici, 'rendu.cjs'), cfg])
}

// Le bas de l'image est assombri ici, dans le film : la phrase y passe. Un voile en CSS serait repeint
// par les couches de thème, blanc en thème clair.
const voile =
  `color=black:s=${base.largeur}x${base.hauteur}:r=${IMAGES_PAR_SECONDE},format=rgba,` +
  `geq=r=0:g=0:b=0:a='255*0.78*pow(clip((Y/H-0.66)/0.34\\,0\\,1)\\,1.5)',trim=end_frame=1,loop=-1:1:0`
const encoder = (sortie, depart, nombre, filtre) =>
  lancer(ffmpeg, [
    '-hide_banner',
    '-y',
    '-framerate',
    String(IMAGES_PAR_SECONDE),
    '-start_number',
    String(depart),
    '-i',
    join(dossier, 'i%04d.png'),
    '-frames:v',
    String(nombre),
    '-filter_complex',
    filtre,
    '-c:v',
    'libx264',
    '-preset',
    'veryslow',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '48',
    '-movflags',
    '+faststart',
    '-an',
    join(assets, sortie)
  ])
encoder('boucle.mp4', IMAGES_INTRO, IMAGES_BOUCLE, `${voile}[v];[0][v]overlay=shortest=1`)
// Le voile monte pendant la révélation, pour finir exactement comme la boucle commence.
encoder(
  'intro.mp4',
  0,
  IMAGES_INTRO,
  `${voile},fade=t=in:st=${DUREE_INTRO - 3}:d=3:alpha=1[v];[0][v]overlay=shortest=1`
)
lancer(ffmpeg, [
  '-hide_banner',
  '-y',
  '-start_number',
  String(IMAGES_INTRO),
  '-i',
  join(dossier, 'i%04d.png'),
  '-frames:v',
  '1',
  '-filter_complex',
  `${voile}[v];[0][v]overlay=shortest=1`,
  '-q:v',
  '4',
  join(assets, 'affiche.jpg')
])
