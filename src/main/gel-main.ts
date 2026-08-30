import { appendFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classerGel,
  resumerGels,
  PERIODE_BATTEMENT_MS,
  SEUIL_GEL_MS,
  type Gel,
  type ResumeGels
} from '../shared/gel-detector'

/**
 * BATTEMENT du process main — l'instrument qui attrape « ce programme ne repond pas ».
 *
 * Un minuteur arme a periode fixe. Tant que la boucle d'evenements tourne, il se reveille a
 * l'heure. Des qu'un appel synchrone la tient (lecture disque reseau, `spawnSync git`, scan de
 * dossier), le reveil arrive en retard — et ce retard est, a la milliseconde pres, la duree pendant
 * laquelle la fenetre etait figee. Journalise dans `<appdata>/autowin-os/gels.jsonl`, best-effort,
 * jamais bloquant.
 */

let dossier: string | undefined
let minuteur: NodeJS.Timeout | undefined

/*
 * PILE, et non scalaire. Mesure du 2026-08-28 : la premiere version remettait 'inactif' des la fin
 * de la lecture la plus INTERNE, si bien que les quatre gels reels captes (pire : 33 335 ms) sont
 * tous ressortis sous 'inconnu' / 'inactif' — l'instrument prouvait le gel sans jamais nommer le
 * coupable. Une operation imbriquee doit rendre la main a celle qui l'ENGLOBE, pas au vide.
 */
const pile: string[] = []

/** Ce que le main declare faire ICI et MAINTENANT — joint au gel pour NOMMER le coupable. */
export function marquerOperation(nom: string): void {
  pile.length = 0
  if (nom) pile.push(nom)
}

/** Empile une operation et rend la fonction qui la depile — sur d'usage en `finally`. */
export function ouvrirOperation(nom: string): () => void {
  pile.push(nom || 'inconnu')
  let ferme = false
  return () => {
    if (ferme) return
    ferme = true
    const i = pile.lastIndexOf(nom || 'inconnu')
    if (i >= 0) pile.splice(i, 1)
  }
}

/** Joue `action` en declarant `nom`, quoi qu'il arrive (succes, jet, rejet). */
export function pendantOperation<T>(nom: string, action: () => T): T {
  const fermer = ouvrirOperation(nom)
  try {
    const valeur = action()
    if (valeur instanceof Promise) {
      return valeur.finally(fermer) as unknown as T
    }
    fermer()
    return valeur
  } catch (e) {
    fermer()
    throw e
  }
}

/**
 * CLOT la phase de demarrage. Mesure du 2026-08-30 : `marquerOperation('demarrage:...')` EMPILE un
 * jalon que rien ne depilait — la pile gardait donc 'demarrage:interface chargee' indefiniment, et
 * 49 des 173 gels du journal ont ete attribues au demarrage alors qu'ils survenaient des HEURES
 * plus tard (rafales de 6 a 10 s a 10h41 sur une app demarree a 7h). L'instrument prouvait le gel
 * sans jamais nommer le coupable. Une phase qui se termine rend la pile au vide.
 */
export function cloreDemarrage(): void {
  pile.length = 0
}

/** Rend l'operation la plus INTERNE encore ouverte (utile aux tests et au diagnostic). */
export function operationDeclaree(): string {
  return pile.length > 0 ? (pile[pile.length - 1] as string) : 'inconnu'
}

/*
 * UN SEUL PUITS D'ECRITURE. Le battement et les mesures DIRECTES doivent aboutir au meme endroit :
 * deux chemins d'ecriture, c'est un test qui observe l'un pendant que le produit alimente l'autre.
 */
let puits: (gel: Gel) => void = journaliser

/** Depose un gel dans le journal — expose pour les mesures DIRECTES (segments synchrones). */
export function journaliserGel(gel: Gel): void {
  puits(gel)
}

function journaliser(gel: Gel): void {
  if (!dossier) return
  const racine = dossier
  void mkdir(racine, { recursive: true })
    .then(() => appendFile(join(racine, 'gels.jsonl'), JSON.stringify(gel) + '\n', 'utf8'))
    .catch(() => {
      /* observabilite best-effort : un journal muet ne doit jamais casser l'application */
    })
}

/**
 * Demarre le battement. Sans dossier, le detecteur reste INERTE (aucun minuteur arme) — un test ou
 * un demarrage sans espace de donnees ne doit pas payer un timer.
 */
export function demarrerDetecteurDeGel(
  dir: string,
  periodeMs = PERIODE_BATTEMENT_MS,
  ecrire: (gel: Gel) => void = journaliser,
  seuilMs = SEUIL_GEL_MS
): () => void {
  dossier = dir
  puits = ecrire
  let precedent = Date.now()
  /*
   * PREUVE PAR LE CPU. Un reveil tardif dit que le temps a passe, pas OU il a passe. On releve donc
   * le CPU consomme par NOTRE process pendant l'intervalle : brule chez nous => la boucle etait
   * tenue par notre code ; pas brule => nous etions desordonnances (machine saturee, veille) et
   * l'operation declaree a cet instant n'est qu'une coincidence.
   */
  let cpuPrecedent = process.cpuUsage()
  minuteur = setInterval(() => {
    const maintenant = Date.now()
    const delta = process.cpuUsage(cpuPrecedent)
    cpuPrecedent = process.cpuUsage()
    const cpuMs = (delta.user + delta.system) / 1000
    const { blocageMs, cause } = classerGel(maintenant - precedent, cpuMs, periodeMs, seuilMs)
    precedent = maintenant
    if (blocageMs > 0) {
      ecrire({
        ts: new Date(maintenant).toISOString(),
        blocageMs,
        operation: operationDeclaree(),
        cause
      })
    }
  }, periodeMs)
  minuteur.unref?.()
  return () => {
    if (minuteur) clearInterval(minuteur)
    minuteur = undefined
    puits = journaliser
  }
}

export interface RapportGels extends ResumeGels {
  /** FAUX quand aucun journal n'existe : la vue le DIT au lieu d'afficher un zero rassurant. */
  disponible: boolean
  source: string
}

/** Lecture SEULE du journal, bornee aux derniers gels : un gel d'il y a trois semaines ne decrit rien. */
export function lireGels(dir: string, derniers = 200): RapportGels {
  const source = join(dir, 'gels.jsonl')
  if (!existsSync(source)) return { ...resumerGels([]), disponible: false, source }
  const lignes = readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean)
  const fenetre = derniers > 0 ? lignes.slice(-derniers) : lignes
  return { ...resumerGels(fenetre), disponible: true, source }
}

/**
 * Fait DECLARER son canal a chaque handler IPC, en une seule couture.
 *
 * Les 149 \`ipcMain.handle\` du main sont la porte d'entree de tout ce que le renderer demande. Les
 * instrumenter un par un serait 149 occasions d'en oublier un ; on enrobe donc l'enregistrement
 * lui-meme. Le handler d'origine est appele tel quel : aucune valeur, aucun rejet n'est modifie.
 */
export function instrumenterCanauxIpc(ipc: {
  handle: (canal: string, ecouteur: (...a: never[]) => unknown) => void
}): void {
  const original = ipc.handle.bind(ipc)
  ipc.handle = (canal: string, ecouteur: (...a: never[]) => unknown): void =>
    original(canal, (...args: never[]) => {
      /*
       * SEUL LE SEGMENT SYNCHRONE COMPTE — mesure du 2026-08-28 (conv-1511).
       *
       * Un gel est, par definition, la boucle d'evenements TENUE : une promesse en attente ne tient
       * rien. La premiere version refermait l'operation au REGLEMENT de la promesse ; un handler
       * async lent (`os:models:quotas`, qui attend un `fetch` reseau) restait donc declare pendant
       * toute son attente et ramassait le nom de blocages causes par un AUTRE code. Il est ressorti
       * treize fois en tete du journal — un alibi, pas un coupable ; la lecture disque qu'on lui
       * imputait a ete chronometree a 30 ms.
       *
       * On ne declare donc que ce qui s'execute AVANT le premier await : le seul segment qui puisse
       * reellement figer la fenetre.
       */
      const fermer = ouvrirOperation(`ipc:${canal}`)
      const depart = Date.now()
      try {
        return ecouteur(...args)
      } finally {
        fermer()
        /*
         * MESURE DIRECTE, plutot qu'attribution par coincidence.
         *
         * Le battement dit QUE la boucle a ete tenue ; il designe l'operation ouverte a cet
         * instant, ce qui reste une CORRELATION. Ici on chronometre le segment synchrone lui-meme :
         * s'il depasse le seuil, c'est une PREUVE que ce canal a tenu la boucle pendant ce temps —
         * le suffixe `(sync)` distingue cette mesure directe de l'attribution du battement.
         */
        const dureeMs = Date.now() - depart
        if (dureeMs >= SEUIL_GEL_MS) {
          journaliserGel({
            ts: new Date().toISOString(),
            blocageMs: dureeMs,
            operation: `ipc:${canal} (sync)`,
            // Chronometrage DIRECT du segment synchrone : imputable par construction, sans
            // dependre de l'heuristique CPU (un blocage d'entree-sortie ne brule pas de CPU).
            cause: 'boucle-tenue'
          })
        }
      }
    })
}
