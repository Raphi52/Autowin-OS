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
  { allowed: true; command: string; cwd: string } | { allowed: false; reason: string }

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

/** Saut de ligne sans sequence d'echappement : cinq occurrences d'un `\n` mange en route dans cette session. */
const SAUT = String.fromCharCode(10)

/**
 * Tronque la sortie en gardant la FIN : l'echec et le recapitulatif sont en bas.
 *
 * Le marqueur est COMPTE dans le plafond. Sans cette reserve, la valeur rendue depassait le cap au
 * lieu de le respecter — meme piege que `truncate` cote tickets, attrape par le test de bornage.
 */
/**
 * Lignes qui portent le VERDICT d'une verification : l'echec nomme et le recapitulatif.
 *
 * Volontairement conservateur et agnostique du runner. Ce qui n'est pas reconnu tombe simplement
 * dans la queue, comme avant — on ne perd rien, on remonte seulement ce qui decide.
 */
const LIGNES_DE_VERDICT =
  /^\s*(?:FAIL|×|✗|✕|Test Files|Tests\s|Duration|error TS\d+|Error:|AssertionError|exit code)/

/**
 * Retire les sequences ANSI d'une ligne avant de la comparer.
 *
 * Revele par la sortie REELLE de l'app le 2026-08-19 : vitest prefixe ses lignes de `ESC[32m`,
 * donc un motif ancre sur le debut de ligne ne matchait JAMAIS et le verdict etait perdu malgre le
 * correctif. Le premier test utilisait du texte propre — un fixture qui ne ressemblait pas a la
 * production, donc un vert qui ne prouvait rien.
 */
// eslint-disable-next-line no-control-regex -- matcher l'echappement ANSI est precisement l'objet : la regle vise un caractere de controle ACCIDENTEL.
const SEQUENCE_ANSI = /\x1b\[[0-9;]*m/g

function sansCouleur(ligne: string): string {
  return ligne.replace(SEQUENCE_ANSI, '')
}

function verdictDe(texte: string, budget: number): string {
  const vues = new Set<string>()
  const retenues: string[] = []
  let taille = 0
  for (const ligne of texte.split(SAUT)) {
    if (!LIGNES_DE_VERDICT.test(sansCouleur(ligne))) continue
    const propre = ligne.trimEnd()
    if (vues.has(propre)) continue
    if (taille + propre.length + 1 > budget) break
    vues.add(propre)
    retenues.push(propre)
    taille += propre.length + 1
  }
  return retenues.join(SAUT)
}

/**
 * Tronque la sortie SANS jeter le verdict.
 *
 * La version precedente ne gardait que la FIN, en supposant « l'echec et le recapitulatif sont en
 * bas ». Vu dans l'app le 2026-08-19 : `stdout` et `stderr` etant fusionnes au fil de l'arrivee
 * (`commands.ts`), une suite bavarde en `stderr` remplissait entierement la fenetre gardee. La
 * pastille affichait « exit 1 », « 182469 caracteres omis », puis uniquement des avertissements
 * `act(...)` sur deux fichiers qui PASSENT — un echec dont la cause etait absente de l'ecran, et un
 * indice qui envoyait chercher le defaut dans du code sain.
 *
 * Les lignes de verdict passent donc devant, la queue remplit le reste. Le marqueur est COMPTE dans
 * le plafond : la valeur rendue ne le depasse jamais.
 */
export function capVerifyOutput(raw: string, cap: number = VERIFY_OUTPUT_CAP): string {
  const text = raw.trim()
  if (text.length <= cap) return text
  const omitted = text.length - cap
  const marker = `…[tronqué — ${omitted} caractères omis]` + SAUT
  const restant = Math.max(0, cap - marker.length)
  const verdict = verdictDe(text, Math.floor(restant / 2))
  const queue = restant - (verdict ? verdict.length + 1 : 0)
  const fin = queue > 0 ? text.slice(-queue) : ''
  return verdict ? marker + verdict + SAUT + fin : marker + fin
}
