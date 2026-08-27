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
 * LE SCRIPT DE TEST EST-IL UN LANCEMENT VITEST *UNIQUE* ? — la seule forme qui accepte des drapeaux.
 *
 * `related` et `--reporter=json` sont des notions de VITEST. Deux defauts successifs, tous deux
 * attrapes par la non-regression ou par un panel, ont montre qu'il ne suffit pas de demander
 * « le projet utilise-t-il vitest ? » :
 *
 *   1. Envoyer ces drapeaux a un projet qui teste AUTREMENT casse un projet sain : cinq tests du
 *      depot sont tombes le 2026-08-27 parce que `node -e "process.exit(0)"` recevait
 *      `--reporter=json` comme argument inconnu.
 *   2. Un booleen ne suffit pas non plus. `npm run X -- <drapeaux>` colle les arguments a la FIN de
 *      la chaine du script : sur `"test": "vitest run && eslint ."`, les drapeaux atterrissent sur
 *      `eslint`, pas sur vitest. Sonde npm reelle : la ligne lancee devient
 *      `cmd1 && cmd2 --reporter=json ...` et cmd2 sort en erreur — un FAUX ROUGE fabrique par la
 *      mesure elle-meme, sur un projet parfaitement sain. Le `npm test` de ce depot a exactement
 *      cette forme (`npm run typecheck && vitest run && npm run lint`).
 *
 * On exige donc une commande SIMPLE : elle mentionne vitest et ne contient aucun enchainement. Tout
 * le reste retombe sur la mesure sans rapport, c'est-a-dire le comportement d'avant.
 */
const ENCHAINEMENT = /(?:&&|\|\||;|&|\|)/

export function scriptVitestUnique(
  cwd: string,
  lireScripts: (dir: string) => Record<string, string> | null = scriptsDeclares
): boolean {
  const scripts = lireScripts(cwd)
  if (!scripts) return false
  for (const nom of ['test:unit', 'test:run', 'tests', 'test']) {
    const corps = scripts[nom]
    if (typeof corps !== 'string' || !corps.includes('vitest')) continue
    // Le PREMIER script trouve est celui que `resolveVerifyCmd` retiendra : c'est lui qui decide,
    // pas le plus favorable. Repondre sur un autre serait juger une commande non jouee.
    return !ENCHAINEMENT.test(corps)
  }
  return false
}

/** Conserve pour la voie de PORTEE, qui n'ajoute aucun drapeau : seul « vitest existe-t-il ? » compte. */
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
 * TROISIEME VERSION. L'HISTORIQUE EST LA JUSTIFICATION — le relire evite de refaire ces trous.
 *
 * v1 (revert `97f2e9dc`) decidait sur le PARSING DE LA SORTIE HUMAINE. Cinq voies prouvees vers une
 * regression publiee : sortie plafonnee a 4000 c (au-dela de ~23 echecs, le nouveau sortait de la
 * fenetre), suite coupee au plafond lue comme un ensemble complet, ligne d'echec FORGEABLE par un
 * `console.log`, nom de test sans sa RAISON, echec de collecte masquant tout un fichier.
 *
 * v2 a change de SOURCE (ce fichier JSON) et ferme ces cinq voies. Un second panel en a prouve
 * quatre nouvelles, toutes dans ce que le JSON NE DIT PAS — c'est la lecon de fond : changer de
 * source ne suffit pas, il faut cartographier le SILENCE de la nouvelle source.
 *   1. un echec de niveau SUITE (`beforeAll`/`afterAll` qui jette) n'est compte par AUCUN champ :
 *      `numFailedTests` l'ignore, la suite porte `status: failed` avec des assertions qui PASSENT,
 *      et `s.message` n'etait jamais lu -> regression publiee (sonde executee) ;
 *   2. l'ensemble etait un `Set` et le controle croise le comparait a `numFailedTests`, un compte de
 *      TESTS : deux tests de meme nom echouant a l'identique rendaient le differentiel non concluant
 *      A JAMAIS (faux refus permanent, sonde executee) ;
 *   3. l'empreinte de raison ne discrimine pas `toEqual` sur objets — vitest ELIDE les valeurs
 *      (`expected { …(2) } to deeply equal { …(2) }`) : deux causes differentes, meme identite. Le
 *      defaut n.4 de la v1 SURVIVAIT, et la note rendue au modele affirmait le contraire ;
 *   4. un exit 0 sans AUCUN test joue etait un vert. Mesure hors modele sur un fichier de code sans
 *      test associe : `EXIT=0`, `success: true`, `numTotalTests: 0`, publie, etiquete « verifie ».
 *
 * REGLE GENERALE : ce qu'on n'a pas su lire ne devient JAMAIS « rien de nouveau ». Toute anomalie
 * rend `concluant: false`, et un differentiel non concluant REFUSE la publication.
 *
 * CE QUI N'EST PAS FERME, ET NE PEUT PAS L'ETRE ICI (nomme, jamais dissimule) : ce rapport est ecrit
 * sur un disque ou le code teste peut ecrire, avec les MEMES DROITS que l'orchestrateur. Un panel a
 * PROUVE par execution qu'un test peut le forger (chemin publie sur l'argv du process fils, process
 * detache qui le reecrit). Les gardes ci-dessous — sanite des fichiers cites, comptes croises,
 * refus au plafond — RELEVENT le cout d'une telle fabrication ; elles ne la ferment pas. Le cadre
 * retenu est un modele FAILLIBLE (il se trompe) et non ADVERSARIAL (il triche) : fermer le second
 * demande une isolation d'execution, hors de la portee de ce module.
 */
export interface RapportDeTests {
  concluant: boolean
  /** Pourquoi le rapport n'est pas exploitable — rendu au modele, jamais tu. */
  raison?: string
  /** Identites des echecs : `<fichier> > <nom> :: <empreinte>` (+ `#n` par occurrence identique). */
  echecs: ReadonlySet<string>
  /** Nombre de tests REELLEMENT joues. `0` n'est pas un vert : c'est une absence de mesure. */
  testsJoues: number
  /** Fichiers de test collectes — sert a comparer les PERIMETRES entre AVANT et APRES. */
  fichiers: ReadonlySet<string>
}

const RAPPORT_VIDE = (raison: string): RapportDeTests => ({
  concluant: false,
  raison,
  echecs: new Set<string>(),
  testsJoues: 0,
  fichiers: new Set<string>()
})

/**
 * L'EMPREINTE D'UNE RAISON D'ECHEC — sa premiere ligne ET l'endroit ou elle s'est produite.
 *
 * C'est ce qui distingue « ce test etait deja rouge » de « ce test est rouge POUR UNE AUTRE RAISON ».
 * La premiere ligne seule ne suffit PAS : sur `toEqual`/`toMatchObject` d'un objet, vitest elide les
 * valeurs (`expected { …(2) } to deeply equal { …(2) }`), donc deux causes differentes produisent la
 * meme ligne — c'est la forme d'assertion la plus courante, et le trou etait beant.
 *
 * On y adjoint donc la premiere frame de pile HORS `node_modules`, reduite a `fichier:ligne:colonne`.
 * Elle est stable entre deux executions identiques (meme bureau, meme fichier) et bouge des que
 * l'echec change de place. Le chemin est reduit a son nom de base : un chemin absolu contient le nom
 * du bureau, qui n'a aucune raison d'entrer dans une identite.
 */
function empreinteDeRaison(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return 'sans-message'
  const premier = typeof messages[0] === 'string' ? messages[0] : ''
  const lignes = sansSequencesAnsi(premier).split(SAUT)
  let tete = ''
  let lieu = ''
  for (const brute of lignes) {
    const ligne = brute.trim()
    if (!ligne) continue
    if (!tete) {
      tete = ligne.slice(0, 200)
      continue
    }
    if (lieu) continue
    // `at <chemin>:<ligne>:<colonne>` — on garde la premiere frame qui n'est pas une dependance.
    const frame = /(?:at\s+|\()?([^\s()]+):(\d+):(\d+)\)?$/.exec(ligne)
    if (!ligne.startsWith('at ') || !frame) continue
    const chemin = frame[1].split(ANTISLASH).join('/')
    if (chemin.includes('node_modules')) continue
    lieu = `${chemin.slice(chemin.lastIndexOf('/') + 1)}:${frame[2]}:${frame[3]}`
  }
  if (!tete) return 'sans-message'
  return lieu ? `${tete} @ ${lieu}` : tete
}

export function echecsDuRapport(
  brut: string | undefined,
  /** Existence d'un fichier de test cite, RELATIVE au bureau. Absent = pas de controle de sanite. */
  fichierExiste?: (cheminRelatif: string) => boolean
): RapportDeTests {
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
  if (typeof objet.numTotalTests !== 'number' || !Number.isFinite(objet.numTotalTests)) {
    return RAPPORT_VIDE('rapport de tests sans compte de tests joués')
  }
  // Un TABLEAU, pas un Set : le controle croise ci-dessous compare des TESTS a des TESTS. Comparer
  // un compte de tests a la taille d'un ensemble DEDUPLIQUE rendait le differentiel non concluant a
  // jamais des que deux tests portaient le meme nom et la meme raison (sonde executee).
  const lignes: string[] = []
  const fichiers = new Set<string>()
  let suitesEnEchec = 0
  for (const suite of objet.testResults) {
    if (typeof suite !== 'object' || suite === null) {
      return RAPPORT_VIDE('rapport de tests de forme inattendue')
    }
    const s = suite as Record<string, unknown>
    const fichier = typeof s.name === 'string' ? s.name.split(ANTISLASH).join('/') : '?'
    fichiers.add(fichier)
    /*
     * SANITE : une suite en echec doit designer un fichier qui EXISTE. Un rapport citant un fichier
     * absent du bureau n'a pas ete produit par la mesure qu'on croit lire. Cette garde ne FERME pas
     * la fabrication (le faussaire peut citer un vrai fichier), elle en releve le cout.
     */
    if (s.status === 'failed' && fichierExiste && !fichierExiste(fichier)) {
      return RAPPORT_VIDE(`le rapport cite une suite introuvable : « ${fichier} »`)
    }
    const assertions = Array.isArray(s.assertionResults) ? s.assertionResults : []
    let echecsDeCetteSuite = 0
    for (const assertion of assertions) {
      if (typeof assertion !== 'object' || assertion === null) {
        return RAPPORT_VIDE('rapport de tests de forme inattendue')
      }
      const a = assertion as Record<string, unknown>
      if (a.status !== 'failed') continue
      echecsDeCetteSuite += 1
      const nom = typeof a.fullName === 'string' && a.fullName.trim() ? a.fullName : String(a.title)
      lignes.push(`${fichier} > ${nom} :: ${empreinteDeRaison(a.failureMessages)}`)
    }
    if (s.status === 'failed') {
      suitesEnEchec += 1
      /*
       * UNE SUITE EN ECHEC SANS ASSERTION EN ECHEC = un echec que le JSON NE COMPTE PAS.
       *
       * C'est le cas d'un `beforeAll`/`afterAll` qui jette, et d'un echec de COLLECTE. Sonde
       * executee : `numFailedTests: 1` alors que DEUX suites echouaient, la seconde avec un test qui
       * PASSE et un `message` renseigne. La v2 ne lisait ni `s.message` ni ce desaccord : la
       * regression etait publiee avec « aucun echec nouveau ». Le compter comme « un rouge de plus »
       * ne suffirait pas — ses tests ne tournent pas, donc ils ne peuvent pas apparaitre comme
       * nouveaux, et un seul `beforeAll` casse couvrirait tout le fichier. Donc : REFUS.
       */
      if (echecsDeCetteSuite === 0) {
        const cause = typeof s.message === 'string' && s.message.trim() ? s.message.trim() : 'cause hors test'
        return RAPPORT_VIDE(
          `échec de niveau suite sur « ${fichier} » (${cause.split(SAUT)[0].slice(0, 160)}) — ` +
            `aucun différentiel n'est fiable`
        )
      }
    }
  }
  /*
   * CONTROLE CROISE, sur les DEUX comptes que vitest annonce. Un rapport dont les comptes ne
   * correspondent pas a ce qu'on a extrait est un rapport qu'on n'a pas su lire, meme si chaque
   * entree lue est valide — et un ensemble retreci se lit exactement comme « rien de nouveau ».
   */
  const annonce = objet.numFailedTests
  if (typeof annonce !== 'number' || !Number.isFinite(annonce)) {
    return RAPPORT_VIDE('rapport de tests sans compte d’échecs — impossible de vérifier la lecture')
  }
  if (annonce !== lignes.length) {
    return RAPPORT_VIDE(
      `rapport de tests incohérent : ${annonce} échec(s) annoncé(s), ${lignes.length} identifié(s)`
    )
  }
  const suitesAnnoncees = objet.numFailedTestSuites
  if (typeof suitesAnnoncees === 'number' && suitesAnnoncees !== suitesEnEchec) {
    return RAPPORT_VIDE(
      `rapport de tests incohérent : ${suitesAnnoncees} suite(s) en échec annoncée(s), ` +
        `${suitesEnEchec} identifiée(s)`
    )
  }
  // `#n` par occurrence identique : deux tests de meme nom ET meme raison restent DEUX echecs, donc
  // en voir un de plus qu'avant reste detectable. Symetrique des deux cotes de la comparaison.
  const vues = new Map<string, number>()
  const echecs = new Set<string>()
  for (const ligne of lignes) {
    const rang = (vues.get(ligne) ?? 0) + 1
    vues.set(ligne, rang)
    echecs.add(rang === 1 ? ligne : `${ligne} #${rang}`)
  }
  return { concluant: true, echecs, testsJoues: objet.numTotalTests, fichiers }
}

/**
 * Le verdict d'un differentiel : ce que l'EDITION a casse, distinct de ce qui etait DEJA casse.
 *
 * `concluant: false` veut dire « on ne sait pas » — et « on ne sait pas » REFUSE.
 */
export interface VerdictDifferentiel {
  concluant: boolean
  nouvelles: readonly string[]
  preexistants: readonly string[]
  publiable: boolean
  raison?: string
  /** Tests reellement joues par la mesure d'APRES, ou `undefined` si le compte est inconnu. */
  testsJoues?: number
}

export function verdictDifferentiel(
  apresEstVert: boolean,
  apres: RapportDeTests,
  avant: RapportDeTests | undefined
): VerdictDifferentiel {
  const vide = { nouvelles: [] as string[], preexistants: [] as string[] }
  if (apresEstVert) {
    /*
     * UN EXIT 0 SANS AUCUN TEST JOUE N'EST PAS UN VERT — c'est une absence de mesure.
     *
     * Mesure hors modele : `vitest related <fichier de code sans test associe> --run` rend EXIT 0,
     * `success: true`, `numTotalTests: 0`. Toute edition d'un fichier que nul test n'exerce etait
     * donc publiee sous l'etiquette « verifie », et c'est aussi le PREMIER APPEL d'une chaine
     * prouvee : editer la configuration de vitest (un `.ts`, donc accepte) pour neutraliser la
     * verification, puis publier n'importe quoi. Ce refus coupe la chaine a son premier maillon.
     *
     * NUANCE ASSUMEE : quand AUCUN rapport n'est disponible (projet qui ne teste pas avec vitest),
     * le compte est inconnu et le vert reste publiable — c'est le comportement d'avant, et le
     * refuser casserait tout projet non-vitest. La difference est nette : ici on SAIT que rien n'a
     * tourne, la on ne sait pas.
     */
    if (apres.concluant && apres.testsJoues === 0) {
      return {
        concluant: true,
        ...vide,
        publiable: false,
        testsJoues: 0,
        raison: 'aucun test n’a été joué — un exit 0 sur une portée vide ne prouve rien'
      }
    }
    return {
      concluant: true,
      ...vide,
      publiable: true,
      ...(apres.concluant ? { testsJoues: apres.testsJoues } : {})
    }
  }
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
   * UNE BASELINE QUI N'A JOUE AUCUN TEST N'EST PAS UNE BASELINE — regle SYMETRIQUE de celle qui
   * refuse un vert a 0 test.
   *
   * DEFAUT TROUVE PAR REPETITION (3e du genre) : `vitest related` collecte parfois 0 test de facon
   * intermittente. Quand cela arrive cote BASELINE, son ensemble d'echecs est VIDE — donc tous les
   * rouges de l'APRES paraissent NOUVEAUX, et le refus ACCUSE L'EDITION d'une regression qu'elle n'a
   * pas commise. Le refus etait « juste » par accident (on ne savait pas), mais son motif etait FAUX,
   * et un motif faux envoie corriger un code sain.
   */
  if (avant.testsJoues === 0 && apres.testsJoues > 0) {
    return {
      concluant: false,
      ...vide,
      publiable: false,
      raison: 'la baseline n’a joué aucun test — elle ne peut rien attester de l’état d’avant'
    }
  }
  if (apres.echecs.size === 0) {
    return {
      concluant: false,
      ...vide,
      publiable: false,
      raison: 'verdict rouge sans aucun échec identifié — cause hors des tests'
    }
  }
  /*
   * LES DEUX MESURES DOIVENT COUVRIR LE MEME PERIMETRE. Sur la voie `vitest related`, l'ensemble
   * collecte derive du graphe d'imports : une edition qui AJOUTE un import fait collecter a l'APRES
   * des fichiers que la baseline ne voyait pas, et un rouge preexistant y devient « nouveau ». Les
   * etiquettes de commande sont identiques dans ce cas — seuls les rapports le disent.
   */
  const perimetreDivergent =
    apres.fichiers.size !== avant.fichiers.size ||
    [...apres.fichiers].some((f) => !avant.fichiers.has(f))
  if (perimetreDivergent) {
    return {
      concluant: false,
      ...vide,
      publiable: false,
      raison: 'les deux mesures ne couvrent pas le même ensemble de fichiers de test'
    }
  }
  const nouvelles = [...apres.echecs].filter((id) => !avant.echecs.has(id))
  const preexistants = [...apres.echecs].filter((id) => avant.echecs.has(id))
  return {
    concluant: true,
    nouvelles,
    preexistants,
    publiable: nouvelles.length === 0,
    testsJoues: apres.testsJoues
  }
}

/**
 * Le verdict, dit au modele. Il NOMME ce qui a ete ecarte, le nombre de tests reellement joues, et
 * ce que cette mesure NE prouve pas.
 *
 * La version precedente affirmait « un test deja rouge dont l'edition change la cause est compte
 * comme nouveau » — REFUTE par sonde pour `toEqual` sur objets. Une note qui surpromet desarme la
 * vigilance qu'elle pretend armer : elle ne dit plus que ce qui est tenu.
 */
export function noteDeDifferentiel(verdict: VerdictDifferentiel): string {
  const nommes = verdict.preexistants.slice(0, PORTEE_FICHIERS_NOMMES)
  const reste = verdict.preexistants.length - nommes.length
  const joues =
    verdict.testsJoues === undefined
      ? 'nombre de tests joués inconnu'
      : `${verdict.testsJoues} test(s) réellement joué(s)`
  return (
    `Verdict DIFFÉRENTIEL (${joues}) : ${verdict.preexistants.length} échec(s) étaient DÉJÀ rouges ` +
    `avant cette édition, avec le même test, la même raison et le même emplacement, et ont été ` +
    `écartés — ${nommes.map((n) => `« ${n} »`).join(', ')}` +
    (reste > 0 ? ` et ${reste} autre(s)` : '') +
    `. Aucun échec NOUVEAU n'est imputable à l'édition.${SAUT}` +
    `CE QUE CE RÉSULTAT NE PROUVE PAS. Il n’atteste pas que la base est verte. Un test qui ne tourne ` +
    `pas ne peut rien signaler. Et l'identité d'un échec repose sur le message du runner : deux ` +
    `causes différentes peuvent la partager quand le message élide ce qu'il compare (assertions sur ` +
    `objets), donc un rouge préexistant peut MASQUER une régression au même endroit.`
  )
}
