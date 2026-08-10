/**
 * Écho de PÉRIMÈTRE : avant d'exécuter le tour, dire à l'utilisateur ce qui va probablement être
 * fait, et sur quoi. Un prompt unique ne tient que si l'on peut corriger la visée AVANT l'envoi.
 *
 * Honnêteté du signal : la phase n'est PAS connue du renderer (elle est décidée côté orchestration).
 * Ce module ne produit donc qu'une PRÉSOMPTION, explicitement libellée « phase probable ». Les
 * cibles, elles, sont des faits : ce sont les mentions `@run:` / `@fichier:` réellement écrites.
 *
 * PUR → testable directement.
 */

import { collectMentionRefs, type MentionSources } from './chat-mentions'

export interface ScopeEcho {
  /** Phase présumée (jamais affirmée comme certaine), ou null si indéterminable. */
  phase: string | null
  /** Cibles DÉSIGNÉES par mention — des faits, pas des devinettes. */
  targets: string[]
}

const PHASE_CUES: Array<{ phase: string; re: RegExp }> = [
  { phase: 'scout', re: /\b(explore|scout|pistes?|options? possibles|cherche des)\b/i },
  {
    phase: 'frame',
    re: /\b(cadre|frame|périmètre|perimetre|spécifie|specifie|conçois|concois)\b/i
  },
  { phase: 'terrain', re: /\b(terrain|sop|procédure|procedure|plan d[’']exécution)\b/i },
  {
    phase: 'build',
    re: /\b(implémente|implemente|code|corrige|fix|répare|repare|ajoute|refactor|migre|débloque|debloque)\b/i
  },
  { phase: 'judge', re: /\b(juge|évalue|evalue|vérifie|verifie|c[’']est bon|relis|audit)\b/i }
]

/** Phase PRÉSUMÉE à partir du verbe dominant. `null` quand rien ne tranche. */
export function presumedPhase(input: string): string | null {
  for (const cue of PHASE_CUES) if (cue.re.test(input)) return cue.phase
  return null
}

/** `null` = rien à afficher (aucune phase présumable, aucune cible désignée). */
export function buildScopeEcho(input: string, sources: MentionSources): ScopeEcho | null {
  const text = input.trim()
  if (!text) return null
  const targets = collectMentionRefs(text, sources).map((r) =>
    r.kind === 'run' ? `run ${r.id}` : `fichier ${r.id}`
  )
  const phase = presumedPhase(text)
  if (!phase && targets.length === 0) return null
  return { phase, targets }
}

/** Ligne d'écho lisible. Le mot « probable » est porté par la phase, jamais par les cibles. */
export function formatScopeEcho(echo: ScopeEcho): string {
  const parts: string[] = []
  if (echo.phase) parts.push(`phase probable : ${echo.phase}`)
  if (echo.targets.length > 0) parts.push(`cibles : ${echo.targets.join(' · ')}`)
  return parts.join(' — ')
}
