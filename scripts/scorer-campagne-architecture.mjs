// SCORE d'une campagne d'architecture : le premier choix de chaque tirage tombe-t-il sur un conteneur
// qui contient VRAIMENT une réponse ?
//
// Usage : node scripts/scorer-campagne-architecture.mjs "<dossier campagne>" "<reponses.json>"
//
// Le fichier de réponses est de la forme :
//   { "B-nature": { "1": [ "<reponse tirage 1>", "<reponse tirage 2>", … ], … }, … }
//
// Deux garde-fous délibérés :
//   · une réponse qui ne correspond à AUCUN groupe connu de la surface est comptée INVALIDE, jamais
//     fausse. Un agent qui a mal lu la consigne de FORMAT ne dit rien sur l'architecture, et le
//     confondre avec une erreur de jugement fausserait la comparaison.
//   · le score d'une architecture n'est affiché qu'avec son ÉTENDUE entre tirages. Une moyenne seule
//     laisserait croire à une précision qu'un petit nombre de tirages n'a pas.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CAMPAGNE = process.argv[2]
const REPONSES = process.argv[3]
if (!CAMPAGNE || !existsSync(CAMPAGNE) || !REPONSES || !existsSync(REPONSES)) {
  console.log(
    'usage : node scripts/scorer-campagne-architecture.mjs "<campagne>" "<reponses.json>"'
  )
  process.exit(2)
}

const { verite, tailles } = JSON.parse(readFileSync(join(CAMPAGNE, 'verite.json'), 'utf8'))
const reponses = JSON.parse(readFileSync(REPONSES, 'utf8'))

/** Les groupes RÉELLEMENT proposés par une surface — sert à distinguer « faux » de « hors format ». */
function groupesDe(surface) {
  const f = join(CAMPAGNE, surface + '.txt')
  if (!existsSync(f)) return null
  const lignes = readFileSync(f, 'utf8').split(String.fromCharCode(10))
  const out = new Set()
  for (const l of lignes) {
    // Un groupe de premier niveau : « Nom (12) », sans indentation.
    const m = l.match(/^(\S.*?) \((\d+)\)\s*$/)
    if (m) out.add(m[1].trim())
    // Un dossier : «   chemin/  (12) », indenté.
    const d = l.match(/^\s+(\S.*?)\/\s+\((\d+)\)\s*$/)
    if (d) out.add(d[1].trim() + '/')
    // Une fiche de la liste plate : «   chemin — titre ».
    const p = l.match(/^\s{2}(\S+\.md) — /)
    if (p) out.add(p[1].trim())
  }
  return out
}

const CHAMP = {
  'A-dossiers': 'dossiers',
  'B-nature': 'B-nature',
  'C-plate': 'fiches',
  'D-intention': 'D-intention',
  'E-sujet': 'E-sujet',
  'F-hybride': 'F-hybride'
}

const nQuestions = Object.keys(verite).length
console.log(`campagne : ${nQuestions} questions, vérité-terrain vérifiée` + String.fromCharCode(10))

const bilan = []
for (const surface of Object.keys(reponses)) {
  const champ = CHAMP[surface]
  const connus = groupesDe(surface)
  const parTirage = []
  let invalides = 0
  const nTirages = Math.max(...Object.values(reponses[surface]).map((v) => v.length))
  for (let t = 0; t < nTirages; t += 1) {
    let justes = 0
    let comptees = 0
    for (const [num, attendus] of Object.entries(verite)) {
      const rep = (reponses[surface][num] ?? [])[t]
      if (rep === undefined) continue
      const normalisee = rep.trim()
      if (connus && connus.size > 0 && !connus.has(normalisee)) {
        invalides += 1
        continue
      }
      comptees += 1
      if (attendus[champ].includes(normalisee)) justes += 1
    }
    if (comptees > 0) parTirage.push({ justes, comptees })
  }
  if (parTirage.length === 0) continue
  const taux = parTirage.map((p) => p.justes / p.comptees)
  const moyenne = taux.reduce((x, y) => x + y, 0) / taux.length
  bilan.push({
    surface,
    tirages: parTirage.length,
    moyenne,
    min: Math.min(...taux),
    max: Math.max(...taux),
    invalides,
    taille: tailles?.[surface] ?? 0,
    detail: parTirage.map((p) => `${p.justes}/${p.comptees}`).join(' ')
  })
}

bilan.sort((x, y) => y.moyenne - x.moyenne)
console.log(
  'surface'.padEnd(14) +
    'moyenne'.padStart(9) +
    'étendue'.padStart(14) +
    'tirages'.padStart(9) +
    'hors format'.padStart(13) +
    '  détail'
)
for (const b of bilan) {
  console.log(
    b.surface.padEnd(14) +
      `${(100 * b.moyenne).toFixed(0)} %`.padStart(9) +
      `${(100 * b.min).toFixed(0)}-${(100 * b.max).toFixed(0)} %`.padStart(14) +
      String(b.tirages).padStart(9) +
      String(b.invalides).padStart(13) +
      '  ' +
      b.detail
  )
}

// L'écart entre la meilleure et la deuxième vaut-il quelque chose ? Comparé à l'étendue INTERNE de la
// meilleure : si l'écart est plus petit que sa propre dispersion, il ne départage rien.
if (bilan.length >= 2) {
  const ecart = bilan[0].moyenne - bilan[1].moyenne
  const dispersion = bilan[0].max - bilan[0].min
  console.log(String.fromCharCode(10) + `écart 1er-2e : ${(100 * ecart).toFixed(1)} points`)
  // À UN SEUL TIRAGE la dispersion vaut 0 par construction, et la comparer à l'écart produirait une
  // conclusion toujours favorable — un faux vert. Tant qu'on n'a pas au moins deux tirages sur le
  // premier, il n'y a rien à conclure, et le dire est la seule sortie honnête.
  if (bilan[0].tirages < 2) {
    console.log('étendue interne du 1er : INDÉFINIE (un seul tirage)')
    console.log(
      '→ RIEN N’EST DÉPARTAGÉ. Un tirage unique ne mesure pas la stabilité : la dispersion n’est pas' +
        String.fromCharCode(10) +
        '  nulle, elle est inconnue. Il faut au moins deux tirages pour que cet écart veuille dire quelque chose.'
    )
  } else {
    console.log(`étendue interne du 1er : ${(100 * dispersion).toFixed(1)} points`)
    console.log(
      ecart > dispersion
        ? '→ l’écart DÉPASSE la dispersion du premier : le classement de tête tient.'
        : '→ l’écart est INFÉRIEUR à la dispersion du premier : rien n’est départagé, il faut plus de tirages.'
    )
  }
}
