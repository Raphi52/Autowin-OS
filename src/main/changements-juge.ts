import { AGGREGATE_MAX_CHARS } from './evidence-digest'

/**
 * CE QUI A CHANGÉ ENTRE DEUX PASSAGES DU JUGE.
 *
 * fix-ok: conv-914 (2026-10-13) — cause lue dans le code : le prompt du juge renvoyait à CHAQUE
 * passage le livrable agrégé entier (`clampAggregateForJudge(exec.text)`, orchestrator.ts), sans
 * jamais garder le texte déjà jugé (`memoire-juge.ts` ne garde que le verdict). Le juge d'une
 * réparation ne pouvait donc pas savoir ce que la réparation avait touché : il revérifiait tout
 * (passages de conv-914, ~25 min pour 4 juges d'après l'analyse de ce run, non re-mesuré).
 *
 * On compare par LIGNES, en multiensemble : une ligne présente une fois de plus qu'avant est
 * « ajoutée », une fois de moins « retirée ». Aucune dépendance de diff dans package.json, et
 * `etat-diff.ts` ne compare que du JSON.
 *
 * LE BLOC NE FAIT JAMAIS DÉPASSER LA TAILLE MAXIMALE ACTUELLE DU PROMPT DU JUGE. Le livrable agrégé
 * y est borné à `AGGREGATE_MAX_CHARS` (evidence-digest.ts, choix de coût de conv-1120) ; le bloc ne
 * prend que la place que le livrable laisse libre sous ce plafond, et au plus
 * `MAX_CARACTERES_CHANGEMENTS`. Sans place, il n'y a pas de bloc.
 */

/** Borne du bloc, en-tête compris : au-delà, les lignes restantes sont comptées, pas recopiées. */
export const MAX_CARACTERES_CHANGEMENTS = 4000
const MAX_CARACTERES_PAR_LIGNE = 300
const ENTETE =
  'CE QUI A CHANGÉ depuis le livrable déjà jugé au passage précédent (« + » ligne ajoutée, « - » ligne retirée) :\n'

export interface LignesChangees {
  ajoutees: string[]
  retirees: string[]
}

function lignesUtiles(texte: string): string[] {
  return texte
    .split(/\r?\n/u)
    .map((ligne) => ligne.replace(/\s+$/u, ''))
    .filter((ligne) => ligne.trim() !== '')
}

/** Les lignes de `apres` absentes de `avant` (et l'inverse), dans leur ordre d'apparition. */
export function lignesChangees(avant: string, apres: string): LignesChangees {
  const restantesAvant = new Map<string, number>()
  for (const ligne of lignesUtiles(avant))
    restantesAvant.set(ligne, (restantesAvant.get(ligne) ?? 0) + 1)
  const ajoutees: string[] = []
  for (const ligne of lignesUtiles(apres)) {
    const n = restantesAvant.get(ligne) ?? 0
    if (n > 0) restantesAvant.set(ligne, n - 1)
    else ajoutees.push(ligne)
  }
  const retirees: string[] = []
  for (const ligne of lignesUtiles(avant)) {
    const n = restantesAvant.get(ligne) ?? 0
    if (n > 0) {
      retirees.push(ligne)
      restantesAvant.set(ligne, n - 1)
    }
  }
  return { ajoutees, retirees }
}

function borner(ligne: string): string {
  return ligne.length > MAX_CARACTERES_PAR_LIGNE
    ? `${ligne.slice(0, MAX_CARACTERES_PAR_LIGNE)}…`
    : ligne
}

function ligneDeSuite(reste: number): string {
  return reste > 0
    ? `… ${reste} autre(s) ligne(s) changée(s), non recopiées — elles sont dans le livrable ci-dessous.\n`
    : ''
}

/**
 * Le bloc injecté dans le prompt du juge à partir du 2e passage. Vide quand rien n'a encore été
 * jugé (1er passage) : il n'y a alors rien à comparer. Vide aussi quand le livrable occupe déjà
 * toute la taille maximale : le bloc ne la dépasse jamais (`AGGREGATE_MAX_CHARS`).
 */
export function noteChangementsPourJuge(texteDejaJuge: string, texteCourant: string): string {
  if (!(texteDejaJuge ?? '').trim()) return ''
  const courant = texteCourant ?? ''
  const budget = Math.min(MAX_CARACTERES_CHANGEMENTS, AGGREGATE_MAX_CHARS - courant.length)
  const { ajoutees, retirees } = lignesChangees(texteDejaJuge, courant)
  if (ajoutees.length === 0 && retirees.length === 0) {
    const note = `${ENTETE}(aucune ligne du livrable n'a changé)\n`
    return note.length <= budget ? note : ''
  }
  const lignes = [
    ...ajoutees.map((l) => `+ ${borner(l)}`),
    ...retirees.map((l) => `- ${borner(l)}`)
  ]
  // Place réservée à la ligne « … N autre(s) » dans le pire cas (aucune ligne recopiée).
  const reserve = ligneDeSuite(lignes.length).length
  let bloc = ''
  let gardees = 0
  for (const ligne of lignes) {
    if (ENTETE.length + bloc.length + ligne.length + 1 + reserve > budget) break
    bloc += `${ligne}\n`
    gardees += 1
  }
  const note = `${ENTETE}${bloc}${ligneDeSuite(lignes.length - gardees)}`
  return note.length <= budget ? note : ''
}
