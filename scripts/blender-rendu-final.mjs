#!/usr/bin/env node
// Rendu FINAL d'une scène Blender pour la skill blender (conv-1570, 2026-11-05) : un seul geste pour
// « rendre → contrôler → mesurer l'exposition → poser l'image dans le fil ».
// Blender tourne en --background sur une COPIE .blend : le Blender interactif du MCP n'est pas bloqué
// pendant les minutes de Cycles, et rien ne s'ouvre sur l'écran de l'utilisateur.
// Le contrôle et la mesure sont ceux de scripts/blender_qualite.py (mêmes points que dans le MCP).
//
// Usage : node scripts/blender-rendu-final.mjs --blend <scene.blend> [--fil conv-NNN] [--nom rendu]
//           [--samples 256] [--titre "Légende"] [--langue fr|en] [--sortie <dossier>] [--blender <exe>]
// Sortie : <dossier>/<nom>.png (maître), .jpg (fil), .json (contrôle), .html (page html-render pour
//          l'outil montrer_bloc) ; une ligne JSON sur stdout.
// Codes : 0 rendu écrit et contrôle vert · 1 erreur inattendue · 2 arguments invalides
//         3 Blender a échoué ou n'a pas écrit l'image · 5 rendu écrit mais contrôle ROUGE (page écrite quand même)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = path.dirname(fileURLToPath(import.meta.url))
export const BLENDER_DEFAUT = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
export const SCRIPT_QUALITE = path.join(ici, 'blender_qualite.py')

export class ErreurRendu extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

export function lireArguments(argv) {
  const opts = { nom: 'rendu', langue: 'fr', blender: BLENDER_DEFAUT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const valeur = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new ErreurRendu(`${a} attend une valeur`, 2)
      return v
    }
    if (a === '--blend') opts.blend = valeur()
    else if (a === '--fil') opts.fil = valeur()
    else if (a === '--nom') opts.nom = valeur()
    else if (a === '--samples') opts.samples = Number(valeur())
    else if (a === '--titre') opts.titre = valeur()
    else if (a === '--langue') opts.langue = valeur()
    else if (a === '--sortie') opts.sortie = valeur()
    else if (a === '--blender') opts.blender = valeur()
    else throw new ErreurRendu(`argument inconnu : ${a}`, 2)
  }
  if (!opts.blend) throw new ErreurRendu('il faut --blend <scene.blend>', 2)
  if (
    opts.samples !== undefined &&
    !(Number.isInteger(opts.samples) && opts.samples >= 1 && opts.samples <= 8192)
  )
    throw new ErreurRendu('--samples doit être un entier de 1 à 8192', 2)
  if (!['fr', 'en'].includes(opts.langue)) throw new ErreurRendu('--langue vaut fr ou en', 2)
  if (!/^[\w-]+$/u.test(opts.nom)) throw new ErreurRendu('--nom : lettres, chiffres, - et _', 2)
  opts.fil = opts.fil || process.env.AUTOWIN_CONVERSATION_ID || 'blender'
  opts.sortie = opts.sortie || path.join(ici, '..', '.autowin-tmp', opts.fil, 'blender')
  return opts
}

// Libellés de la page : elle est lue par l'utilisateur, dans la langue choisie de l'app.
const LIBELLES = {
  fr: {
    kicker: 'Rendu Blender · Cycles',
    rendu: 'de rendu',
    echantillons: 'échantillons',
    points: {
      hdri: 'Lumière HDRI',
      materiaux: 'Vrais matériaux',
      biseaux: 'Biseaux',
      objectif: 'Objectif',
      profondeur: 'Profondeur de champ',
      agx: 'Couleur AgX',
      cycles: 'Cycles + débruitage',
      exposition: 'Exposition'
    }
  },
  en: {
    kicker: 'Blender render · Cycles',
    rendu: 'to render',
    echantillons: 'samples',
    points: {
      hdri: 'HDRI light',
      materiaux: 'Real materials',
      biseaux: 'Bevels',
      objectif: 'Lens',
      profondeur: 'Depth of field',
      agx: 'AgX colour',
      cycles: 'Cycles + denoise',
      exposition: 'Exposure'
    }
  }
}

// Valeur d'un point VERT mise en mots dans la langue de la page, à partir de `mesure` (valeurs brutes de
// blender_qualite.py). Un point rouge garde son `detail` d'agent : il se corrige avant d'être montré.
const pourcent = (x) => `${(x * 100).toFixed(1)} %`
const VALEURS = {
  fr: {
    hdri: (m) => m.image,
    materiaux: (m) => `${m.objets} objet(s) habillé(s)`,
    biseaux: (m) => `aucune arête vive au-delà de ${m.seuil}°`,
    objectif: (m) => `${m.mm} mm`,
    profondeur: (m) => `net sur ${m.sujet}, f/${m.f}`,
    agx: (m) => m.vue,
    cycles: (m) => `${m.echantillons} échantillons, débruité`,
    exposition: (m) =>
      `brûlé ${pourcent(m.ecretees)}, bouché ${pourcent(m.bouchees)}, contraste ${m.contraste}`
  },
  en: {
    hdri: (m) => m.image,
    materiaux: (m) => `${m.objets} object(s) dressed`,
    biseaux: (m) => `no sharp edge above ${m.seuil}°`,
    objectif: (m) => `${m.mm} mm`,
    profondeur: (m) => `sharp on ${m.sujet}, f/${m.f}`,
    agx: (m) => m.vue,
    cycles: (m) => `${m.echantillons} samples, denoised`,
    exposition: (m) =>
      `blown ${pourcent(m.ecretees)}, crushed ${pourcent(m.bouchees)}, contrast ${m.contraste}`
  }
}

export function valeurDuPoint(p, langue = 'fr') {
  const f = (VALEURS[langue] || VALEURS.fr)[p.id]
  return p.ok && p.mesure && f ? f(p.mesure) : p.detail
}

const echapper = (t) =>
  String(t).replace(
    /[&<>"]/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

/** Page html-render : image en base64 + la grille de contrôle. Aucune couleur en dur : classes aw-* du thème. */
export function pageHtml({ jpegBase64, resultat, titre, langue = 'fr' }) {
  const L = LIBELLES[langue] || LIBELLES.fr
  const rendu = resultat.rendu || {}
  const [l, h] = rendu.resolution || [resultat.image?.largeur, resultat.image?.hauteur]
  const puces = (resultat.points || [])
    .map((p) => {
      const nom = L.points[p.id] || p.id
      const valeur = valeurDuPoint(p, langue)
      return `<li class="aw-chip ${p.ok ? 'aw-ok' : 'aw-ko'}" title="${echapper(valeur)}">${p.ok ? '✓' : '✗'} <b>${echapper(nom)}</b> · ${echapper(valeur)}</li>`
    })
    .join('')
  const ligne = [
    titre ? `<b>${echapper(titre)}</b>` : '',
    l && h ? `<span class="aw-chip">${l}×${h}</span>` : '',
    rendu.secondes !== undefined
      ? `<span class="aw-chiffre">${Math.round(rendu.secondes)} s</span> ${L.rendu}`
      : '',
    rendu.echantillons ? `${rendu.echantillons} ${L.echantillons}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return `<style>
.bq{font-size:14px;line-height:1.5;width:100%}
.bq img{display:block;width:100%;height:auto;border-radius:6px;margin:6px 0}
.bq p{margin:4px 0}
.bq ul{list-style:none;padding:0;margin:6px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.bq li{font-size:12px}
</style>
<div class="bq">
<div class="aw-kicker">${echapper(L.kicker)}</div>
<img src="data:image/jpeg;base64,${jpegBase64}" alt="${echapper(titre || L.kicker)}">
<p>${ligne}</p>
<ul>${puces}</ul>
</div>
`
}

/** Extrait la ligne « QUALITE_JSON: » de la sortie de Blender. */
export function lireResultat(sortie) {
  const ligne = String(sortie)
    .split(/\r?\n/u)
    .find((x) => x.startsWith('QUALITE_JSON: '))
  return ligne ? JSON.parse(ligne.slice('QUALITE_JSON: '.length)) : null
}

export function rendreFinal(opts) {
  if (!existsSync(opts.blend)) throw new ErreurRendu(`fichier absent : ${opts.blend}`, 2)
  if (!existsSync(opts.blender)) throw new ErreurRendu(`Blender absent : ${opts.blender}`, 2)
  mkdirSync(opts.sortie, { recursive: true })
  const base = path.join(opts.sortie, opts.nom)
  const fichiers = {
    png: `${base}.png`,
    jpg: `${base}.jpg`,
    json: `${base}.json`,
    html: `${base}.html`
  }
  const args = ['-b', opts.blend, '--python', SCRIPT_QUALITE, '--']
  args.push('--rendre', fichiers.png, '--jpeg', fichiers.jpg, '--json', fichiers.json)
  if (opts.samples) args.push('--samples', String(opts.samples))
  const debut = Date.now()
  const r = spawnSync(opts.blender, args, {
    encoding: 'utf8',
    timeout: 30 * 60_000,
    maxBuffer: 64 * 1024 * 1024
  })
  const resultat = lireResultat(r.stdout)
  if (!resultat || !existsSync(fichiers.png) || !existsSync(fichiers.jpg)) {
    const fin = `${r.stdout || ''}\n${r.stderr || ''}`.trim().slice(-1200)
    throw new ErreurRendu(
      `Blender n'a pas rendu (code ${r.status}${r.error ? `, ${r.error.message}` : ''}) : ${fin}`,
      3
    )
  }
  const jpegBase64 = readFileSync(fichiers.jpg).toString('base64')
  writeFileSync(
    fichiers.html,
    pageHtml({ jpegBase64, resultat, titre: opts.titre, langue: opts.langue })
  )
  return {
    code: resultat.ok ? 0 : 5,
    ok: resultat.ok,
    secondesTotal: Math.round((Date.now() - debut) / 1000),
    ...fichiers,
    rendu: resultat.rendu,
    image: resultat.image,
    rouges: resultat.points.filter((p) => !p.ok)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sortie = rendreFinal(lireArguments(process.argv.slice(2)))
    console.log(JSON.stringify(sortie))
    process.exit(sortie.code)
  } catch (e) {
    console.log(JSON.stringify({ code: e.code || 1, erreur: e.message }))
    process.exit(e.code || 1)
  }
}
