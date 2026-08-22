import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * PLAFOND de la verification — le temps au bout duquel on ARRETE la suite et on le DIT.
 *
 * DEFAUT VECU le 22/08 (conv-1363) : chaque `edit_file` rejoue toute la suite unitaire dans un
 * bureau isole (`withIsolatedMutation`), et ce `spawn` n'avait AUCUNE horloge. La suite a tourne
 * 6 min 40 ; pendant ce temps le pilote etait bloque DANS la commande, donc il ne drainait plus
 * ses directives, le bloc `ask` restait affiche et le chat semblait mort — sans qu'aucune borne
 * n'existe pour y mettre fin. Une attente sans plafond n'est pas une attente, c'est un blocage.
 *
 * Genereux volontairement : le but n'est pas de couper une suite honnete, c'est d'empecher un
 * blocage INFINI. `AUTOWIN_VERIFY_TIMEOUT_MS` permet de le regler (et aux tests de le rendre court).
 */
export const VERIFY_TIMEOUT_MS = 600_000

export function verifyTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const brut = Number(env.AUTOWIN_VERIFY_TIMEOUT_MS)
  return Number.isFinite(brut) && brut > 0 ? brut : VERIFY_TIMEOUT_MS
}

/**
 * Le verdict d'une verification ARRETEE au plafond. `ok: false` sans discussion : une suite
 * interrompue n'a rien prouve, et un `exitCode: null` seul se lirait comme une panne de lancement.
 */
export function verifyTimeoutOutcome(command: string, ms: number): VerifyOutcome {
  return {
    ok: false,
    exitCode: null,
    command,
    output: `vérification arrêtée après ${Math.round(ms / 1000)} s (plafond) — rien n'est prouvé, la suite n'a pas rendu son verdict`
  }
}


/**
 * VERIFICATION DE PORTEE — ce que l'edition a REELLEMENT pu casser, et rien d'autre.
 *
 * DEFAUT VECU le 22/08 (conv-1363). `edit_file` conditionnait sa publication a un verdict GLOBAL :
 * la suite entiere devait sortir a 0. Or ce verdict repond « le depot est-il vert ? », jamais
 * « cette edition a-t-elle casse quelque chose ? ». Les deux questions coincident tant que la base
 * est verte, et divergent totalement des qu'elle ne l'est plus : une edition SAINE de
 * `orchestration-outcome.ts` a ete jetee parce que `Markdown.test.tsx` echouait — 11 tests sur 62,
 * sur le commit COMMITTE, sans aucun rapport avec l'edition (le bureau isole part d'`origin` et
 * EXCLUT les fichiers sales, donc aucune contamination locale n'etait en cause).
 *
 * `vitest related` rejoue les tests qui DEPENDENT du fichier edite, par le graphe d'imports.
 * L'immunite aux rouges sans rapport est donc obtenue par CONSTRUCTION, pas par une exception qui
 * avalerait des echecs. Mesure sur le cas reel : 134 fichiers, 1498 tests, 69,7 s VERT, contre
 * 6 min 40 ROUGE pour la suite entiere.
 *
 * ANGLE MORT ASSUME : un test qui n'exerce le fichier que par un chemin d'EXECUTION (import
 * dynamique, processus lance) sort du graphe d'imports et n'est pas rejoue. Il est NOMME dans le
 * verdict rendu au modele — un angle mort tu se lirait comme une preuve.
 */
export const VERIFY_RELATED_ANGLE_MORT =
  'portée = les tests qui importent le(s) fichier(s) édité(s) ; un test qui ne les exerce que par un chemin d’exécution (import dynamique, processus lancé) n’est pas rejoué'

function scriptsDeclares(dir: string): Record<string, string> | null {
  const chemin = join(dir, 'package.json')
  if (!existsSync(chemin)) return null
  try {
    return (JSON.parse(readFileSync(chemin, 'utf8')) as { scripts?: Record<string, string> })
      .scripts ?? {}
  } catch {
    return null
  }
}

export type RelatedVerifyDecision =
  | { allowed: true; argv: string[]; cwd: string; command: string }
  | { allowed: false; reason: string }

/**
 * Un chemin ne doit jamais pouvoir se faire passer pour une OPTION.
 *
 * Les chemins viennent de `decideEdit` (deja borne : pas de traversee, pas de `.git`, pas de
 * secrets) et jamais du modele — mais ils traversent ici une frontiere d'ARGUMENTS. Un chemin
 * commencant par `-` deviendrait un drapeau de vitest : c'est la seule facon dont cette extension
 * pourrait elargir ce que la commande fait, et elle est fermee ici plutot que supposee impossible.
 */
const ANTISLASH = String.fromCharCode(92)

const cheminUtilisable = (chemin: unknown): chemin is string =>
  typeof chemin === 'string' &&
  chemin.trim().length > 0 &&
  !chemin.startsWith('-') &&
  !chemin.includes('..') &&
  !chemin.includes(String.fromCharCode(0)) &&
  !/^[a-zA-Z]:/.test(chemin) &&
  !chemin.startsWith('/') &&
  !chemin.startsWith(ANTISLASH)

/**
 * Decide la verification de PORTEE. La commande est FIXE (`vitest related … --run`) : seuls des
 * chemins valides s'y injectent, en argv SEPARES — aucune chaine interpolee, donc aucune surface
 * d'injection, exactement comme la voie globale.
 */
export function decideRelatedVerify(
  cwd: string | undefined,
  paths: readonly unknown[],
  lireScripts: (dir: string) => Record<string, string> | null = scriptsDeclares
): RelatedVerifyDecision {
  if (!cwd || !cwd.trim()) {
    return { allowed: false, reason: 'aucun workspace résolu — rien à vérifier' }
  }
  /*
   * `related` est une notion de VITEST. Un projet qui teste autrement n'a pas de graphe d'imports a
   * interroger : lui envoyer cette commande fabriquerait un « lancement impossible » — donc un REFUS
   * de publier — sur un projet parfaitement sain. On ne prend cette voie que si le projet declare
   * reellement vitest, et le repli global couvre tous les autres.
   */
  const scripts = lireScripts(cwd)
  const declare = scripts
    ? ['test:unit', 'test:run', 'tests', 'test'].some((nom) => (scripts[nom] ?? '').includes('vitest'))
    : false
  if (!declare) {
    return { allowed: false, reason: 'le projet ne déclare pas vitest — portée non dérivable' }
  }
  const retenus = paths.filter(cheminUtilisable)
  // Un SEUL chemin refuse suffit a rendre la portee incomplete : verifier les autres et publier
  // quand meme donnerait un vert qui ne couvre pas tout ce que l'edition a touche.
  if (!retenus.length || retenus.length !== paths.length) {
    return { allowed: false, reason: 'aucun chemin édité exploitable — portée indéterminable' }
  }
  const argv = ['vitest', 'related', ...retenus.map((c) => c.split(ANTISLASH).join('/')), '--run']
  return { allowed: true, argv, cwd, command: argv.join(' ') }
}

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
