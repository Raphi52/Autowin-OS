import { resolveVerifyCmd } from './hooks/resolve-verify-cmd'

/**
 * COMMANDE DE VERIFICATION exposee a l'agent — pour qu'il puisse PROUVER au lieu de promettre.
 *
 * Pourquoi ce module existe (2026-07-28) : l'agent de chat ne pouvait rien executer, donc il ne
 * pouvait jamais dire « vert » avec un artefact — toute la discipline « pas de fait sans preuve » lui
 * etait inaccessible. La voie evidente (donner Bash au CLI avec `--allowedTools "Bash(npm test)"`)
 * a ete TESTEE et INVALIDEE : le pattern ne restreint rien, l'agent executait `echo BONJOUR` sans
 * refus, avec ET sans bypassPermissions. Donner Bash equivaut donc a donner un shell (rm/git/curl).
 *
 * D'ou cette architecture : le modele ne choisit JAMAIS la commande. Il demande « verifie », et c'est
 * Autowin qui decide quoi lancer, a partir du script `test` DECLARE par le projet. Aucun parametre
 * libre ne traverse cette frontiere — c'est la seule propriete qui rend l'exposition sure.
 */

export type VerifyDecision =
  | { allowed: true; command: string; cwd: string }
  | { allowed: false; reason: string }

/**
 * Decide s'il y a une verification executable, et LAQUELLE. Les arguments eventuels du modele sont
 * volontairement IGNORES : la commande vient du projet, jamais de la demande.
 */
export function decideVerifyCommand(
  cwd: string | undefined,
  resolve: (dir: string) => string | undefined = resolveVerifyCmd
): VerifyDecision {
  if (!cwd || !cwd.trim()) {
    return { allowed: false, reason: 'aucun workspace résolu — rien à vérifier' }
  }
  const command = resolve(cwd)
  if (!command) {
    return {
      allowed: false,
      reason: 'le projet ne déclare aucun script « test » — rien à rejouer (pas de faux vert)'
    }
  }
  // Ceinture ET bretelles : meme si `resolveVerifyCmd` evoluait, seule une commande de la liste
  // blanche peut sortir d'ici. Un futur resolveur bavard ne pourra pas transformer ce point
  // d'entree en shell.
  if (!ALLOWED_COMMANDS.has(command)) {
    return { allowed: false, reason: `commande non autorisée : ${command}` }
  }
  return { allowed: true, command, cwd }
}

/**
 * Liste blanche EXHAUSTIVE des commandes que ce point d'entree peut lancer. Toute autre valeur est
 * refusee, quelle qu'en soit la provenance. Volontairement minuscule : ce n'est pas un shell.
 */
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'npm test',
  // Scripts de tests PURS, preferes par resolveVerifyCmd : `npm test` peut inclure typecheck+lint,
  // et un lint rouge sur des warnings preexistants rendait `verify` incapable de conclure.
  'npm run test:unit',
  'npm run test:run',
  'npm run tests'
])

/** Sortie d'une verification, telle qu'elle est rendue a l'agent. */
export interface VerifyOutcome {
  ok: boolean
  exitCode: number | null
  command: string
  /** Sortie TRONQUEE : une suite de tests entiere n'a pas a inonder le contexte du tour. */
  output: string
}

export const VERIFY_OUTPUT_CAP = 4_000

/**
 * Tronque la sortie en gardant la FIN : l'echec et le recapitulatif sont en bas.
 *
 * Le marqueur est COMPTE dans le plafond. Sans cette reserve, la valeur rendue depassait le cap au
 * lieu de le respecter — meme piege que `truncate` cote tickets, attrape par le test de bornage.
 */
export function capVerifyOutput(raw: string, cap: number = VERIFY_OUTPUT_CAP): string {
  const text = raw.trim()
  if (text.length <= cap) return text
  const omitted = text.length - cap
  const marker = `…[tronqué — ${omitted} caractères omis]\n`
  const kept = Math.max(0, cap - marker.length)
  return `${marker}${text.slice(-kept)}`
}
