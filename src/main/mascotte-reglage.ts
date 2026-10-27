import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AUTOWIN_APP_DATA_DIR } from '../shared/app-identity'
import type { PositionMascotte } from './mascotte'

/**
 * AFFICHER OU MASQUER LA MASCOTTE DU BUREAU — Settings · Interface (conv-1145, 2026-10-25).
 *
 * Gardé par le MOTEUR, pas par l'interface : la mascotte vit hors de la fenêtre et doit savoir,
 * dès le démarrage et fenêtre principale fermée, si elle a le droit d'apparaître. Rangé à côté du
 * réglage du Brain (`brain-reglage.ts`, `%APPDATA%\autowin-os`).
 *
 * Par défaut AFFICHÉE : c'est la fonction que l'utilisateur vient de demander ; l'interrupteur sert
 * à la retirer, pas à la découvrir.
 */

/** `undefined` sans `APPDATA` : un environnement qui ne le pose pas ne lit aucun réglage. */
export function mascotteReglageFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env.APPDATA?.trim()
  return base ? join(base, AUTOWIN_APP_DATA_DIR, 'mascotte.json') : undefined
}

/** Le choix enregistré. Fichier absent, illisible ou abîmé : affichée. */
export function lireMascotteAffichee(env: NodeJS.ProcessEnv = process.env): boolean {
  const fichier = mascotteReglageFile(env)
  if (!fichier) return true
  try {
    const brut = JSON.parse(readFileSync(fichier, 'utf8')) as { affichee?: unknown } | null
    return brut?.affichee !== false
  } catch {
    return true
  }
}

/**
 * Enregistre le choix. Seul un vrai booléen est accepté : une valeur douteuse venue de l'interface
 * ne doit pas masquer la mascotte par erreur. Rend `true` seulement si le fichier a changé.
 */
export function ecrireMascotteAffichee(
  valeur: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (typeof valeur !== 'boolean')
    throw new Error('Choix de la mascotte invalide (booléen attendu).')
  const fichier = mascotteReglageFile(env)
  if (!fichier)
    throw new Error(
      'Dossier de données introuvable (APPDATA) : choix de la mascotte non enregistré.'
    )
  if (existsSync(fichier) && lireMascotteAffichee(env) === valeur) return false
  ecrireReglage(fichier, { affichee: valeur, position: lirePositionMascotte(env) })
  return true
}

/**
 * LA PLACE DE LA BILLE (conv-1142, 2026-10-26) : là où l'utilisateur l'a glissée, gardée dans le
 * même fichier, pour qu'elle y revienne au prochain démarrage. Chaque écriture garde l'autre champ :
 * déplacer ne réaffiche pas une bille fermée, la fermer n'oublie pas sa place.
 */
type ReglageMascotte = { affichee: boolean; position: PositionMascotte | null }

function positionValide(brut: unknown): PositionMascotte | null {
  if (!brut || typeof brut !== 'object') return null
  const { x, y } = brut as { x?: unknown; y?: unknown }
  return Number.isSafeInteger(x) && Number.isSafeInteger(y)
    ? { x: x as number, y: y as number }
    : null
}

function ecrireReglage(fichier: string, reglage: ReglageMascotte): void {
  mkdirSync(dirname(fichier), { recursive: true })
  const contenu = reglage.position
    ? { affichee: reglage.affichee, position: reglage.position }
    : { affichee: reglage.affichee }
  writeFileSync(fichier, `${JSON.stringify(contenu, null, 2)}\n`, 'utf8')
}

/** La place gardée. Absente, abîmée ou pas en pixels entiers : `null` (le coin d'origine). */
export function lirePositionMascotte(
  env: NodeJS.ProcessEnv = process.env
): PositionMascotte | null {
  const fichier = mascotteReglageFile(env)
  if (!fichier) return null
  try {
    const brut = JSON.parse(readFileSync(fichier, 'utf8')) as { position?: unknown } | null
    return positionValide(brut?.position)
  } catch {
    return null
  }
}

/** Garde la place. Seuls des pixels entiers sont acceptés ; rend `true` si le fichier a changé. */
export function ecrirePositionMascotte(
  position: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const valide = positionValide(position)
  if (!valide) throw new Error('Place de la mascotte invalide (pixels entiers attendus).')
  const fichier = mascotteReglageFile(env)
  if (!fichier)
    throw new Error('Dossier de données introuvable (APPDATA) : place de la mascotte non gardée.')
  const avant = lirePositionMascotte(env)
  if (avant && avant.x === valide.x && avant.y === valide.y) return false
  ecrireReglage(fichier, { affichee: lireMascotteAffichee(env), position: valide })
  return true
}
