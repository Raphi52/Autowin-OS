#!/usr/bin/env node
/**
 * VIDER LES VIEILLES CORBEILLES DU `/gc`, ET SEULEMENT SUR ACCORD (conv-1341, 2026-10-30).
 *
 * Le `/gc` quotidien déplace ce qui est mort dans `.autowin-data/gc-corbeille/AAAA-MM-JJ/` et propose
 * la purge au-delà de 14 jours. Depuis le 28/10, une corbeille atteint cet âge presque chaque jour :
 * la même question revient pour quelques Mo. Ce script la remplace, une fois l'accord donné.
 *
 * CE QU'IL NE SUPPOSE PAS, parce que la suppression ne se rattrape pas :
 *
 *  - L'ACCORD se lit dans `autowin-os/gc-purge-auto.json`, à côté de la corbeille, et vaut seulement
 *    pour `{"enabled": true}`. Absent, illisible ou mal typé : lecture seule, comme `autoclose-store.ts`.
 *    Le chemin se déduit de la racine et le seuil est écrit ici : aucune option ne peut les changer.
 *  - L'ÂGE se compte en jours du calendrier. En millisecondes, le changement d'heure du 25/10 donne
 *    14,04 jours du 16/10 au 30/10, et une corbeille de 14 jours pile serait partie un jour trop tôt.
 *  - LE CONTENU est relu à chaque passe, à toute profondeur. La corbeille du 13/10 portait
 *    `conversations.json.pre-remake`, mise à l'abri à la main avant la purge du 28/10, et celle du
 *    29/10 porte deux sauvegardes `conversations.json.*`. Ces fichiers ne se recréent pas : leur
 *    corbeille est gardée et repart à la question habituelle du `/gc`.
 *  - UNE JONCTION n'est jamais suivie. `supprimerArbre` la retire sans toucher sa cible, là où `rmSync`
 *    viderait le `node_modules` du dépôt (`src/main/fs-supprimer.ts`).
 *  - LE JOURNAL est écrit AVANT de supprimer : une purge impossible à tracer n'a pas lieu.
 *
 * Usage, depuis le dépôt Autowin :
 *   node --no-warnings scripts/gc-purger-corbeilles.mjs --racine <chemin absolu>/.autowin-data/gc-corbeille
 *
 * Sortie : le bilan en JSON. Code 0 = passe faite, 1 = une purge a échoué, 2 = commande refusée.
 */
import { appendFileSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { supprimerArbre } from '../src/main/fs-supprimer.ts'

const JOURS_DE_GARDE = 14
const NOM_DE_LA_RACINE = 'gc-corbeille'
const NOM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u
/** Sauvegardes de l'historique des conversations : uniques, et jamais recréées à l'identique. */
const NOM_PROTEGE = /^conversations\.json|\.pre-remake$/iu

const absente = (erreur) => erreur?.code === 'ENOENT'

/** Le numéro du jour, sans heure ni fuseau : deux dates du calendrier se soustraient. */
const numeroDuJour = (annee, mois, jour) => Date.UTC(annee, mois - 1, jour) / 86_400_000

/** Le numéro du jour d'un nom `AAAA-MM-JJ`, ou `null` si ce n'est pas une vraie date. */
function jourDuNom(nom) {
  const morceaux = NOM_DATE.exec(nom)
  if (!morceaux) return null
  const [annee, mois, jour] = morceaux.slice(1).map(Number)
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  const valide =
    date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour
  return valide ? numeroDuJour(annee, mois, jour) : null
}

/** Pourquoi refuser cette racine, ou `null`. Une racine absente est acceptée : rien à purger. */
function motifDeRefusDeLaRacine(racine) {
  if (typeof racine !== 'string' || racine.trim() === '') return 'racine absente ou vide'
  if (!isAbsolute(racine)) return `racine relative refusée : ${racine}`
  if (basename(resolve(racine)) !== NOM_DE_LA_RACINE)
    return `racine refusée, elle doit s'appeler ${NOM_DE_LA_RACINE} : ${racine}`
  try {
    if (!lstatSync(racine).isDirectory()) return `racine refusée, pas un vrai dossier : ${racine}`
  } catch (erreur) {
    if (!absente(erreur)) return `racine illisible : ${racine}`
  }
  return null
}

function accordDonne(chemin) {
  try {
    const brut = readFileSync(chemin, 'utf8').replace(/^\uFEFF/u, '')
    return JSON.parse(brut)?.enabled === true
  } catch {
    return false
  }
}

function manifesteValable(corbeille) {
  try {
    const manifeste = lstatSync(join(corbeille, 'MANIFEST.txt'))
    return manifeste.isFile() && manifeste.size > 0
  } catch {
    return false
  }
}

/** Parcourt sans suivre les liens. Un dossier illisible interdit de conclure. */
function inventaire(corbeille, lireDossier) {
  const resultat = { octets: 0, fichiers: 0, proteges: [], illisible: undefined }
  const aVoir = [corbeille]
  while (aVoir.length > 0) {
    const dossier = aVoir.pop()
    try {
      for (const entree of lireDossier(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, entree.name)
        if (NOM_PROTEGE.test(entree.name)) resultat.proteges.push(relative(corbeille, chemin))
        const infos = lstatSync(chemin)
        if (infos.isSymbolicLink()) continue
        if (infos.isDirectory()) {
          aVoir.push(chemin)
        } else {
          resultat.octets += infos.size
          resultat.fichiers += 1
        }
      }
    } catch {
      resultat.illisible = relative(corbeille, dossier) || '.'
      return resultat
    }
  }
  return resultat
}

/** Range une entrée : `recente`, `gardee` (avec son motif) ou `candidate` (avec son inventaire). */
function examiner({ racine, nom, aujourdhui, lireDossier }) {
  const jour = jourDuNom(nom)
  if (jour === null) return { rang: 'gardee', nom, motif: 'nom sans date valable' }
  const corbeille = join(racine, nom)
  if (!lstatSync(corbeille).isDirectory())
    return { rang: 'gardee', nom, motif: 'pas un vrai dossier' }
  const jours = aujourdhui - jour
  if (jours <= JOURS_DE_GARDE) return { rang: 'recente', nom }
  if (!manifesteValable(corbeille))
    return { rang: 'gardee', nom, motif: 'MANIFEST.txt absent, vide ou pas un fichier' }
  const { octets, fichiers, proteges, illisible } = inventaire(corbeille, lireDossier)
  if (illisible !== undefined)
    return { rang: 'gardee', nom, motif: `dossier illisible : ${illisible}` }
  if (proteges.length > 0)
    return { rang: 'gardee', nom, motif: `sauvegarde à trier : ${proteges.sort().join(', ')}` }
  return { rang: 'candidate', nom, chemin: corbeille, jours, octets, fichiers }
}

/**
 * Une passe. `maintenant`, `supprimer` et `lireDossier` n'existent que pour les tests : la ligne de
 * commande ne les expose pas, une date passée en option pourrait tout vieillir d'un coup.
 */
export function purgerLesCorbeilles({
  racine,
  maintenant = new Date(),
  supprimer = supprimerArbre,
  lireDossier = readdirSync
}) {
  const bilan = {
    code: 0,
    mode: 'lecture-seule',
    message: '',
    purgees: [],
    aPurger: [],
    gardees: [],
    recentes: [],
    echecs: []
  }
  const refus = motifDeRefusDeLaRacine(racine)
  if (refus) return { ...bilan, code: 2, message: refus }

  const donnees = join(dirname(resolve(racine)), 'autowin-os')
  const journal = join(donnees, 'gc-purges.jsonl')
  if (accordDonne(join(donnees, 'gc-purge-auto.json'))) bilan.mode = 'purge'

  let noms = []
  try {
    noms = readdirSync(racine).sort()
  } catch (erreur) {
    if (!absente(erreur)) throw erreur
  }
  const aujourdhui = numeroDuJour(
    maintenant.getFullYear(),
    maintenant.getMonth() + 1,
    maintenant.getDate()
  )

  for (const nom of noms) {
    const vue = examiner({ racine, nom, aujourdhui, lireDossier })
    if (vue.rang === 'recente') bilan.recentes.push(nom)
    if (vue.rang === 'gardee') bilan.gardees.push({ nom, motif: vue.motif })
    if (vue.rang !== 'candidate') continue
    const { chemin, ...candidate } = vue
    delete candidate.rang
    if (bilan.mode === 'lecture-seule') {
      bilan.aPurger.push(candidate)
      continue
    }
    const ligne = {
      quand: maintenant.toISOString(),
      corbeille: nom,
      jours: vue.jours,
      octets: vue.octets,
      fichiers: vue.fichiers
    }
    try {
      appendFileSync(journal, `${JSON.stringify({ ...ligne, geste: 'purge' })}\n`)
    } catch (erreur) {
      bilan.echecs.push({ nom, erreur: `journal impossible à écrire : ${erreur.message}` })
      bilan.code = 1
      break
    }
    try {
      supprimer(chemin)
      bilan.purgees.push(candidate)
    } catch (erreur) {
      bilan.echecs.push({ nom, erreur: erreur.message })
      bilan.code = 1
      try {
        const echec = { ...ligne, geste: 'purge-echouee', erreur: erreur.message }
        appendFileSync(journal, `${JSON.stringify(echec)}\n`)
      } catch {
        // Le premier passage a déjà laissé sa ligne, et l'échec se lit dans le bilan.
      }
    }
  }

  const rien =
    bilan.purgees.length + bilan.aPurger.length + bilan.gardees.length + bilan.echecs.length === 0
  if (rien) bilan.message = 'Rien à purger'
  return bilan
}

function principal() {
  let racine
  try {
    const { values } = parseArgs({ options: { racine: { type: 'string' } } })
    racine = values.racine
  } catch (erreur) {
    console.error(`Option refusée : ${erreur.message}`)
    return 2
  }
  const bilan = purgerLesCorbeilles({ racine })
  if (bilan.code === 2) console.error(bilan.message)
  else console.log(JSON.stringify(bilan, null, 2))
  return bilan.code
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal()
}
