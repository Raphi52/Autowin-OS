#!/usr/bin/env node
/**
 * CE QUE COÛTE UN REDÉMARRAGE D'AUTOWIN, MESURÉ SUR LES DONNÉES DÉJÀ ÉCRITES (conv-1338, 2026-10-30).
 *
 * La piste « un moteur qui se remplace sans relancer l'app » vaut plusieurs jours : 41 fichiers de
 * `src/main` importent electron et le processus principal tient 280 canaux. Ce script est son premier
 * pas sans risque : il donne les chiffres qui décident du chantier, et il les rejoue après coup pour
 * savoir si une correction a payé. Il répond à trois questions :
 *   - où part la durée d'un démarrage : le moteur, ou le rechargement de la fenêtre ?
 *     (jalons de `demarrages.jsonl`, `src/main/gel-main.ts`) ;
 *   - combien de tours repartent juste après un démarrage ?
 *     (événements `kind: resumed` de `turn-journals/<fil>/<tour>.jsonl`) ;
 *   - qui a demandé les fermetures ? (`fermeture demandee-par=` de `app-exits.log`, rangé À CÔTÉ de
 *     la racine de données, voir `src/main/journal-arrets.ts`).
 *
 * CE QU'IL NE MESURE PAS : une reprise n'est pas forcément causée par le démarrage qui la précède.
 * D'où le compte à part de celles qui suivent dans les 120 secondes.
 *
 * Usage : node scripts/mesure-reprises-apres-demarrage.mjs [--data <racine>]
 *   --data  défaut : `$AUTOWIN_DATA_ROOT`, sinon `<depot>/.autowin-data/autowin-os`.
 * Sortie 0 = mesure rendue en JSON ; 2 = racine de données introuvable.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const JALON_INTERFACE_DEMANDEE = "chargement de l'interface demandé"
const JALON_INTERFACE_CHARGEE = 'interface chargée'
const FENETRE_REPRISE_MS = 120_000

function lireJson(ligne) {
  try {
    return JSON.parse(ligne)
  } catch {
    // Un journal coupé par une fermeture brutale finit sur une ligne incomplète : elle ne compte pas.
    return null
  }
}

const lignes = (texte) => texte.split('\n').filter((ligne) => ligne.trim())

/** Les démarrages du journal, avec la part du moteur et celle de la fenêtre quand elles sont connues. */
export function lireDemarrages(texte) {
  const demarrages = []
  for (const ligne of lignes(texte)) {
    const entree = lireJson(ligne)
    const ts = Date.parse(entree?.ts)
    if (Number.isNaN(ts)) continue
    const jalon = (etape) => entree.jalons?.find((j) => j.etape === etape)?.ms
    const moteurMs = jalon(JALON_INTERFACE_DEMANDEE) ?? null
    const totalMs = jalon(JALON_INTERFACE_CHARGEE) ?? null
    demarrages.push({
      ts,
      moteurMs,
      interfaceMs: moteurMs !== null && totalMs !== null ? totalMs - moteurMs : null
    })
  }
  return demarrages.sort((a, b) => a.ts - b.ts)
}

/** Les instants de reprise d'un journal de tour. */
export function reprisesDuJournal(texte) {
  const instants = []
  for (const ligne of lignes(texte)) {
    // Filtre d'abord sur le texte : un journal de tour porte des prompts entiers à ne pas relire.
    if (!ligne.includes('"kind":"resumed"')) continue
    const entree = lireJson(ligne)
    if (entree?.kind === 'resumed' && Number.isFinite(entree.at)) instants.push(entree.at)
  }
  return instants
}

/** Les fermetures de la période, comptées par origine (`restart_app`, `moteur modifie`…). */
export function causesDeFermeture(texte, depuisMs) {
  const causes = {}
  for (const ligne of lignes(texte)) {
    const trouve = /^(\S+) fermeture demandee-par=(.+?)(?: \(|\s+—|$)/u.exec(ligne)
    if (!trouve || !(Date.parse(trouve[1]) >= depuisMs)) continue
    causes[trouve[2]] = (causes[trouve[2]] ?? 0) + 1
  }
  return causes
}

export function mediane(valeurs) {
  if (valeurs.length === 0) return null
  const triees = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(triees.length / 2)
  return triees.length % 2 === 1 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2
}

/** Le dernier démarrage qui précède cet instant ; `null` s'il est plus ancien que le journal. */
function demarragePrecedent(demarrages, instant) {
  let trouve = null
  for (const demarrage of demarrages) {
    if (demarrage.ts > instant) break
    trouve = demarrage
  }
  return trouve
}

export function mesurer({ demarrages, reprises, causes }) {
  const connues = (cle) => demarrages.map((d) => d[cle]).filter((v) => v !== null)
  const delaisMs = []
  const parDemarrage = new Map()
  const suivisDePres = new Set()
  for (const instant of reprises) {
    const demarrage = demarragePrecedent(demarrages, instant)
    if (!demarrage) continue
    const delai = instant - demarrage.ts
    delaisMs.push(delai)
    parDemarrage.set(demarrage.ts, (parDemarrage.get(demarrage.ts) ?? 0) + 1)
    if (delai <= FENETRE_REPRISE_MS) suivisDePres.add(demarrage.ts)
  }
  const delaiMedian = mediane(delaisMs)
  return {
    demarrages: {
      nombre: demarrages.length,
      premier: demarrages[0] ? new Date(demarrages[0].ts).toISOString() : null,
      dernier: demarrages.length ? new Date(demarrages.at(-1).ts).toISOString() : null,
      medianes: {
        moteurMs: mediane(connues('moteurMs')),
        interfaceMs: mediane(connues('interfaceMs'))
      }
    },
    reprises: {
      nombre: delaisMs.length,
      delaiMedianSecondes: delaiMedian === null ? null : Math.round(delaiMedian / 1000),
      dans120Secondes: delaisMs.filter((delai) => delai <= FENETRE_REPRISE_MS).length,
      demarragesSuivisDans120Secondes: suivisDePres.size,
      maxParDemarrage: Math.max(0, ...parDemarrage.values())
    },
    fermetures: causes
  }
}

/** Les reprises de tous les journaux écrits depuis `depuisMs`. Les plus anciens ne sont pas ouverts. */
function lireReprises(racineDonnees, depuisMs) {
  const dossier = join(racineDonnees, 'turn-journals')
  if (!existsSync(dossier)) return []
  const instants = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue
    const fil = join(dossier, entree.name)
    for (const nom of readdirSync(fil)) {
      const fichier = join(fil, nom)
      if (!nom.endsWith('.jsonl') || statSync(fichier).mtimeMs < depuisMs) continue
      instants.push(...reprisesDuJournal(readFileSync(fichier, 'utf8')))
    }
  }
  return instants
}

function lancer(arguments_) {
  const rang = arguments_.indexOf('--data')
  const depot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const racine =
    (rang >= 0 ? arguments_[rang + 1] : process.env['AUTOWIN_DATA_ROOT']) ??
    join(depot, '.autowin-data', 'autowin-os')
  const journal = join(racine, 'demarrages.jsonl')
  if (!existsSync(journal)) {
    process.stderr.write(`Racine de données introuvable : ${journal}\n`)
    process.exit(2)
  }
  const demarrages = lireDemarrages(readFileSync(journal, 'utf8'))
  const depuisMs = demarrages[0]?.ts ?? 0
  const arrets = join(racine, '..', 'app-exits.log')
  const causes = existsSync(arrets) ? causesDeFermeture(readFileSync(arrets, 'utf8'), depuisMs) : {}
  const reprises = lireReprises(racine, depuisMs)
  process.stdout.write(JSON.stringify(mesurer({ demarrages, reprises, causes }), null, 2) + '\n')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  lancer(process.argv.slice(2))
}
