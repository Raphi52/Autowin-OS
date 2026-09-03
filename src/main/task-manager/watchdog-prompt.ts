import type { WatchdogOutcome, WatchdogSignal } from './types'

/**
 * Ce que l'agent reveille recoit, et ce qu'on lui demande de rendre.
 *
 * Deux exigences que le cadrage a posees et qui vivent ici :
 *  - il recoit le CONTEXTE de l'evenement (la ligne, son voisinage, la source). Sans lui, un agent
 *    reveille par « une erreur est apparue » repart de zero et devine l'incident ;
 *  - il rend un TRI explicite. Sans issue lisible, un reveil evenementiel n'est qu'une alerte de
 *    plus : quelqu'un doit quand meme aller lire pour savoir si c'etait grave.
 */

const WATCHDOG_OUTCOMES: readonly WatchdogOutcome[] = [
  'benign',
  'report',
  'investigate',
  'repair'
]

const OUTCOME_LABEL: Record<WatchdogOutcome, string> = {
  benign: 'bénin — aucun suivi nécessaire',
  report: 'rapport — à signaler, sans intervention',
  investigate: 'investigation — creusé, cause identifiée ou piste posée',
  repair: 'réparation — un changement a été fait'
}

/** Le marqueur est en fin de reponse et sur sa propre ligne : lisible par l'humain, parsable ici. */
const OUTCOME_MARKER =
  /^\s*(?:[-*]\s*)?(?:\*\*)?ISSUE(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*([a-zA-Zéèê-]+)/imu

const OUTCOME_ALIASES: Record<string, WatchdogOutcome> = {
  benign: 'benign',
  benin: 'benign',
  bénin: 'benign',
  report: 'report',
  rapport: 'report',
  investigate: 'investigate',
  investigation: 'investigate',
  repair: 'repair',
  reparation: 'repair',
  réparation: 'repair'
}

export function buildWatchdogPrompt(basePrompt: string, signal: WatchdogSignal): string {
  return [
    basePrompt.trim(),
    '',
    '--- ÉVÉNEMENT QUI T’A RÉVEILLÉ ---',
    signal.context.trim(),
    '--- fin de l’événement ---',
    '',
    "Tu n'as pas été lancé par une horloge : quelque chose vient de se produire, et le contexte " +
      'ci-dessus est tout ce qui le décrit. Établis les faits avant de conclure.',
    '',
    'Termine ta réponse par une dernière ligne indiquant ton tri, exactement sous cette forme :',
    'ISSUE: benign | report | investigate | repair',
    '',
    ...WATCHDOG_OUTCOMES.map((outcome) => `- \`${outcome}\` : ${OUTCOME_LABEL[outcome]}`)
  ].join('\n')
}

/**
 * Lit le tri dans la reponse de l'agent. Rend `undefined` plutot qu'une valeur par defaut : ne pas
 * savoir ce que l'agent a conclu est une information, et la deviner (« sans doute benin ») serait
 * exactement le genre de faux acquis que ce systeme doit eviter.
 */
export function parseWatchdogOutcome(reply: string | undefined): WatchdogOutcome | undefined {
  if (!reply) return undefined
  // La DERNIERE occurrence fait foi : l'agent peut citer les valeurs possibles en cours de reponse.
  let found: WatchdogOutcome | undefined
  for (const line of reply.split('\n')) {
    const match = OUTCOME_MARKER.exec(line)
    if (!match) continue
    const candidate = OUTCOME_ALIASES[match[1].toLowerCase()]
    if (candidate) found = candidate
  }
  return found
}

/** Contexte lisible d'une ligne de log qui a matche, avec son voisinage. */
export function describeFileMatch(path: string, line: string, neighbourhood: string[]): string {
  const trigger = bounded(line, 2_048)
  let triggerRemoved = false
  const around = neighbourhood
    .filter((entry) => {
      if (!triggerRemoved && entry === line) {
        triggerRemoved = true
        return false
      }
      return true
    })
    .slice(0, 8)
    .map((entry) => `  ${bounded(entry, 1_024)}`)
  return [
    `Source : fichier surveillé ${bounded(path, 512)}`,
    `Ligne déclenchante : ${trigger}`,
    ...(around.length ? ['', 'Lignes autour (contexte brut) :', ...around] : [])
  ].join('\n')
}

function bounded(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}… [${value.length - maxChars} caractères tronqués]`
}
