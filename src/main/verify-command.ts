import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { resolveVerifyCmd } from './hooks/resolve-verify-cmd'
import { sansSequencesAnsi } from '../shared/ansi'

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
 *
 * `partiel` = ce que la suite avait DEJA ecrit avant la coupure, et il revient avec le verdict.
 * DEFAUT VECU le 2026-08-25 (conv-1400) : la sortie collectee etait jetee et REMPLACEE par le seul
 * message de plafond. Apres dix minutes d'attente, l'utilisateur recevait « rien n'est prouve » et
 * pas une ligne de plus — impossible de distinguer une suite trop LENTE d'une suite BLOQUEE sur un
 * test qui ne rend jamais la main, ni de voir les rouges deja tombes. Le plafond doit borner
 * l'attente, pas effacer les faits acquis pendant cette attente.
 *
 * Le verdict, lui, ne bouge pas d'un pouce : une sortie partielle pleine de coches ne se lit JAMAIS
 * comme un vert, et le message de plafond reste en TETE pour que la raison de l'arret prime.
 */
/**
 * LE MARQUEUR D'UN ARRET AU PLAFOND, place a cote du texte qui le produit.
 *
 * `natureDeLEchec` doit reconnaitre un plafond pour ne pas le classer « tests » (conv-1410). Il ne
 * peut le faire qu'en lisant la sortie -- donc en dependant de cette phrase. La declarer ICI, sous
 * les yeux de qui edite le message, est la seule facon d'empecher les deux de deriver en silence ;
 * un test de derive verifie que le marqueur reconnait bien la sortie reelle de cette fonction.
 */
export const VERIFY_PLAFOND_MARQUEUR = /arr[eê]t[eé]e apr[eè]s \d+ s \(plafond\)/i

export function verifyTimeoutOutcome(
  command: string,
  ms: number,
  partiel: string = ''
): VerifyOutcome {
  /*
   * UN PLAFOND DOIT DIRE QUOI FAIRE.
   *
   * « rien n'est prouve » est exact mais sterile : l'agent relance la MEME commande et reperd le
   * meme temps. Mesure du 2026-08-25 : trois occurrences en une journee (conv-1400, conv-1404,
   * conv-1405), la meme commande relancee a chaque fois. Un message qui ne nomme aucune issue
   * fabrique la boucle qu'il constate.
   */
  const plafond =
    `vérification arrêtée après ${Math.round(ms / 1000)} s (plafond) — rien n'est prouvé, ` +
    `la suite n'a pas rendu son verdict.${SAUT}` +
    `Ne relance pas la même commande : donne-lui une cible (« verify <fichier> » rejoue les tests ` +
    `qui importent ce fichier, mesuré 20 à 70 s), ou relève le plafond via ` +
    `AUTOWIN_VERIFY_TIMEOUT_MS si la suite entière est vraiment ce qu'il faut prouver.`
  const acquis = capVerifyOutput(partiel)
  return {
    ok: false,
    exitCode: null,
    command,
    output: acquis
      ? `${plafond}${SAUT}${SAUT}Ce que la suite avait écrit avant d'être coupée :${SAUT}${acquis}`
      : plafond
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

/**
 * LE PROJET TESTE-T-IL AVEC VITEST ? — la seule question qui autorise une notion vitest.
 *
 * `related` et le rapport `--reporter=json` sont des notions de VITEST. Les envoyer a un projet qui
 * teste autrement fabrique un « lancement impossible », donc un REFUS de publier, sur un projet
 * parfaitement sain. DEFAUT ATTRAPE PAR LA NON-REGRESSION le 2026-08-27 : cinq tests de
 * `commands.test.ts` declarent `test:unit: node -e "process.exit(0)"` et se sont mis a echouer des
 * que des drapeaux de rapport ont ete ajoutes a leur commande — node les recevait comme des
 * arguments inconnus. Un projet non-vitest doit garder EXACTEMENT le comportement d'avant.
 */
export function declareVitest(
  cwd: string,
  lireScripts: (dir: string) => Record<string, string> | null = scriptsDeclares
): boolean {
  const scripts = lireScripts(cwd)
  if (!scripts) return false
  return ['test:unit', 'test:run', 'tests', 'test'].some((nom) =>
    (scripts[nom] ?? '').includes('vitest')
  )
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
  if (!declareVitest(cwd, lireScripts)) {
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

/**
 * LA PORTEE DERIVEE DE CE QUI A CHANGE — ou rien, et alors la suite complete reprend la main.
 *
 * `vitest related` raisonne sur un graphe d'IMPORTS : seul un fichier de code y a une place. Un
 * dossier non suivi (`node_modules/`, `.autowin-data/`), un `.md`, un `.json` de configuration n'y
 * entrent pas — les router vers la portee fabriquerait un vert qui n'a rien mesure.
 *
 * ATTRAPE PAR SON PROPRE TEST DE RETROCOMPAT le 2026-08-25 : sur un arbre cense etre propre, le
 * `node_modules` non suivi devenait la cible et la commande jouee etait
 * `vitest related node_modules/ --run`. Un vert vide est pire qu'une suite lente.
 *
 * REGLE STRICTE, et c'est le point : la portee n'est derivable que si TOUT ce qui a change est du
 * code. Des qu'un seul chemin echappe au graphe d'imports, la portee ne couvre plus ce qui a bouge —
 * et une portee incomplete presentee comme un verdict est exactement le faux vert qu'on evite.
 * Meme regle que `decideRelatedVerify`, qui refuse deja un lot de chemins partiellement exploitable.
 */
const EXTENSIONS_DE_CODE = /[.](?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

export function porteeDerivableDesChangements(
  chemins: readonly string[]
): readonly string[] | undefined {
  if (chemins.length === 0) return undefined
  const normalises = chemins.map((chemin) => chemin.split(ANTISLASH).join('/'))
  if (!normalises.every((chemin) => EXTENSIONS_DE_CODE.test(chemin))) return undefined
  return normalises
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

function sansCouleur(ligne: string): string {
  return sansSequencesAnsi(ligne)
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
  /*
   * DEPOUILLER A L'ENTREE, une fois pour toutes.
   *
   * DEFAUT VECU le 2026-08-25 (conv-1404) : le panneau de `verify` affichait des lignes entieres de
   * codes de couleur. `sansCouleur` existait — mais elle ne servait qu'a TESTER la ligne contre le
   * motif de verdict : la ligne RETENUE gardait ses couleurs, et la queue aussi. Depouiller ici, au
   * seul entonnoir de ce qui est rendu, rend le geste inratable ; et le plafond se mesure enfin sur
   * du texte VISIBLE, au lieu de laisser les octets d'echappement manger le budget.
   */
  const text = sansSequencesAnsi(raw).trim()
  if (text.length <= cap) return text
  const omitted = text.length - cap
  const marker = `…[tronqué — ${omitted} caractères omis]` + SAUT
  const restant = Math.max(0, cap - marker.length)
  const verdict = verdictDe(text, Math.floor(restant / 2))
  const queue = restant - (verdict ? verdict.length + 1 : 0)
  const fin = queue > 0 ? text.slice(-queue) : ''
  return verdict ? marker + verdict + SAUT + fin : marker + fin
}

/** Au-delà, la note inonderait le contexte du tour : on nomme les premiers, on compte le reste. */
const PORTEE_FICHIERS_NOMMES = 5

/**
 * NOMME LA PORTÉE D'UN VERT — rend `undefined` quand il n'y a rien à nuancer.
 *
 * Une suite lancée dans un arbre de travail SALE mesure l'arbre, jamais l'état commité : les deux
 * diffèrent exactement de la valeur du `git status`. Sur un dépôt où plusieurs sessions écrivent,
 * cet écart n'est pas théorique — il contient les correctifs en vol des autres, ET leurs
 * suppressions, qui masquent un rouge en empêchant un test de s'exécuter.
 *
 * Mesuré le 2026-08-22 (conv-1371) : « exit 0, 713 fichiers / 7754 tests » a été rendu, puis lu
 * comme « base unitaire prouvée verte, prête pour la fusion » — alors que `origin/main` portait
 * 3 tests rouges au même instant. `verify` ne peut pas empêcher cette conclusion, mais il peut
 * cesser de la laisser paraître fondée.
 *
 * Reprend la règle déjà posée par `edit_file` : un vert dont on ignore l'étendue se lit plus large
 * qu'il n'est. Et celle du gate : NOMMER, pas compter — « 14 fichiers » n'est pas actionnable.
 */
export function porteeDuVert(fichiersNonCommites: readonly string[]): string | undefined {
  const sales = fichiersNonCommites.map((f) => f.trim()).filter((f) => f.length > 0)
  if (sales.length === 0) return undefined
  const nommes = sales.slice(0, PORTEE_FICHIERS_NOMMES)
  const reste = sales.length - nommes.length
  const liste = nommes.map((f) => `« ${f} »`).join(', ') + (reste > 0 ? ` et ${reste} autre(s)` : '')
  return (
    `Portée de ce résultat : il mesure l'ARBRE DE TRAVAIL, qui contient ${sales.length} fichier(s) ` +
    `non commité(s) — ${liste}. Il n'atteste pas l'état commité, et ne suffit donc pas à conclure ` +
    `avant une fusion : un fichier de test supprimé mais non commité ne rend pas vert, il se tait. ` +
    `Pour juger la cible de fusion, rejouer sur une copie propre de cette base.`
  )
}

/**
 * Le verdict d'une cible proposee par le modele : acceptee, ou refusee AVEC son motif.
 *
 * `parPortee` distingue les deux façons de verifier une cible ACCEPTEE :
 *   - absent  -> la cible EST un test : on le joue directement ;
 *   - `true`  -> la cible est une SOURCE : on joue les tests qui l'IMPORTENT (`vitest related`).
 */
export type VerdictDeCible =
  | { ok: true; chemin: string; parPortee?: true }
  | { ok: false; raison: string }

/**
 * Motifs de fichier de TEST acceptes. Volontairement etroits : ce point d'entree ne doit jamais
 * pouvoir executer un fichier quelconque du depot.
 */
const MOTIF_FICHIER_DE_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * VALIDE une cible de verification proposee par le modele.
 *
 * POURQUOI CE POINT EXISTE, vecu le 2026-08-25 : un agent de chat devait prouver UN fichier de test.
 * Il ne pouvait pas -- `verify` ne prenait aucun argument et rejouait la suite entiere, plafonnee a
 * 600 s, qu'elle depasse. Quatre tentatives, quatre refus. Faute de pouvoir executer, il a
 * diagnostique par lecture statique et affirme un defaut « certain » que l'execution a refute.
 *
 * ON NE DONNE PAS BASH POUR AUTANT : la voie `--allowedTools "Bash(npm test)"` a ete mesuree sur le
 * vrai binaire et INVALIDEE -- le pattern ne restreint rien, `echo BONJOUR` passait, avec et sans
 * bypassPermissions. « Bash mais seulement npm test » n'existe pas ; c'est Bash tout court.
 *
 * On donne donc le droit de NOMMER, pas d'executer. La frontiere ne bouge pas : Autowin construit
 * l'argv, `shell: false`, arguments separes -- aucune interpolation, donc aucune injection, meme si
 * ces gardes evoluaient. Le modele ne fournit qu'un chemin, et ce chemin doit etre :
 *   - RELATIF et contenu dans le depot (ni absolu, ni remontant) ;
 *   - hors de `.git` -- un nom peut ressembler a un test tout en visant le depot lui-meme ;
 *   - un fichier de TEST, pas du code quelconque ;
 *   - EXISTANT : un fichier absent fait sortir vitest en erreur, mais compter sur ce hasard serait
 *     fragile, et un « vert » sur une suite vide serait le pire des resultats ;
 *   - un fichier UNIQUE, pas un joker.
 *
 * Chaque refus porte son MOTIF : un refus muet renvoie le modele a la devinette, et c'est exactement
 * ce qui a produit le diagnostic statique errone.
 */
export function cibleDeVerification(
  cible: string,
  racine: string,
  existe: (chemin: string) => boolean = existsSync
): VerdictDeCible {
  const brut = (cible ?? '').trim()
  if (!brut) return { ok: false, raison: 'aucune cible fournie' }
  const normalise = brut.split('\\').join('/')

  if (normalise.includes('*') || normalise.includes('?')) {
    return { ok: false, raison: 'une cible est UN fichier, pas un motif — les jokers sont refusés' }
  }
  // `isAbsolute` seul laisserait passer `C:/…` sur une machine POSIX : on teste les deux formes.
  if (isAbsolute(normalise) || /^[a-zA-Z]:\//.test(normalise) || normalise.startsWith('/')) {
    return { ok: false, raison: 'la cible doit être un chemin RELATIF au dépôt' }
  }
  const segments = normalise.split('/').filter(Boolean)
  if (segments.includes('..')) {
    return { ok: false, raison: 'la cible ne peut pas remonter hors du dépôt' }
  }
  if (segments.includes('.git')) {
    return { ok: false, raison: 'la cible ne peut pas viser le dépôt git lui-même' }
  }
  if (!existe(join(racine, ...segments))) {
    return { ok: false, raison: `la cible n’existe pas : ${normalise}` }
  }
  /*
   * UNE SOURCE EST ROUTEE, PAS REFUSEE -- corrige le 2026-08-25 apres conv-1404.
   *
   * Ce point refusait tout ce qui n'etait pas un fichier de test. Or un agent qui vient d'editer
   * `chat-pilotage-prompt.ts` demande naturellement a verifier CE fichier : le refus le laissait sans
   * issue (« la cible doit etre un fichier de test » ne dit pas quoi faire), le run echouait, et son
   * bureau restait conserve, publication incomplete. Refuser une cible valide faute d'avoir pense a
   * son cas est un FAUX refus, et il coute un run entier.
   *
   * Le mecanisme existait deja : `decideRelatedVerify` joue `vitest related <fichier> --run`, soit
   * les tests qui IMPORTENT le fichier edite. Il n'y avait donc pas a refuser, mais a ROUTER.
   *
   * Les gardes qui PROTEGENT restent intactes : remontee de chemin, chemin absolu, `.git`, joker,
   * fichier absent. Ce qui s'elargit est le TYPE de fichier, jamais la zone atteignable.
   */
  const chemin = segments.join('/')
  return MOTIF_FICHIER_DE_TEST.test(normalise)
    ? { ok: true, chemin }
    : { ok: true, chemin, parPortee: true }
}

/**
 * L'ARTEFACT STRUCTURE DE VITEST, lu comme un ENSEMBLE D'ECHECS IDENTIFIES.
 *
 * POURQUOI CE MODULE EXISTE SOUS CETTE FORME. Une premiere version (revert `97f2e9dc`) fondait la
 * decision de publier sur le parsing de la sortie HUMAINE du runner. Cinq juges externes ont PROUVE,
 * contre-exemples executes a l'appui, qu'elle publiait des regressions par cinq voies :
 *   1. la sortie est PLAFONNEE a 4000 caracteres avant la comparaison -> au-dela d'environ 23
 *      echecs, un echec NOUVEAU sortait de la fenetre lue (mesure : n=20 detecte, n=30/40/60/80
 *      publie). Le regime ou elle cassait etait exactement celui qu'elle servait : une base bruyante.
 *   2. une suite coupee au plafond de TEMPS rend une sortie PARTIELLE contenant deja des lignes
 *      d'echec -> tous presents « avant », donc publiable, alors que la suite n'a rendu aucun verdict.
 *   3. toute ligne ressemblant a un echec entrait dans l'ensemble, `console.log` COMPRIS -> vecteur
 *      d'attaque en deux appels : poser la ligne forgee (vert, publie), puis casser le test (classe
 *      « preexistant »).
 *   4. le NOM d'un test ne porte pas la RAISON de son echec -> meme nom, autre cause = « preexistant ».
 *   5. un fichier deja en echec de COLLECTE masquait toute regression de ce fichier, en un appel.
 *
 * Les quatre premieres tombent par CHANGEMENT DE SOURCE : un fichier JSON n'est pas tronque, une
 * absence de fichier est detectable, et `console.log` n'y fabrique aucune entree. La cinquieme est
 * traitee ici comme un REFUS, jamais comme un rouge ecarte.
 *
 * REGLE GENERALE DE CE MODULE : ce qu'on n'a pas su lire ne devient jamais « rien de nouveau ». Toute
 * anomalie rend `concluant: false`, et un differentiel non concluant REFUSE la publication.
 */
export interface RapportDeTests {
  concluant: boolean
  /** Pourquoi le rapport n'est pas exploitable — rendu au modele, jamais tu. */
  raison?: string
  /** Identites des echecs : `<fichier> > <nom complet> :: <empreinte de la raison>`. */
  echecs: ReadonlySet<string>
}

const RAPPORT_VIDE = (raison: string): RapportDeTests => ({
  concluant: false,
  raison,
  echecs: new Set<string>()
})

/**
 * L'EMPREINTE D'UNE RAISON D'ECHEC — la premiere ligne significative du message.
 *
 * C'est ce qui distingue « ce test etait deja rouge » de « ce test est rouge POUR UNE AUTRE RAISON ».
 * Volontairement la premiere ligne seule : elle porte l'assertion (`AssertionError: expected 1 to
 * be 2`) et rien de ce qui varie d'une execution a l'autre (durees, chemins absolus de la pile).
 */
function empreinteDeRaison(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return 'sans-message'
  const premier = typeof messages[0] === 'string' ? messages[0] : ''
  for (const ligne of sansSequencesAnsi(premier).split(SAUT)) {
    const propre = ligne.trim()
    if (propre.length > 0) return propre.slice(0, 200)
  }
  return 'sans-message'
}

export function echecsDuRapport(brut: string | undefined): RapportDeTests {
  if (!brut || !brut.trim()) {
    return RAPPORT_VIDE('aucun rapport de tests produit — rien à comparer')
  }
  let racine: unknown
  try {
    racine = JSON.parse(brut)
  } catch {
    return RAPPORT_VIDE('rapport de tests illisible (JSON invalide)')
  }
  if (typeof racine !== 'object' || racine === null || Array.isArray(racine)) {
    return RAPPORT_VIDE('rapport de tests de forme inattendue')
  }
  const objet = racine as Record<string, unknown>
  // La FORME est validee, jamais supposee : une evolution du format doit REFUSER, pas retrecir
  // silencieusement l'ensemble lu.
  if (typeof objet.success !== 'boolean' || !Array.isArray(objet.testResults)) {
    return RAPPORT_VIDE('rapport de tests incomplet (ni verdict ni résultats exploitables)')
  }
  const echecs = new Set<string>()
  for (const suite of objet.testResults) {
    if (typeof suite !== 'object' || suite === null) {
      return RAPPORT_VIDE('rapport de tests de forme inattendue')
    }
    const s = suite as Record<string, unknown>
    const fichier = typeof s.name === 'string' ? s.name.split(ANTISLASH).join('/') : '?'
    const assertions = Array.isArray(s.assertionResults) ? s.assertionResults : []
    /*
     * UN FICHIER QUI N'A PAS COLLECTE REFUSE TOUT LE DIFFERENTIEL. Le compter comme « un rouge de
     * plus » laisserait une seule erreur de syntaxe preexistante couvrir n'importe quelle regression
     * de ce fichier : ses tests ne tournent pas, donc ils ne peuvent pas apparaitre comme nouveaux.
     */
    if (s.status === 'failed' && assertions.length === 0) {
      return RAPPORT_VIDE(`échec de collecte sur « ${fichier} » — aucun différentiel n'est fiable`)
    }
    for (const assertion of assertions) {
      if (typeof assertion !== 'object' || assertion === null) {
        return RAPPORT_VIDE('rapport de tests de forme inattendue')
      }
      const a = assertion as Record<string, unknown>
      if (a.status !== 'failed') continue
      const nom = typeof a.fullName === 'string' && a.fullName.trim() ? a.fullName : String(a.title)
      echecs.add(`${fichier} > ${nom} :: ${empreinteDeRaison(a.failureMessages)}`)
    }
  }
  /*
   * CONTROLE CROISE. Un rapport dont le compte ANNONCE ne correspond pas aux echecs EXTRAITS est un
   * rapport qu'on n'a pas su lire, meme si chaque entree lue est valide. Sans cette garde, une
   * evolution du format retrecirait l'ensemble en silence — et un ensemble retreci se lit
   * exactement comme « rien de nouveau ». C'est la forme generale du defaut n°1 de la v1.
   */
  const annonce = objet.numFailedTests
  if (typeof annonce !== 'number' || !Number.isFinite(annonce)) {
    return RAPPORT_VIDE('rapport de tests sans compte d’échecs — impossible de vérifier la lecture')
  }
  if (annonce !== echecs.size) {
    return RAPPORT_VIDE(
      `rapport de tests incohérent : ${annonce} échec(s) annoncé(s), ${echecs.size} identifié(s)`
    )
  }
  return { concluant: true, echecs }
}

/**
 * Le verdict d'un differentiel : ce que l'EDITION a casse, distinct de ce qui etait DEJA casse.
 *
 * `concluant: false` veut dire « on ne sait pas » — et « on ne sait pas » REFUSE. C'est la contrainte
 * qui empeche cette mesure de devenir une fabrique de faux verts.
 */
export interface VerdictDifferentiel {
  concluant: boolean
  /** Echecs presents APRES et absents AVANT : les seuls imputables a l'edition. */
  nouvelles: readonly string[]
  /** Echecs presents dans les DEUX : le bruit de la base, ecarte mais NOMME. */
  preexistants: readonly string[]
  /** Vrai seulement si le differentiel conclut ET n'impute aucun echec nouveau. */
  publiable: boolean
  /** Pourquoi il ne conclut pas — pour que le refus ENSEIGNE au lieu d'envoyer a la devinette. */
  raison?: string
}

export function verdictDifferentiel(
  apresEstVert: boolean,
  apres: RapportDeTests,
  avant: RapportDeTests | undefined
): VerdictDifferentiel {
  const vide = { nouvelles: [] as string[], preexistants: [] as string[] }
  // Un APRES vert n'a rien a differencier — et ce chemin ne mesure aucune baseline.
  if (apresEstVert) return { concluant: true, ...vide, publiable: true }
  if (!avant) {
    return { concluant: false, ...vide, publiable: false, raison: 'baseline non mesurée' }
  }
  if (!apres.concluant) {
    return { concluant: false, ...vide, publiable: false, raison: `après : ${apres.raison}` }
  }
  if (!avant.concluant) {
    return { concluant: false, ...vide, publiable: false, raison: `avant : ${avant.raison}` }
  }
  /*
   * LE RUNNER DIT ROUGE MAIS LE RAPPORT NE PORTE AUCUN ECHEC. Crash apres ecriture, echec hors
   * test, runner introuvable : on ne sait pas ce qui s'est passe, donc on refuse.
   */
  if (apres.echecs.size === 0) {
    return {
      concluant: false,
      ...vide,
      publiable: false,
      raison: 'verdict rouge sans aucun échec identifié — cause hors des tests'
    }
  }
  const nouvelles = [...apres.echecs].filter((id) => !avant.echecs.has(id))
  const preexistants = [...apres.echecs].filter((id) => avant.echecs.has(id))
  return { concluant: true, nouvelles, preexistants, publiable: nouvelles.length === 0 }
}

/** Le verdict, dit au modele : ce qui a ete ECARTE est NOMME, et l'angle mort avec. */
export function noteDeDifferentiel(verdict: VerdictDifferentiel): string {
  const nommes = verdict.preexistants.slice(0, PORTEE_FICHIERS_NOMMES)
  const reste = verdict.preexistants.length - nommes.length
  return (
    `Verdict DIFFÉRENTIEL : ${verdict.preexistants.length} échec(s) étaient DÉJÀ rouges avant cette ` +
    `édition, à l'identique (même test, même raison), et ont été écartés — ` +
    `${nommes.map((n) => `« ${n} »`).join(', ')}` +
    (reste > 0 ? ` et ${reste} autre(s)` : '') +
    `. Aucun échec NOUVEAU n'est imputable à l'édition.${SAUT}` +
    `Ce résultat n’atteste PAS que la base est verte : il dit seulement que cette édition n'a rien ` +
    `cassé de plus. Et un rouge préexistant peut MASQUER une régression que ce différentiel ne peut ` +
    `pas voir — un test déjà rouge dont l'édition change la cause est compté comme nouveau, mais un ` +
    `test qui ne tourne pas ne peut rien signaler.`
  )
}
